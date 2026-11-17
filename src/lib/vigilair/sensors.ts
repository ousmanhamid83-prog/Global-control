import type { ProtectedSite } from "./types";
import { AO } from "./geo.ts";

/** Zones protégées par défaut : des lieux réels de N'Djamena, que le chef ajuste dans « Zones ». */
export const PROTECTED_SITES: ProtectedSite[] = [
  {
    id: "fttj",
    name: "FTTJ",
    kind: "aerodrome",
    lat: AO.airport.lat,
    lon: AO.airport.lon,
    radiusKm: 3.2,
  },
  {
    id: "palais",
    name: "Palais",
    kind: "palais",
    lat: 12.113,
    lon: 15.074,
    radiusKm: 1.6,
  },
  {
    id: "kassei",
    name: "Camp Kassai",
    kind: "camp",
    lat: 12.118,
    lon: 15.038,
    radiusKm: 1.4,
  },
  {
    id: "nation",
    name: "Place de la Nation",
    kind: "ministere",
    lat: 12.134,
    lon: 15.049,
    radiusKm: 0.9,
  },
  {
    id: "chagoua",
    name: "Pont Chagoua",
    kind: "pont",
    lat: 12.102,
    lon: 15.088,
    radiusKm: 0.8,
  },
];
