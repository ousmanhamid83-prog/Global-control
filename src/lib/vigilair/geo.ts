/** N'Djamena COP — 4K ~1 m, ident 10 m, veille ≤ 50 m, approche, AES, Sahel, Monde. */

export const AO = {
  name: "Sahel · AES · N'Djamena",
  centerLat: 12.1348,
  centerLon: 15.0557,
  /** Envelope de vie des pistes (côté ~4 200 km). */
  sizeKm: 8400,
  identKm: 240,
  sahelKm: 8400,
  airport: { lat: 12.1336, lon: 15.034, label: "FTTJ" },
  river: [
    { lat: 11.96, lon: 15.02 },
    { lat: 12.02, lon: 15.01 },
    { lat: 12.08, lon: 14.995 },
    { lat: 12.134, lon: 15.02 },
    { lat: 12.2, lon: 15.05 },
    { lat: 12.28, lon: 15.09 },
  ],
  logone: [
    { lat: 11.96, lon: 15.08 },
    { lat: 12.02, lon: 15.06 },
    { lat: 12.07, lon: 15.04 },
    { lat: 12.11, lon: 15.028 },
  ],
  city: { lat: 12.1348, lon: 15.0557, rKm: 4.2 },
};

export type MapScale = "k4" | "ident" | "veille" | "approche" | "aes" | "sahel" | "monde";

export const SCALE: Record<
  MapScale,
  { sizeKm: number; tileZ: number; barKm: number; label: string; rings: number[] }
> = {
  k4: {
    sizeKm: 2.4,
    tileZ: 17,
    barKm: 0.2,
    label: "1,2 m",
    rings: [0.5, 1],
  },
  ident: {
    sizeKm: 1.2,
    tileZ: 19,
    barKm: 0.1,
    label: "0,3 m",
    rings: [0.2, 0.4, 0.6],
  },
  veille: {
    sizeKm: 96,
    tileZ: 12,
    barKm: 10,
    label: "Veille",
    rings: [20, 40, 48],
  },
  approche: {
    sizeKm: 240,
    tileZ: 12,
    barKm: 20,
    label: "Approche",
    rings: [50, 100, 120],
  },
  aes: {
    sizeKm: 5200,
    tileZ: 6,
    barKm: 400,
    label: "AES",
    rings: [500, 1000, 1500, 2000, 2500],
  },
  sahel: {
    sizeKm: 8400,
    tileZ: 5,
    barKm: 500,
    label: "Sahel",
    rings: [1000, 2000, 3000, 4000],
  },
  monde: {
    sizeKm: 44000,
    tileZ: 3,
    barKm: 5000,
    label: "Monde",
    rings: [5000, 10000, 20000],
  },
};

export function isLocalScale(s: MapScale): boolean {
  return s === "k4" || s === "ident";
}

/** Échelles où le visible natif tient ≤ 50 m (z ≥ 12). */
export function isHiResScale(s: MapScale): boolean {
  return s === "k4" || s === "ident" || s === "veille" || s === "approche";
}

/** GSD Web Mercator au sol, mètres / pixel de tuile 256. */
export function visGsdM(z: number, lat = AO.centerLat): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Lecture GSD poste : 4.6 m, 30 m, 1.0 km. */
export function formatGsdM(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "—";
  if (m < 10) return `${m.toFixed(1)} m`;
  if (m < 950) return `${Math.round(m)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export type GeoOrigin = { lat: number; lon: number };

export const HOME: GeoOrigin = { lat: AO.centerLat, lon: AO.centerLon };

export function isHomeOrigin(o: GeoOrigin, km = 0.5): boolean {
  return haversineKm(o.lat, o.lon, HOME.lat, HOME.lon) < km;
}

export type TheaterId = "tchad" | "darfour" | "aes" | "sahel" | "monde";

export const THEATER_LABEL: Record<TheaterId, string> = {
  tchad: "Tchad",
  darfour: "Darfour",
  aes: "AES",
  sahel: "Sahel",
  monde: "Monde",
};

export function inRing(
  lat: number,
  lon: number,
  ring: { lat: number; lon: number }[],
): boolean {
  let n = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const hit =
      a.lat > lat !== b.lat > lat &&
      lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat + 1e-12) + a.lon;
    if (hit) n += 1;
  }
  return n % 2 === 1;
}

export function theaterOf(lat: number, lon: number): TheaterId {
  if (lat >= 11 && lat <= 16.8 && lon >= 22.35 && lon <= 27.6) return "darfour";
  if (lat >= 7.4 && lat <= 23.5 && lon >= 13.4 && lon <= 24) return "tchad";
  if (inRing(lat, lon, AES_HULL)) return "aes";
  if (lat >= 8 && lat <= 24 && lon >= -18 && lon <= 38) return "sahel";
  return "monde";
}

export function theaterRank(id: TheaterId): number {
  if (id === "tchad") return 5;
  if (id === "darfour") return 4;
  if (id === "aes") return 3;
  if (id === "sahel") return 2;
  return 1;
}

/** Pistes perdues au-delà du théâtre (rayon ~4 200 km, Dakar inclus). */
export const THEATRE_RADIUS_KM = 4200;

export type SahelCity = {
  name: string;
  lat: number;
  lon: number;
  /** 1 = capitale (Sahel), 2 = nœud op. (AES), 3 = local. */
  tier: 1 | 2 | 3;
};

export const SAHEL_CITIES: SahelCity[] = [
  { name: "N'Djamena", lat: 12.1348, lon: 15.0557, tier: 1 },
  { name: "Dakar", lat: 14.693, lon: -17.447, tier: 1 },
  { name: "Nouakchott", lat: 18.079, lon: -15.978, tier: 1 },
  { name: "Bamako", lat: 12.639, lon: -8.003, tier: 1 },
  { name: "Ouagadougou", lat: 12.371, lon: -1.52, tier: 1 },
  { name: "Niamey", lat: 13.512, lon: 2.112, tier: 1 },
  { name: "Khartoum", lat: 15.501, lon: 32.532, tier: 1 },
  { name: "Kousseri", lat: 12.078, lon: 15.031, tier: 3 },
  { name: "Maiduguri", lat: 11.846, lon: 13.16, tier: 2 },
  { name: "Diffa", lat: 13.315, lon: 12.609, tier: 2 },
  { name: "Bol", lat: 13.458, lon: 14.715, tier: 3 },
  { name: "Moundou", lat: 8.566, lon: 16.077, tier: 2 },
  { name: "Sarh", lat: 9.143, lon: 18.392, tier: 3 },
  { name: "Mongo", lat: 12.184, lon: 18.693, tier: 3 },
  { name: "Ati", lat: 13.215, lon: 18.335, tier: 3 },
  { name: "Abéché", lat: 13.829, lon: 20.832, tier: 2 },
  { name: "Faya", lat: 17.926, lon: 19.104, tier: 2 },
  { name: "Fada", lat: 17.185, lon: 21.582, tier: 3 },
  { name: "Bardai", lat: 21.355, lon: 17.001, tier: 3 },
  { name: "Agadez", lat: 16.974, lon: 7.991, tier: 2 },
  { name: "Zinder", lat: 13.807, lon: 8.988, tier: 2 },
  { name: "Maradi", lat: 13.491, lon: 7.102, tier: 3 },
  { name: "Tahoua", lat: 14.889, lon: 5.268, tier: 2 },
  { name: "Tillabéri", lat: 14.211, lon: 1.453, tier: 2 },
  { name: "Gao", lat: 16.266, lon: -0.04, tier: 2 },
  { name: "Tombouctou", lat: 16.773, lon: -3.007, tier: 2 },
  { name: "Kidal", lat: 18.441, lon: 1.407, tier: 2 },
  { name: "Ménaka", lat: 15.918, lon: 2.402, tier: 2 },
  { name: "Tessalit", lat: 20.201, lon: 1.012, tier: 3 },
  { name: "Kayes", lat: 14.447, lon: -11.444, tier: 3 },
  { name: "Dori", lat: 14.035, lon: -0.035, tier: 2 },
  { name: "Djibo", lat: 14.099, lon: -1.627, tier: 2 },
  { name: "Fada N'Gourma", lat: 12.061, lon: 0.358, tier: 3 },
  { name: "Ouahigouya", lat: 13.563, lon: -2.422, tier: 3 },
  { name: "Néma", lat: 16.617, lon: -7.25, tier: 2 },
  { name: "Aioun", lat: 16.666, lon: -9.615, tier: 3 },
  { name: "Bakel", lat: 14.9, lon: -12.456, tier: 3 },
  { name: "Kano", lat: 12.002, lon: 8.592, tier: 2 },
  { name: "Sokoto", lat: 13.062, lon: 5.233, tier: 2 },
  { name: "Maroua", lat: 10.591, lon: 14.316, tier: 2 },
  { name: "Birao", lat: 10.284, lon: 22.782, tier: 3 },
  { name: "Geneina", lat: 13.45, lon: 22.447, tier: 2 },
  { name: "El Fasher", lat: 13.628, lon: 25.35, tier: 2 },
  { name: "Nyala", lat: 12.051, lon: 24.88, tier: 2 },
  { name: "El Obeid", lat: 13.184, lon: 30.217, tier: 2 },
  { name: "Dongola", lat: 19.167, lon: 30.474, tier: 3 },
  { name: "Kassala", lat: 15.451, lon: 36.4, tier: 2 },
  { name: "Port-Soudan", lat: 19.616, lon: 37.216, tier: 2 },
  { name: "Kufra", lat: 24.183, lon: 23.283, tier: 2 },
];

/** Ville connue la plus proche d'un point, avec la distance en km (pour situer un foyer). */
export function nearestCity(lat: number, lon: number): { name: string; distKm: number } {
  let best = SAHEL_CITIES[0]!;
  let bestD = Infinity;
  for (const c of SAHEL_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { name: best.name, distKm: bestD };
}

export type SahelState = {
  id: string;
  name: string;
  aes: boolean;
  lat: number;
  lon: number;
};

export const SAHEL_STATES: SahelState[] = [
  { id: "sn", name: "Sénégal", aes: false, lat: 14.5, lon: -14.8 },
  { id: "mr", name: "Mauritanie", aes: false, lat: 20.4, lon: -10.6 },
  { id: "ml", name: "Mali", aes: true, lat: 18.4, lon: -2.4 },
  { id: "bf", name: "Burkina Faso", aes: true, lat: 13.15, lon: -1.9 },
  { id: "ne", name: "Niger", aes: true, lat: 18.2, lon: 9.3 },
  { id: "td", name: "Tchad", aes: false, lat: 15.6, lon: 18.7 },
  { id: "sd", name: "Soudan", aes: false, lat: 16.2, lon: 30.2 },
  { id: "ng", name: "Nigeria (nord)", aes: false, lat: 12.2, lon: 8.4 },
  { id: "cm", name: "Cameroun (EN)", aes: false, lat: 10.7, lon: 14.5 },
  { id: "ly", name: "Libye (sud)", aes: false, lat: 23.6, lon: 17.8 },
];

export const AES_HULL: { lat: number; lon: number }[] = [
  { lat: 24.8, lon: -6.2 },
  { lat: 24.2, lon: 4 },
  { lat: 23.4, lon: 12 },
  { lat: 20.6, lon: 15.4 },
  { lat: 15.2, lon: 13.8 },
  { lat: 13.2, lon: 11 },
  { lat: 11.7, lon: 3.6 },
  { lat: 9.5, lon: 1.8 },
  { lat: 9.4, lon: -2.9 },
  { lat: 10.1, lon: -5.5 },
  { lat: 10.2, lon: -8.3 },
  { lat: 12.4, lon: -12 },
  { lat: 16.6, lon: -12.3 },
  { lat: 22.4, lon: -6.8 },
];

export type Corridor = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  aes: boolean;
};

export const CORRIDORS: Corridor[] = [
  { id: "tibesti", name: "Tibesti / Libye", lat: 16.8, lon: 16.9, aes: false },
  { id: "darfour", name: "Darfour / Soudan", lat: 13.4, lon: 21.2, aes: false },
  { id: "fasher", name: "El Fasher / Kordofan", lat: 13.6, lon: 25.4, aes: false },
  { id: "khartoum", name: "Nil / Khartoum", lat: 15.5, lon: 32.5, aes: false },
  { id: "portsoudan", name: "Mer Rouge / Port-Soudan", lat: 19.4, lon: 36.8, aes: false },
  { id: "geneina", name: "Geneina / frontière", lat: 13.45, lon: 22.4, aes: false },
  { id: "rca", name: "Sud / RCA", lat: 8.9, lon: 18.1, aes: false },
  { id: "borno", name: "Borno / Nigeria", lat: 11.7, lon: 13.3, aes: false },
  { id: "diffa", name: "Diffa / Niger", lat: 13.4, lon: 12.7, aes: true },
  { id: "tenere", name: "Ténéré / Agadez", lat: 17.2, lon: 9.2, aes: true },
  { id: "tahoua", name: "Tahoua / Niger", lat: 14.9, lon: 5.3, aes: true },
  { id: "tillaberi", name: "Tillabéri / Liptako", lat: 14.21, lon: 1.45, aes: true },
  { id: "gao", name: "Gao / Mali", lat: 16.3, lon: 0, aes: true },
  { id: "kidal", name: "Kidal / Adrar des Ifoghas", lat: 18.44, lon: 1.41, aes: true },
  { id: "menaka", name: "Ménaka / Liptako-Gourma", lat: 15.92, lon: 2.4, aes: true },
  { id: "dori", name: "Dori / Burkina Est", lat: 14.04, lon: -0.03, aes: true },
  { id: "djibo", name: "Djibo / Soum", lat: 14.1, lon: -1.63, aes: true },
  { id: "ouaga", name: "Ouagadougou / AES", lat: 12.37, lon: -1.53, aes: true },
  { id: "bamako", name: "Bamako / AES", lat: 12.64, lon: -8, aes: true },
  { id: "nema", name: "Néma / Mauritanie", lat: 16.62, lon: -7.25, aes: false },
  { id: "bakel", name: "Bakel / Sénégal", lat: 14.9, lon: -12.45, aes: false },
  { id: "sokoto", name: "Sokoto / Nigeria", lat: 13.06, lon: 5.23, aes: false },
  { id: "kufra", name: "Kufra / Sahara", lat: 22.5, lon: 23, aes: false },
  { id: "ennedi", name: "Ennedi / désert", lat: 17.2, lon: 21.5, aes: false },
  { id: "extreme-nord", name: "Extrême-Nord / Cameroun", lat: 10.6, lon: 14.4, aes: false },
];

export const LAKE_CHAD: { lat: number; lon: number }[] = [
  { lat: 12.85, lon: 14.25 },
  { lat: 13.15, lon: 14.35 },
  { lat: 13.45, lon: 14.55 },
  { lat: 13.4, lon: 14.95 },
  { lat: 13.1, lon: 15.15 },
  { lat: 12.7, lon: 14.85 },
  { lat: 12.65, lon: 14.45 },
];

const KM_PER_DEG_LAT = 110.574;

export function kmPerDegLon(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

export function project(
  lat: number,
  lon: number,
  w: number,
  h: number,
  sizeKm = AO.sizeKm,
  origin: GeoOrigin = HOME,
): { x: number; y: number } {
  const dx = (lon - origin.lon) * kmPerDegLon(origin.lat);
  const dy = (lat - origin.lat) * KM_PER_DEG_LAT;
  const x = w / 2 + (dx / sizeKm) * w;
  const y = h / 2 - (dy / sizeKm) * h;
  return { x, y };
}

export function unproject(
  x: number,
  y: number,
  w: number,
  h: number,
  sizeKm = AO.sizeKm,
  origin: GeoOrigin = HOME,
): { lat: number; lon: number } {
  const dx = ((x - w / 2) / w) * sizeKm;
  const dy = ((h / 2 - y) / h) * sizeKm;
  return {
    lat: origin.lat + dy / KM_PER_DEG_LAT,
    lon: origin.lon + dx / kmPerDegLon(origin.lat),
  };
}

export function destPoint(
  lat: number,
  lon: number,
  headingDeg: number,
  distKm: number,
): { lat: number; lon: number } {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = (distKm * Math.cos(rad)) / KM_PER_DEG_LAT;
  const dLon = (distKm * Math.sin(rad)) / kmPerDegLon(lat);
  return { lat: lat + dLat, lon: lon + dLon };
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function headingBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dx = (lon2 - lon1) * kmPerDegLon(lat1);
  const dy = (lat2 - lat1) * KM_PER_DEG_LAT;
  let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function predictPath(
  lat: number,
  lon: number,
  heading: number,
  speedKmh: number,
  steps = 12,
  stepS = 25,
): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  let p = { lat, lon };
  const stepKm = (speedKmh / 3600) * stepS;
  for (let i = 0; i < steps; i++) {
    p = destPoint(p.lat, p.lon, heading, stepKm);
    out.push(p);
  }
  return out;
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}  ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

export function formatCoordShort(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatRange(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.max(0, Math.round(km * 1000))} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatAzimut(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(d).padStart(3, "0")}°`;
}

const MGRS_COL = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MGRS_ROW = "ABCDEFGHJKLMNPQRSTUV";
const MGRS_BAND = "CDEFGHJKLMNPQRSTUVWX";

function toUtm(latDeg: number, lonDeg: number, zone: number): { easting: number; northing: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const t = Math.tan(lat) ** 2;
  const c = ep2 * Math.cos(lat) ** 2;
  const A = Math.cos(lat) * (lon - lon0);
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * lat -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * lat) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * lat) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * lat));
  const easting =
    k0 *
      n *
      (A +
        ((1 - t + c) * A ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * A ** 5) / 120) +
    500000;
  const northing =
    k0 *
    (m +
      n *
        Math.tan(lat) *
        (A ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * A ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * A ** 6) / 720));
  return { easting, northing };
}

/** MGRS compact. digits 4 = 10 m, 5 = 1 m. N'Djamena = zone 33P. */
export function mgrsCompact(lat: number, lon: number, digits = 4): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  if (lat < -80 || lat > 84) return "polaire";
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const bandIdx = Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)));
  const band = MGRS_BAND.charAt(bandIdx);
  const { easting, northing } = toUtm(lat, lon, zone);
  const colSet = (zone - 1) % 3;
  const colIdx = colSet * 8 + Math.floor(easting / 100000) - 1;
  const col = MGRS_COL.charAt(((colIdx % 24) + 24) % 24);
  const rowOff = zone % 2 === 0 ? 5 : 0;
  const row = MGRS_ROW.charAt((Math.floor(northing / 100000) + rowOff) % 20);
  const d = Math.max(1, Math.min(5, Math.round(digits)));
  const f = 10 ** (5 - d);
  const e = String(Math.floor((easting % 100000) / f)).padStart(d, "0");
  const n = String(Math.floor((northing % 100000) / f)).padStart(d, "0");
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  const n = 2 ** z;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
}

export function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
