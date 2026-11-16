/**
 * L'image d'une de NOS sources (drone, caméra de site) posée en fond de carte : où ses quatre coins
 * tombent au sol, et comment la tendre entre eux. Deux calages : quatre coins posés à la main, ou
 * l'emprise calculée de la télémétrie du drone (caméra à la verticale). Rien ici ne regarde ce que
 * l'image montre : c'est une image de terrain sous les pistes, pas une identification de personnes.
 */

import { KM_PER_DEG_LAT, kmPerDegLon } from "./geo.ts";

export type PointGeo = { lat: number; lon: number };
/** Les coins de l'image, dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export type Coins = [PointGeo, PointGeo, PointGeo, PointGeo];

export type Calage =
  | { mode: "coins"; coins: Coins }
  /** Emprise calculée : caméra à la verticale, de ce champ horizontal (degrés). */
  | { mode: "drone"; champDeg: number };

export const CHAMP_MIN_DEG = 10;
export const CHAMP_MAX_DEG = 150;
/** Champ horizontal d'une nacelle courante, proposé par défaut. */
export const CHAMP_DEFAUT_DEG = 70;
/** Deux coins posés plus loin l'un de l'autre que ceci : ce n'est pas l'image d'une source du poste. */
const ENVERGURE_MAX_KM = 20;

// Les mêmes mètres par degré que la carte : l'image tombe où la carte la dessine.
const M_PAR_DEG_LAT = KM_PER_DEG_LAT * 1000;
const mParDegLon = (lat: number): number => kmPerDegLon(lat) * 1000;

/** Le plan local, en mètres, autour du premier coin : assez juste sur quelques kilomètres. */
function enMetres(o: PointGeo, p: PointGeo): [number, number] {
  return [(p.lon - o.lon) * mParDegLon(o.lat), (p.lat - o.lat) * M_PAR_DEG_LAT];
}

/**
 * Pourquoi ces quatre coins ne conviennent pas, ou null. Ils doivent être lisibles, proches, et
 * former un quadrilatère convexe pris dans l'ordre : croisé ou replié, l'image ne se tend pas.
 */
export function refusCoins(coins: readonly PointGeo[]): string | null {
  if (coins.length !== 4)
    return "quatre coins attendus : haut-gauche, haut-droit, bas-droit, bas-gauche";
  for (const c of coins) {
    // Number.isFinite ne convertit rien : un texte, un nul, un absent sont refusés comme un NaN.
    if (
      !c ||
      !Number.isFinite(c.lat) ||
      !Number.isFinite(c.lon) ||
      Math.abs(c.lat) > 90 ||
      Math.abs(c.lon) > 180
    ) {
      return "coin illisible : latitude, longitude en degrés décimaux";
    }
  }
  const m = coins.map((c) => enMetres(coins[0]!, c));
  let sens = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = m[i]!;
    const [bx, by] = m[(i + 1) % 4]!;
    const [cx, cy] = m[(i + 2) % 4]!;
    if (Math.hypot(bx - ax, by - ay) > ENVERGURE_MAX_KM * 1000) {
      return `coins à plus de ${ENVERGURE_MAX_KM} km l'un de l'autre`;
    }
    const tourne = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    // Moins d'un mètre carré : deux coins confondus, ou trois alignés.
    if (Math.abs(tourne) < 1) return "coins confondus ou alignés : l'image n'aurait pas de surface";
    if (sens !== 0 && Math.sign(tourne) !== sens) {
      return "coins croisés : les donner dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche";
    }
    sens = Math.sign(tourne);
  }
  return null;
}

/** Un calage lu du disque ou reçu de la console : rendu propre, ou la raison du refus. */
export function lireCalage(brut: unknown): Calage | { erreur: string } {
  const c = (brut && typeof brut === "object" ? brut : {}) as {
    mode?: unknown;
    coins?: unknown;
    champDeg?: unknown;
  };
  if (c.mode === "drone") {
    const champ = c.champDeg;
    if (typeof champ !== "number" || !(champ >= CHAMP_MIN_DEG && champ <= CHAMP_MAX_DEG)) {
      return { erreur: `champ de la caméra hors bornes (${CHAMP_MIN_DEG} à ${CHAMP_MAX_DEG}°)` };
    }
    return { mode: "drone", champDeg: champ };
  }
  if (c.mode === "coins") {
    const coins = Array.isArray(c.coins) ? (c.coins as PointGeo[]) : [];
    const non = refusCoins(coins);
    if (non) return { erreur: non };
    return {
      mode: "coins",
      coins: coins.map((p) => ({ lat: p.lat, lon: p.lon })) as Coins,
    };
  }
  return { erreur: "calage inconnu : quatre coins, ou emprise calculée depuis le drone" };
}

/** Sous cette hauteur, le drone est au sol : son image ne couvre rien. */
const HAUTEUR_MIN_M = 2;

/**
 * Où tombent les coins de l'image d'une caméra À LA VERTICALE sous le drone, sur un sol plat à la
 * hauteur de son départ : le haut de l'image vers son cap. `rapport` : hauteur / largeur de l'image.
 * Rend null sans cap ou au sol. Une nacelle inclinée, un relief marqué faussent ce calcul.
 */
export function coinsDepuisDrone(
  p: { lat: number; lon: number; hauteurM: number; cap: number | null },
  champDeg: number,
  rapport: number,
): Coins | null {
  if (p.cap === null || p.hauteurM < HAUTEUR_MIN_M || !(rapport > 0)) return null;
  const demiLargeur = p.hauteurM * Math.tan((champDeg * Math.PI) / 360);
  const demiHauteur = demiLargeur * rapport;
  const cap = (p.cap * Math.PI) / 180;
  // Vers l'avant (le haut de l'image) et vers la droite, en (est, nord).
  const avant: [number, number] = [Math.sin(cap), Math.cos(cap)];
  const droite: [number, number] = [Math.cos(cap), -Math.sin(cap)];
  const coin = (a: number, d: number): PointGeo => ({
    lat: p.lat + (a * demiHauteur * avant[1] + d * demiLargeur * droite[1]) / M_PAR_DEG_LAT,
    lon: p.lon + (a * demiHauteur * avant[0] + d * demiLargeur * droite[0]) / mParDegLon(p.lat),
  });
  return [coin(1, -1), coin(1, 1), coin(-1, 1), coin(-1, -1)];
}

export type Point2 = readonly [number, number];

/**
 * La transformation qui porte le carré unité (u, v de 0 à 1, origine en haut à gauche de l'image)
 * sur un quadrilatère de l'écran — celle d'un plan vu en perspective. Rend la fonction (u, v) → (x, y).
 */
export function versQuadrilatere(
  q: readonly [Point2, Point2, Point2, Point2],
): (u: number, v: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  // Un parallélogramme (sx = sy = 0) donne g = h = 0 : la transformation est alors affine.
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

/**
 * La transformation affine du canevas (a, b, c, d, e, f) qui porte le triangle s (pixels de
 * l'image) sur le triangle t (pixels de l'écran).
 */
export function affineTriangle(
  s: readonly [Point2, Point2, Point2],
  t: readonly [Point2, Point2, Point2],
): [number, number, number, number, number, number] {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s;
  const [[tx0, ty0], [tx1, ty1], [tx2, ty2]] = t;
  const den = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
  const a = ((tx1 - tx0) * (sy2 - sy0) - (tx2 - tx0) * (sy1 - sy0)) / den;
  const c = ((tx2 - tx0) * (sx1 - sx0) - (tx1 - tx0) * (sx2 - sx0)) / den;
  const b = ((ty1 - ty0) * (sy2 - sy0) - (ty2 - ty0) * (sy1 - sy0)) / den;
  const d = ((ty2 - ty0) * (sx1 - sx0) - (ty1 - ty0) * (sx2 - sx0)) / den;
  return [a, b, c, d, tx0 - a * sx0 - c * sy0, ty0 - b * sx0 - d * sy0];
}
