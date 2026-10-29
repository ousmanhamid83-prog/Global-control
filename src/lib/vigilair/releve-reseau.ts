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
import { ageLiveAc, type LiveAc } from "./live-adsb.ts";

export type Cellule = { lat: number; lon: number; label: string };

/**
 * Cellules à interroger à ce relevé. Celles qui MANQUENT (jamais relevées, ou expirées) passent en
 * premier ; s'il en manque plus que le budget d'un relevé — démarrage à froid, retour après une
 * longue veille — on les prend TOUTES, une fois, pour que l'image soit complète tout de suite.
 * Sinon, les `parReleve` cellules les plus anciennes : un tourniquet qui ne laisse personne vieillir
 * plus que les autres.
 */
export function cellulesDuReleve(
  cellules: readonly Cellule[],
  releveeA: ReadonlyMap<string, number>,
  parReleve: number,
): Cellule[] {
  const manquantes = cellules.filter((c) => !releveeA.has(c.label));
  if (manquantes.length > parReleve) return manquantes;
  return [...cellules]
    .sort(
      (a, b) =>
        (releveeA.get(a.label) ?? Number.NEGATIVE_INFINITY) -
        (releveeA.get(b.label) ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, parReleve);
}

/**
 * Durée de vie d'une cellule en cache : DEUX tours de rotation à la cadence nominale, pour qu'elle
 * soit encore servie quand la rotation repasse, même si les relevés s'espacent.
 */
export function vieCellule(nbCellules: number, parReleve: number, cadenceMs: number): number {
  return 2 * Math.ceil(nbCellules / parReleve) * cadenceMs;
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
