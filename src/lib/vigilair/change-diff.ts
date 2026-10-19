/**
 * Détection de CHANGEMENT entre deux images datées du même cadre — différence brute d'image,
 * pas une détection d'objet ni une identité. On allume les pixels qui ont bougé entre deux passages
 * (une piste nouvelle, un bâtiment, un engin apparu), l'œil de l'opérateur tranche. Classique, réel,
 * honnête : rien n'est inventé, aucun modèle ne « reconnaît » qui que ce soit.
 *
 * Fonction pure (travaille sur des tableaux RGBA), donc testable sans canvas.
 */

export type DiffOptions = {
  /** Seuil de différence moyenne par canal (0..255) au-delà duquel un pixel est « changé ». */
  threshold?: number;
  /** Teinte RGBA posée sur les pixels changés. */
  tint?: [number, number, number, number];
  /** Somme R+G+B en-dessous de laquelle un pixel est « sans donnée » (bord, pas de passage) et ignoré. */
  noData?: number;
};

export type DiffResult = {
  /** Masque RGBA à superposer : teinte sur le changement, transparent ailleurs. */
  overlay: Uint8ClampedArray;
  /** Fraction de pixels changés (hors sans-donnée), 0..1. */
  changedFrac: number;
  /** Nombre de pixels comparés (hors sans-donnée). */
  compared: number;
  width: number;
  height: number;
};

/**
 * Compare `before` et `after` (RGBA, même taille) et renvoie un calque de changement.
 * Un pixel quasi-noir dans l'une des scènes (sans passage / hors emprise) n'est jamais compté comme
 * un changement : on n'invente pas de l'activité là où il n'y a pas d'image.
 */
export function diffHeatmap(
  before: Uint8ClampedArray | Uint8Array,
  after: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: DiffOptions = {},
): DiffResult {
  const threshold = opts.threshold ?? 30;
  const [tr, tg, tb, ta] = opts.tint ?? [255, 64, 0, 150];
  const noData = opts.noData ?? 24;
  const n = width * height;
  const overlay = new Uint8ClampedArray(n * 4);
  let changed = 0;
  let compared = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const br = before[p];
    const bg = before[p + 1];
    const bb = before[p + 2];
    const ar = after[p];
    const ag = after[p + 1];
    const ab = after[p + 2];
    if (br + bg + bb < noData || ar + ag + ab < noData) continue; // sans donnée : ignoré
    compared++;
    const d = (Math.abs(br - ar) + Math.abs(bg - ag) + Math.abs(bb - ab)) / 3;
    if (d >= threshold) {
      overlay[p] = tr;
      overlay[p + 1] = tg;
      overlay[p + 2] = tb;
      overlay[p + 3] = ta;
      changed++;
    }
  }
  return { overlay, changedFrac: compared ? changed / compared : 0, compared, width, height };
}
