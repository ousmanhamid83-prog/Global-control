/**
 * Détection de SABOTAGE caméra — cœur PUR, testable. Réponse à l'intrus (souvent interne) qui essaie
 * de « se passer » de nos caméras : il ne peut pas se cacher du logiciel (on ne fait pas d'identité),
 * mais s'il NEUTRALISE la caméra, la surveillance elle-même change d'état — et ÇA, on le voit :
 *   - MASQUÉE / obscurcie : objectif couvert, bombé, aspergé → l'image devient sombre et/ou uniforme.
 *   - FIGÉE : image gelée ou bouclée (on rejoue une vieille image) → trames quasi identiques dans le temps.
 *   (COUPÉE : caméra débranchée / liaison coupée — déjà vu par la veille réseau / le proxy injoignable.)
 * Analyse de SIGNAL (luminance, variance, immobilité ABSOLUE), jamais d'identité. Aucune dépendance.
 */

/** Moyenne et variance de luminance d'une trame (valeurs 0..255). */
export function luminanceStats(luma: Uint8Array): { mean: number; variance: number } {
  const n = luma.length;
  if (n === 0) return { mean: 0, variance: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += luma[i]!;
  const mean = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = luma[i]! - mean;
    v += d * d;
  }
  return { mean, variance: v / n };
}

/**
 * Deux trames sont-elles QUASI IDENTIQUES (même luminance pixel à pixel, à `tol` près) ? Un vrai
 * capteur a toujours du bruit : des trames quasi identiques sur la durée = FLUX FIGÉ (gelé / bouclé),
 * pas une scène simplement calme. Échantillonne un pixel sur `step` pour rester léger.
 */
export function framesNearlyIdentical(a: Uint8Array, b: Uint8Array, tol = 1.2, step = 7): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < a.length; i += step) {
    sum += Math.abs(a[i]! - b[i]!);
    cnt++;
  }
  return cnt > 0 && sum / cnt <= tol;
}

export type TamperTrack = { dark: number; uniform: number; frozen: number };
export const EMPTY_TAMPER: TamperTrack = { dark: 0, uniform: 0, frozen: 0 };

export type TamperCfg = {
  /** Moyenne de luminance sous laquelle l'image est « noire » (objectif couvert, de nuit sans éclairage). */
  darkMean: number;
  /** Variance sous laquelle l'image est « uniforme » (bâche / peinture / brouillage optique). */
  uniformVar: number;
  /** Nombre de trames consécutives avant de déclarer le sabotage (évite les faux positifs transitoires). */
  grace: number;
};
export const DEFAULT_TAMPER_CFG: TamperCfg = { darkMean: 12, uniformVar: 6, grace: 3 };

export type TamperVerdict = "masquee" | "figee" | null;

/**
 * Met à jour l'état de sabotage d'une caméra pour une nouvelle trame. `sameAsPrev` = la trame est
 * quasi identique à la précédente (voir framesNearlyIdentical). Renvoie la piste mise à jour et un
 * verdict quand un état anormal DURE au-delà de `grace` trames.
 *   - masquee : sombre OU uniforme assez longtemps (objectif couvert/bombé/aspergé, image noire).
 *   - figee   : trames identiques assez longtemps (gelé / bouclé) — mais PAS quand c'est aussi noir
 *               (une image noire figée est d'abord un masquage).
 */
export function stepTamper(
  prev: TamperTrack,
  obs: { mean: number; variance: number; sameAsPrev: boolean },
  cfg: TamperCfg = DEFAULT_TAMPER_CFG,
): { track: TamperTrack; verdict: TamperVerdict; reason?: string } {
  const isDark = obs.mean <= cfg.darkMean;
  const isUniform = obs.variance <= cfg.uniformVar;
  const track: TamperTrack = {
    dark: isDark ? prev.dark + 1 : 0,
    uniform: isUniform ? prev.uniform + 1 : 0,
    frozen: obs.sameAsPrev ? prev.frozen + 1 : 0,
  };
  const g = Math.max(1, cfg.grace);
  if (track.dark >= g || track.uniform >= g) {
    return { track, verdict: "masquee", reason: isDark ? "image noire (objectif couvert ?)" : "image uniforme (objectif bâché/aspergé ?)" };
  }
  // Figé seulement si l'image n'est pas (aussi) noire : une image noire relève du masquage.
  if (track.frozen >= g && !isDark) {
    return { track, verdict: "figee", reason: "trames identiques (flux gelé / bouclé ?)" };
  }
  return { track, verdict: null };
}
