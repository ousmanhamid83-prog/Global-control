/**
 * PORTÉE RÉELLEMENT ATTEINTE — cœur PUR, testable.
 *
 * Un poste qui affiche « portée 1200 km » et ne montre rien au-delà de 10 km pose une question que
 * le logiciel doit savoir trancher lui-même : est-ce que RIEN ne vole là-bas, est-ce que personne
 * ne l'entend, ou est-ce que NOUS coupons quelque part ? Sans cette réponse, l'opérateur ne peut
 * pas distinguer un ciel vide d'un capteur sourd — et un scope vide est alors indiscernable d'un
 * scope en panne.
 *
 * Ce module ne mesure donc PAS la portée théorique (celle du réglage), mais la portée CONSTATÉE :
 * la distance des positions réellement reçues. C'est un fait, pas une promesse.
 *
 * Mesuré en réel (octobre 2026) sur les agrégateurs réseau : 0 avion dans un rayon de 463 km autour
 * de N'Djamena, 62 autour de Tunis, 960 autour de Paris — avec la même requête, qui répond HTTP 200
 * dans les trois cas. Le Tchad n'est pas un trou de logiciel, c'est un trou de RÉCEPTEURS. Seule une
 * antenne locale y donne de vrais avions, et c'est sa portée à elle qu'il faut pouvoir lire.
 *
 * Géométrie et statistique de réception, jamais d'identité.
 */

/** Bornes des anneaux de distance (km). Resserrées en bas : c'est là que se joue le diagnostic. */
export const RING_KM = [5, 10, 25, 50, 100, 200, 400, 800] as const;

export type RangeProfile = {
  /** Nombre de positions prises en compte. */
  n: number;
  /** La plus lointaine réellement reçue (km). 0 si rien. */
  maxKm: number;
  /** Distance médiane : dit où se trouve le gros du trafic entendu. */
  medKm: number;
  /**
   * Compte par anneau, dans l'ordre de RING_KM, plus un dernier seau pour « au-delà du dernier
   * anneau ». Longueur = RING_KM.length + 1.
   */
  bins: number[];
};

/**
 * Profil de distance d'un lot de positions reçues. Prend les distances déjà calculées : ce module
 * ne refait pas de géométrie, il la résume.
 */
export function rangeProfile(distancesKm: number[]): RangeProfile {
  const bins = new Array<number>(RING_KM.length + 1).fill(0);
  const bons = distancesKm.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  for (const d of bons) {
    let i = RING_KM.findIndex((r) => d <= r);
    if (i < 0) i = RING_KM.length;
    bins[i]! += 1;
  }
  if (bons.length === 0) return { n: 0, maxKm: 0, medKm: 0, bins };
  return {
    n: bons.length,
    maxKm: bons[bons.length - 1]!,
    medKm: bons[Math.floor(bons.length / 2)]!,
    bins,
  };
}

/**
 * Portée en deçà de laquelle une antenne 1090 au sol est manifestement bridée par son installation
 * et non par la physique. Le 1090 MHz est une liaison à vue : l'horizon radio d'un avion de ligne
 * dépasse largement 200 km. Entendre moins de 25 km, c'est un symptôme d'installation (antenne à
 * l'intérieur, câble trop long, pas de vue dégagée), pas une fatalité.
 */
export const PORTEE_COURTE_KM = 25;

/** Au-delà, l'installation fait son travail : c'est une portée normale pour une antenne au sol. */
export const PORTEE_NORMALE_KM = 120;

export type PorteeVerdict = {
  /** Y a-t-il de quoi conclure ? */
  concluant: boolean;
  /** Ce que le poste peut affirmer, sans le dépasser. */
  texte: string;
  /** Faut-il attirer l'œil de l'opérateur ? */
  alerte: boolean;
};

/**
 * Ce que la portée constatée permet d'AFFIRMER — et rien de plus. On ne conclut jamais d'un
 * échantillon vide : « aucune position » veut dire qu'on ne sait pas, pas que l'antenne est mauvaise.
 */
export function porteeVerdict(p: RangeProfile, antenneBranchee: boolean): PorteeVerdict {
  if (!antenneBranchee) {
    return {
      concluant: false,
      texte: "Aucune antenne locale déclarée : la veille ne tient qu'au réseau.",
      alerte: false,
    };
  }
  if (p.n === 0) {
    return {
      concluant: false,
      texte: "Antenne branchée, aucune position reçue : rien à conclure sur la portée.",
      alerte: true,
    };
  }
  // Un maximum tiré de deux ou trois positions ne dit pas grand-chose : on le signale comme tel.
  const maigre = p.n < 10;
  if (p.maxKm < PORTEE_COURTE_KM) {
    return {
      concluant: !maigre,
      texte: `Portée constatée ${p.maxKm.toFixed(0)} km sur ${p.n} position${p.n > 1 ? "s" : ""}. Le 1090 MHz porte à vue : moins de ${PORTEE_COURTE_KM} km vient de l'installation (antenne à l'intérieur, câble trop long, vue bouchée), pas du logiciel — qui n'écarte rien en deçà de 800 km.`,
      alerte: true,
    };
  }
  if (p.maxKm < PORTEE_NORMALE_KM) {
    return {
      concluant: !maigre,
      texte: `Portée constatée ${p.maxKm.toFixed(0)} km (médiane ${p.medKm.toFixed(0)} km) sur ${p.n} positions. Correcte mais perfectible : surélever l'antenne et dégager l'horizon gagne le plus.`,
      alerte: false,
    };
  }
  return {
    concluant: !maigre,
    texte: `Portée constatée ${p.maxKm.toFixed(0)} km (médiane ${p.medKm.toFixed(0)} km) sur ${p.n} positions. Normale pour une antenne au sol.`,
    alerte: false,
  };
}

export type CellOutcome = {
  label: string;
  /** La cellule a-t-elle répondu ? */
  repondu: boolean;
  /** Refusée pour cause de débit (HTTP 429) : ce n'est PAS un ciel vide. */
  refusee: boolean;
  /** Avions rendus par la cellule quand elle a répondu. */
  avions: number;
};

export type CouvertureVerdict = {
  interrogees: number;
  repondues: number;
  refusees: number;
  muettes: number;
  /** Cellules qui ont répondu SANS aucun avion : zone sans récepteur, pas panne. */
  videsConfirmees: number;
  avions: number;
  texte: string;
};

/**
 * Pourquoi le scope est vide, dit honnêtement. Le piège qu'on refuse : traiter « on m'a refusé la
 * requête » et « j'ai regardé, il n'y a personne » comme la même chose. Le premier est une panne de
 * notre côté, le second est un fait sur le ciel — et l'opérateur doit pouvoir les séparer, sinon un
 * capteur muet se déguise en calme plat.
 */
export function couvertureVerdict(cells: CellOutcome[]): CouvertureVerdict {
  const interrogees = cells.length;
  const repondues = cells.filter((c) => c.repondu).length;
  const refusees = cells.filter((c) => c.refusee).length;
  const muettes = cells.filter((c) => !c.repondu && !c.refusee).length;
  const videsConfirmees = cells.filter((c) => c.repondu && c.avions === 0).length;
  const avions = cells.reduce((s, c) => s + (c.repondu ? c.avions : 0), 0);
  let texte: string;
  if (interrogees === 0) {
    texte = "Aucune cellule interrogée.";
  } else if (repondues === 0) {
    texte = `Aucune cellule n'a répondu (${refusees} refusée${refusees > 1 ? "s" : ""} pour débit, ${muettes} en échec) : le vide affiché ne dit RIEN sur le ciel.`;
  } else if (avions === 0) {
    texte = `${repondues}/${interrogees} cellules ont répondu, zéro avion : aucun récepteur dans ces zones — le ciel n'est pas vide, c'est l'écoute qui manque.`;
  } else {
    texte = `${avions} avions sur ${repondues}/${interrogees} cellules${refusees > 0 ? ` (${refusees} refusée${refusees > 1 ? "s" : ""} pour débit)` : ""}.`;
  }
  return { interrogees, repondues, refusees, muettes, videsConfirmees, avions, texte };
}
