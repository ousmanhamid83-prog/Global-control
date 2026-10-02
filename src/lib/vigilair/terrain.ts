import {
  AO,
  LAKE_CHAD,
  formatAzimut,
  formatRange,
  haversineKm,
  headingBetween,
  type MapScale,
} from "./geo";
import type { SatLayer } from "./sat";

/** Départ des axes : seuil FTTJ, pas un point au hasard dans la ville. */
const FROM = AO.airport;

export type RangeAxis = {
  id: string;
  name: string;
  short: string;
  lat: number;
  lon: number;
  note: string;
};

function lakeCenter(): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const p of LAKE_CHAD) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / LAKE_CHAD.length, lon: lon / LAKE_CHAD.length };
}

const LAKE = lakeCenter();

/** Axes que la veille et l'approche (96 / 240 km) ne tiennent pas ensemble. */
export const RANGE_AXES: RangeAxis[] = [
  {
    id: "abecher",
    name: "Abéché",
    short: "Abéché",
    lat: 13.847,
    lon: 20.8443,
    note: "FTTC · est Tchad",
  },
  {
    id: "lac",
    name: "Lac Tchad",
    short: "Lac Tchad",
    lat: LAKE.lat,
    lon: LAKE.lon,
    note: "Cuvette, pas seulement la rive proche de N'Djamena",
  },
  {
    id: "kousseri",
    name: "Kousséri",
    short: "Kousséri",
    lat: 12.0786,
    lon: 15.0308,
    note: "Frontière Cameroun · rive du Logone, en face de N'Djamena",
  },
  {
    id: "maroua",
    name: "Maroua",
    short: "Maroua",
    lat: 10.5956,
    lon: 14.3157,
    note: "Extrême-Nord Cameroun · la veille 96 km ne l'atteint pas",
  },
  {
    id: "tibesti",
    name: "Tibesti",
    short: "Tibesti",
    lat: 21.3547,
    lon: 17.0012,
    note: "Bardaï · massif, pas le point sud 16,8°N",
  },
  {
    id: "tobruk",
    name: "Tobrouk",
    short: "Tobrouk",
    lat: 32.084,
    lon: 23.976,
    note: "Libye · côte. Ce n'est pas le Tibesti.",
  },
];

export type AxisLeg = { km: number; az: number; label: string };

export function axisLeg(ax: RangeAxis): AxisLeg {
  const km = haversineKm(FROM.lat, FROM.lon, ax.lat, ax.lon);
  const az = headingBetween(FROM.lat, FROM.lon, ax.lat, ax.lon);
  return { km, az, label: `${formatRange(km)}  az ${formatAzimut(az)}` };
}

/** Sahel tient Abéché, le lac, le Cameroun, le Tibesti et Tobrouk d'un seul cadre. */
export function frameAxis(): MapScale {
  return "sahel";
}

export function frameFor(lat: number, lon: number): MapScale {
  const km = haversineKm(FROM.lat, FROM.lon, lat, lon);
  if (km <= 45) return "veille";
  if (km <= 2000) return "aes";
  if (km <= 4100) return "sahel";
  return "monde";
}

export type Peak = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  elevM: number;
  /** Nom affiché au Monde. Les autres ne sont qu'un triangle, sauf sélection. */
  mark: boolean;
};

export const PEAKS: Peak[] = [
  { id: "emi-koussi", name: "Emi Koussi", country: "Tchad", lat: 19.7936, lon: 18.5464, elevM: 3445, mark: true },
  { id: "tousside", name: "Toussidé", country: "Tchad", lat: 21.0406, lon: 16.475, elevM: 3315, mark: true },
  { id: "deriba", name: "Deriba", country: "Soudan", lat: 12.9547, lon: 24.2711, elevM: 3042, mark: true },
  { id: "mt-cameroun", name: "Mont Cameroun", country: "Cameroun", lat: 4.2167, lon: 9.1706, elevM: 4040, mark: true },
  { id: "toubkal", name: "Toubkal", country: "Maroc", lat: 31.0592, lon: -7.9158, elevM: 4167, mark: true },
  { id: "tahat", name: "Tahat", country: "Algérie", lat: 23.2883, lon: 5.5339, elevM: 2908, mark: false },
  { id: "kili", name: "Kilimandjaro", country: "Tanzanie", lat: -3.0674, lon: 37.3556, elevM: 5895, mark: true },
  { id: "kenya", name: "Mont Kenya", country: "Kenya", lat: -0.1521, lon: 37.3084, elevM: 5199, mark: false },
  { id: "ras-dashen", name: "Ras Dashen", country: "Éthiopie", lat: 13.236, lon: 38.371, elevM: 4550, mark: false },
  { id: "margherita", name: "Margherita", country: "Ouganda", lat: 0.385, lon: 29.873, elevM: 5109, mark: false },
  { id: "thabana", name: "Thabana Ntlenyana", country: "Lesotho", lat: -29.468, lon: 29.268, elevM: 3482, mark: false },
  { id: "blanc", name: "Mont Blanc", country: "France", lat: 45.8326, lon: 6.8652, elevM: 4808, mark: true },
  { id: "elbrouz", name: "Elbrouz", country: "Russie", lat: 43.355, lon: 42.4392, elevM: 5642, mark: true },
  { id: "etna", name: "Etna", country: "Italie", lat: 37.751, lon: 14.9934, elevM: 3357, mark: false },
  { id: "everest", name: "Everest", country: "Népal", lat: 27.9881, lon: 86.925, elevM: 8849, mark: true },
  { id: "k2", name: "K2", country: "Pakistan", lat: 35.8808, lon: 76.5151, elevM: 8611, mark: false },
  { id: "damavand", name: "Damavand", country: "Iran", lat: 35.9558, lon: 52.1094, elevM: 5609, mark: false },
  { id: "fuji", name: "Fuji", country: "Japon", lat: 35.3606, lon: 138.7274, elevM: 3776, mark: true },
  { id: "kinabalu", name: "Kinabalu", country: "Malaisie", lat: 6.0753, lon: 116.558, elevM: 4095, mark: false },
  { id: "jaya", name: "Puncak Jaya", country: "Indonésie", lat: -4.0789, lon: 137.1583, elevM: 4884, mark: true },
  { id: "denali", name: "Denali", country: "États-Unis", lat: 63.0695, lon: -151.0074, elevM: 6190, mark: true },
  { id: "aconcagua", name: "Aconcagua", country: "Argentine", lat: -32.6532, lon: -70.0109, elevM: 6961, mark: true },
  { id: "chimborazo", name: "Chimborazo", country: "Équateur", lat: -1.4693, lon: -78.8175, elevM: 6263, mark: false },
  { id: "orizaba", name: "Orizaba", country: "Mexique", lat: 19.0304, lon: -97.269, elevM: 5636, mark: false },
  { id: "aoraki", name: "Aoraki", country: "Nouvelle-Zélande", lat: -43.595, lon: 170.141, elevM: 3724, mark: true },
  { id: "kosci", name: "Kosciuszko", country: "Australie", lat: -36.4559, lon: 148.2635, elevM: 2228, mark: false },
  { id: "mauna", name: "Mauna Kea", country: "États-Unis", lat: 19.8206, lon: -155.4681, elevM: 4207, mark: false },
  { id: "vinson", name: "Vinson", country: "Antarctique", lat: -78.5254, lon: -85.6171, elevM: 4892, mark: true },
];

export function peakById(id: string | null): Peak | null {
  if (!id) return null;
  return PEAKS.find((p) => p.id === id) ?? null;
}

export function peakLeg(p: Peak): AxisLeg {
  const km = haversineKm(FROM.lat, FROM.lon, p.lat, p.lon);
  const az = headingBetween(FROM.lat, FROM.lon, p.lat, p.lon);
  return { km, az, label: `${formatRange(km)}  az ${formatAzimut(az)}` };
}

/** Le massif et le toit s'imagent. L'occupant, non. */
export function peakSense(layer: SatLayer): string {
  if (layer === "ir" || layer === "th") {
    return "IR / thermique ~1 km : image de la masse, pas d'un corps dans la roche ni sous un toit.";
  }
  if (layer === "rel") {
    return "Relief ~30 m : image de la face. Un abri peut y être. Pas l'homme dedans.";
  }
  if (layer === "nv") {
    return "Nuit ~750 m : lueurs. Ni la crête, ni l'intérieur.";
  }
  return "Visible : image du toit et de la face. Un homme peut rester dedans — son image, non. L'indice est une voiture au seuil.";
}
