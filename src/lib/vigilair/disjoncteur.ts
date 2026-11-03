/**
 * Disjoncteur par source d'imagerie. Le poste isolé est souvent au bout d'une liaison lente ou
 * coupée. Sans garde-fou, chaque tuile satellite attend le délai plein (≈ 10 s) avant d'abandonner ;
 * le navigateur n'ouvrant que ~6 connexions par hôte, quelques centaines de tuiles lentes prennent
 * TOUTES les connexions et AFFAMENT les appels serveur dont dépend la console — qui reste alors
 * bloquée sur « Chargement du poste… ».
 *
 * Le disjoncteur compte les échecs de CONNEXION (délai dépassé, réseau coupé) par source. Après
 * quelques échecs d'affilée, il « ouvre » : pendant une pause, les tuiles vers cette source
 * reviennent VIDE tout de suite, sans retenir de connexion. La pause écoulée, il laisse repasser
 * UNE tuile d'essai (mi-ouvert) ; un succès referme, un échec rouvre. Avant, toutes repassaient à
 * la fois : toutes les 45 s, une vague de tuiles attendait chacune le délai plein et reprenait les
 * six connexions. Un « rien ici » du fournisseur (404) n'est PAS un échec de connexion : la source
 * répond, le disjoncteur reste fermé.
 */
export type EtatDisjoncteur = "fermé" | "ouvert";

export type Disjoncteur = {
  /** true si l'on peut tenter un appel vers cette source maintenant. */
  passe: (cle: string) => boolean;
  /** La source a répondu (même « rien ici ») : elle est joignable. */
  succes: (cle: string) => void;
  /** La source n'a pas répondu (délai, réseau) : échec de connexion. */
  echec: (cle: string) => void;
  etat: (cle: string) => EtatDisjoncteur;
};

type Etat = { echecs: number; ouvertJusqu: number; essai: boolean };

export function creerDisjoncteur(opts?: {
  /** Échecs de connexion d'affilée avant d'ouvrir (défaut 3). */
  seuil?: number;
  /** Durée d'ouverture, en ms (défaut 45 000). */
  pauseMs?: number;
  /** Horloge, pour les tests. */
  maintenant?: () => number;
}): Disjoncteur {
  const seuil = opts?.seuil ?? 3;
  const pauseMs = opts?.pauseMs ?? 45_000;
  const horloge = opts?.maintenant ?? Date.now;
  const etats = new Map<string, Etat>();
  const etat = (cle: string): Etat => {
    let e = etats.get(cle);
    if (!e) {
      e = { echecs: 0, ouvertJusqu: 0, essai: false };
      etats.set(cle, e);
    }
    return e;
  };
  return {
    passe(cle) {
      const e = etat(cle);
      if (horloge() < e.ouvertJusqu) return false;
      // Mi-ouvert : une tuile d'essai à la fois, les autres reviennent vides sans attendre.
      if (e.echecs >= seuil) {
        if (e.essai) return false;
        e.essai = true;
      }
      return true;
    },
    succes(cle) {
      const e = etat(cle);
      e.echecs = 0;
      e.ouvertJusqu = 0;
    },
    echec(cle) {
      const e = etat(cle);
      e.echecs += 1;
      e.essai = false;
      // Au seuil, on ouvre. Un échec en mi-ouvert (echecs déjà ≥ seuil) rouvre aussitôt.
      if (e.echecs >= seuil) e.ouvertJusqu = horloge() + pauseMs;
    },
    etat(cle) {
      return horloge() < etat(cle).ouvertJusqu ? "ouvert" : "fermé";
    },
  };
}
