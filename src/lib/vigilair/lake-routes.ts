import { formatRange, haversineKm } from "./geo";

export type LakeCraft = "pirogue" | "jetski";

export type LakeFix = { name: string; lat: number; lon: number };

export type LakeRoute = {
  id: string;
  name: string;
  short: string;
  craft: LakeCraft;
  waypoints: LakeFix[];
  note: string;
};

/**
 * Axes WGS84 entre points réels de la cuvette sud.
 * Pas un levé bathymétrique : la ligne joint les embarcadères,
 * elle ne trace pas le chenal dans les roseaux.
 * Bassin nord (Nguigmi) souvent à sec — aucune route.
 */
export const LAKE_ROUTES: LakeRoute[] = [
  {
    id: "piro-archipel",
    name: "Pirogue Bol – Baga Sola",
    short: "Pirogue archipel",
    craft: "pirogue",
    waypoints: [
      { name: "Bol", lat: 13.45861, lon: 14.71472 },
      { name: "Bol Guini", lat: 13.5, lon: 14.68333 },
      { name: "Baga Sola", lat: 13.53705, lon: 14.31301 },
    ],
    note: "Pirogue. Archipel et polders Bol–Baga Sola. Chenaux peu profonds : pas un jet ski.",
  },
  {
    id: "piro-cuvette",
    name: "Pirogue Bol – Blangoua",
    short: "Pirogue cuvette",
    craft: "pirogue",
    waypoints: [
      { name: "Bol", lat: 13.45861, lon: 14.71472 },
      { name: "Kinasserom", lat: 12.9656885, lon: 14.5575923 },
      { name: "Blangoua", lat: 12.7739921, lon: 14.5524628 },
    ],
    note: "Pirogue. De Bol vers Kinasserom puis Blangoua, rive camerounaise. Axe GPS, pas le chenal exact dans les roseaux.",
  },
  {
    id: "jet-cuvette",
    name: "Jet ski Darak – Kinasserom",
    short: "Jet ski",
    craft: "jetski",
    waypoints: [
      { name: "Darak", lat: 12.8776762, lon: 14.2969767 },
      { name: "Kinasserom", lat: 12.9656885, lon: 14.5575923 },
    ],
    note: "Jet ski seulement ici : eau libre de la cuvette sud, souvent 1 à 4 m. Pas un sondeur. Le reste du lac est à la pirogue. Vers Nguigmi, le bassin nord est souvent à sec.",
  },
];

export function routeById(id: string | null): LakeRoute | null {
  if (!id) return null;
  return LAKE_ROUTES.find((r) => r.id === id) ?? null;
}

export function routeKm(route: LakeRoute): number {
  let km = 0;
  for (let i = 1; i < route.waypoints.length; i++) {
    const a = route.waypoints[i - 1]!;
    const b = route.waypoints[i]!;
    km += haversineKm(a.lat, a.lon, b.lat, b.lon);
  }
  return km;
}

export function routeLabel(route: LakeRoute): string {
  const craft = route.craft === "jetski" ? "jet ski" : "pirogue";
  return `${route.name} · ${formatRange(routeKm(route))} · ${craft}`;
}
