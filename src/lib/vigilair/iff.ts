/** IFF Mode 4 — crypto FATL. VIGILAIR n'émet pas le challenge. */
import { PLATFORM_BY_ID, threatRank } from "./catalog";
import { destPoint, haversineKm } from "./geo";
import { SENSOR_SITES } from "./sensors";
import type {
  FriendKind,
  IffFix,
  IffM4State,
  ModeSSurveillance,
  Origin,
  Platform,
  Threat,
  Track,
} from "./types";

export type ThreatFloor = "ALL" | "moderee" | "elevee" | "critique";
export type IffFilter = "ALL" | "m4" | "sans-m4";

export const M4_STEALTH =
  "Le challenge Mode 4 part d'un interrogateur secondaire existant (radar 3D). VIGILAIR n'émet pas. Un UAS sans transpondeur ne voit rien.";

const M4_VALID =
  "Réponse crypto Mode 4 valide — clé du jour FATL. Interrogateur externe. VIGILAIR n'émet pas.";
const M4_INVALID =
  "Transpondeur entendu, crypto Mode 4 invalide (pas la clé FATL). Possible usurpation 3/A.";
const M4_TIMEOUT =
  "Pas de réponse Mode 4. Pas de transpondeur militaire, ou hors volume d'interrogation.";
export const M4_ABSENT_CIVIL =
  "Civil ADS-B / Mode S — pas de Mode 4. Trafic ASECNA, pas un UAS.";
const M4_ABSENT =
  "Pas de Mode 4 corrélé. Interrogation possible via l'interrogateur du site radar.";
const M4_DEMANDE =
  "Demande transmise à l'interrogateur secondaire. VIGILAIR n'émet pas.";

export const M4_DELAY_MS = 1400;

function isAmi(t: { friendKind?: FriendKind | null }): boolean {
  return t.friendKind === "fatl" || t.friendKind === "asecna";
}

export function m4Label(s: IffM4State): string {
  switch (s) {
    case "valid":
      return "M4 valide";
    case "invalid":
      return "M4 invalide";
    case "timeout":
      return "M4 timeout";
    case "demande":
      return "M4 demande";
    default:
      return "Sans M4";
  }
}

export function m4Tone(s: IffM4State): "ok" | "warn" | "crit" | "default" {
  if (s === "valid") return "ok";
  if (s === "invalid") return "crit";
  if (s === "timeout" || s === "demande") return "warn";
  return "default";
}

export function m4Short(s: IffM4State): string {
  switch (s) {
    case "valid":
      return "M4+";
    case "invalid":
      return "M4-";
    case "timeout":
      return "M4?";
    case "demande":
      return "M4…";
    default:
      return "sans M4";
  }
}

export type IffModeRow = {
  id: string;
  label: string;
  value: string;
  tone: "ok" | "warn" | "crit" | "default";
};

export function iffModeRows(iff: IffFix): IffModeRow[] {
  const rows: IffModeRow[] = [];
  if (iff.mode === "ADS-B") {
    rows.push({
      id: "adsb",
      label: "ADS-B",
      value: iff.flightId || iff.squawk,
      tone: "ok",
    });
    rows.push({
      id: "3a",
      label: "3/A",
      value: iff.squawk,
      tone: "default",
    });
    if (iff.icao24) {
      rows.push({
        id: "s",
        label: "Mode S",
        value: iff.icao24,
        tone: "default",
      });
    }
    rows.push({
      id: "4",
      label: "Mode 4",
      value: "N/A civil",
      tone: iff.m4 === "invalid" ? "crit" : "default",
    });
    appendMlatRows(rows, iff);
    return rows;
  }
  rows.push({
    id: "3a",
    label: "3/A",
    value: iff.squawk && iff.squawk !== "0000" ? iff.squawk : "—",
    tone: "default",
  });
  if (iff.mode === "S" || iff.icao24) {
    rows.push({
      id: "s",
      label: "Mode S",
      value: iff.icao24 ?? iff.flightId,
      tone: "default",
    });
  }
  rows.push({
    id: "4",
    label: "Mode 4",
    value: iff.m4 === "absent" ? "Non interrogé" : m4Label(iff.m4),
    tone: iff.m4 === "absent" ? "default" : m4Tone(iff.m4),
  });
  appendMlatRows(rows, iff);
  return rows;
}

function appendMlatRows(rows: IffModeRow[], iff: IffFix) {
  if (iff.mlat) {
    rows.push({
      id: "mlat",
      label: "MLAT",
      value: iff.mlat.spoofSuspect
        ? `écart ${iff.mlat.adsbDeltaKm} km`
        : `${iff.mlat.nSites} sites`,
      tone: iff.mlat.spoofSuspect ? "crit" : "ok",
    });
  }
}

export function iffModesLine(iff: IffFix): string {
  return iffModeRows(iff)
    .map((r) => `${r.label} ${r.value}`)
    .join(" · ");
}

export function octalSquawk(n: number): string {
  return (n & 0o7777).toString(8).padStart(4, "0");
}

export function fatlCarriesM4(plat: Platform | undefined): boolean {
  if (!plat || plat.friendKind !== "fatl") return false;
  return true;
}

export function coveringIffSite(lat: number, lon: number): {
  id: string;
  name: string;
} {
  let best: { id: string; name: string; d: number } | null = null;
  for (const s of SENSOR_SITES) {
    if (s.kind !== "radar" || !s.online) continue;
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d > s.rangeKm) continue;
    if (!best || d < best.d) best = { id: s.id, name: s.name, d };
  }
  return best
    ? { id: best.id, name: best.name }
    : { id: "rad-1", name: "RADAR-1 FTTJ" };
}

export function blankIff(flightId: string, source: IffFix["source"] = "iff-ssr"): IffFix {
  return {
    mode: "4",
    squawk: "0000",
    icao24: null,
    flightId,
    source,
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note: M4_ABSENT,
    surveillance: "none",
    replies: [],
    mlat: null,
    adsbClaim: null,
    lastReplyAt: null,
  };
}

export function normalizeIff(iff: IffFix | null | undefined, flightId: string): IffFix | null {
  if (!iff) return null;
  return {
    mode: iff.mode,
    squawk: iff.squawk,
    icao24: iff.icao24,
    flightId: iff.flightId || flightId,
    source: iff.source === "iff-fatl" || iff.source === "adsb-asecna" ? iff.source : "iff-ssr",
    m4: iff.m4 ?? "absent",
    m4At: iff.m4At ?? null,
    m4Site: iff.m4Site ?? null,
    m4Note: iff.m4Note ?? M4_ABSENT,
    surveillance: iff.surveillance ?? inferLegacySurv(iff),
    replies: iff.replies ?? [],
    mlat: iff.mlat ?? null,
    adsbClaim: iff.adsbClaim ?? null,
    lastReplyAt: iff.lastReplyAt ?? null,
  };
}

function inferLegacySurv(iff: IffFix): ModeSSurveillance {
  if (iff.mode === "ADS-B") return "adsb";
  if (iff.source === "iff-fatl") return "ehs";
  if (iff.mode === "S") return "els";
  return "none";
}

export function mintFatlIff(flightId: string, i: number): IffFix {
  const site = coveringIffSite(12.1348, 15.0557);
  return {
    mode: "4",
    squawk: octalSquawk(0o4000 + (i % 0o777)),
    icao24: (0x0c4000 + (i % 0x0fff)).toString(16).toUpperCase().padStart(6, "0"),
    flightId,
    source: "iff-fatl",
    m4: "valid",
    m4At: Date.now(),
    m4Site: site.name,
    m4Note: M4_VALID,
    surveillance: "ehs",
    replies: [],
    mlat: null,
    adsbClaim: null,
    lastReplyAt: null,
  };
}

export function mintAsecnaIff(flightId: string, i: number): IffFix {
  return {
    mode: "ADS-B",
    squawk: octalSquawk(0o1000 + (i % 0o6777)),
    icao24: (0x040000 + (i % 0x8000)).toString(16).toUpperCase().padStart(6, "0"),
    flightId,
    source: "adsb-asecna",
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note: M4_ABSENT_CIVIL,
    surveillance: "adsb",
    replies: [],
    mlat: null,
    adsbClaim: null,
    lastReplyAt: null,
  };
}

export function mintSpoofIff(flightId: string, i: number): IffFix {
  return {
    mode: "3/A",
    squawk: octalSquawk(0o1200 + (i % 0o500)),
    icao24: null,
    flightId,
    source: "iff-ssr",
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note: "Squawk 3/A entendu — pas de Mode 4, pas de Mode S. Possible usurpation.",
    surveillance: "none",
    replies: [],
    mlat: null,
    adsbClaim: null,
    lastReplyAt: null,
  };
}

export function mintHostileTransponder(flightId: string, i: number): IffFix {
  return {
    mode: "S",
    squawk: octalSquawk(0o2000 + (i % 0o1777)),
    icao24: (0x3c0000 + (i % 0xffff)).toString(16).toUpperCase().padStart(6, "0"),
    flightId,
    source: "iff-ssr",
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note: M4_ABSENT,
    surveillance: "els",
    replies: [],
    mlat: null,
    adsbClaim: null,
    lastReplyAt: null,
  };
}

export function mintSpoofAdsb(
  flightId: string,
  i: number,
  lat: number,
  lon: number,
): IffFix {
  const claim = destPoint(lat, lon, (i * 47) % 360, 16 + (i % 8) * 3.2);
  return {
    mode: "ADS-B",
    squawk: octalSquawk(0o1000 + (i % 0o6777)),
    icao24: (0x040000 + (i % 0x8000)).toString(16).toUpperCase().padStart(6, "0"),
    flightId: ["ETH714", "KP042", "MS874", "QC211"][i % 4]!,
    source: "iff-ssr",
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note:
      "Squitter DF17 civil entendu — pas de Mode 4. Position GPS à vérifier par MLAT.",
    surveillance: "adsb",
    replies: [],
    mlat: null,
    adsbClaim: { lat: claim.lat, lon: claim.lon },
    lastReplyAt: null,
  };
}

export function maybeHostileIff(
  plat: Platform,
  flightId: string,
  seq: number,
  forceSpoof = false,
): IffFix | null {
  if (forceSpoof) return mintSpoofIff(flightId, seq);
  if (plat.uasClass === "chasse") return mintHostileTransponder(flightId, seq);
  if (
    (plat.uasClass === "loitering" ||
      plat.uasClass === "male" ||
      plat.uasClass === "ucav") &&
    Math.random() < 0.2
  ) {
    return mintSpoofIff(flightId, seq);
  }
  return null;
}

export function canRequestM4(track: Track): { ok: boolean; reason: string } {
  if (track.idState === "perdu") {
    return { ok: false, reason: "Piste perdue — plus d'interrogation." };
  }
  if (track.iff?.m4 === "demande") {
    return { ok: false, reason: "Interrogation Mode 4 déjà en cours." };
  }
  const site = coveringIffSite(track.lat, track.lon);
  return {
    ok: true,
    reason: `Demande d'interrogation Mode 4 à ${site.name}. ${M4_STEALTH}`,
  };
}

export function beginM4Request(track: Track, at: number): IffFix {
  const site = coveringIffSite(track.lat, track.lon);
  const base = track.iff ?? blankIff(track.callsign);
  return {
    ...base,
    flightId: base.flightId || track.callsign,
    m4: "demande",
    m4At: at,
    m4Site: site.name,
    m4Note: `${M4_DEMANDE} Site ${site.name}.`,
  };
}

export function resolveM4(track: Track, at: number): IffFix {
  const site = coveringIffSite(track.lat, track.lon);
  const base = track.iff ?? blankIff(track.callsign);
  const kind: FriendKind | undefined = track.friendKind;
  if (kind === "fatl" || fatlCarriesM4(PLATFORM_BY_ID[track.truePlatformId])) {
    return {
      ...base,
      mode: "4",
      source: "iff-fatl",
      m4: "valid",
      m4At: at,
      m4Site: site.name,
      m4Note: `${M4_VALID} ${site.name}.`,
    };
  }
  if (kind === "asecna") {
    return {
      ...base,
      m4: "absent",
      m4At: at,
      m4Site: site.name,
      m4Note: M4_ABSENT_CIVIL,
    };
  }
  const hasXpdr = Boolean(base.squawk && base.squawk !== "0000");
  if (hasXpdr) {
    return {
      ...base,
      m4: "invalid",
      m4At: at,
      m4Site: site.name,
      m4Note: `${M4_INVALID} ${site.name}.`,
    };
  }
  return {
    ...base,
    m4: "timeout",
    m4At: at,
    m4Site: site.name,
    m4Note: `${M4_TIMEOUT} ${site.name}.`,
  };
}

function trackThreat(t: Track): Threat {
  const id = t.hypotheses[0]?.platformId ?? t.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

export type PaintFilter = {
  showFriends: boolean;
  showLive?: boolean;
  threatFloor: ThreatFloor;
  iffFilter: IffFilter;
  selectedId: string | null;
};

export function passesPaintFilter(t: Track, f: PaintFilter): boolean {
  if (t.idState === "perdu") return false;
  if (t.id === f.selectedId || t.locked) return true;
  if (t.feed === "adsb") {
    if (f.showLive === false) return false;
  } else if (isAmi(t) && !f.showFriends) return false;
  if (f.threatFloor !== "ALL") {
    if (threatRank(trackThreat(t)) < threatRank(f.threatFloor)) return false;
  }
  if (f.iffFilter === "m4" && t.iff?.m4 !== "valid") return false;
  if (f.iffFilter === "sans-m4" && t.iff?.m4 === "valid") return false;
  return true;
}

export function passesRailOrigin(
  t: Track,
  originFilter: Origin | "ALL" | "AMI" | "LIVE",
  showFriends: boolean,
): boolean {
  const ami = isAmi(t);
  if (originFilter === "LIVE") return t.feed === "adsb";
  if (originFilter === "AMI") return ami && t.feed !== "adsb";
  if (t.feed === "adsb") {
    return originFilter === "ALL";
  }
  if (ami) {
    if (originFilter !== "ALL") return false;
    if (!showFriends) return false;
    return true;
  }
  if (originFilter === "ALL") return true;
  if (originFilter === "XX") return t.origin === "XX" || t.origin === null;
  return t.origin === originFilter || t.origin === null;
}

export const THREAT_FLOOR_ORDER: ThreatFloor[] = [
  "ALL",
  "moderee",
  "elevee",
  "critique",
];

export const IFF_FILTER_ORDER: IffFilter[] = ["ALL", "m4", "sans-m4"];

export function nextThreatFloor(cur: ThreatFloor): ThreatFloor {
  const i = THREAT_FLOOR_ORDER.indexOf(cur);
  return THREAT_FLOOR_ORDER[(i + 1) % THREAT_FLOOR_ORDER.length]!;
}

export function nextIffFilter(cur: IffFilter): IffFilter {
  const i = IFF_FILTER_ORDER.indexOf(cur);
  return IFF_FILTER_ORDER[(i + 1) % IFF_FILTER_ORDER.length]!;
}

export function threatFloorLabel(f: ThreatFloor): string {
  switch (f) {
    case "moderee":
      return "≥ modérée";
    case "elevee":
      return "≥ élevée";
    case "critique":
      return "Critique";
    default:
      return "Toutes";
  }
}

export function iffFilterLabel(f: IffFilter): string {
  if (f === "m4") return "Mode 4";
  if (f === "sans-m4") return "Sans M4";
  return "IFF tous";
}

export function countM4(tracks: Track[]): {
  valid: number;
  invalid: number;
  absent: number;
  spoof: number;
  demande: number;
} {
  let valid = 0;
  let invalid = 0;
  let absent = 0;
  let spoof = 0;
  let demande = 0;
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    const s = t.iff?.m4 ?? "absent";
    if (s === "valid") valid += 1;
    else if (s === "invalid") invalid += 1;
    else if (s === "demande") demande += 1;
    else absent += 1;
    if (!isAmi(t) && t.iff && s !== "valid") spoof += 1;
  }
  return { valid, invalid, absent, spoof, demande };
}
