/**
 * Géométrie de SCOPE de la veille — pur, testable. Deux outils sans identité :
 *  - pointInPolygon : ne garder que les présences DANS un périmètre tracé (ignorer la route publique).
 *  - inArmWindow    : n'armer les alertes que sur une fenêtre horaire (ex. la nuit).
 */

export type Pt = { x: number; y: number };

/** Ray-casting : le point est-il à l'intérieur du polygone (≥ 3 sommets) ? Coordonnées quelconques. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * L'heure (0..24, fractionnaire possible) est-elle dans la fenêtre d'armement [from, to) ?
 * from < to : fenêtre de jour. from > to : fenêtre qui passe minuit (ex. 19→6 = la nuit).
 * from === to : toujours armé (pas de fenêtre).
 */
export function inArmWindow(hour: number, from: number, to: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  if (from === to) return true;
  if (from < to) return h >= from && h < to;
  return h >= from || h < to;
}
