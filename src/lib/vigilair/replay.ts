import { normalizeIff } from "./iff";
import type { EwState, FriendKind, IdState, IffFix, Origin, Track, UasClass } from "./types";

export const SNAP_MS = 1000;
export const SNAP_MAX = 480;

export type SnapTrack = {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  speedKmh: number;
  origin: Origin | null;
  idState: IdState;
  locked: boolean;
  corridor: string | null;
  truePlatformId: string;
  confidence: number;
  classGuess: UasClass | null;
  injected: boolean;
  ew: EwState;
  trail: { lat: number; lon: number }[];
  friendKind?: FriendKind;
  iff?: IffFix | null;
  feed?: Track["feed"];
  icaoType?: string | null;
  reg?: string | null;
  emergency?: string | null;
};

export type Snap = {
  t: number;
  tracks: SnapTrack[];
};

export function compactTracks(tracks: Track[]): SnapTrack[] {
  return tracks
    .filter((t) => t.idState !== "perdu")
    .map((t) => ({
      id: t.id,
      callsign: t.callsign,
      lat: t.lat,
      lon: t.lon,
      altM: t.altM,
      heading: t.heading,
      speedKmh: t.speedKmh,
      origin: t.origin,
      idState: t.idState,
      locked: t.locked,
      corridor: t.corridor,
      truePlatformId: t.truePlatformId,
      confidence: t.confidence,
      classGuess: t.classGuess,
      injected: Boolean(t.injected),
      ew: t.ew?.state ?? "idle",
      trail: t.trail.slice(-12),
      friendKind: t.friendKind,
      iff: t.iff ?? null,
      feed: t.feed,
      icaoType: t.icaoType,
      reg: t.reg,
      emergency: t.emergency,
    }));
}

export function expandSnap(snap: Snap): Track[] {
  return snap.tracks.map((s) => ({
    id: s.id,
    callsign: s.callsign,
    lat: s.lat,
    lon: s.lon,
    altM: s.altM,
    heading: s.heading,
    speedKmh: s.speedKmh,
    climbMs: 0,
    trail: s.trail.length > 0 ? s.trail : [{ lat: s.lat, lon: s.lon }],
    truePlatformId: s.truePlatformId,
    idState: s.idState,
    confidence: s.confidence,
    origin: s.origin,
    classGuess: s.classGuess,
    hypotheses: s.truePlatformId
      ? [{ platformId: s.truePlatformId, score: s.confidence }]
      : [],
    sensors: [],
    firstSeen: snap.t,
    lastUpdate: snap.t,
    dwellS: 0,
    confirmedAt: s.idState === "confirme" ? snap.t : null,
    motion: "transit" as const,
    loiterCx: s.lat,
    loiterCy: s.lon,
    loiterR: 0.02,
    turnRate: 0,
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: false,
    launchFix: null,
    stopFix: null,
    locked: s.locked,
    corridor: s.corridor,
    ew:
      s.ew !== "idle"
        ? { state: s.ew, at: snap.t, note: "AAR — bande enregistrement" }
        : null,
    injected: s.injected,
    friendKind: s.friendKind,
    iff: s.iff ?? null,
    feed: s.feed,
    icaoType: s.icaoType,
    reg: s.reg,
    emergency: s.emergency,
  }));
}

export function formatTape(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
