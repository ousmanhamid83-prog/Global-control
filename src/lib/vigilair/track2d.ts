/**
 * Pistage MULTI-CIBLES 2D par association plus-proche-voisin — pur, sans identité, sans modèle.
 * Chaque piste garde un id stable d'une trame à l'autre tant qu'on la retrouve ; une piste perdue est
 * « coastée » (prédite) quelques trames avant d'être abandonnée ; une détection isolée fait naître une
 * nouvelle piste. C'est de la géométrie de mouvement (« où va CETTE zone »), jamais « qui c'est ».
 *
 * Fonction pure (aucune dépendance), donc testable sous `node --test`.
 */

export type Detection = { cx: number; cy: number };

export type Track2D = {
  id: number;
  cx: number;
  cy: number;
  /** Vitesse lissée (pixels / trame), pour prédire la position et donner cap + allure. */
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
  /** Nombre de trames où la piste a été confirmée (≥ 2 = piste établie). */
  hits: number;
  /** Trames consécutives sans détection associée (coast). */
  misses: number;
};

export type TrackerOpts = {
  /** Distance d'association max (px) entre position prédite et détection. */
  gate: number;
  /** Trames de coast tolérées avant d'abandonner une piste. */
  maxMisses: number;
  /** Longueur max de la trace conservée. */
  maxTrail: number;
};

/**
 * Avance le pisteur d'une trame. Renvoie les pistes mises à jour et le prochain id libre.
 * Association gloutonne : les pistes les mieux établies choisissent d'abord leur détection.
 */
export function stepTracker(
  prev: Track2D[],
  dets: Detection[],
  seedId: number,
  opts: TrackerOpts,
): { tracks: Track2D[]; nextId: number } {
  const { gate, maxMisses, maxTrail } = opts;
  const used = new Set<number>();
  const out: Track2D[] = [];
  let nextId = seedId;

  const order = [...prev].sort((a, b) => b.hits - a.hits || a.id - b.id);
  for (const t of order) {
    const px = t.cx + t.vx;
    const py = t.cy + t.vy;
    let best = -1;
    let bestD = gate;
    for (let i = 0; i < dets.length; i++) {
      if (used.has(i)) continue;
      const d = Math.hypot(dets[i]!.cx - px, dets[i]!.cy - py);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      const d = dets[best]!;
      const nvx = 0.6 * t.vx + 0.4 * (d.cx - t.cx);
      const nvy = 0.6 * t.vy + 0.4 * (d.cy - t.cy);
      out.push({
        id: t.id,
        cx: d.cx,
        cy: d.cy,
        vx: nvx,
        vy: nvy,
        trail: [...t.trail, { x: d.cx, y: d.cy }].slice(-maxTrail),
        hits: t.hits + 1,
        misses: 0,
      });
    } else {
      const misses = t.misses + 1;
      if (misses <= maxMisses) {
        const cx = t.cx + t.vx;
        const cy = t.cy + t.vy;
        out.push({
          ...t,
          cx,
          cy,
          misses,
          trail: [...t.trail, { x: cx, y: cy }].slice(-maxTrail),
        });
      }
      // sinon : piste abandonnée (pas réinjectée)
    }
  }

  for (let i = 0; i < dets.length; i++) {
    if (used.has(i)) continue;
    const d = dets[i]!;
    out.push({ id: nextId++, cx: d.cx, cy: d.cy, vx: 0, vy: 0, trail: [{ x: d.cx, y: d.cy }], hits: 1, misses: 0 });
  }

  return { tracks: out, nextId };
}

/** Pistes ÉTABLIES (vues au moins minHits fois) — on n'affiche/alerte pas sur un éclair d'une trame. */
export function confirmedTracks(tracks: Track2D[], minHits = 2): Track2D[] {
  return tracks.filter((t) => t.hits >= minHits && t.misses === 0);
}
