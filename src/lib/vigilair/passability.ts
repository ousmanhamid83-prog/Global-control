import {
  AO,
  LAKE_CHAD,
  destPoint,
  formatAzimut,
  formatCoord,
  formatRange,
  haversineKm,
  headingBetween,
  inRing,
  type MapScale,
} from "./geo";
import type { SatLayer } from "./sat";

export type PassMode = "voiture" | "quatre" | "pied" | "technique" | "eau" | "inconnu";

export type ZoneRegion = "afrique" | "moyen-orient" | "europe" | "monde" | "libre";

export type GpsFix = { lat: number; lon: number };

export type GpsZone = {
  id: string;
  name: string;
  region: ZoneRegion;
  lat: number;
  lon: number;
  radiusKm: number;
  north: GpsFix;
  east: GpsFix;
  south: GpsFix;
  west: GpsFix;
  status: "loading" | "ok" | "degrade";
  elevMinM: number | null;
  elevMaxM: number | null;
  slopeMaxPct: number | null;
  slopeMeanPct: number | null;
  mode: PassMode;
  source: string;
  note: string;
};

export type ZonePreset = {
  id: string;
  name: string;
  region: ZoneRegion;
  lat: number;
  lon: number;
  radiusKm: number;
  note: string;
  scale: MapScale;
  layer: SatLayer;
};

/** Points réels. Le clic carte couvre n'importe quel autre point. */
export const ZONE_PRESETS: ZonePreset[] = [
  {
    id: "maghreb",
    name: "Maghreb",
    region: "afrique",
    lat: 31.63,
    lon: -8.008,
    radiusKm: 18,
    note: "Haouz de Marrakech",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "nil",
    name: "Nil",
    region: "afrique",
    lat: 15.5007,
    lon: 32.5599,
    radiusKm: 16,
    note: "Khartoum, rive du Nil",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "austral",
    name: "Austral",
    region: "afrique",
    lat: -26.2044,
    lon: 28.0456,
    radiusKm: 16,
    note: "Hauts plateaux, Johannesburg",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "levant",
    name: "Levant",
    region: "moyen-orient",
    lat: 31.9539,
    lon: 35.9106,
    radiusKm: 14,
    note: "Amman",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "golfe",
    name: "Golfe",
    region: "moyen-orient",
    lat: 24.4539,
    lon: 54.3773,
    radiusKm: 20,
    note: "Abords d'Abu Dhabi",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "alpes",
    name: "Alpes",
    region: "europe",
    lat: 45.9237,
    lon: 6.8694,
    radiusKm: 12,
    note: "Vallée de Chamonix",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "plaine",
    name: "Plaine",
    region: "europe",
    lat: 48.8566,
    lon: 2.3522,
    radiusKm: 14,
    note: "Bassin parisien",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "andes",
    name: "Andes",
    region: "monde",
    lat: -32.6532,
    lon: -69.95,
    radiusKm: 14,
    note: "Piémont de l'Aconcagua",
    scale: "veille",
    layer: "rel",
  },
  {
    id: "himalaya",
    name: "Himalaya",
    region: "monde",
    lat: 27.9881,
    lon: 86.925,
    radiusKm: 12,
    note: "Khumbu, Everest",
    scale: "veille",
    layer: "rel",
  },
];

export const PASS_LABEL: Record<PassMode, string> = {
  voiture: "voiture sur piste",
  quatre: "4×4 ou à pied",
  pied: "à pied seulement",
  technique: "rando engagée",
  eau: "eau — ni voiture ni rando",
  inconnu: "GPS seul",
};

export function zoneCorners(lat: number, lon: number, radiusKm: number) {
  return {
    north: destPoint(lat, lon, 0, radiusKm),
    east: destPoint(lat, lon, 90, radiusKm),
    south: destPoint(lat, lon, 180, radiusKm),
    west: destPoint(lat, lon, 270, radiusKm),
  };
}

export function zoneOnWater(lat: number, lon: number): boolean {
  return inRing(lat, lon, LAKE_CHAD);
}

export function classifyPass(opts: {
  water: boolean;
  slopeMax: number | null;
  slopeMean: number | null;
}): { mode: PassMode; note: string } {
  if (opts.water) {
    return {
      mode: "eau",
      note: "Eau. Ni voiture ni randonnée. Le lac se voit en IR géostationnaire ~1 km, presque temps réel — pas un homme, pas un toit.",
    };
  }
  const max = opts.slopeMax;
  const mean = opts.slopeMean;
  if (max == null || mean == null) {
    return {
      mode: "inconnu",
      note: "MNT non joint. Le cercle GPS est exact. La pente n'est pas inventée.",
    };
  }
  const slope = `Pente max ${max.toFixed(0)} % · moyenne ${mean.toFixed(0)} %. MNT Copernicus ~90 m, pas un graphe routier, pas les mines, pas le sable.`;
  if (max < 8 && mean < 4) {
    return {
      mode: "voiture",
      note: `${slope} Piste probablement praticable en voiture. Ce n'est pas une route levée.`,
    };
  }
  if (max < 16) {
    return {
      mode: "quatre",
      note: `${slope} 4×4 ou piste. Randonnée courante. Voiture de route non garantie.`,
    };
  }
  if (max < 32) {
    return {
      mode: "pied",
      note: `${slope} À pied. Trop raide pour une voiture.`,
    };
  }
  return {
    mode: "technique",
    note: `${slope} Massif. Randonnée engagée ou impossible. Véhicule non.`,
  };
}

export function draftZone(opts: {
  id: string;
  name: string;
  region: ZoneRegion;
  lat: number;
  lon: number;
  radiusKm: number;
}): GpsZone {
  const c = zoneCorners(opts.lat, opts.lon, opts.radiusKm);
  return {
    ...opts,
    ...c,
    status: "loading",
    elevMinM: null,
    elevMaxM: null,
    slopeMaxPct: null,
    slopeMeanPct: null,
    mode: "inconnu",
    source: "",
    note: "Mesure du relief…",
  };
}

export function zoneReadout(z: GpsZone): string {
  const from = haversineKm(AO.airport.lat, AO.airport.lon, z.lat, z.lon);
  const az = headingBetween(AO.airport.lat, AO.airport.lon, z.lat, z.lon);
  const elev =
    z.elevMinM != null && z.elevMaxM != null
      ? ` · alt ${Math.round(z.elevMinM)}–${Math.round(z.elevMaxM)} m`
      : "";
  return `${z.name} · ${formatCoord(z.lat, z.lon)} · rayon ${formatRange(z.radiusKm)} · ${PASS_LABEL[z.mode]}${elev} · depuis FTTJ ${formatRange(from)} az ${formatAzimut(az)}`;
}

export const PERSONNEL_LIMIT =
  "Thermique et IR ~1 km : un massif ou le lac, oui. Un homme sur un toit, non — un corps n'est pas un pixel, un toit n'est pas transparent.";
