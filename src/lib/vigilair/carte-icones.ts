/**
 * Les symboles de la carte, dessinés au canevas et remis à MapLibre sous un nom qui dit tout ce qu'il
 * faut pour les refaire : « cadre|hostile|#c45c5c|11 », « forme|aile|#8aa0b8 »… MapLibre demande un
 * nom qu'il n'a pas encore (styleimagemissing) : on le dessine à cet instant, une fois pour toutes.
 */
import { drawApp6Air, type Affiliation } from "./app6.ts";

/** Formes de plateforme, pointe vers le haut (le cap les fait tourner sur la carte). */
export type FormePiste = "adsb" | "ami" | "chasse" | "aile" | "tri";

const FORMES: Record<FormePiste, [number, number][]> = {
  adsb: [
    [0, -7],
    [7, 0],
    [0, 7],
    [-7, 0],
  ],
  ami: [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ],
  chasse: [
    [0, -12],
    [8, 8],
    [0, 3],
    [-8, 8],
  ],
  aile: [
    [0, -8],
    [5, 6],
    [0, 3],
    [-5, 6],
  ],
  tri: [
    [0, -7],
    [6, 5],
    [-6, 5],
  ],
};

const AFFILIATIONS: readonly Affiliation[] = ["ami", "hostile", "neutre", "suspect", "inconnu"];

export const nomCadre = (affil: Affiliation, couleur: string, rayon: number) =>
  `cadre|${affil}|${couleur}|${rayon}`;
export const nomForme = (forme: FormePiste, couleur: string) => `forme|${forme}|${couleur}`;
/** Petit carré plein (point, station), carré vide (départ d'un drone), croix, triangle (pic). */
export const nomPoint = (couleur: string, cote: number) => `point|${couleur}|${cote}`;
export const nomCarre = (couleur: string) => `carre|${couleur}`;
export const nomCroix = (couleur: string) => `croix|${couleur}`;
export const nomTriangle = (couleur: string, plein: boolean) =>
  `triangle|${couleur}|${plein ? 1 : 0}`;
/** Trait de cap d'un drone : 22 px depuis sa position, dans son cap (ancré en bas). */
export const nomCap = (couleur: string) => `cap|${couleur}`;

const COULEUR = /^#[0-9a-f]{6}$|^rgba?\([\d., ]+\)$/i;

/** Ce que dit un nom de symbole, ou null s'il n'en est pas un (MapLibre peut en demander d'autres). */
export function lireNom(
  nom: string,
):
  | { type: "cadre"; affil: Affiliation; couleur: string; rayon: number }
  | { type: "forme"; forme: FormePiste; couleur: string }
  | { type: "point"; couleur: string; cote: number }
  | { type: "carre" | "croix" | "cap"; couleur: string }
  | { type: "triangle"; couleur: string; plein: boolean }
  | null {
  const [type, a, b, c] = nom.split("|");
  if (type === "cadre") {
    const rayon = Number(c);
    if (!AFFILIATIONS.includes(a as Affiliation) || !COULEUR.test(b ?? "")) return null;
    if (!Number.isFinite(rayon) || rayon < 2 || rayon > 40) return null;
    return { type, affil: a as Affiliation, couleur: b!, rayon };
  }
  if (type === "forme") {
    if (!(a! in FORMES) || !COULEUR.test(b ?? "")) return null;
    return { type, forme: a as FormePiste, couleur: b! };
  }
  if (type === "point") {
    const cote = Number(b);
    if (!COULEUR.test(a ?? "") || !Number.isFinite(cote) || cote < 1 || cote > 20) return null;
    return { type, couleur: a!, cote };
  }
  if (type === "carre" || type === "croix" || type === "cap") {
    return COULEUR.test(a ?? "") ? { type, couleur: a! } : null;
  }
  if (type === "triangle") {
    return COULEUR.test(a ?? "") ? { type, couleur: a!, plein: b === "1" } : null;
  }
  return null;
}

/** Côté de l'image d'un symbole, en pixels de carte (la finesse multiplie). */
export function coteIcone(n: NonNullable<ReturnType<typeof lireNom>>): number {
  if (n.type === "cadre") return Math.ceil(n.rayon * 2.5 + 6);
  if (n.type === "cap") return 48;
  if (n.type === "point") return n.cote + 2;
  return 28;
}

/** Dessine le symbole nommé ; null si le nom n'en est pas un. */
export function dessinerIcone(
  nom: string,
  finesse: number,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  const n = lireNom(nom);
  if (!n) return null;
  const cote = coteIcone(n);
  const toile = document.createElement("canvas");
  toile.width = toile.height = Math.ceil(cote * finesse);
  const ctx = toile.getContext("2d");
  if (!ctx) return null;
  ctx.scale(finesse, finesse);
  const m = cote / 2;
  ctx.lineJoin = "round";
  switch (n.type) {
    case "cadre":
      drawApp6Air(ctx, m, m, n.rayon, n.affil, n.couleur, teinte(n.couleur, 0.1));
      break;
    case "forme": {
      ctx.fillStyle = n.couleur;
      ctx.beginPath();
      FORMES[n.forme].forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(m + x, m + y) : ctx.lineTo(m + x, m + y),
      );
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "point":
      ctx.fillStyle = n.couleur;
      ctx.fillRect(1, 1, n.cote, n.cote);
      break;
    case "carre":
      ctx.strokeStyle = n.couleur;
      ctx.lineWidth = 1;
      ctx.strokeRect(m - 4, m - 4, 8, 8);
      break;
    case "croix":
      ctx.strokeStyle = n.couleur;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(m - 9, m);
      ctx.lineTo(m + 9, m);
      ctx.moveTo(m, m - 9);
      ctx.lineTo(m, m + 9);
      ctx.stroke();
      break;
    case "triangle":
      ctx.strokeStyle = n.couleur;
      ctx.fillStyle = n.couleur;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m, m - 5);
      ctx.lineTo(m + 3.5, m + 3);
      ctx.lineTo(m - 3.5, m + 3);
      ctx.closePath();
      if (n.plein) ctx.fill();
      ctx.stroke();
      break;
    case "cap":
      // Ancré en bas au centre : le trait part de la position du drone vers son cap.
      ctx.strokeStyle = n.couleur;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m, cote);
      ctx.lineTo(m, cote - 22);
      ctx.stroke();
      break;
  }
  const img = ctx.getImageData(0, 0, toile.width, toile.height);
  return { width: img.width, height: img.height, data: img.data };
}

/** « #c45c5c » à 10 % : l'intérieur d'un cadre. */
function teinte(couleur: string, a: number): string {
  if (!couleur.startsWith("#") || couleur.length !== 7) return "transparent";
  const n = Number.parseInt(couleur.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
