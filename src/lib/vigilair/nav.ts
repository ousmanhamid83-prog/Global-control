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
