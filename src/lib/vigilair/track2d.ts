/**
 * Pistage MULTI-CIBLES 2D par association plus-proche-voisin — pur, sans identité, sans modèle.
 * Chaque piste garde un id stable d'une trame à l'autre tant qu'on la retrouve ; une piste perdue est
 * « coastée » (prédite) quelques trames avant d'être abandonnée ; une détection isolée fait naître une
 * nouvelle piste. C'est de la géométrie de mouvement (« où va CETTE zone »), jamais « qui c'est ».
 *
 * Fonction pure (aucune dépendance), donc testable sous `node --test`.
 */

/**
 * Détection d'une trame : son centre, et une SIGNATURE D'APPARENCE non-biométrique (luminance moyenne
 * et taille de la zone). « Le plus clair / le plus grand » — jamais « qui c'est » : sert UNIQUEMENT à
 * garder deux pistes distinctes après un croisement, pas à identifier une personne.
 */
export type Detection = { cx: number; cy: number; lum?: number; area?: number };

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
  /** Trames consécutives où la piste est quasi IMMOBILE (vitesse < stillEps) : une présence arrêtée. */
  still?: number;
  /** Apparence lissée (luminance moyenne) — pour désambiguïser au croisement, pas une identité. */
  lum?: number;
  /** Taille lissée (aire de la zone) — idem. */
  area?: number;
};

export type TrackerOpts = {
  /** Distance d'association max (px) entre position prédite et détection. */
  gate: number;
  /** Trames de coast tolérées avant d'abandonner une piste MOBILE. */
  maxMisses: number;
  /** Longueur max de la trace conservée. */
  maxTrail: number;
  /** Vitesse (px/trame) en-dessous de laquelle une piste est dite immobile. Défaut 1.2. */
  stillEps?: number;
  /** Coast prolongé pour une présence devenue immobile (ne pas la perdre si elle ne bouge plus). Défaut = maxMisses. */
  stationaryGrace?: number;
  /** Poids de l'écart d'apparence (luminance) dans le coût d'association. Défaut 0.15. 0 = position seule. */
  appearanceWeight?: number;
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
  const stillEps = opts.stillEps ?? 1.2;
  const stationaryGrace = opts.stationaryGrace ?? maxMisses;
  const appW = opts.appearanceWeight ?? 0.15;
  const used = new Set<number>();
  const out: Track2D[] = [];
  let nextId = seedId;

  const order = [...prev].sort((a, b) => b.hits - a.hits || a.id - b.id);
  for (const t of order) {
    const px = t.cx + t.vx;
    const py = t.cy + t.vy;
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < dets.length; i++) {
      if (used.has(i)) continue;
      const dist = Math.hypot(dets[i]!.cx - px, dets[i]!.cy - py);
      if (dist > gate) continue; // la position reste la garde (gate)
      // Coût = distance + désaccord d'APPARENCE (luminance) : au croisement, chaque piste retrouve
      // SA cible (la plus claire reste avec la plus claire), sans jamais identifier qui que ce soit.
      const la = t.lum;
      const lb = dets[i]!.lum;
      const app = la != null && lb != null ? appW * Math.abs(la - lb) : 0;
      const cost = dist + app;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      const d = dets[best]!;
      const nvx = 0.6 * t.vx + 0.4 * (d.cx - t.cx);
      const nvy = 0.6 * t.vy + 0.4 * (d.cy - t.cy);
      const still = Math.hypot(nvx, nvy) < stillEps ? (t.still ?? 0) + 1 : 0;
      out.push({
        id: t.id,
        cx: d.cx,
        cy: d.cy,
        vx: nvx,
        vy: nvy,
        trail: [...t.trail, { x: d.cx, y: d.cy }].slice(-maxTrail),
        hits: t.hits + 1,
        misses: 0,
        still,
        lum: d.lum != null ? (t.lum != null ? 0.7 * t.lum + 0.3 * d.lum : d.lum) : t.lum,
        area: d.area != null ? (t.area != null ? 0.7 * t.area + 0.3 * d.area : d.area) : t.area,
      });
    } else {
      const misses = t.misses + 1;
      // Une présence devenue IMMOBILE bénéficie d'un coast prolongé : elle ne bouge plus, mais elle
      // est toujours là — on ne l'efface pas comme une piste mobile qu'on a juste perdue.
      const grace = (t.still ?? 0) >= 3 ? stationaryGrace : maxMisses;
      if (misses <= grace) {
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
    out.push({ id: nextId++, cx: d.cx, cy: d.cy, vx: 0, vy: 0, trail: [{ x: d.cx, y: d.cy }], hits: 1, misses: 0, still: 0 });
  }

  return { tracks: out, nextId };
}

/**
 * Pistes ÉTABLIES à afficher/alerter : vues au moins minHits fois, et soit détectées cette trame
 * (misses 0), soit en coast court d'une présence immobile (still ≥ 3, misses ≤ coastStill).
 */
export function confirmedTracks(tracks: Track2D[], minHits = 2, coastStill = 0): Track2D[] {
  return tracks.filter(
    (t) => t.hits >= minHits && (t.misses === 0 || ((t.still ?? 0) >= 3 && t.misses <= coastStill)),
  );
}

/** Une piste est-elle une présence IMMOBILE (arrêtée) ? */
export function isStationary(t: Track2D): boolean {
  return (t.still ?? 0) >= 3;
}

/**
 * Compte les OCCLUSIONS : détections dans lesquelles ≥ 2 pistes prédites tombent (deux cibles qui se
 * croisent/se recouvrent). Sert à prévenir l'opérateur qu'un id peut s'échanger le temps du croisement.
 */
export function detectOcclusions(prev: Track2D[], dets: Detection[], gate: number): number {
  const claims = new Array(dets.length).fill(0);
  for (const t of prev) {
    const px = t.cx + t.vx;
    const py = t.cy + t.vy;
    let best = -1;
    let bestD = gate;
    for (let i = 0; i < dets.length; i++) {
      const d = Math.hypot(dets[i]!.cx - px, dets[i]!.cy - py);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) claims[best] += 1;
  }
  return claims.filter((c) => c >= 2).length;
}
