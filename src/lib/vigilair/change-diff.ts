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
  /** Si vrai, le résultat inclut un masque binaire des pixels changés (pour l'analyse de zones). */
  mask?: boolean;
};

export type DiffResult = {
  /** Masque RGBA à superposer : teinte sur le changement, transparent ailleurs. */
  overlay: Uint8ClampedArray;
  /** Fraction de pixels changés (hors sans-donnée), 0..1. */
  changedFrac: number;
  /** Nombre de pixels comparés (hors sans-donnée). */
  compared: number;
  /** Masque binaire 1=changé / 0=inchangé (si opts.mask). Pour l'analyse de zones de mouvement. */
  mask?: Uint8Array;
  width: number;
  height: number;
};

/** Une zone de mouvement : son étendue (boîte), son aire en pixels, son centre. Géométrie, pas identité. */
export type MoveBlob = {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
};

export type PresenceStats = {
  /** Nombre de zones de mouvement distinctes (≥ minArea). */
  count: number;
  /** Total de pixels en mouvement. */
  totalChanged: number;
  /** La plus grande zone, ou null. */
  largest: MoveBlob | null;
};

/**
 * Indice de PRÉSENCE — lecture prudente de la géométrie d'une zone de mouvement. Ce n'est PAS une
 * reconnaissance d'objet ni une identité : juste « petit/compact » vs « large/allongé », pour aider
 * l'opérateur à décider où regarder. Le mot « piéton » / « véhicule » est un INDICE à confirmer à
 * l'œil sur la capture, jamais une détermination automatique.
 */
export type PresenceHint = {
  sizePct: number;
  aspect: number;
  where: string;
  hint: string;
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
  const mask = opts.mask ? new Uint8Array(n) : undefined;
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
      if (mask) mask[i] = 1;
      changed++;
    }
  }
  return { overlay, changedFrac: compared ? changed / compared : 0, compared, mask, width, height };
}

/**
 * Regroupe les pixels en mouvement en ZONES connexes (4-connexité, pile itérative — pas de récursion).
 * Renvoie le nombre de zones ≥ minArea, le total de pixels, et la plus grande zone (boîte + centre).
 * Pure : c'est de la géométrie de changement, aucun modèle, aucune identité.
 */
export function blobStats(mask: Uint8Array, width: number, height: number, minArea = 4): PresenceStats {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  let count = 0;
  let totalChanged = 0;
  let largest: MoveBlob | null = null;
  for (let i = 0; i < n; i++) totalChanged += mask[i] ? 1 : 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let sx = 0;
    let sy = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < width - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && mask[idx - width] && !seen[idx - width]) { seen[idx - width] = 1; stack.push(idx - width); }
      if (y < height - 1 && mask[idx + width] && !seen[idx + width]) { seen[idx + width] = 1; stack.push(idx + width); }
    }
    if (area < minArea) continue;
    count++;
    if (!largest || area > largest.area) {
      largest = { area, x0, y0, x1, y1, cx: sx / area, cy: sy / area };
    }
  }
  return { count, totalChanged, largest };
}

/**
 * Indice de présence prudent à partir de la plus grande zone. Le label piéton/véhicule est un
 * INDICE (à confirmer à l'œil), jamais une détermination : la géométrie d'un diff ne reconnaît
 * personne ni rien.
 */
export function presenceHint(largest: MoveBlob | null, width: number, height: number): PresenceHint {
  if (!largest) return { sizePct: 0, aspect: 1, where: "—", hint: "aucune zone nette" };
  const sizePct = Math.round((largest.area / (width * height)) * 1000) / 10;
  const w = largest.x1 - largest.x0 + 1;
  const h = largest.y1 - largest.y0 + 1;
  const aspect = Math.round((w / Math.max(1, h)) * 100) / 100;
  const fx = largest.cx / width;
  const fy = largest.cy / height;
  const hx = fx < 0.34 ? "gauche" : fx > 0.66 ? "droite" : "centre";
  const hy = fy < 0.34 ? "haut" : fy > 0.66 ? "bas" : "milieu";
  const where = `${hy}-${hx}`;
  let hint: string;
  if (sizePct < 0.8) hint = "mouvement ténu";
  else if (sizePct < 2.5 && aspect <= 1.1) hint = "silhouette compacte (piéton possible)";
  else if (sizePct >= 4 && aspect >= 1.3) hint = "masse large (véhicule possible)";
  else hint = "présence indéterminée";
  return { sizePct, aspect, where, hint };
}

/**
 * Direction ÉCRAN d'un déplacement (dx vers la droite, dy vers le bas dans le repère image).
 * Renvoie un libellé 8 secteurs, ou « immobile ». C'est le SENS de la piste à l'écran, pas un cap
 * géographique : le suivi reste une aide, jamais une identité.
 */
export function frameHeading(dx: number, dy: number): string {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return "immobile";
  // atan2 avec -dy : l'axe Y image pointe vers le bas, on le retourne pour que « haut » = +90°.
  let a = (Math.atan2(-dy, dx) * 180) / Math.PI; // (-180, 180], 0 = droite, 90 = haut
  if (a < 0) a += 360; // [0, 360)
  const sectors = [
    "droite",
    "haut-droite",
    "haut",
    "haut-gauche",
    "gauche",
    "bas-gauche",
    "bas",
    "bas-droite",
  ];
  const i = Math.round(a / 45) % 8;
  return sectors[i]!;
}
