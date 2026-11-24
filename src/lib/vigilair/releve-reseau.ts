/**
 * RELEVÉ RÉSEAU 1090ES — cœur PUR, testable : quelles cellules interroger à ce relevé, et comment
 * réunir des lots relevés à des instants différents sans fausser l'heure d'observation.
 *
 * Mesuré sur 5 min de vraies images, à froid, avant ce module :
 *  - le continent (21 cellules) était interrogé trois cellules par relevé, en tourniquet : un tour
 *    prenait ~168 s, mais une cellule n'était gardée que 100 s. Chaque cellule DISPARAISSAIT donc
 *    ~40 % du temps — l'image est tombée de 215 avions à 20, 186 pistes ont été perdues puis
 *    renées, et leur confirmation repartait de zéro à chaque fois ;
 *  - au démarrage, l'image se remplissait trois cellules à la fois : plus de deux minutes avant
 *    d'être complète ;
 *  - chaque cellule gardait l'âge de son propre relevé, et l'image en recevait un autre, tamponné
 *    quand le DERNIER flux (METAR, SIGMET…) avait répondu : l'heure d'observation des rapports
 *    resservis glissait de 2,2 à 3,7 s à chaque rafraîchissement — des positions qui sautillent.
 */
import { deadReckon } from "./coast.ts";
import { haversineKm } from "./geo.ts";
import { ageLiveAc, type LiveAc } from "./live-adsb.ts";

export type Cellule = { lat: number; lon: number; label: string };

/** Ce qu'une cellule a rendu à son dernier relevé : son heure, et combien d'avions. */
export type EtatCellule = { at: number; avions: number };

/**
 * Le rythme d'une cellule. Mesuré en réel le 23 novembre 2026 sur les 139 cellules de l'Afrique et
 * du Moyen-Orient : 29 rendaient des avions, 70 aucun — un trou de récepteurs, pas de logiciel.
 * Une cellule active revient vite ; une vide plus rarement, mais toujours : le jour où un récepteur
 * y apparaît, il est pris.
 */
export type Rythme = { active: number; vide: number };

/** Combien de cellules par relevé, combien d'entre elles gardées aux non-actives, à quel rythme. */
export type PlanReleve = { parReleve: number; reserve: number; rythme: Rythme };

/**
 * Le plan du poste : une cellule active toutes les minutes, une vide tous les quarts d'heure ; au
 * plus 16 cellules par relevé (un relevé toutes les 20 s), soit 0,8 requête par seconde, dont 2
 * places toujours gardées aux cellules vides ou jamais relevées. Mesuré le 23 novembre 2026 :
 * adsb.fi accepte des lots de 4 toutes les 2 s (40 sur 40) et refuse les rafales ; adsb.lol n'en
 * accorde que 500 par jour (en-tête x-ratelimit-limit).
 */
export const PLAN_RELEVE: PlanReleve = {
  parReleve: 16,
  reserve: 2,
  rythme: { active: 60_000, vide: 15 * 60_000 },
};

/** Quand relever la cellule : jamais relevée, tout de suite ; sinon selon ce qu'elle a rendu. */
export function echeance(etat: EtatCellule | undefined, r: Rythme): number {
  if (!etat) return Number.NEGATIVE_INFINITY;
  return etat.at + (etat.avions > 0 ? r.active : r.vide);
}

/**
 * Cellules à interroger à ce relevé, parmi celles dont l'échéance est passée, au plus `parReleve` :
 * d'abord les actives, la plus en retard d'abord (une active qui expire, ce sont des pistes perdues
 * puis renées) ; mais `reserve` places vont toujours aux autres, jamais relevées d'abord (dans
 * l'ordre de la liste), puis les vides : sans cela, des actives nombreuses les affameraient, et un
 * nouveau récepteur ne serait jamais découvert. Les API publiques refusent les rafales (mesuré :
 * 139 cellules en 10 s, 133 refus 429) : au démarrage, l'image se remplit par lots.
 */
export function cellulesDuReleve(
  cellules: readonly Cellule[],
  etats: ReadonlyMap<string, EtatCellule>,
  maintenant: number,
  plan: PlanReleve,
): Cellule[] {
  const dues = cellules
    .map((c) => {
      const etat = etats.get(c.label);
      return { c, e: echeance(etat, plan.rythme), active: (etat?.avions ?? 0) > 0 };
    })
    .filter((x) => x.e <= maintenant)
    .sort((x, y) => x.e - y.e);
  const actives = dues.filter((x) => x.active);
  const autres = dues.filter((x) => !x.active);
  const pourAutres = Math.min(autres.length, plan.reserve);
  const prises = actives.slice(0, plan.parReleve - pourAutres);
  const reste = plan.parReleve - prises.length;
  return [...prises, ...autres.slice(0, reste)].map((x) => x.c);
}

/**
 * Durée de vie d'une cellule en cache : trois fois son rythme, pour qu'elle soit encore servie
 * quand la rotation repasse en retard (relevés espacés, échéances en file).
 */
export function vieCellule(etat: EtatCellule, r: Rythme): number {
  return 3 * (etat.avions > 0 ? r.active : r.vide);
}

/** Sans en-tête lisible, une source qui refuse est laissée une minute. */
const REPOS_DEFAUT_MS = 60_000;
/** Jamais plus d'un jour : la fenêtre d'adsb.lol (w=86400). */
const REPOS_MAX_MS = 86_400_000;

/**
 * Jusqu'à quand laisser une source publique de côté, d'après sa réponse. adsb.lol n'accorde que
 * 500 requêtes par jour et le dit dans chaque réponse : `x-ratelimit-remaining`, et
 * `x-ratelimit-reset`, les secondes jusqu'à la remise à zéro (minuit UTC ; mesuré le 23 novembre
 * 2026). Quand il n'en reste plus, ou sur un refus 429, la source attend sa remise à zéro au lieu
 * d'essuyer un refus à chaque cellule. `null` : la source reste ouverte.
 */
export function reposSource(
  statut: number,
  entete: (nom: string) => string | null,
  maintenant: number,
): number | null {
  if (statut !== 429 && entete("x-ratelimit-remaining") !== "0") return null;
  // Sans en-tête, Number(null) vaut 0 : le repos par défaut.
  const secondes = Number(entete("x-ratelimit-reset"));
  const ms = secondes > 0 ? Math.min(secondes * 1000, REPOS_MAX_MS) : REPOS_DEFAUT_MS;
  return maintenant + ms;
}

/** Une liste d'avions et l'heure (horloge du poste) à laquelle son âge `seenS` était exact. */
export type Lot = { ac: LiveAc[]; at: number };

/**
 * Réunit des lots relevés à des instants différents en UNE liste, dont tous les âges sont exacts à
 * `refAt`. Par avion, le rapport le plus frais l'emporte ; une urgence ou un drapeau militaire vus
 * dans un autre lot ne se perdent pas.
 */
export function reunirLots(lots: readonly Lot[], refAt: number): LiveAc[] {
  const parHex = new Map<string, LiveAc>();
  for (const lot of lots) {
    for (const ac of ageLiveAc(lot.ac, (refAt - lot.at) / 1000)) {
      const prev = parHex.get(ac.hex);
      if (!prev || ac.seenS <= prev.seenS) {
        parHex.set(ac.hex, {
          ...ac,
          emergency: ac.emergency ?? prev?.emergency ?? null,
          military: ac.military || Boolean(prev?.military),
        });
      } else if (!prev.emergency && ac.emergency) {
        parHex.set(ac.hex, { ...prev, emergency: ac.emergency });
      }
    }
  }
  return [...parHex.values()];
}

/** Le rayon d'une cellule : les 250 milles marins de la requête. */
export const RAYON_CELLULE_KM = 250 * 1.852;

/** Le dernier rapport connu d'un avion, et l'heure (horloge du poste) où son âge était exact. */
export type Rapport = { ac: LiveAc; at: number };

/**
 * Les avions absents des relevés frais, gardés avec leur dernier rapport : son âge le dit, et la
 * console en fait une piste mémoire, son incertitude qui grandit. Un relevé de cellule ne rend
 * que les avions dont la position est fraîche : en bord de couverture ou à basse altitude, un
 * avion qui vole encore manque des relevés entiers. Mesuré le 23 et le 24 novembre 2026 sans cette
 * règle (160 cellules, une active revenant en ~90 s) : 55 pistes perdues puis renées en 6 min la
 * nuit, 136 en 11 min le jour, leur confirmation repartie de zéro ; revenues 124 à 689 s après
 * leur dernier rapport, la moitié avant 222 s, 77 % avant 300 s.
 *
 * Un avion sorti de toutes les cellules s'en va, et aucun n'est gardé plus de `limiteS` secondes
 * sans rapport. Attendre qu'une cellule le « constate » absent ne marche pas : essayé le 24, la
 * cellule relevée après son dernier rapport le manquait comme les autres, puis il revenait.
 */
export function pasEncoreAbsents(
  derniers: Iterable<Rapport>,
  presents: ReadonlySet<string>,
  cellules: readonly Cellule[],
  maintenant: number,
  limiteS: number,
): Rapport[] {
  const gardes: Rapport[] = [];
  for (const r of derniers) {
    if (presents.has(r.ac.hex)) continue;
    const silenceS = (maintenant - r.at) / 1000 + r.ac.seenS;
    if (silenceS > limiteS) continue;
    const p = deadReckon(
      { lat: r.ac.lat, lon: r.ac.lon, heading: r.ac.track, speedKmh: r.ac.gsKmh },
      silenceS,
    );
    if (cellules.some((c) => haversineKm(p.lat, p.lon, c.lat, c.lon) <= RAYON_CELLULE_KM)) {
      gardes.push(r);
    }
  }
  return gardes;
}
