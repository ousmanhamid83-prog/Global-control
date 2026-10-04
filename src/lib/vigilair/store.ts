import { create } from "zustand";
import { PLATFORM_BY_ID, threatRank } from "./catalog";
import { methodBlurb } from "./engine";
import { bulletinToJournal, fileEvidence } from "./evidence-store";
import { canRequestEw } from "./ew";
import { AO, HOME, SCALE, haversineKm, theaterRank, type GeoOrigin, type MapScale } from "./geo";
import { countFriends, isFriend, spawnFriendTrack } from "./friends";
import {
  beginM4Request,
  canRequestM4,
  M4_DELAY_MS,
  nextIffFilter,
  nextThreatFloor,
  passesPaintFilter,
  resolveM4,
  type IffFilter,
  type PaintFilter,
  type ThreatFloor,
} from "./iff";
import { INJECTS, spawnInject } from "./inject";
import type { GpsZone } from "./passability";
import { iffEvidenceLine, tickModeS } from "./mode-s";
import { DEFAULT_PPI, type HistSample, type PpiParams } from "./ppi";
import {
  SNAP_MAX,
  SNAP_MS,
  compactTracks,
  expandSnap,
  type Snap,
} from "./replay";
import { spawnTrack, stepTrack } from "./simulate";
import {
  isLiveFeed,
  mergeLiveTracks,
  type LivePicture,
} from "./live-adsb";
import { treatContact } from "./treat";
import { preloadAoTiles, preloadAt, SAT_CREDIT, tileRef } from "./tiles";
import type { SatLayer, SatMeta } from "./sat";
import { detectRaids } from "./raid";
import { raiseSigintAlerts } from "./sigint";
import { lockFire } from "./fire-clock";
import { emptyFlags, type StewardFlags, type StewardParamId } from "./steward";
import { setTileRefine } from "./tiles";
import { emitDuty } from "./duty-bus";
import { SAR_NOTE, SCENE_NOTE, evidenceOf } from "./trace";
import { buildCapture, type CaptureShot, type Phenomenon } from "./capture";
import type { AlertItem, AudioClip, JournalEntry, Origin, Threat, Track } from "./types";
import type { WatchShiftRow } from "./watch";
import {
  loadWatchMode,
  persistWatchMode,
  watchHomeScale,
} from "./watch-mode";
import type { CopLockState } from "./guard";
import {
  DEFAULT_ZONES,
  evaluateZones,
  getLiveZones,
  setLiveZones,
  type ZoneRow,
  type ZoneStatus,
} from "./zones";
import { mineZoneRows } from "./mines";
import { reportZoneBreach } from "./zones-ops";

const JOURNAL_KEY = "vigilair-journal-v1";
const CLIPS_KEY = "vigilair-clips-v1";

function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JournalEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
  } catch {
    return [];
  }
}

function saveJournal(entries: JournalEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries.slice(0, 200)));
}

function loadClips(): AudioClip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CLIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AudioClip[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function saveClips(clips: AudioClip[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CLIPS_KEY, JSON.stringify(clips.slice(0, 40)));
}

export type FilterOrigin = Origin | "ALL" | "AMI" | "LIVE";
export type ClockMode = "live" | "replay";
export type CopTool = "lock" | "mesure" | "zone";

type VigilairState = {
  tracks: Track[];
  selectedId: string | null;
  alerts: AlertItem[];
  journal: JournalEntry[];
  clips: AudioClip[];
  listening: boolean;
  listenWide: boolean;
  running: boolean;
  now: number;
  originFilter: FilterOrigin;
  search: string;
  spawned: number;
  mapScale: MapScale;
  satLayer: SatLayer;
  satMeta: SatMeta | null;
  copTool: CopTool;
  ewArmed: boolean;
  ppi: PpiParams;
  history: HistSample[];
  clockMode: ClockMode;
  replayIndex: number;
  replayCount: number;
  instruction: boolean;
  lastInject: string | null;
  showFriends: boolean;
  showLive: boolean;
  livePicture: LivePicture | null;
  liveAt: number;
  liveError: string | null;
  watch: WatchShiftRow | null;
  watchLoaded: boolean;
  copLock: CopLockState | null;
  zones: ZoneRow[];
  zonePicture: ZoneStatus[];
  threatFloor: ThreatFloor;
  iffFilter: IffFilter;
  watchMode: boolean;
  watchDimmed: boolean;
  watchAutoLayer: boolean;
  watchWokeAt: number | null;
  watchWokeReason: string | null;
  viewOrigin: GeoOrigin;
  capture: CaptureShot | null;
  captures: CaptureShot[];
  phenomena: Phenomenon[];
  axisId: string | null;
  peakId: string | null;
  showPeaks: boolean;
  gpsZone: GpsZone | null;
  lakeRouteId: string | null;
  mineId: string | null;
  marine: boolean;
  waterId: string | null;
  stewardOn: boolean;
  stewardFlags: StewardFlags;
  stewardHeldIr: boolean;
  weeklyOn: boolean;
  weeklyDay: number;
  weeklyHour: number;
  lastWeeklyAt: number;
  stewardLog: { at: number; text: string }[];
  select: (id: string | null) => void;
  lockTrack: (id: string | null) => void;
  setOriginFilter: (v: FilterOrigin) => void;
  setSearch: (v: string) => void;
  setRunning: (v: boolean) => void;
  setMapScale: (v: MapScale) => void;
  setSatLayer: (v: SatLayer) => void;
  setSatMeta: (v: SatMeta) => void;
  setCopTool: (v: CopTool) => void;
  setAxisId: (id: string | null) => void;
  setPeakId: (id: string | null) => void;
  setShowPeaks: (on: boolean) => void;
  setGpsZone: (z: GpsZone | null) => void;
  setLakeRouteId: (id: string | null) => void;
  setMineId: (id: string | null) => void;
  setMarine: (on: boolean) => void;
  setWaterId: (id: string | null) => void;
  setStewardOn: (on: boolean) => void;
  setStewardFlag: (id: StewardParamId, on: boolean) => void;
  setWeekly: (patch: { on?: boolean; day?: number; hour?: number; lastAt?: number }) => void;
  pushSteward: (text: string, at: number) => void;
  setViewOrigin: (o: GeoOrigin) => void;
  setEwArmed: (v: boolean) => void;
  setPpi: (patch: Partial<PpiParams>) => void;
  ackAlert: (id: string) => void;
  ackAll: () => void;
  ackSigint: () => void;
  fileBulletin: (trackId: string) => void;
  recordClip: (trackId: string) => void;
  setListening: (v: boolean) => void;
  setListenWide: (v: boolean) => void;
  requestEw: (trackId: string) => void;
  requestM4: (trackId: string) => void;
  clearJournal: () => void;
  hydrateJournal: (rows: JournalEntry[]) => void;
  seekReplay: (index: number, play?: boolean) => void;
  scrubReplay: (delta: number) => void;
  returnToLive: () => void;
  runInject: (id: string) => void;
  lockLive: () => void;
  purgeInjects: () => void;
  setInstruction: (v: boolean) => void;
  setShowFriends: (v: boolean) => void;
  setShowLive: (v: boolean) => void;
  setThreatFloor: (v: ThreatFloor) => void;
  cycleThreatFloor: () => void;
  setIffFilter: (v: IffFilter) => void;
  cycleIffFilter: () => void;
  setWatch: (w: WatchShiftRow | null) => void;
  setCopLock: (l: CopLockState | null) => void;
  setZones: (z: ZoneRow[]) => void;
  setWatchMode: (on: boolean) => void;
  setWatchAutoLayer: (on: boolean) => void;
  applyWatchWake: (opts: {
    wake: boolean;
    reason: string;
    ident: boolean;
  }) => void;
  openCapture: (opts: {
    lat: number;
    lon: number;
    kind: CaptureShot["kind"];
    title: string;
    body: string;
    source: string;
    id?: string;
    /** Garde l'échelle si le chef regarde un axe lac ou une mine. */
    holdCamera?: boolean;
  }) => void;
  closeCapture: () => void;
  homeOrigin: () => void;
};

let loopStarted = false;
let liveTracks: Track[] = [];
let spawned = 0;
const raidWarned = new Set<string>();
const zoneWarned = new Set<string>();
const phenomWarned = new Set<string>();
const snaps: Snap[] = [];
let replayView: Track[] | null = null;
let replayAcc = 0;
let lastSnapAt = 0;
const mlatWarned = new Set<string>();

function applyZoneAlerts(tracks: Track[], now: number, alerts: AlertItem[]): void {
  const zones = getLiveZones();
  const picture = evaluateZones(tracks, [...zones, ...mineZoneRows()]);
  useVigilair.setState({ zonePicture: picture });
  const liveIds = new Set(tracks.map((t) => t.id));
  for (const key of [...zoneWarned]) {
    const tid = key.split(":").pop();
    if (tid && !liveIds.has(tid)) zoneWarned.delete(key);
  }
  if (useVigilair.getState().clockMode === "replay") return;
  for (const st of picture) {
    if (!st.zone.armed) continue;
    for (const c of st.inside) {
      if (!c.uas) continue;
      const key = `in:${st.zone.id}:${c.trackId}`;
      if (zoneWarned.has(key)) continue;
      zoneWarned.add(key);
      alerts.push({
        id: `al-zone-${st.zone.id}-${c.trackId}`,
        trackId: c.trackId,
        at: now,
        level: "critique",
        title: `INTRUSION · ${st.zone.name} · ${c.callsign}`,
        body: `${c.distKm.toFixed(2)} km du centre. Bulle armée. VIGILAIR n'émet pas.`,
        acked: false,
      });
      void reportZoneBreach({
        data: {
          zoneId: st.zone.id,
          zoneName: st.zone.name,
          trackId: c.trackId,
          callsign: c.callsign,
          distKm: c.distKm,
          kind: "inside",
          uas: true,
        },
      }).catch(() => undefined);
    }
    for (const c of st.approaching) {
      if (!c.uas) continue;
      const key = `ap:${st.zone.id}:${c.trackId}`;
      if (zoneWarned.has(key)) continue;
      zoneWarned.add(key);
      alerts.push({
        id: `al-zoneap-${st.zone.id}-${c.trackId}`,
        trackId: c.trackId,
        at: now,
        level: "elevee",
        title: `Approche · ${st.zone.name} · ${c.callsign}`,
        body: `${c.distKm.toFixed(2)} km · fermeture sur la bulle.`,
        acked: false,
      });
      void reportZoneBreach({
        data: {
          zoneId: st.zone.id,
          zoneName: st.zone.name,
          trackId: c.trackId,
          callsign: c.callsign,
          distKm: c.distKm,
          kind: "approach",
          uas: true,
        },
      }).catch(() => undefined);
    }
  }
}

export function peekTracks(): Track[] {
  return replayView ?? liveTracks;
}

export function peekSnapCount(): number {
  return snaps.length;
}

function sampleHistory(tracks: Track[], now: number): HistSample {
  const live = tracks.filter((t) => t.idState !== "perdu");
  const s: HistSample = {
    t: now,
    live: live.length,
    confirmed: 0,
    cn: 0,
    tr: 0,
    ru: 0,
    ir: 0,
    xx: 0,
    ami: 0,
    critique: 0,
    elevee: 0,
    adsb: 0,
    uas: 0,
  };
  for (const t of live) {
    if (t.feed === "adsb") s.adsb += 1;
    if (isFriend(t)) {
      s.ami += 1;
    } else {
      const o = t.origin ?? "XX";
      if (o === "CN") s.cn += 1;
      else if (o === "TR") s.tr += 1;
      else if (o === "RU") s.ru += 1;
      else if (o === "IR") s.ir += 1;
      else s.xx += 1;
      if (t.feed !== "adsb") s.uas += 1;
    }
    if (t.idState === "confirme") s.confirmed += 1;
    const th = threatOf(t);
    if (th === "critique") s.critique += 1;
    if (th === "elevee") s.elevee += 1;
  }
  return s;
}

function pushSnap(now: number) {
  snaps.push({ t: now, tracks: compactTracks(liveTracks) });
  if (snaps.length > SNAP_MAX) snaps.shift();
}

function pruneTracks() {
  const feed = liveTracks.filter((t) => isLiveFeed(t));
  const restAll = liveTracks.filter((t) => !isLiveFeed(t));
  const CAP = 36;
  if (restAll.length <= CAP) {
    liveTracks = [...feed, ...restAll];
    return;
  }
  const keep = restAll.filter((t) => t.locked || t.injected || t.friendKind);
  const rest = restAll
    .filter((t) => !t.locked && !t.injected && !t.friendKind)
    .sort((a, b) => b.lastUpdate - a.lastUpdate);
  liveTracks = [...feed, ...keep, ...rest.slice(0, Math.max(0, CAP - keep.length))];
}

function showReplay(index: number, play: boolean) {
  if (snaps.length === 0) return;
  const i = Math.max(0, Math.min(snaps.length - 1, index));
  const snap = snaps[i]!;
  replayView = expandSnap(snap);
  useVigilair.setState({
    clockMode: "replay",
    replayIndex: i,
    replayCount: snaps.length,
    tracks: replayView,
    now: snap.t,
    running: play,
  });
}

function goLive(running = true) {
  replayView = null;
  useVigilair.setState({
    clockMode: "live",
    tracks: liveTracks,
    now: Date.now(),
    running,
    replayCount: snaps.length,
  });
}

export const useVigilair = create<VigilairState>()((set, get) => ({
  tracks: [],
  selectedId: null,
  alerts: [],
  journal: [],
  clips: [],
  listening: false,
  listenWide: false,
  running: true,
  now: 0,
  originFilter: "ALL",
  search: "",
  spawned: 0,
  mapScale: "ident",
  satLayer: "vis",
  satMeta: null,
  copTool: "lock",
  ewArmed: false,
  ppi: DEFAULT_PPI,
  history: [],
  clockMode: "live",
  replayIndex: 0,
  replayCount: 0,
  instruction: false,
  lastInject: null,
  showFriends: true,
  showLive: true,
  livePicture: null,
  liveAt: 0,
  liveError: null,
  watch: null,
  watchLoaded: false,
  copLock: null,
  zones: DEFAULT_ZONES,
  zonePicture: [],
  threatFloor: "ALL",
  iffFilter: "ALL",
  watchMode: false,
  watchDimmed: false,
  watchAutoLayer: true,
  watchWokeAt: null,
  watchWokeReason: null,
  viewOrigin: HOME,
  capture: null,
  captures: [],
  phenomena: [],
  axisId: null,
  peakId: null,
  showPeaks: false,
  gpsZone: null,
  lakeRouteId: null,
  mineId: null,
  marine: false,
  waterId: null,
  stewardOn: false,
  stewardFlags: emptyFlags(),
  stewardHeldIr: false,
  weeklyOn: false,
  weeklyDay: 1,
  weeklyHour: 5,
  lastWeeklyAt: 0,
  stewardLog: [],
  select: (id) => set({ selectedId: id }),
  lockTrack: (id) => {
    liveTracks = liveTracks.map((t) => ({ ...t, locked: id != null && t.id === id }));
    if (replayView) {
      replayView = replayView.map((t) => ({ ...t, locked: id != null && t.id === id }));
    }
    set({ selectedId: id, tracks: peekTracks() });
    if (id) {
      const t = peekTracks().find((x) => x.id === id);
      emitDuty({
        kind: "lock",
        title: `Verrou ${t?.callsign ?? id}`,
        detail: "Piste verrouillée pour identification.",
        trackId: id,
      });
    }
  },
  setOriginFilter: (originFilter) => set({ originFilter }),
  setSearch: (search) => set({ search }),
  setRunning: (running) => set({ running }),
  setMapScale: (mapScale) => set({ mapScale }),
  setSatLayer: (satLayer) => set({ satLayer }),
  setSatMeta: (satMeta) => set({ satMeta }),
  setCopTool: (copTool) => set({ copTool }),
  setAxisId: (axisId) => set({ axisId }),
  setPeakId: (peakId) => set({ peakId }),
  setShowPeaks: (showPeaks) => set({ showPeaks }),
  setGpsZone: (gpsZone) => set({ gpsZone }),
  setLakeRouteId: (lakeRouteId) => set({ lakeRouteId }),
  setMineId: (mineId) => set({ mineId }),
  setMarine: (marine) => set({ marine }),
  setWaterId: (waterId) => set({ waterId }),
  setStewardOn: (stewardOn) => set({ stewardOn, ...(stewardOn ? {} : { stewardHeldIr: false }) }),
  setStewardFlag: (id, on) => {
    const layers = ["vis", "ir", "th", "nv", "rel"] as const;
    const flags = { ...get().stewardFlags, [id]: on };
    if (on && (layers as readonly string[]).includes(id)) {
      for (const layer of layers) if (layer !== id) flags[layer] = false;
      set({ stewardFlags: flags, satLayer: id as "vis" | "ir" | "th" | "nv" | "rel" });
      return;
    }
    if (on && (id === "mesure" || id === "bulles")) {
      flags.mesure = id === "mesure";
      flags.bulles = id === "bulles";
      set({ stewardFlags: flags, copTool: id === "mesure" ? "mesure" : "zone" });
      return;
    }
    if (!on && (id === "mesure" || id === "bulles")) {
      set({ stewardFlags: flags, copTool: "lock" });
      return;
    }
    set({
      stewardFlags: flags,
      weeklyOn: id === "hebdo" ? on : get().weeklyOn,
    });
    if (id === "relief") set({ showPeaks: on });
    if (id === "marine") set({ marine: on });
    if (id === "veille") get().setWatchMode(on);
    if (id === "live") set({ showLive: on });
    if (id === "amis") set({ showFriends: on });
    if (id === "ecoute") set({ listening: on });
    if (id === "large") set({ listenWide: on, listening: on || get().listening });
    if (id === "instruction") set({ instruction: on });
    if (id === "affinage") setTileRefine(on);
    if (id === "auto") get().setWatchAutoLayer(on);
    if (id === "horloge") set({ running: on });
    if (id === "remanence") get().setPpi({ afterglow: on });
    if (id === "etiquettes") get().setPpi({ labels: on });
    if (id === "traces") get().setPpi({ trails: on });
    if (id === "iffppi") get().setPpi({ iff: on });
  },
  setWeekly: (patch) =>
    set({
      ...(patch.on !== undefined ? { weeklyOn: patch.on } : {}),
      ...(patch.day !== undefined ? { weeklyDay: patch.day } : {}),
      ...(patch.hour !== undefined ? { weeklyHour: patch.hour } : {}),
      ...(patch.lastAt !== undefined ? { lastWeeklyAt: patch.lastAt } : {}),
    }),
  pushSteward: (text, at) =>
    set((s) => {
      if (s.stewardLog[0]?.text === text) return s;
      return { stewardLog: [{ at, text }, ...s.stewardLog].slice(0, 12) };
    }),
  setViewOrigin: (viewOrigin) => set({ viewOrigin }),
  setEwArmed: (ewArmed) => {
    if (ewArmed && get().copLock?.locked) return;
    if (!ewArmed) {
      liveTracks = liveTracks.map((t) =>
        t.ew && t.ew.state !== "idle"
          ? {
              ...t,
              ew: {
                state: "idle" as const,
                at: Date.now(),
                note: "Effecteur désarmé. Cessation d'effet. Contrôleur adverse non informé.",
              },
            }
          : t,
      );
    }
    set({ ewArmed, tracks: peekTracks() });
  },
  setPpi: (patch) => set({ ppi: { ...get().ppi, ...patch } }),
  ackAlert: (id) =>
    set({
      alerts: get().alerts.map((a) => (a.id === id ? { ...a, acked: true } : a)),
    }),
  ackAll: () => set({ alerts: get().alerts.map((a) => ({ ...a, acked: true })) }),
  ackSigint: () =>
    set({
      alerts: get().alerts.map((a) => (a.domain === "sigint" ? { ...a, acked: true } : a)),
    }),
  fileBulletin: (trackId) => {
    const t =
      liveTracks.find((x) => x.id === trackId) ??
      get().tracks.find((x) => x.id === trackId);
    if (!t) return;
    const plat = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
    if (!plat) return;
    const ev = evidenceOf(t);
    const pendingId = `j-pending-${t.id}-${Date.now()}`;
    const entry: JournalEntry = {
      id: pendingId,
      at: Date.now(),
      trackId: t.id,
      callsign: t.callsign,
      platformId: plat.id,
      origin: plat.origin,
      confidence: t.confidence,
      lat: t.lat,
      lon: t.lon,
      altM: t.altM,
      sensors: t.sensors,
      method: methodBlurb(t),
      launchLat: t.launchFix?.lat,
      launchLon: t.launchFix?.lon,
      stopLat: t.stopFix?.lat,
      stopLon: t.stopFix?.lon,
      c2Lat: t.pilotFix?.lat,
      c2Lon: t.pilotFix?.lon,
      ewNote: t.ew?.state === "effet" || t.ew?.state === "demande" ? t.ew.note : undefined,
      injected: t.injected,
      pending: true,
    };
    const journal = [
      entry,
      ...get().journal.filter((j) => !(j.trackId === t.id && !j.contentSha256)),
    ].slice(0, 200);
    saveJournal(journal);
    set({ journal });
    emitDuty({
      kind: "bulletin",
      title: `Dossier ${t.callsign}`,
      detail: `${plat.manufacturer} ${plat.name} · preuve versée`,
      trackId: t.id,
    });
    void fileEvidence({
      data: {
        trackId: t.id,
        callsign: t.callsign,
        platformId: plat.id,
        origin: plat.origin,
        platformName: plat.name,
        manufacturer: plat.manufacturer,
        confidence: t.confidence,
        lat: t.lat,
        lon: t.lon,
        altM: t.altM,
        heading: t.heading,
        speedKmh: t.speedKmh,
        sensors: t.sensors,
        method: methodBlurb(t),
        launchLat: t.launchFix?.lat ?? null,
        launchLon: t.launchFix?.lon ?? null,
        launchAt: t.launchFix?.at ?? null,
        launchMethod: t.launchFix?.method ?? null,
        launchTile: ev?.launchTile ?? (t.launchFix ? tileRef(t.launchFix.lat, t.launchFix.lon) : null),
        c2Lat: t.pilotFix?.lat ?? null,
        c2Lon: t.pilotFix?.lon ?? null,
        c2Method: t.pilotFix?.method ?? null,
        c2Tile: t.pilotFix ? tileRef(t.pilotFix.lat, t.pilotFix.lon) : null,
        stopLat: t.stopFix?.lat ?? null,
        stopLon: t.stopFix?.lon ?? null,
        stopAt: t.stopFix?.at ?? null,
        stopMethod: t.stopFix?.method ?? null,
        stopTile: ev?.stopTile ?? (t.stopFix ? tileRef(t.stopFix.lat, t.stopFix.lon) : null),
        satCredit: SAT_CREDIT,
        sarNote: SAR_NOTE,
        sceneNote: SCENE_NOTE,
        ewNote: t.ew?.state === "effet" || t.ew?.state === "demande" ? t.ew.note : null,
        corridor: t.corridor,
        injected: Boolean(t.injected),
        iffNote: iffEvidenceLine(t),
      },
    })
      .then((row) => {
        const next = [bulletinToJournal(row), ...get().journal.filter((j) => j.id !== pendingId)].slice(
          0,
          200,
        );
        saveJournal(next);
        set({ journal: next });
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Versement serveur échoué";
        console.error("[vigilair] fileEvidence", err);
        const next = get().journal.map((j) =>
          j.id === pendingId
            ? {
                ...j,
                pending: false,
                fileError: msg.slice(0, 240),
              }
            : j,
        );
        saveJournal(next);
        set({ journal: next });
      });
  },
  recordClip: (trackId) => {
    const t =
      liveTracks.find((x) => x.id === trackId) ??
      get().tracks.find((x) => x.id === trackId);
    if (!t) return;
    if (!t.acoustic?.locked && !get().listenWide) return;
    const clip: AudioClip = {
      id: `clip-${t.id}-${Date.now()}`,
      at: Date.now(),
      trackId: t.id,
      callsign: t.callsign,
      bpfHz: t.acoustic?.bpfHz ?? 0,
      channel: t.acoustic?.channel ?? "none",
      durationS: 8,
      note: t.acoustic?.channelNote ?? "Écoute SIGINT large — métadonnées RF, pas de contrôle.",
    };
    const clips = [clip, ...get().clips].slice(0, 40);
    saveClips(clips);
    set({ clips });
    emitDuty({
      kind: "clip",
      title: `Clip SIGINT ${t.callsign}`,
      detail: clip.note,
      trackId: t.id,
    });
  },
  setListening: (listening) => set({ listening }),
  setListenWide: (listenWide) => set({ listenWide, listening: listenWide || get().listening }),
  requestEw: (trackId) => {
    if (get().copLock?.locked) return;
    const t = liveTracks.find((x) => x.id === trackId);
    if (!t) return;
    const check = canRequestEw(t, get().ewArmed);
    const now = Date.now();
    if (!check.ok) {
      liveTracks = liveTracks.map((x) =>
        x.id === trackId
          ? { ...x, ew: { state: "refuse", at: now, note: check.reason } }
          : x,
      );
      const refused: AlertItem = {
        id: `al-${trackId}-ew-ref-${now}`,
        trackId,
        at: now,
        level: "faible",
        title: `${t.callsign} · effet RF refusé`,
        body: check.reason,
        acked: false,
      };
      const alerts = [refused, ...useVigilair.getState().alerts].slice(0, 40);
      useVigilair.setState({ tracks: liveTracks, alerts });
      return;
    }
    liveTracks = liveTracks.map((x) =>
      x.id === trackId
        ? { ...x, ew: { state: "demande", at: now, note: check.reason } }
        : x,
    );
    const asked: AlertItem = {
      id: `al-${trackId}-ew-${now}`,
      trackId,
      at: now,
      level: "elevee",
      title: `${t.callsign} · demande d'effet RF`,
      body: "Transmis à l'autorité. Télépilote non informé. VIGILAIR n'émet pas.",
      acked: false,
    };
    const alerts = [asked, ...useVigilair.getState().alerts].slice(0, 40);
    useVigilair.setState({ tracks: liveTracks, alerts });
    emitDuty({
      kind: "ew",
      title: `Demande RF ${t.callsign}`,
      detail: "Transmis à l'autorité. VIGILAIR n'émet pas.",
      trackId,
      severity: "warn",
    });
  },
  requestM4: (trackId) => {
    if (useVigilair.getState().clockMode === "replay") return;
    if (useVigilair.getState().copLock?.locked) return;
    const t = liveTracks.find((x) => x.id === trackId);
    if (!t) return;
    const check = canRequestM4(t);
    const now = Date.now();
    if (!check.ok) {
      const refused: AlertItem = {
        id: `al-${trackId}-m4-ref-${now}`,
        trackId,
        at: now,
        level: "faible",
        title: `${t.callsign} · Mode 4 refusé`,
        body: check.reason,
        acked: false,
      };
      useVigilair.setState({
        alerts: [refused, ...useVigilair.getState().alerts].slice(0, 40),
      });
      return;
    }
    liveTracks = liveTracks.map((x) =>
      x.id === trackId ? { ...x, iff: beginM4Request(x, now) } : x,
    );
    const asked: AlertItem = {
      id: `al-${trackId}-m4-${now}`,
      trackId,
      at: now,
      level: "faible",
      title: `${t.callsign} · interrogation Mode 4`,
      body: check.reason,
      acked: false,
    };
    useVigilair.setState({
      tracks: liveTracks,
      alerts: [asked, ...useVigilair.getState().alerts].slice(0, 40),
    });
    emitDuty({
      kind: "m4",
      title: `Mode 4 ${t.callsign}`,
      detail: check.reason,
      trackId,
    });
  },
  clearJournal: () => {
    emitDuty({
      kind: "delete_denied",
      title: "Tentative de vidage du journal",
      detail: "Le journal de preuve est append-only. Seul le chef de division peut purger le cache poste.",
      severity: "crit",
    });
  },
  hydrateJournal: (rows) => {
    const pending = get().journal.filter((j) => j.pending);
    const trackIds = new Set(rows.map((r) => r.trackId));
    const keep = pending.filter((p) => !trackIds.has(p.trackId));
    const journal = [...keep, ...rows].sort((a, b) => b.at - a.at).slice(0, 200);
    saveJournal(journal);
    set({ journal });
  },
  seekReplay: (index, play = false) => {
    showReplay(index, play);
  },
  scrubReplay: (delta) => {
    const st = get();
    const idx = st.clockMode === "replay" ? st.replayIndex : snaps.length - 1;
    showReplay(idx + delta, false);
  },
  returnToLive: () => goLive(true),
  setInstruction: (instruction) => set({ instruction }),
  setShowFriends: (showFriends) => set({ showFriends }),
  setShowLive: (showLive) => set({ showLive }),
  setThreatFloor: (threatFloor) => set({ threatFloor }),
  cycleThreatFloor: () =>
    set({ threatFloor: nextThreatFloor(get().threatFloor) }),
  setIffFilter: (iffFilter) => set({ iffFilter }),
  cycleIffFilter: () => set({ iffFilter: nextIffFilter(get().iffFilter) }),
  setWatch: (w) => set({ watch: w, watchLoaded: true }),
  setCopLock: (l) => set({ copLock: l }),
  setZones: (z) => {
    setLiveZones(z);
    set({ zones: z });
  },
  setWatchMode: (on) => {
    persistWatchMode(on);
    if (on) {
      const cur = get().mapScale;
      set({
        watchMode: true,
        watchDimmed: true,
        watchAutoLayer: true,
        watchWokeAt: null,
        watchWokeReason: null,
        mapScale: watchHomeScale(cur),
        running: true,
        clockMode: "live",
      });
    } else {
      set({
        watchMode: false,
        watchDimmed: false,
        watchAutoLayer: false,
        watchWokeAt: null,
        watchWokeReason: null,
      });
    }
  },
  setWatchAutoLayer: (watchAutoLayer) => set({ watchAutoLayer }),
  applyWatchWake: ({ wake, reason, ident }) => {
    const st = get();
    if (!st.watchMode) return;
    if (wake) {
      const first = st.watchDimmed || st.watchWokeAt == null;
      const patch: Partial<VigilairState> = {
        watchDimmed: false,
        watchWokeAt: Date.now(),
        watchWokeReason: reason,
        running: true,
      };
      if (
        ident &&
        first &&
        st.mapScale !== "ident" &&
        st.mapScale !== "k4" &&
        !st.lakeRouteId &&
        !st.mineId &&
        !st.waterId
      ) {
        patch.mapScale = "ident";
      }
      set(patch);
      return;
    }
    if (!st.watchDimmed && st.watchWokeAt && Date.now() - st.watchWokeAt >= 45_000) {
      set({ watchDimmed: true, watchWokeReason: null, mapScale: "veille" });
    }
  },
  openCapture: ({ lat, lon, kind, title, body, source, id, holdCamera }) => {
    const st = get();
    const shot = buildCapture({
      id: id ?? `cap-${kind}-${Math.round(lat * 1000)}-${Math.round(lon * 1000)}-${Date.now()}`,
      lat,
      lon,
      kind,
      title,
      body,
      source,
      tracks: peekTracks(),
      phenomena: st.phenomena,
    });
    preloadAt(lat, lon, SCALE.ident.tileZ, "vis");
    set({
      capture: shot,
      captures: [shot, ...st.captures.filter((c) => c.id !== shot.id)].slice(0, 24),
      ...(holdCamera
        ? {}
        : {
            viewOrigin: { lat, lon },
            mapScale: "ident" as const,
            satLayer: "vis" as const,
          }),
      running: true,
    });
  },
  closeCapture: () => set({ capture: null }),
  homeOrigin: () =>
    set({
      viewOrigin: HOME,
      capture: null,
      mapScale: get().watchMode ? "veille" : "ident",
    }),
  runInject: (id) => {
    if (get().copLock?.locked) return;
    const spec = INJECTS.find((x) => x.id === id);
    if (!spec) return;
    const now = Date.now();
    replayView = null;
    const created = spawnInject(spec, now);
    if (created.length === 0) return;
    liveTracks = [...created, ...liveTracks];
    pruneTracks();
    spawned += created.length;
    const alert: AlertItem = {
      id: `al-inj-${spec.id}-${now}`,
      trackId: created[0]!.id,
      at: now,
      level: "elevee",
      title: `INJECT · ${spec.name}`,
      body: spec.blurb,
      acked: false,
      injected: true,
    };
    set({
      clockMode: "live",
      instruction: true,
      lastInject: spec.id,
      mapScale: spec.mapScale,
      tracks: liveTracks,
      selectedId: created[0]!.id,
      now,
      running: true,
      spawned,
      replayCount: snaps.length,
      alerts: [alert, ...get().alerts].slice(0, 40),
    });
  },
  lockLive: () => {
    if (get().copLock?.locked) return;
    const pool = peekTracks().filter((t) => t.feed === "adsb");
    if (pool.length === 0) return;
    const o = get().viewOrigin;
    let best = pool[0]!;
    let bestD = Infinity;
    for (const t of pool) {
      const d = (t.lat - o.lat) ** 2 + (t.lon - o.lon) ** 2;
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    preloadAt(best.lat, best.lon, 17, "vis");
    preloadAt(best.lat, best.lon, SCALE.ident.tileZ, "vis");
    set({
      viewOrigin: { lat: best.lat, lon: best.lon },
      mapScale: "ident",
      satLayer: "vis",
      selectedId: best.id,
      clockMode: "live",
    });
    get().lockTrack(best.id);
  },
  purgeInjects: () => {
    liveTracks = liveTracks.filter((t) => t.feed === "adsb" || t.feed === "rid");
    replayView = null;
    mlatWarned.clear();
    const keep = new Set(liveTracks.map((t) => t.id));
    const selectedId = get().selectedId;
    set({
      clockMode: "live",
      tracks: liveTracks,
      instruction: false,
      lastInject: null,
      now: Date.now(),
      running: true,
      selectedId: selectedId && keep.has(selectedId) ? selectedId : null,
      alerts: get().alerts.filter(
        (a) => !a.injected && (!a.trackId || keep.has(a.trackId)),
      ),
    });
  },
}));

function applySim(dt: number) {
  const now = Date.now();
  const alerts: AlertItem[] = [];
  const armed = useVigilair.getState().ewArmed;
  liveTracks = liveTracks.map((t) => {
    if (isLiveFeed(t)) return t;
    let next = stepTrack(t, dt, now);
    if (
      next.iff?.m4 === "demande" &&
      next.iff.m4At != null &&
      now - next.iff.m4At >= M4_DELAY_MS
    ) {
      const resolved = resolveM4(next, now);
      next = { ...next, iff: resolved };
      if (resolved.m4 === "invalid") {
        alerts.push({
          id: `al-${next.id}-m4-bad-${now}`,
          trackId: next.id,
          at: now,
          level: "critique",
          title: `${next.callsign} · Mode 4 invalide`,
          body: resolved.m4Note,
          acked: false,
          injected: next.injected,
        });
      } else if (resolved.m4 === "timeout" && !isFriend(next)) {
        alerts.push({
          id: `al-${next.id}-m4-to-${now}`,
          trackId: next.id,
          at: now,
          level: "moderee",
          title: `${next.callsign} · Mode 4 timeout`,
          body: resolved.m4Note,
          acked: false,
          injected: next.injected,
        });
      }
    }
    if (isFriend(next)) {
      if (next.ew?.state === "demande" || next.ew?.state === "effet") {
        next = {
          ...next,
          ew: {
            state: "refuse",
            at: now,
            note: "Piste amie FATL / ASECNA — effecteur interdit.",
          },
        };
      }
      const iff = tickModeS(next, now);
      if (iff) next = { ...next, iff };
      return next;
    }
    const iff = tickModeS(next, now);
    if (iff) next = { ...next, iff };
    if (
      iff?.mlat?.spoofSuspect &&
      !mlatWarned.has(next.id) &&
      !isFriend(next)
    ) {
      mlatWarned.add(next.id);
      alerts.push({
        id: `al-${next.id}-mlat-${now}`,
        trackId: next.id,
        at: now,
        level: "critique",
        title: `${next.callsign} · ADS-B / MLAT désaccord`,
        body: iff.mlat.note,
        acked: false,
        injected: next.injected,
      });
    }
    if (next.ew?.state === "demande" && (!armed || now - next.ew.at > 1800)) {
      if (!armed) {
        next = {
          ...next,
          ew: {
            state: "idle",
            at: now,
            note: "Effecteur désarmé avant effet.",
          },
        };
      } else {
        next = {
          ...next,
          ew: {
            state: "effet",
            at: now,
            note: "Effet RF lointain simulé. Le télépilote voit une perte de liaison, sans savoir qu'il est intercepté.",
          },
        };
        alerts.push({
          id: `al-${next.id}-ew-on-${now}`,
          trackId: next.id,
          at: now,
          level: "critique",
          title: `${next.callsign} · effet RF`,
          body: "Liaison C2 dégradée. Contrôleur adverse non informé de l'interception. Pas de prise de contrôle.",
          acked: false,
        });
      }
    }
    return next;
  });

  for (const t of liveTracks) {
    if (t.idState === "confirme" && t.confirmedAt === now) {
      if (isFriend(t)) continue;
      const plat = PLATFORM_BY_ID[t.truePlatformId];
      if (plat && plat.origin !== "XX") {
        alerts.push({
          id: `al-${t.id}-${now}`,
          trackId: t.id,
          at: now,
          level: plat.threat,
          title: `${t.callsign} · ${plat.manufacturer} ${plat.name}`,
          body: `Identification silencieuse — ${plat.originLabel} · ${Math.round(t.confidence)} % · contrôleur non alerté`,
          acked: false,
        });
      }
    }
    if (
      t.idState === "hors-mandat" &&
      t.dwellS > 4 &&
      t.dwellS < 4 + dt + 0.05
    ) {
      alerts.push({
        id: `al-${t.id}-xx`,
        trackId: t.id,
        at: now,
        level: "faible",
        title: `${t.callsign} · hors mandat`,
        body: "Origine hors CN / TR / RU / IR — piste classée hors périmètre contractuel.",
        acked: false,
      });
    }
    if (
      !t.siteWarned &&
      t.cpa &&
      t.cpa.closing &&
      t.cpa.distKm < 3.2 &&
      t.idState !== "hors-mandat" &&
      t.idState !== "perdu"
    ) {
      const plat = PLATFORM_BY_ID[t.truePlatformId];
      const level = plat?.threat ?? "moderee";
      if (level === "elevee" || level === "critique" || t.cpa.distKm < 1.6) {
        t.siteWarned = true;
        alerts.push({
          id: `al-${t.id}-cpa`,
          trackId: t.id,
          at: now,
          level: level === "faible" ? "moderee" : level,
          title: `${t.callsign} · approche ${t.cpa.name}`,
          body: `${t.cpa.distKm.toFixed(1)} km · ${t.cpa.etaS ? `ETA ${Math.max(1, Math.round(t.cpa.etaS))} s` : "CPA"}`,
          acked: false,
        });
      }
    }
  }

  const raids = detectRaids(liveTracks);
  applyZoneAlerts(liveTracks, now, alerts);
  raiseSigintAlerts(liveTracks, now, alerts);
  const liveCorridors = new Set(raids.map((r) => r.corridor));
  for (const k of [...raidWarned]) {
    if (!liveCorridors.has(k)) raidWarned.delete(k);
  }
  for (const r of raids) {
    if (raidWarned.has(r.corridor)) continue;
    raidWarned.add(r.corridor);
    const injectedRaid = r.trackIds.every(
      (id) => liveTracks.find((t) => t.id === id)?.injected,
    );
    alerts.push({
      id: `al-raid-${r.corridor}-${now}`,
      trackId: r.trackIds[0] ?? "",
      at: now,
      level: r.worst === "faible" ? "moderee" : r.worst,
      title: injectedRaid
        ? `INJECT · Raid ${r.corridor} · ${r.count} pistes`
        : `Raid ${r.corridor} · ${r.count} pistes`,
      body: injectedRaid
        ? `Formation — salve ${r.originLabels.join(" / ")} depuis ${r.corridor}. Pas un contact réel.`
        : `Salve ${r.originLabels.join(" / ")} depuis ${r.corridor}. Contrôleurs non informés.`,
      acked: false,
      injected: injectedRaid,
    });
  }

  liveTracks = liveTracks.filter(
    (t) => t.idState !== "perdu" || now - t.lastUpdate < 8000,
  );
  pruneTracks();
  const hostiles = liveTracks.filter((t) => !isFriend(t) && t.feed !== "adsb").length;
  const wantMin = useVigilair.getState().instruction ? 10 : 0;
  if (useVigilair.getState().instruction && hostiles < wantMin && Math.random() < 0.03) {
    liveTracks = [spawnTrack(now), ...liveTracks];
    spawned += 1;
  }
  const nFriends = liveTracks.filter(
    (tr) => tr.friendKind && tr.feed !== "adsb" && tr.idState !== "perdu",
  ).length;
  if (useVigilair.getState().instruction && nFriends < 4 && Math.random() < 0.06) {
    liveTracks = [spawnFriendTrack(now), ...liveTracks];
    spawned += 1;
  }

  if (alerts.length > 0) {
    const prev = useVigilair.getState().alerts;
    useVigilair.setState({
      alerts: [...alerts, ...prev].slice(0, 40),
    });
  }
}

export function bootVigilair() {
  if (typeof window === "undefined") return;
  preloadAoTiles();
  if (!useVigilair.getState().instruction) {
    liveTracks = liveTracks.filter((t) => t.feed === "adsb" || t.feed === "rid");
  }
  if (useVigilair.getState().now === 0) {
    const now = Date.now();
    pushSnap(now);
    useVigilair.setState({
      tracks: liveTracks,
      journal: loadJournal(),
      clips: loadClips(),
      now,
      selectedId: null,
      history: [sampleHistory(liveTracks, now)],
      replayCount: snaps.length,
    });
  } else if (useVigilair.getState().journal.length === 0) {
    useVigilair.setState({ journal: loadJournal(), tracks: liveTracks });
  } else {
    useVigilair.setState({ tracks: liveTracks });
  }
  if (loopStarted) return;
  loopStarted = true;
  if (loadWatchMode()) {
    useVigilair.setState({
      watchMode: true,
      watchDimmed: true,
      watchAutoLayer: true,
      mapScale: "veille",
      running: true,
    });
  }
  let last = performance.now();
  let lastUi = 0;
  let lastHist = 0;
  lastSnapAt = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.12, (t - last) / 1000);
    last = t;
    const st = useVigilair.getState();
    if (st.running && st.clockMode === "live") applySim(dt);
    if (st.running && st.clockMode === "replay") {
      replayAcc += dt * 1000;
      if (replayAcc >= SNAP_MS) {
        replayAcc -= SNAP_MS;
        const next = st.replayIndex + 1;
        if (next >= snaps.length) {
          useVigilair.setState({ running: false });
        } else {
          showReplay(next, true);
        }
      }
    }
    if (st.clockMode === "live" && t - lastSnapAt > SNAP_MS) {
      lastSnapAt = t;
      pushSnap(Date.now());
    }
    if (t - lastUi > 120) {
      lastUi = t;
      const live = st.clockMode === "live";
      const patch: Partial<VigilairState> = live
        ? {
            tracks: liveTracks,
            now: Date.now(),
            spawned,
            replayCount: snaps.length,
          }
        : {
            replayCount: snaps.length,
          };
      if (live && t - lastHist > 4000) {
        lastHist = t;
        const prev = useVigilair.getState().history;
        patch.history = [...prev, sampleHistory(liveTracks, Date.now())].slice(-48);
      }
      useVigilair.setState(patch);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function currentPaintFilter(): PaintFilter {
  const s = useVigilair.getState();
  return {
    showFriends: s.showFriends,
    showLive: s.showLive,
    threatFloor: s.threatFloor,
    iffFilter: s.iffFilter,
    selectedId: s.selectedId,
  };
}

export function trackVisible(t: Track, selectedId?: string | null): boolean {
  const s = useVigilair.getState();
  return passesPaintFilter(t, {
    showFriends: s.showFriends,
    showLive: s.showLive,
    threatFloor: s.threatFloor,
    iffFilter: s.iffFilter,
    selectedId: selectedId ?? s.selectedId,
  });
}

export function threatOf(track: Track): Threat {
  const id = track.hypotheses[0]?.platformId ?? track.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    const ta = threatRank(threatOf(a));
    const tb = threatRank(threatOf(b));
    if (ta !== tb) return tb - ta;
    return b.confidence - a.confidence;
  });
}


export function ingestLivePicture(pic: LivePicture) {
  const usable =
    pic.aircraft.length > 0 ||
    pic.metar.length > 0 ||
    pic.taf.length > 0 ||
    pic.sigmets.length > 0 ||
    pic.airport != null ||
    pic.alerts.length > 0 ||
    (pic.phenomena?.length ?? 0) > 0;
  useVigilair.setState({
    livePicture: pic,
    liveAt: pic.at,
    liveError: usable ? null : (pic.errors[0] ?? null),
    phenomena: pic.phenomena ?? [],
  });
  for (const p of pic.phenomena ?? []) {
    if (p.kind === "feu") lockFire(p.id, Date.now());
  }
  if (useVigilair.getState().clockMode === "replay") return;
  const now = Date.now();
  const { tracks, born, emergencies } = mergeLiveTracks(liveTracks, pic.aircraft, now);
  liveTracks = tracks;
  const alerts: AlertItem[] = [];
  for (const tr of emergencies) {
    alerts.push({
      id: `al-emg-${tr.id}-${now}`,
      trackId: tr.id,
      at: now,
      level: "critique",
      title: `${tr.callsign} · ${tr.emergency}`,
      body: `Squawk d'urgence 1090ES live. ${tr.icaoType ?? ""} ${tr.reg ?? ""} · VIGILAIR n'émet pas.`.trim(),
      acked: false,
    });
  }
  for (const tr of born) {
    const d = haversineKm(tr.lat, tr.lon, AO.centerLat, AO.centerLon);
    if (tr.category?.toUpperCase() === "B6") {
      alerts.push({
        id: `al-uav-${tr.id}`,
        trackId: tr.id,
        at: now,
        level: "elevee",
        title: `${tr.callsign} · UAS ADS-B (B6)`,
        body: `Catégorie émetteur B6 — UAV réel sur 1090ES. ${tr.icaoType ?? ""} ${tr.reg ?? ""} · ${Math.round(d)} km de FTTJ.`,
        acked: false,
      });
    } else if (d <= 120) {
      alerts.push({
        id: `al-live-${tr.id}`,
        trackId: tr.id,
        at: now,
        level: "faible",
        title: `${tr.callsign} · 1090ES volume ident`,
        body: `${tr.icaoType ?? "IFR"} · ${Math.round(d)} km de FTTJ · flux live, pas un UAS.`,
        acked: false,
      });
    }
  }
  applyZoneAlerts(liveTracks, now, alerts);
  for (const tr of liveTracks) {
    if (!tr.locked || tr.feed !== "adsb") continue;
    const treated = treatContact(
      {
        id: tr.id,
        callsign: tr.callsign,
        lat: tr.lat,
        lon: tr.lon,
        altM: tr.altM,
        nic: tr.nic ?? null,
        nacp: tr.nacp ?? null,
        squawk: tr.iff?.squawk ?? null,
        icao24: tr.iff?.icao24 ?? null,
        mode: tr.iff?.mode ?? null,
      },
      pic,
    );
    if (treated.verdict === "1090ES traité") continue;
    const id = `al-treat-${tr.id}-${treated.verdict}`;
    if (useVigilair.getState().alerts.some((a) => a.id === id)) continue;
    alerts.push({
      id,
      trackId: tr.id,
      at: now,
      level: treated.verdict.startsWith("GNSS") ? "elevee" : "moderee",
      title: `${tr.callsign} · ${treated.verdict}`,
      body: `${treated.xpdr} · ${treated.metar} · ${treated.sigmet} · ${treated.gnss}`,
      acked: false,
    });
  }
  raiseSigintAlerts(liveTracks, now, alerts);
  const hotJam = (pic.jam ?? []).filter((j) => j.level === "high");
  if (hotJam.length > 0) {
    const jamId = `al-jam-${hotJam[0]!.lat}-${hotJam[0]!.lon}`;
    const already = useVigilair.getState().alerts.some((a) => a.id === jamId);
    if (!already) {
      alerts.push({
        id: jamId,
        trackId: "",
        at: now,
        level: "moderee",
        title: `GNSS dégradé · ${hotJam.length} cellule(s)`,
        body: "NIC/NACp ADS-B bas (méthode gpsjam). Distinguer jamming local d'une tempête SWPC.",
        acked: false,
      });
    }
  }
  let autoPhenom: (typeof pic.phenomena)[number] | null = null;
  for (const p of pic.phenomena ?? []) {
    if (phenomWarned.has(p.id)) continue;
    const rank = theaterRank(p.theater);
    // Une alerte se mérite. Hors théâtre (« monde »), le phénomène reste sur la carte et dans les
    // graphiques sans sonner ; les feux FIRMS ne sonnent qu'au Tchad et au Darfour : en saison
    // sèche il y en a des dizaines par jour au Sahel, ils noieraient les alertes drone et intrusion.
    if (rank < 3) continue;
    if (p.kind === "feu" && rank < 4) continue;
    phenomWarned.add(p.id);
    alerts.push({
      id: `al-nat-${p.id}`,
      trackId: "",
      at: now,
      level: p.level,
      title: p.title,
      body: `${p.body} · ouvrir capture 10 m`,
      acked: false,
      lat: p.lat,
      lon: p.lon,
    });
    // La caméra ne part seule que pour un événement critique au Tchad ; le reste attend le clic
    // « ouvrir capture » de l'opérateur, pour ne pas lui arracher la veille de FTTJ.
    if (rank >= 5 && p.level === "critique" && !autoPhenom) {
      autoPhenom = p;
    }
  }
  if (phenomWarned.size > 240) {
    const keep = [...phenomWarned].slice(-120);
    phenomWarned.clear();
    for (const k of keep) phenomWarned.add(k);
  }
  const patch: Partial<VigilairState> = { tracks: peekTracks() };
  if (alerts.length > 0) {
    patch.alerts = [...alerts, ...useVigilair.getState().alerts].slice(0, 48);
  }
  useVigilair.setState(patch);
  const bornUav = born.find((tr) => (tr.category ?? "").toUpperCase() === "B6");
  const stNow = useVigilair.getState();
  const holdCamera = Boolean(stNow.lakeRouteId || stNow.mineId || stNow.waterId);
  if (!stNow.capture && bornUav) {
    stNow.openCapture({
      lat: bornUav.lat,
      lon: bornUav.lon,
      kind: "uav",
      title: `${bornUav.callsign} · UAV 10 m`,
      body: "Capture visible ≤ 10 m sur piste B6",
      source: "1090ES",
      id: `cap-uav-${bornUav.id}`,
      holdCamera,
    });
  } else if (!stNow.capture && autoPhenom) {
    stNow.openCapture({
      lat: autoPhenom.lat,
      lon: autoPhenom.lon,
      kind: autoPhenom.kind,
      title: autoPhenom.title,
      body: autoPhenom.body,
      source: autoPhenom.source,
      id: `cap-${autoPhenom.id}`,
      holdCamera,
    });
  }
}
