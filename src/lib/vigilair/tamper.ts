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

export type TamperTrack = {
  dark: number;
  uniform: number;
  frozen: number;
  moved: number;
  /**
   * L'entrée dans le noir s'est-elle faite d'un COUP ? Verrouillé au début de la série sombre et tenu
   * tant qu'elle dure. C'est ce qui sépare un objectif qu'on couvre (chute brutale) de la nuit qui
   * tombe (baisse progressive) — sans ça, toute caméra sans éclairage crierait au sabotage chaque soir.
   */
  darkAbrupt: boolean;
};
export const EMPTY_TAMPER: TamperTrack = { dark: 0, uniform: 0, frozen: 0, moved: 0, darkAbrupt: false };

export type TamperCfg = {
  /** Moyenne de luminance sous laquelle l'image est « noire » (objectif couvert, de nuit sans éclairage). */
  darkMean: number;
  /** Variance sous laquelle l'image est « uniforme » (bâche / peinture / brouillage optique). */
  uniformVar: number;
  /** Nombre de trames consécutives avant de déclarer le sabotage (évite les faux positifs transitoires). */
  grace: number;
  /** Marge au-dessus des seuils « noir / uniforme » pour qu'une trame soit EXPLOITABLE comme preuve. */
  clearMargin: number;
  /**
   * Écart de MOTIF au-delà duquel la vue n'est plus la vue de référence. Échelle de
   * `signatureDistance` : 0 = même vue, 2 = motif exactement inversé.
   */
  movedDist: number;
  /**
   * Trames consécutives avant de déclarer la caméra déplacée. Plus patient que `grace` : un véhicule
   * qui se gare devant l'objectif change aussi le motif, on ne crie qu'une fois que ça DURE.
   */
  movedGrace: number;
  /**
   * Chute de luminance, en UNE trame, à partir de laquelle l'entrée dans le noir est jugée BRUTALE
   * (donc provoquée). Le crépuscule fait perdre quelques points par trame ; une bâche sur l'objectif
   * fait tomber l'image d'un coup.
   */
  abruptDrop: number;
};
export const DEFAULT_TAMPER_CFG: TamperCfg = {
  darkMean: 12,
  uniformVar: 6,
  grace: 3,
  clearMargin: 1.5,
  movedDist: 0.8,
  movedGrace: 9,
  abruptDrop: 35,
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
 * Amplitude minimale du motif (en niveaux de luminance) en dessous de laquelle une signature n'a plus
 * rien à dire : image plate, ou scène trop sombre pour que le motif sorte du bruit.
 */
const MIN_AMP = 1.5;

/**
 * Normalise une signature en MOTIF PUR : on retire la moyenne (décalage de luminosité) PUIS on divise
 * par l'amplitude propre du motif (changement de contraste). Renvoie null quand il n'y a plus de motif
 * exploitable — à ce moment-là on ne conclut rien plutôt que d'amplifier du bruit.
 */
function patternOf(a: number[]): number[] | null {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  const c = a.map((v) => v - m);
  const amp = c.reduce((s, v) => s + Math.abs(v), 0) / c.length;
  if (!(amp >= MIN_AMP)) return null;
  return c.map((v) => v / amp);
}

/**
 * Écart entre deux signatures, INSENSIBLE À L'ÉCLAIRAGE — au décalage ET au contraste. C'est la
 * différence qui compte : un nuage ou un phare DÉCALENT toute la scène, mais le jour qui tombe la
 * MULTIPLIE (l'éclairement module la réflectance). En ne comparant que le motif normalisé, le
 * crépuscule donne un écart ~0, là où une caméra détournée change le motif lui-même.
 * Repère d'échelle : deux vues identiques → 0 ; un motif exactement inversé → 2.
 */
export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const na = patternOf(a);
  const nb = patternOf(b);
  if (!na || !nb) return 0; // pas de motif exploitable des deux côtés : on ne conclut rien
  let sum = 0;
  for (let i = 0; i < na.length; i++) sum += Math.abs(na[i]! - nb[i]!);
  return sum / na.length;
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
 *   - masquee : uniforme CLAIR assez longtemps (bâche/peinture), ou noir assez longtemps MAIS entré
 *               dans le noir d'un coup — une baisse progressive, c'est le crépuscule, pas un sabotage.
 *   - figee   : trames identiques assez longtemps (gelé / bouclé) — mais PAS quand c'est aussi noir
 *               (une image noire figée est d'abord un masquage).
 *   - deplacee: `sigFar` (le motif ne colle plus à la vue de référence) assez longtemps, sur une image
 *               CLAIRE et VIVANTE — c'est le coup d'après de celui qui sait qu'on repère un masquage :
 *               il tourne la caméra au lieu de la couvrir.
 */
export function stepTamper(
  prev: TamperTrack,
  obs: { mean: number; variance: number; sameAsPrev: boolean; sigFar?: boolean; drop?: number },
  cfg: TamperCfg = DEFAULT_TAMPER_CFG,
): { track: TamperTrack; verdict: TamperVerdict; reason?: string } {
  const isDark = obs.mean <= cfg.darkMean;
  const isUniform = obs.variance <= cfg.uniformVar;
  // Une image noire est AUSSI uniforme : si on comptait les deux, la nuit déclencherait la branche
  // « uniforme » en contournant le test de brutalité. L'uniformité ne compte donc que CLAIRE — une
  // bâche ou de la peinture sur l'objectif, qui elles ne ressemblent à aucune heure de la journée.
  const track: TamperTrack = {
    dark: isDark ? prev.dark + 1 : 0,
    uniform: isUniform && !isDark ? prev.uniform + 1 : 0,
    frozen: obs.sameAsPrev ? prev.frozen + 1 : 0,
    moved: obs.sigFar ? prev.moved + 1 : 0,
    // Verrouillé à l'entrée dans le noir, puis tenu tant que la série dure.
    darkAbrupt: isDark ? (prev.dark > 0 ? prev.darkAbrupt : (obs.drop ?? 0) >= cfg.abruptDrop) : false,
  };
  const g = Math.max(1, cfg.grace);
  if (track.uniform >= g) {
    return { track, verdict: "masquee", reason: "image uniforme (objectif bâché/aspergé ?)" };
  }
  // Noir SEULEMENT si la chute a été brutale : sinon c'est la nuit qui tombe, pas un sabotage.
  if (track.dark >= g && track.darkAbrupt) {
    return { track, verdict: "masquee", reason: "image noire (objectif couvert ?)" };
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
