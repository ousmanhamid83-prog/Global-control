/**
 * Détection de SABOTAGE caméra — cœur PUR, testable. Réponse à l'intrus (souvent interne) qui essaie
 * de « se passer » de nos caméras : il ne peut pas se cacher du logiciel (on ne fait pas d'identité),
 * mais s'il NEUTRALISE la caméra, la surveillance elle-même change d'état — et ÇA, on le voit :
 *   - MASQUÉE / obscurcie : objectif couvert, bombé, aspergé → l'image devient sombre et/ou uniforme.
 *   - FIGÉE : image gelée ou bouclée (on rejoue une vieille image) → trames quasi identiques dans le temps.
 *   - DÉPLACÉE : caméra détournée (vers un mur, le ciel, le sol) ou champ obstrué par un obstacle posé
 *     exprès. L'image reste CLAIRE et VIVANTE — rien ne la distingue des deux cas ci-dessus : ce qui
 *     change, c'est le MOTIF SPATIAL de la scène par rapport à la vue de référence apprise.
 *   (COUPÉE : caméra débranchée / liaison coupée — déjà vu par la veille réseau / le proxy injoignable.)
 * Analyse de SIGNAL (luminance, variance, immobilité ABSOLUE, motif spatial), jamais d'identité.
 * Aucune dépendance.
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

export type TamperTrack = { dark: number; uniform: number; frozen: number; moved: number };
export const EMPTY_TAMPER: TamperTrack = { dark: 0, uniform: 0, frozen: 0, moved: 0 };

export type TamperCfg = {
  /** Moyenne de luminance sous laquelle l'image est « noire » (objectif couvert, de nuit sans éclairage). */
  darkMean: number;
  /** Variance sous laquelle l'image est « uniforme » (bâche / peinture / brouillage optique). */
  uniformVar: number;
  /** Nombre de trames consécutives avant de déclarer le sabotage (évite les faux positifs transitoires). */
  grace: number;
  /** Marge au-dessus des seuils « noir / uniforme » pour qu'une trame soit EXPLOITABLE comme preuve. */
  clearMargin: number;
  /** Écart de signature spatiale au-delà duquel la vue n'est plus la vue de référence. */
  movedDist: number;
  /**
   * Trames consécutives avant de déclarer la caméra déplacée. Plus patient que `grace` : un véhicule
   * qui se gare devant l'objectif change aussi le motif, on ne crie qu'une fois que ça DURE.
   */
  movedGrace: number;
};
export const DEFAULT_TAMPER_CFG: TamperCfg = {
  darkMean: 12,
  uniformVar: 6,
  grace: 3,
  clearMargin: 1.5,
  movedDist: 14,
  movedGrace: 9,
};

export type TamperVerdict = "masquee" | "figee" | "deplacee" | null;

/**
 * Cette trame est-elle EXPLOITABLE comme PREUVE (ni noire, ni uniforme, avec une marge) ? C'est elle
 * qu'on garde de côté : quand l'objectif est couvert, la trame du moment ne montre plus rien, et la
 * seule image qui vaille pour l'opérateur est la DERNIÈRE VUE NETTE d'avant la neutralisation.
 */
export function isClearFrame(obs: { mean: number; variance: number }, cfg: TamperCfg = DEFAULT_TAMPER_CFG): boolean {
  return obs.mean >= cfg.darkMean * cfg.clearMargin && obs.variance >= cfg.uniformVar * cfg.clearMargin;
}

/**
 * SIGNATURE SPATIALE d'une scène : la trame carrée `px`×`px` est résumée en une grille `side`×`side`
 * de luminances moyennes. Grossier par construction — on veut reconnaître « c'est bien la même vue »,
 * pas décrire le contenu (et encore moins quelqu'un).
 */
export function sceneSignature(luma: Uint8Array, px: number, side = 4): number[] {
  const out: number[] = [];
  const cell = Math.max(1, Math.floor(px / side));
  for (let gy = 0; gy < side; gy++) {
    for (let gx = 0; gx < side; gx++) {
      let s = 0;
      let n = 0;
      for (let y = gy * cell; y < Math.min(px, (gy + 1) * cell); y++) {
        for (let x = gx * cell; x < Math.min(px, (gx + 1) * cell); x++) {
          s += luma[y * px + x] ?? 0;
          n++;
        }
      }
      out.push(n > 0 ? s / n : 0);
    }
  }
  return out;
}

/**
 * Écart entre deux signatures, INSENSIBLE À L'ÉCLAIRAGE : on retire d'abord à chaque signature sa
 * propre moyenne, donc seul le MOTIF compte. Un nuage, un phare ou le jour qui tombe décalent toutes
 * les cases ensemble → écart ~0 (c'est la même vue). Une caméra détournée change le motif → écart fort.
 */
export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i]! - ma) - (b[i]! - mb));
  return sum / a.length;
}

/**
 * Mélange lent de la vue de référence vers la vue courante : absorbe la dérive LÉGITIME (végétation,
 * saisons, véhicules garés pour de bon). `alpha` petit → un détournement franc déclenche l'alerte bien
 * avant que la référence ait bougé. On n'appelle ceci QUE quand rien d'anormal n'est en cours : jamais
 * apprendre une vue sabotée comme étant la normale.
 */
export function blendSignature(ref: number[], sig: number[], alpha = 0.05): number[] {
  if (ref.length !== sig.length) return sig.slice();
  const a = Math.min(1, Math.max(0, alpha));
  return ref.map((v, i) => v * (1 - a) + sig[i]! * a);
}

/**
 * Met à jour l'état de sabotage d'une caméra pour une nouvelle trame. `sameAsPrev` = la trame est
 * quasi identique à la précédente (voir framesNearlyIdentical). Renvoie la piste mise à jour et un
 * verdict quand un état anormal DURE au-delà de `grace` trames.
 *   - masquee : sombre OU uniforme assez longtemps (objectif couvert/bombé/aspergé, image noire).
 *   - figee   : trames identiques assez longtemps (gelé / bouclé) — mais PAS quand c'est aussi noir
 *               (une image noire figée est d'abord un masquage).
 *   - deplacee: `sigFar` (le motif ne colle plus à la vue de référence) assez longtemps, sur une image
 *               CLAIRE et VIVANTE — c'est le coup d'après de celui qui sait qu'on repère un masquage :
 *               il tourne la caméra au lieu de la couvrir.
 */
export function stepTamper(
  prev: TamperTrack,
  obs: { mean: number; variance: number; sameAsPrev: boolean; sigFar?: boolean },
  cfg: TamperCfg = DEFAULT_TAMPER_CFG,
): { track: TamperTrack; verdict: TamperVerdict; reason?: string } {
  const isDark = obs.mean <= cfg.darkMean;
  const isUniform = obs.variance <= cfg.uniformVar;
  const track: TamperTrack = {
    dark: isDark ? prev.dark + 1 : 0,
    uniform: isUniform ? prev.uniform + 1 : 0,
    frozen: obs.sameAsPrev ? prev.frozen + 1 : 0,
    moved: obs.sigFar ? prev.moved + 1 : 0,
  };
  const g = Math.max(1, cfg.grace);
  if (track.dark >= g || track.uniform >= g) {
    return { track, verdict: "masquee", reason: isDark ? "image noire (objectif couvert ?)" : "image uniforme (objectif bâché/aspergé ?)" };
  }
  // Figé seulement si l'image n'est pas (aussi) noire : une image noire relève du masquage.
  if (track.frozen >= g && !isDark) {
    return { track, verdict: "figee", reason: "trames identiques (flux gelé / bouclé ?)" };
  }
  // Détournement : seulement sur une image exploitable — sinon c'est un masquage, traité au-dessus.
  if (track.moved >= Math.max(1, cfg.movedGrace) && !isDark && !isUniform) {
    return { track, verdict: "deplacee", reason: "champ de vue modifié (caméra détournée ou obstruée ?)" };
  }
  return { track, verdict: null };
}
