/** Bulles de protection C-UAS — N'Djamena. VIGILAIR n'émet pas. */

import { isFriend } from "./friends";
import { haversineKm, headingBetween } from "./geo";
import { PROTECTED_SITES } from "./sensors";
import type { ProtectedSite, Track } from "./types";

export type ZoneKind = ProtectedSite["kind"] | "mine";

export type ZoneRow = {
  id: string;
  name: string;
  kind: ZoneKind;
  lat: number;
  lon: number;
  radiusKm: number;
  armed: boolean;
  note: string;
};

export type ZoneContact = {
  trackId: string;
  callsign: string;
  distKm: number;
  uas: boolean;
  friend: boolean;
};

export type ZoneLevel = "veille" | "trafic" | "approche" | "intrusion";

export type ZoneStatus = {
  zone: ZoneRow;
  inside: ZoneContact[];
  approaching: ZoneContact[];
  level: ZoneLevel;
};

export const ZONE_KIND_LABEL: Record<ZoneKind, string> = {
  aerodrome: "Aérodrome",
  palais: "Palais / présidence",
  camp: "Camp",
  pont: "Pont / axe",
  ministere: "Site civil",
  mine: "Périmètre minier",
};

export const ZONE_LEVEL_LABEL: Record<ZoneLevel, string> = {
  veille: "Veille",
  trafic: "Trafic",
  approche: "Approche",
  intrusion: "Intrusion",
};

export const DEFAULT_ZONES: ZoneRow[] = PROTECTED_SITES.map((s) => ({
  ...s,
  armed: true,
  note: "",
}));

let liveZones: ZoneRow[] = DEFAULT_ZONES;

export function setLiveZones(rows: ZoneRow[]): void {
  liveZones = rows.length > 0 ? rows : DEFAULT_ZONES;
}

export function getLiveZones(): ZoneRow[] {
  return liveZones;
}

/** UAS / piste mandatée. Civil 1090ES (hors B6) = trafic, pas une intrusion. */
export function isUasThreat(t: Track): boolean {
  if (isFriend(t)) return false;
  if (t.injected) return true;
  if ((t.category ?? "").toUpperCase() === "B6") return true;
  if (t.feed === "rid") return true;
  if (t.feed === "adsb") return false;
  return true;
}

function asContact(t: Track, distKm: number): ZoneContact {
  return {
    trackId: t.id,
    callsign: t.callsign,
    distKm,
    uas: isUasThreat(t),
    friend: isFriend(t),
  };
}

export function evaluateZones(tracks: Track[], zones: ZoneRow[]): ZoneStatus[] {
  const live = tracks.filter((t) => t.idState !== "perdu");
  return zones.map((zone) => {
    const inside: ZoneContact[] = [];
    const approaching: ZoneContact[] = [];
    for (const t of live) {
      const distKm = haversineKm(t.lat, t.lon, zone.lat, zone.lon);
      if (distKm <= zone.radiusKm) {
        inside.push(asContact(t, distKm));
        continue;
      }
      if (!zone.armed) continue;
      const bear = headingBetween(t.lat, t.lon, zone.lat, zone.lon);
      let err = bear - t.heading;
      if (err < -180) err += 360;
      if (err > 180) err -= 360;
      const closing = Math.abs(err) < 55 && t.speedKmh > 8;
      if (closing && distKm <= zone.radiusKm * 2.4) {
        approaching.push(asContact(t, distKm));
      }
    }
    inside.sort((a, b) => a.distKm - b.distKm);
    approaching.sort((a, b) => a.distKm - b.distKm);
    let level: ZoneLevel = "veille";
    if (zone.armed && inside.some((c) => c.uas)) level = "intrusion";
    else if (zone.armed && approaching.some((c) => c.uas)) level = "approche";
    else if (inside.length > 0) level = "trafic";
    return { zone, inside, approaching, level };
  });
}

export function zoneLevelTone(level: ZoneLevel): "ok" | "warn" | "crit" | "default" {
  if (level === "intrusion") return "crit";
  if (level === "approche") return "warn";
  if (level === "trafic") return "ok";
  return "default";
}
