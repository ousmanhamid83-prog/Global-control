/**
 * Navigation directe (orthodromie) — cap et distance d'un point à un site, et sûreté de l'axe.
 * En Afrique saharo-sahélienne (BET, Ennedi) il n'y a pas de route : on tient un CAP, pas un
 * itinéraire routier. Ce module calcule le cap vrai, la distance grand-cercle, l'ETA, et repère les
 * obstacles CAPTÉS (crue, feu, séisme) qui bordent la ligne droite. Réception seule : ça aide un
 * véhicule à tenir un cap, ça ne guide rien. Le terrain, lui, se reconnaît à l'œil.
 *
 * Fonctions pures (pas de DOM, pas de réseau) — testables sous node.
 */

const R = 6371; // rayon terrestre km
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cap vrai initial (°, 0 = Nord, sens horaire) de A vers B. */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const WIND = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

/** Rose des vents à 16 branches (français : O = Ouest). */
export function cardinal(deg: number): string {
  return WIND[Math.round(((deg % 360) / 22.5)) % 16]!;
}

/** Écart de cap signé (° dans [-180, 180]) : positif = tourner à droite. */
export function relativeTurn(currentCourseDeg: number, targetBearingDeg: number): number {
  let d = ((targetBearingDeg - currentCourseDeg + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

/** Point à la fraction f (0..1) de la grande géodésique A→B (interpolation sphérique). */
function interp(aLat: number, aLon: number, bLat: number, bLon: number, f: number, angdist: number): [number, number] {
  if (angdist === 0) return [aLat, aLon];
  const φ1 = toRad(aLat);
  const λ1 = toRad(aLon);
  const φ2 = toRad(bLat);
  const λ2 = toRad(bLon);
  const A = Math.sin((1 - f) * angdist) / Math.sin(angdist);
  const B = Math.sin(f * angdist) / Math.sin(angdist);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))];
}

export type PathPoint = { lat: number; lon: number; alongKm: number };

/** Échantillonne l'axe A→B (points réguliers le long de la géodésique). */
export function samplePath(aLat: number, aLon: number, bLat: number, bLon: number, stepKm = 5): PathPoint[] {
  const total = distanceKm(aLat, aLon, bLat, bLon);
  const angdist = total / R;
  const n = Math.max(2, Math.ceil(total / stepKm) + 1);
  const out: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const [lat, lon] = interp(aLat, aLon, bLat, bLon, f, angdist);
    out.push({ lat, lon, alongKm: f * total });
  }
  return out;
}

export type Hazard = { id: string; kind: string; level?: string; lat: number; lon: number; title: string };
export type AxisHazard = Hazard & { alongKm: number; offsetKm: number; side: "gauche" | "droite" | "axe" };

/**
 * Obstacles qui bordent l'axe A→B : pour chaque danger, distance minimale à la ligne droite ; retenu
 * si ≤ bufferKm. Donne la distance « sur l'axe » (alongKm), l'écart latéral et le côté (gauche/droite).
 */
export function axisHazards(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  hazards: Hazard[],
  bufferKm = 25,
  stepKm = 5,
): AxisHazard[] {
  const path = samplePath(aLat, aLon, bLat, bLon, stepKm);
  const course = bearingDeg(aLat, aLon, bLat, bLon);
  const out: AxisHazard[] = [];
  for (const h of hazards) {
    let best = Infinity;
    let along = 0;
    for (const p of path) {
      const d = distanceKm(h.lat, h.lon, p.lat, p.lon);
      if (d < best) {
        best = d;
        along = p.alongKm;
      }
    }
    if (best <= bufferKm) {
      const toH = bearingDeg(aLat, aLon, h.lat, h.lon);
      const turn = relativeTurn(course, toH);
      const side: AxisHazard["side"] = best < 1 ? "axe" : turn >= 0 ? "droite" : "gauche";
      out.push({ ...h, alongKm: along, offsetKm: best, side });
    }
  }
  return out.sort((x, y) => x.alongKm - y.alongKm);
}

export type NavSolution = {
  distanceKm: number;
  bearingDeg: number;
  cardinal: string;
  etaMin: number | null; // à la vitesse donnée
};

/** Solution de navigation A→B, avec ETA (min) à `speedKmh` si > 0. */
export function solve(aLat: number, aLon: number, bLat: number, bLon: number, speedKmh = 0): NavSolution {
  const d = distanceKm(aLat, aLon, bLat, bLon);
  const brg = bearingDeg(aLat, aLon, bLat, bLon);
  return {
    distanceKm: d,
    bearingDeg: brg,
    cardinal: cardinal(brg),
    etaMin: speedKmh > 0 ? (d / speedKmh) * 60 : null,
  };
}

/** Point atteint depuis (lat,lon) en suivant un cap sur une distance (grand-cercle). */
export function destinationPoint(lat: number, lon: number, brgDeg: number, distKm: number): [number, number] {
  const δ = distKm / R;
  const θ = toRad(brgDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

export type LatLon = { lat: number; lon: number };

export type RouteTotals = {
  distanceKm: number;
  etaMin: number | null;
  legs: { from: LatLon; to: LatLon; bearingDeg: number; distanceKm: number }[];
};

/** Totaux d'une route multi-étapes (départ → étapes → destination). */
export function routeTotals(points: LatLon[], speedKmh = 0): RouteTotals {
  const legs: RouteTotals["legs"] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
    legs.push({ from: a, to: b, bearingDeg: bearingDeg(a.lat, a.lon, b.lat, b.lon), distanceKm: d });
    total += d;
  }
  return { distanceKm: total, etaMin: speedKmh > 0 ? (total / speedKmh) * 60 : null, legs };
}

/** Obstacles le long d'une route multi-étapes (alongKm cumulé). Dédoublonnés par id (offset min). */
export function routeHazards(points: LatLon[], hazards: Hazard[], bufferKm = 25, stepKm = 5): AxisHazard[] {
  const byId = new Map<string, AxisHazard>();
  let along0 = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const h of axisHazards(a.lat, a.lon, b.lat, b.lon, hazards, bufferKm, stepKm)) {
      const merged = { ...h, alongKm: along0 + h.alongKm };
      const prev = byId.get(h.id);
      if (!prev || h.offsetKm < prev.offsetKm) byId.set(h.id, merged);
    }
    along0 += distanceKm(a.lat, a.lon, b.lat, b.lon);
  }
  return [...byId.values()].sort((x, y) => x.alongKm - y.alongKm);
}

export type Detour =
  | { clear: true }
  | { clear: false; waypoint: LatLon; offsetKm: number; side: "gauche" | "droite" }
  | { clear: false; waypoint: null };

/**
 * Cherche un CONTOURNEMENT simple d'une étape non sûre : un point de passage décalé du milieu,
 * perpendiculaire au cap, tel que les deux demi-étapes soient dégagées. null si rien ne dégage en
 * deçà de ~180 km (→ conseiller le demi-tour). Contournement proposé, pas un plan de route optimal.
 */
export function safeDetour(aLat: number, aLon: number, bLat: number, bLon: number, hazards: Hazard[], bufferKm = 25): Detour {
  if (axisHazards(aLat, aLon, bLat, bLon, hazards, bufferKm).length === 0) return { clear: true };
  const course = bearingDeg(aLat, aLon, bLat, bLon);
  const half = distanceKm(aLat, aLon, bLat, bLon) / 2;
  const [mLat, mLon] = destinationPoint(aLat, aLon, course, half);
  for (let off = bufferKm; off <= 180; off += 15) {
    for (const turn of [90, -90]) {
      const [wLat, wLon] = destinationPoint(mLat, mLon, course + turn, off);
      const leg1 = axisHazards(aLat, aLon, wLat, wLon, hazards, bufferKm);
      const leg2 = axisHazards(wLat, wLon, bLat, bLon, hazards, bufferKm);
      if (leg1.length === 0 && leg2.length === 0) {
        return { clear: false, waypoint: { lat: wLat, lon: wLon }, offsetKm: off, side: turn > 0 ? "droite" : "gauche" };
      }
    }
  }
  return { clear: false, waypoint: null };
}

/**
 * Déclinaison magnétique APPROCHÉE (°, Est positif) pour la bande saharo-sahélienne. Estimation
 * grossière à vérifier sur carte aéronautique — le cap magnétique = cap vrai − déclinaison. null hors
 * zone (l'opérateur saisit alors la valeur de sa carte).
 */
export function declinationEstimate(lat: number, lon: number): number | null {
  if (lat < -10 || lat > 35 || lon < -25 || lon > 55) return null;
  const d = 0.6 + 0.08 * (lon - 15) + 0.06 * (lat - 12);
  return Math.round(d * 10) / 10;
}
