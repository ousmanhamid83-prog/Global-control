/**
 * La déclinaison magnétique d'un lieu : l'angle entre le nord vrai et le nord du compas, par le
 * modèle magnétique mondial WMM2025 (NOAA/NCEI et British Geological Survey), valable du 1er janvier
 * 2025 au 1er janvier 2030. L'écran radar du poste s'en sert pour ses relèvements « nord
 * magnétique » : là où est son antenne, pas à N'Djamena seulement. Hors de ces dates, le modèle ne
 * dit rien (null) : un modèle périmé se tairait mal.
 *
 * Coefficients : WMM2025.COF (13/11/2024), matériel du gouvernement des États-Unis, non soumis au
 * droit d'auteur (« in the public domain and not licensed or under copyright »). Les équations sont
 * celles du rapport technique « The US/UK World Magnetic Model for 2025-2030 ».
 */

/** [n, m, g, h, ġ, ḣ] : nT et nT/an, à l'époque 2025,0. */
const COEFFICIENTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 0, -29351.8, 0, 12, 0],
  [1, 1, -1410.8, 4545.4, 9.7, -21.5],
  [2, 0, -2556.6, 0, -11.6, 0],
  [2, 1, 2951.1, -3133.6, -5.2, -27.7],
  [2, 2, 1649.3, -815.1, -8, -12.1],
  [3, 0, 1361, 0, -1.3, 0],
  [3, 1, -2404.1, -56.6, -4.2, 4],
  [3, 2, 1243.8, 237.5, 0.4, -0.3],
  [3, 3, 453.6, -549.5, -15.6, -4.1],
  [4, 0, 895, 0, -1.6, 0],
  [4, 1, 799.5, 278.6, -2.4, -1.1],
  [4, 2, 55.7, -133.9, -6, 4.1],
  [4, 3, -281.1, 212, 5.6, 1.6],
  [4, 4, 12.1, -375.6, -7, -4.4],
  [5, 0, -233.2, 0, 0.6, 0],
  [5, 1, 368.9, 45.4, 1.4, -0.5],
  [5, 2, 187.2, 220.2, 0, 2.2],
  [5, 3, -138.7, -122.9, 0.6, 0.4],
  [5, 4, -142, 43, 2.2, 1.7],
  [5, 5, 20.9, 106.1, 0.9, 1.9],
  [6, 0, 64.4, 0, -0.2, 0],
  [6, 1, 63.8, -18.4, -0.4, 0.3],
  [6, 2, 76.9, 16.8, 0.9, -1.6],
  [6, 3, -115.7, 48.8, 1.2, -0.4],
  [6, 4, -40.9, -59.8, -0.9, 0.9],
  [6, 5, 14.9, 10.9, 0.3, 0.7],
  [6, 6, -60.7, 72.7, 0.9, 0.9],
  [7, 0, 79.5, 0, 0, 0],
  [7, 1, -77, -48.9, -0.1, 0.6],
  [7, 2, -8.8, -14.4, -0.1, 0.5],
  [7, 3, 59.3, -1, 0.5, -0.8],
  [7, 4, 15.8, 23.4, -0.1, 0],
  [7, 5, 2.5, -7.4, -0.8, -1],
  [7, 6, -11.1, -25.1, -0.8, 0.6],
  [7, 7, 14.2, -2.3, 0.8, -0.2],
  [8, 0, 23.2, 0, -0.1, 0],
  [8, 1, 10.8, 7.1, 0.2, -0.2],
  [8, 2, -17.5, -12.6, 0, 0.5],
  [8, 3, 2, 11.4, 0.5, -0.4],
  [8, 4, -21.7, -9.7, -0.1, 0.4],
  [8, 5, 16.9, 12.7, 0.3, -0.5],
  [8, 6, 15, 0.7, 0.2, -0.6],
  [8, 7, -16.8, -5.2, 0, 0.3],
  [8, 8, 0.9, 3.9, 0.2, 0.2],
  [9, 0, 4.6, 0, 0, 0],
  [9, 1, 7.8, -24.8, -0.1, -0.3],
  [9, 2, 3, 12.2, 0.1, 0.3],
  [9, 3, -0.2, 8.3, 0.3, -0.3],
  [9, 4, -2.5, -3.3, -0.3, 0.3],
  [9, 5, -13.1, -5.2, 0, 0.2],
  [9, 6, 2.4, 7.2, 0.3, -0.1],
  [9, 7, 8.6, -0.6, -0.1, -0.2],
  [9, 8, -8.7, 0.8, 0.1, 0.4],
  [9, 9, -12.9, 10, -0.1, 0.1],
  [10, 0, -1.3, 0, 0.1, 0],
  [10, 1, -6.4, 3.3, 0, 0],
  [10, 2, 0.2, 0, 0.1, 0],
  [10, 3, 2, 2.4, 0.1, -0.2],
  [10, 4, -1, 5.3, 0, 0.1],
  [10, 5, -0.6, -9.1, -0.3, -0.1],
  [10, 6, -0.9, 0.4, 0, 0.1],
  [10, 7, 1.5, -4.2, -0.1, 0],
  [10, 8, 0.9, -3.8, -0.1, -0.1],
  [10, 9, -2.7, 0.9, 0, 0.2],
  [10, 10, -3.9, -9.1, 0, 0],
  [11, 0, 2.9, 0, 0, 0],
  [11, 1, -1.5, 0, 0, 0],
  [11, 2, -2.5, 2.9, 0, 0.1],
  [11, 3, 2.4, -0.6, 0, 0],
  [11, 4, -0.6, 0.2, 0, 0.1],
  [11, 5, -0.1, 0.5, -0.1, 0],
  [11, 6, -0.6, -0.3, 0, 0],
  [11, 7, -0.1, -1.2, 0, 0.1],
  [11, 8, 1.1, -1.7, -0.1, 0],
  [11, 9, -1, -2.9, -0.1, 0],
  [11, 10, -0.2, -1.8, -0.1, 0],
  [11, 11, 2.6, -2.3, -0.1, 0],
  [12, 0, -2, 0, 0, 0],
  [12, 1, -0.2, -1.3, 0, 0],
  [12, 2, 0.3, 0.7, 0, 0],
  [12, 3, 1.2, 1, 0, -0.1],
  [12, 4, -1.3, -1.4, 0, 0.1],
  [12, 5, 0.6, 0, -0, 0],
  [12, 6, 0.6, 0.6, 0.1, 0],
  [12, 7, 0.5, -0.1, 0, 0],
  [12, 8, -0.1, 0.8, 0, 0],
  [12, 9, -0.4, 0.1, 0, 0],
  [12, 10, -0.2, -1, -0.1, 0],
  [12, 11, -1.3, 0.1, 0, 0],
  [12, 12, -0.7, 0.2, -0.1, -0.1],
];

const EPOQUE = 2025.0;
const FIN = 2030.0;
const DEGRE = 12;
/** Rayon de référence géomagnétique (km). */
const RAYON_REF = 6371.2;
/** Ellipsoïde WGS84 : demi-grand axe (km) et aplatissement. */
const A = 6378.137;
const APLATISSEMENT = 1 / 298.257223563;
const E2 = APLATISSEMENT * (2 - APLATISSEMENT);

const RAD = Math.PI / 180;

/** Le champ en un lieu (nT) : X vers le nord, Y vers l'est, Z vers le bas ; D en degrés (est +). */
export type Champ = { x: number; y: number; z: number; declinaison: number };

/** L'année décimale d'un instant (2026,5 ≈ début juillet 2026). */
export function anneeDecimale(date: Date): number {
  const an = date.getUTCFullYear();
  const debut = Date.UTC(an, 0, 1);
  const suivant = Date.UTC(an + 1, 0, 1);
  return an + (date.getTime() - debut) / (suivant - debut);
}

/**
 * Le champ WMM2025 à la latitude et la longitude géodésiques (degrés), à `hauteurKm` au-dessus de
 * l'ellipsoïde, à l'année décimale `annee` ; null hors du 1er janvier 2025 au 1er janvier 2030.
 */
export function champ(lat: number, lon: number, hauteurKm: number, annee: number): Champ | null {
  if (!(annee >= EPOQUE && annee < FIN)) return null;
  const dt = annee - EPOQUE;
  // Géodésique → géocentrique sphérique.
  const phi = lat * RAD;
  const sinPhi = Math.sin(phi);
  const rc = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const p = (rc + hauteurKm) * Math.cos(phi);
  const zc = (rc * (1 - E2) + hauteurKm) * sinPhi;
  const r = Math.hypot(p, zc);
  const phiC = Math.asin(zc / r);
  // Colatitude géocentrique : les fonctions de Legendre de Schmidt et leurs dérivées en θ.
  const c = Math.sin(phiC);
  const s = Math.cos(phiC);
  const P: number[][] = [];
  const dP: number[][] = [];
  for (let n = 0; n <= DEGRE; n++) {
    P.push(new Array<number>(n + 1).fill(0));
    dP.push(new Array<number>(n + 1).fill(0));
  }
  P[0]![0] = 1;
  for (let n = 1; n <= DEGRE; n++) {
    for (let m = 0; m <= n; m++) {
      if (m === n) {
        const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
        P[n]![n] = k * s * P[n - 1]![n - 1]!;
        dP[n]![n] = k * (c * P[n - 1]![n - 1]! + s * dP[n - 1]![n - 1]!);
      } else if (m === n - 1) {
        const k = Math.sqrt(2 * n - 1);
        P[n]![m] = k * c * P[n - 1]![m]!;
        dP[n]![m] = k * (-s * P[n - 1]![m]! + c * dP[n - 1]![m]!);
      } else {
        const k1 = 2 * n - 1;
        const k2 = Math.sqrt((n - 1 + m) * (n - 1 - m));
        const k = Math.sqrt(n * n - m * m);
        P[n]![m] = (k1 * c * P[n - 1]![m]! - k2 * P[n - 2]![m]!) / k;
        dP[n]![m] = (k1 * (-s * P[n - 1]![m]! + c * dP[n - 1]![m]!) - k2 * dP[n - 2]![m]!) / k;
      }
    }
  }
  const lambda = lon * RAD;
  let xc = 0;
  let yc = 0;
  let zcomp = 0;
  for (const [n, m, g0, h0, gd, hd] of COEFFICIENTS) {
    const g = g0 + dt * gd;
    const h = h0 + dt * hd;
    const f = (RAYON_REF / r) ** (n + 2);
    const cm = Math.cos(m * lambda);
    const sm = Math.sin(m * lambda);
    const gh = g * cm + h * sm;
    // X' = -(1/r) ∂V/∂φ' : la dérivée en φ' est l'opposée de celle en θ.
    xc += f * gh * dP[n]![m]!;
    yc += f * m * (g * sm - h * cm) * P[n]![m]!;
    zcomp -= f * (n + 1) * gh * P[n]![m]!;
  }
  yc /= s;
  // Du repère géocentrique au repère de l'ellipsoïde.
  const psi = phiC - phi;
  const x = xc * Math.cos(psi) - zcomp * Math.sin(psi);
  const z = xc * Math.sin(psi) + zcomp * Math.cos(psi);
  return { x, y: yc, z, declinaison: Math.atan2(yc, x) / RAD };
}

/** La déclinaison (degrés, est +) au sol en un lieu, à un instant ; null hors des dates du modèle. */
export function declinaison(lat: number, lon: number, instant: Date): number | null {
  return champ(lat, lon, 0, anneeDecimale(instant))?.declinaison ?? null;
}
