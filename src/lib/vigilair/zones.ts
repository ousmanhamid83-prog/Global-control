/** Bulles de protection C-UAS — N'Djamena. AfriControl n'émet pas. */

import { isFriend } from "./friends.ts";
import { haversineKm, headingBetween } from "./geo.ts";
import { PROTECTED_SITES } from "./sensors.ts";
import type { ProtectedSite, Track } from "./types";

export type ZoneKind = ProtectedSite["kind"] | "mine" | "custom";

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
  /** Piste d'exercice (vrai vol de notre drone, joué comme intrus) : versée comme exercice. */
  exercice: boolean;
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
  custom: "Site surveillé",
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
  // Un rejeu est du passé : il ne déclenche jamais une intrusion (ni son signalement au serveur).
  if (t.feed === "rejeu") return false;
  // Exercice : le drone joue un intrus, et c'est précisément ce que l'exercice éprouve.
  if (t.feed === "exercice") return true;
  // 1090ES : seul un émetteur de catégorie B6 (UAV) est une menace ; le reste est du trafic.
  return (t.category ?? "").toUpperCase() === "B6";
}

function asContact(t: Track, distKm: number): ZoneContact {
  return {
    trackId: t.id,
    callsign: t.callsign,
    distKm,
    uas: isUasThreat(t),
    friend: isFriend(t),
    exercice: t.feed === "exercice",
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

/** La sorte d'une bulle lue du registre ; une sorte inconnue vaut « ministere ». */
export function sorteDeBulle(v: string): ZoneKind {
  if (v === "aerodrome" || v === "palais" || v === "camp" || v === "pont" || v === "ministere") {
    return v;
  }
  return "ministere";
}

/** Une ligne du registre des bulles (table protected_zone), en bulle. */
export function bulleDeLigne(r: {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  radius_km: number;
  armed: boolean;
  note: string;
}): ZoneRow {
  return {
    id: r.id,
    name: r.name,
    kind: sorteDeBulle(r.kind),
    lat: Number(r.lat),
    lon: Number(r.lon),
    radiusKm: Number(r.radius_km),
    armed: Boolean(r.armed),
    note: r.note ?? "",
  };
}

/** Un passage à consigner : un UAS entré dans une bulle armée, ou qui s'en approche. */
export type Passage = {
  zoneId: string;
  zoneName: string;
  trackId: string;
  callsign: string;
  distKm: number;
  kind: "inside" | "approach";
  uas: true;
  /** Piste d'exercice : consignée comme telle, jamais dite au chef. */
  exercice: boolean;
};

/**
 * Les passages d'une image des bulles : dans chaque bulle ARMÉE, les UAS entrés, puis ceux qui s'en
 * approchent. La console et la veille du serveur consignent les mêmes, dans le même registre.
 */
export function passagesDe(image: ZoneStatus[]): Passage[] {
  const out: Passage[] = [];
  for (const st of image) {
    if (!st.zone.armed) continue;
    const sortes = [
      [st.inside, "inside"],
      [st.approaching, "approach"],
    ] as const;
    for (const [contacts, kind] of sortes) {
      for (const c of contacts) {
        if (!c.uas) continue;
        out.push({
          zoneId: st.zone.id,
          zoneName: st.zone.name,
          trackId: c.trackId,
          callsign: c.callsign,
          distKm: c.distKm,
          kind,
          uas: true,
          exercice: c.exercice,
        });
      }
    }
  }
  return out;
}
