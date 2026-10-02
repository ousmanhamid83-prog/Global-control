import { formatRange, formatGsdM, haversineKm, type MapScale } from "./geo";
import type { SatLayer } from "./sat";
import { formatPx, lastPixelScan, pixelDetections, realDetectLine } from "./tiles";

export type HydroRegion = "tchad" | "afrique" | "monde";

export type HydroPlace = {
  id: string;
  name: string;
  short: string;
  region: HydroRegion;
  kind: "lac" | "fleuve";
  lat: number;
  lon: number;
  radiusKm: number;
  /** Cercle d'ordre de grandeur. Le Lac Tchad a déjà son polygone. */
  circle: boolean;
  scale: MapScale;
  note: string;
  line?: { name: string; lat: number; lon: number }[];
};

export const HYDRO_REGION_LABEL: Record<HydroRegion, string> = {
  tchad: "Tchad",
  afrique: "Afrique",
  monde: "Monde",
};

/** Traits WGS84. Pas un sondeur, pas une profondeur, pas un rivage levé au mètre. */
export const HYDRO: HydroPlace[] = [
  {
    id: "chari",
    name: "Chari",
    short: "Chari",
    region: "tchad",
    kind: "fleuve",
    lat: 11.2,
    lon: 16.2,
    radiusKm: 8,
    circle: false,
    scale: "aes",
    note: "Pirogue. Sarh, Bousso, N'Djamena, embouchure vers Kinasserom. Axe GPS, pas le chenal.",
    line: [
      { name: "Sarh", lat: 9.1429, lon: 18.3923 },
      { name: "Bousso", lat: 10.482, lon: 16.711 },
      { name: "N'Djamena", lat: 12.111, lon: 15.049 },
      { name: "Kinasserom", lat: 12.9657, lon: 14.5576 },
    ],
  },
  {
    id: "logone",
    name: "Logone",
    short: "Logone",
    region: "tchad",
    kind: "fleuve",
    lat: 10.3,
    lon: 15.7,
    radiusKm: 6,
    circle: false,
    scale: "aes",
    note: "Pirogue. Moundou, Laï, Bongor, confluent avec le Chari à N'Djamena. Pas un sondeur.",
    line: [
      { name: "Moundou", lat: 8.5667, lon: 16.0833 },
      { name: "Laï", lat: 9.3956, lon: 16.2986 },
      { name: "Bongor", lat: 10.2806, lon: 15.3722 },
      { name: "N'Djamena", lat: 12.104, lon: 15.041 },
    ],
  },
  {
    id: "lac-tchad",
    name: "Lac Tchad",
    short: "Lac Tchad",
    region: "tchad",
    kind: "lac",
    lat: 13.04,
    lon: 14.65,
    radiusKm: 40,
    circle: false,
    scale: "approche",
    note: "Cuvette sud. Le polygone est schématique. Pas une bathymétrie.",
  },
  {
    id: "fitri",
    name: "Lac Fitri",
    short: "Fitri",
    region: "tchad",
    kind: "lac",
    lat: 12.8,
    lon: 17.5,
    radiusKm: 14,
    circle: true,
    scale: "veille",
    note: "Plan d'eau saisonnier, Batha. Cercle d'ordre de grandeur, pas le rivage.",
  },
  {
    id: "iro",
    name: "Lac Iro",
    short: "Iro",
    region: "tchad",
    kind: "lac",
    lat: 10.1,
    lon: 19.417,
    radiusKm: 7,
    circle: true,
    scale: "veille",
    note: "Moyen-Chari. Plan d'eau, pas une sonde.",
  },
  {
    id: "lere",
    name: "Lac de Léré",
    short: "Léré",
    region: "tchad",
    kind: "lac",
    lat: 9.633,
    lon: 14.183,
    radiusKm: 5,
    circle: true,
    scale: "veille",
    note: "Mayo-Kebbi. Plan d'eau, pas une sonde.",
  },
  {
    id: "ounianga",
    name: "Ounianga Kébir",
    short: "Ounianga",
    region: "tchad",
    kind: "lac",
    lat: 19.05,
    lon: 20.517,
    radiusKm: 3,
    circle: true,
    scale: "veille",
    note: "Lacs du Borkou, Ennedi. Petits plans d'eau du désert.",
  },
  {
    id: "serir",
    name: "Ounianga Sérir",
    short: "Sérir",
    region: "tchad",
    kind: "lac",
    lat: 18.917,
    lon: 20.867,
    radiusKm: 4,
    circle: true,
    scale: "veille",
    note: "Lacs du Borkou. Pas une profondeur.",
  },
  {
    id: "victoria",
    name: "Lac Victoria",
    short: "Victoria",
    region: "afrique",
    kind: "lac",
    lat: -1.0,
    lon: 33.0,
    radiusKm: 40,
    circle: true,
    scale: "veille",
    note: "Afrique de l'Est. Le cercle n'est pas le rivage levé.",
  },
  {
    id: "tanganyika",
    name: "Lac Tanganyika",
    short: "Tanganyika",
    region: "afrique",
    kind: "lac",
    lat: -6.0,
    lon: 29.5,
    radiusKm: 30,
    circle: true,
    scale: "veille",
    note: "Rift. Cercle d'ordre de grandeur.",
  },
  {
    id: "malawi",
    name: "Lac Malawi",
    short: "Malawi",
    region: "afrique",
    kind: "lac",
    lat: -12.0,
    lon: 34.35,
    radiusKm: 25,
    circle: true,
    scale: "veille",
    note: "Rift. Cercle d'ordre de grandeur.",
  },
  {
    id: "turkana",
    name: "Lac Turkana",
    short: "Turkana",
    region: "afrique",
    kind: "lac",
    lat: 3.5,
    lon: 36.0,
    radiusKm: 20,
    circle: true,
    scale: "veille",
    note: "Kenya. Plan d'eau, pas une sonde.",
  },
  {
    id: "tana",
    name: "Lac Tana",
    short: "Tana",
    region: "afrique",
    kind: "lac",
    lat: 12.0,
    lon: 37.3,
    radiusKm: 15,
    circle: true,
    scale: "veille",
    note: "Éthiopie, source du Nil Bleu.",
  },
  {
    id: "nasser",
    name: "Lac Nasser",
    short: "Nasser",
    region: "afrique",
    kind: "lac",
    lat: 22.8,
    lon: 32.5,
    radiusKm: 15,
    circle: true,
    scale: "veille",
    note: "Nil, Égypte / Soudan. Retenue, pas le lit levé.",
  },
  {
    id: "caspienne",
    name: "Caspienne",
    short: "Caspienne",
    region: "monde",
    kind: "lac",
    lat: 42.0,
    lon: 51.0,
    radiusKm: 40,
    circle: true,
    scale: "veille",
    note: "Eurasie. Le cercle n'est pas le rivage.",
  },
  {
    id: "baikal",
    name: "Baïkal",
    short: "Baïkal",
    region: "monde",
    kind: "lac",
    lat: 53.5,
    lon: 108.2,
    radiusKm: 20,
    circle: true,
    scale: "veille",
    note: "Sibérie. Plan d'eau, pas une sonde.",
  },
  {
    id: "superieur",
    name: "Lac Supérieur",
    short: "Supérieur",
    region: "monde",
    kind: "lac",
    lat: 47.7,
    lon: -87.5,
    radiusKm: 30,
    circle: true,
    scale: "veille",
    note: "Grands Lacs, Amérique du Nord.",
  },
  {
    id: "titicaca",
    name: "Titicaca",
    short: "Titicaca",
    region: "monde",
    kind: "lac",
    lat: -15.83,
    lon: -69.33,
    radiusKm: 15,
    circle: true,
    scale: "veille",
    note: "Andes. Plan d'eau, pas une sonde.",
  },
  {
    id: "leman",
    name: "Léman",
    short: "Léman",
    region: "monde",
    kind: "lac",
    lat: 46.45,
    lon: 6.53,
    radiusKm: 8,
    circle: true,
    scale: "veille",
    note: "Europe, Alpes.",
  },
  {
    id: "morte",
    name: "Mer Morte",
    short: "Mer Morte",
    region: "monde",
    kind: "lac",
    lat: 31.5,
    lon: 35.47,
    radiusKm: 8,
    circle: true,
    scale: "veille",
    note: "Levant. Plan d'eau, pas une sonde.",
  },
  {
    id: "tonle",
    name: "Tonlé Sap",
    short: "Tonlé Sap",
    region: "monde",
    kind: "lac",
    lat: 12.9,
    lon: 104.07,
    radiusKm: 15,
    circle: true,
    scale: "veille",
    note: "Asie. Niveau très variable. Pas le rivage.",
  },
  {
    id: "eyre",
    name: "Lac Eyre",
    short: "Eyre",
    region: "monde",
    kind: "lac",
    lat: -28.7,
    lon: 137.1,
    radiusKm: 20,
    circle: true,
    scale: "veille",
    note: "Australie. Souvent à sec. Pas une sonde.",
  },
];

export const CHART_NOTE =
  "Carte marine : traits et plans d'eau en WGS84. Pas un sondeur. Aucune profondeur, aucun chenal levé.";

export function hydroById(id: string | null): HydroPlace | null {
  if (!id) return null;
  return HYDRO.find((w) => w.id === id) ?? null;
}

export function hydroKm(place: HydroPlace): number {
  const line = place.line;
  if (!line || line.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    km += haversineKm(a.lat, a.lon, b.lat, b.lon);
  }
  return km;
}

export function waterAt(lat: number, lon: number): HydroPlace | null {
  let best: HydroPlace | null = null;
  let bestD = Infinity;
  for (const w of HYDRO) {
    if (w.kind !== "lac" || !w.circle) continue;
    const d = haversineKm(lat, lon, w.lat, w.lon);
    if (d <= w.radiusKm && d < bestD) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

/** Les trois tâches, séparées. L'identification ne se déduit pas des deux autres. */
export function sensorVerdict(layer: SatLayer, gsdM: number): string {
  const dets = pixelDetections(gsdM, layer);
  const tasks = dets.map((d) => `${d.label} ${formatPx(d.px)} px ${d.clsLabel}`).join(" · ");
  const identified = dets.some((d) => d.cls === "identification");
  const idLine = identified
    ? "Identification atteinte."
    : "Identification non atteinte, seuil 12 px.";
  const reel = realDetectLine(lastPixelScan());
  const tail = reel ? ` ${reel}.` : "";
  if (layer === "ir" || layer === "th") {
    return `Thermique et IR : ${formatGsdM(gsdM)} au sol. Nappe, rive, massif. ${tasks}. ${idLine}${tail}`;
  }
  if (layer === "nv") {
    return `Nuit : ${formatGsdM(gsdM)}. Lueurs et nappes. ${tasks}. ${idLine}${tail}`;
  }
  if (layer === "rel") {
    return `Relief : ${formatGsdM(gsdM)}. Cuvette, fleuve, massif. ${tasks}. ${idLine}${tail}`;
  }
  return `Visible : ${formatGsdM(gsdM)} là où la tuile est réelle. ${tasks}. ${idLine}${tail}`;
}

export function hydroLabel(place: HydroPlace): string {
  if (place.kind === "fleuve") return `${place.name} · ${formatRange(hydroKm(place))} · pirogue`;
  return `${place.name} · rayon ${formatRange(place.radiusKm)} · plan d'eau`;
}
