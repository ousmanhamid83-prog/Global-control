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
 * (mi-ouvert) ; un succès referme, un échec rouvre. Un « rien ici » du fournisseur (404) n'est PAS
 * un échec de connexion : la source répond, le disjoncteur reste fermé.
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

type Etat = { echecs: number; ouvertJusqu: number };

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
      e = { echecs: 0, ouvertJusqu: 0 };
      etats.set(cle, e);
    }
    return e;
  };
  return {
    passe(cle) {
      return horloge() >= etat(cle).ouvertJusqu;
    },
    succes(cle) {
      const e = etat(cle);
      e.echecs = 0;
      e.ouvertJusqu = 0;
    },
    echec(cle) {
      const e = etat(cle);
      e.echecs += 1;
      // Au seuil, on ouvre. Un échec en mi-ouvert (echecs déjà ≥ seuil) rouvre aussitôt.
      if (e.echecs >= seuil) e.ouvertJusqu = horloge() + pauseMs;
    },
    etat(cle) {
      return horloge() < etat(cle).ouvertJusqu ? "ouvert" : "fermé";
    },
  };
}
