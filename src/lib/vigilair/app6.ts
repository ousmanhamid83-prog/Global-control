/**
 * Symbologie APP-6 / 2525 réduite à ce que VIGILAIR sait vraiment d'une piste : l'affiliation
 * (donnée par le cadre), la dimension (ici toujours « air »), et quelques amplificateurs.
 *
 * VIGILAIR est un poste de réception : il ne distribue rien, n'interroge rien. L'affiliation est
 * une lecture, jamais une désignation de tir. « Inconnu » est l'état par défaut assumé : une piste
 * sans IFF ami et sans mandat connu reste INCONNU, pas HOSTILE.
 */

import type { Threat, Track } from "./types";

/** Ami par affiliation (FATL / ASECNA), distinct de l'origine constructeur. */
function isFriend(t: Track): boolean {
  return t.friendKind === "fatl" || t.friendKind === "asecna";
}

/** Affiliation standard STANAG : la forme du cadre en dépend. */
export type Affiliation = "ami" | "hostile" | "neutre" | "suspect" | "inconnu";

export type App6Symbol = {
  affiliation: Affiliation;
  /** HOSTILE/SUSPECT seulement sur mandat (origine sous surveillance) ; jamais par défaut. */
  reason: string;
  emergency: boolean;
  /** Tête de raid : amplificateur, pas une affiliation. */
  raidLead: boolean;
  /** NIC faible : position GNSS douteuse, possible brouillage. */
  gnssSuspect: boolean;
  label: string;
};

const AFFIL_LABEL: Record<Affiliation, string> = {
  ami: "Ami",
  hostile: "Hostile",
  neutre: "Neutre",
  suspect: "Suspect",
  inconnu: "Inconnu",
};

export function affiliationLabel(a: Affiliation): string {
  return AFFIL_LABEL[a];
}

/** Jeton de couleur de console pour l'affiliation (le trait du cadre et le remplissage). */
export function affiliationColorVar(a: Affiliation): string {
  switch (a) {
    case "ami":
      return "--color-ok";
    case "hostile":
      return "--color-crit";
    case "suspect":
      return "--color-warn";
    case "neutre":
      return "--color-series-2";
    default:
      return "--color-muted-foreground";
  }
}

/**
 * Lit l'affiliation d'une piste. Règles, dans l'ordre :
 *  - IFF ami (FATL Mode 4 valide, ou ASECNA) → AMI ;
 *  - Mode 4 demandé mais invalide alors qu'un ami est attendu → SUSPECT ;
 *  - origine sous mandat (CN/TR/RU/IR) et menace haute → HOSTILE ; menace moindre → SUSPECT ;
 *  - trafic civil identifié hors mandat → NEUTRE ;
 *  - tout le reste → INCONNU (l'état honnête par défaut).
 */
export function affiliationOf(t: Track, threat: Threat): { affiliation: Affiliation; reason: string } {
  if (isFriend(t)) {
    if (t.iff?.m4 === "invalid") {
      return { affiliation: "suspect", reason: "ami attendu, Mode 4 invalide" };
    }
    return {
      affiliation: "ami",
      reason: t.friendKind === "fatl" ? "FATL · IFF Mode 4" : "ASECNA · plan de vol IFR",
    };
  }
  const mandate = t.origin === "CN" || t.origin === "TR" || t.origin === "RU" || t.origin === "IR";
  if (mandate) {
    if (threat === "critique" || threat === "elevee") {
      return { affiliation: "hostile", reason: `mandat ${t.origin} · menace ${threat}` };
    }
    return { affiliation: "suspect", reason: `mandat ${t.origin} · à lever` };
  }
  // 1090ES civil net (confirmé, non militaire, pas un UAV catégorie B6) : neutre.
  if (t.feed === "adsb" && t.idState === "confirme" && !t.military && t.category?.toUpperCase() !== "B6") {
    return { affiliation: "neutre", reason: "1090ES civil · hors mandat" };
  }
  return { affiliation: "inconnu", reason: "sans IFF ni mandat levé" };
}

export function app6Of(t: Track, threat: Threat): App6Symbol {
  const { affiliation, reason } = affiliationOf(t, threat);
  return {
    affiliation,
    reason,
    emergency: Boolean(t.emergency),
    raidLead: false,
    gnssSuspect: t.nic != null && t.nic < 5,
    label: affiliationLabel(affiliation),
  };
}

type Ctx = CanvasRenderingContext2D;

/**
 * Dessine le cadre APP-6 d'une piste AÉRIENNE, centré sur (x,y), dans la couleur donnée.
 * La dimension « air » ouvre le cadre vers le bas (toit), la convention OTAN :
 *   AMI    → arc / rectangle arrondi ouvert en bas
 *   HOSTILE→ losange ouvert en bas (pointe en haut)
 *   NEUTRE → carré ouvert en bas (toit plat à angles)
 *   SUSPECT→ losange en tireté
 *   INCONNU→ quadrilobe (trèfle) ouvert en bas
 * `fill` peint l'intérieur à faible opacité (déjà réglée par l'appelant via globalAlpha).
 */
export function drawApp6Air(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  affiliation: Affiliation,
  stroke: string,
  fill?: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (affiliation) {
    case "ami": {
      // Demi-cercle supérieur (ami aérien), montants qui descendent.
      ctx.moveTo(-r, r);
      ctx.lineTo(-r, 0);
      ctx.arc(0, 0, r, Math.PI, 0, false);
      ctx.lineTo(r, r);
      break;
    }
    case "neutre": {
      // Carré ouvert en bas.
      ctx.moveTo(-r, r);
      ctx.lineTo(-r, -r);
      ctx.lineTo(r, -r);
      ctx.lineTo(r, r);
      break;
    }
    case "hostile":
    case "suspect": {
      // Losange, pointe en haut (ouvert en bas).
      const d = r * 1.25;
      ctx.moveTo(-d, 0.15 * d);
      ctx.lineTo(0, -d);
      ctx.lineTo(d, 0.15 * d);
      break;
    }
    default: {
      // Inconnu : quadrilobe ouvert en bas (quatre arcs, côté bas omis).
      const a = r * 0.62;
      ctx.moveTo(-r, a);
      ctx.arc(-a, 0, a, Math.PI * 0.5, Math.PI * 1.5, false);
      ctx.arc(0, -a, a, Math.PI, 0, false);
      ctx.arc(a, 0, a, Math.PI * 1.5, Math.PI * 0.5, false);
      break;
    }
  }
  if (affiliation === "suspect") ctx.setLineDash([4, 2]);
  if (fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
