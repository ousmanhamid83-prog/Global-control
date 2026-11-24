import { create } from "zustand";
import { PLATFORM_BY_ID, threatRank } from "./catalog";
import { methodBlurb } from "./engine";
import { bulletinToJournal, fileEvidence } from "./evidence-store";
import { AO, HOME, SCALE, haversineKm, nearestCity, theaterRank, type GeoOrigin, type MapScale } from "./geo";
import { isFriend } from "./friends";
import { nextThreatFloor, passesPaintFilter, type ThreatFloor } from "./iff";
import { autoLockPick, type AutoPick } from "./auto-lock";
import type { GpsZone } from "./passability";
import { iffEvidenceLine } from "./mode-s";
import { DEFAULT_PPI, type HistSample, type PpiParams } from "./ppi";
import {
  SNAP_MAX,
  SNAP_MS,
  compactTracks,
  expandSnap,
  type Snap,
} from "./replay";
import {
  avecStatutId,
  emergencyLabel,
  isLiveFeed,
  liveAcToTrack,
  mergeLiveTracks,
  type LivePicture,
} from "./live-adsb";
import { cpaSite } from "./cpa";
import { COAST_ALERT_S, DUP_ADDR_RUN } from "./coast";
import { silentAlarm, siteApproach } from "./site-approach";
import { indexTape, rejeuClock, tapeAt, type RejeuTape, type TapeIndex } from "./rejeu";
import { treatContact } from "./treat";
import { tileRef } from "./tiles";
import type { SatLayer, SatMeta } from "./sat";
import { autoLayerSwitch } from "./sat";
import { detectRaids } from "./raid";
import { lockFire } from "./fire-clock";
import { emptyFlags, type StewardFlags, type StewardParamId } from "./steward";
import { setTileRefine } from "./tiles";
import { emitDuty } from "./duty-bus";
import { buildCapture, type CaptureShot, type Phenomenon } from "./capture";
import type { AlertItem, JournalEntry, Origin, Threat, Track } from "./types";
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
  passagesDe,
  getLiveZones,
  setLiveZones,
  type ZoneRow,
  type ZoneStatus,
} from "./zones";
import { mineZoneRows } from "./mines";
import type { NavRoute } from "./nav";
import { nearestWatchSite, watchZoneRows } from "./watch-sites";
import { dronesPeek, matchOwnDrone } from "./drones";
import { exerciceEnCours } from "./drones-core";
import { constat1090 } from "./drones-pilotage";
import { telemetriePour } from "./drones-suivi";
import { PREFIXE_EXERCICE, pisteExercice } from "./exercice";
import { droneDeclare, libelleDrone } from "./drones-oaci";
import { ouLibelle } from "./drones-entendus";
import { cameraLibre, droneACapturer, PREFIXE_CAPTURE_DRONE } from "./regions-drones";

/** Dernier relevé de la veille drone : mouvement %, zones, indice de présence, et capture figée. */
export type DroneMotion = {
  pct: number | null;
  at: number;
  error?: string;
  /** Nombre de zones de mouvement distinctes. */
  zones?: number;
  /** Indice de présence (prudent, à confirmer à l'œil) — jamais une identité. */
  hint?: string;
  /** Localisation grossière de la plus grande zone dans le cadre (ex. « bas-gauche »). */
  where?: string;
  /** Suivi de piste : sens de déplacement à l'écran de la piste principale (ex. « droite »). */
  heading?: string;
  /** Suivi de piste : vitesse estimée de la piste principale (% du cadre / s). */
  speed?: number;
  /** Pistage multi-cibles : nombre de pistes établies simultanément. */
  targets?: number;
  /** Pistage multi-cibles : une entrée par piste (id stable, cap écran, vitesse, position, immobile, durée). */
  tracks?: { id: number; heading: string; speed: number; where: string; stationary?: boolean; dwell?: number }[];
  /** Note de contexte non-alarmante (ex. « variation d'éclairage », « croisement de pistes »). */
  note?: string;
  /** Capture : trame figée + surcouche mouvement + trace (data URL), pour revue humaine. */
  frame?: string;
  /**
   * Heure de la trame de preuve `frame` quand elle est ANTÉRIEURE à `at`. Cas du sabotage : la trame du
   * moment ne montre plus rien (noire, bâchée, détournée), donc la preuve est la dernière vue NETTE
   * d'avant la neutralisation — et il faut dire à l'opérateur de quand elle date.
   */
  frameAt?: number;
  /** Niveau de la dernière alerte liée (elevee / critique si périmètre armé). */
  level?: "elevee" | "critique";
  /**
   * Sabotage caméra détecté : objectif masqué/obscurci, flux figé (gelé/bouclé), ou caméra détournée de
   * son champ de vue. Jamais d'identité : on constate que la surveillance a été neutralisée.
   */
  tamper?: "masquee" | "figee" | "deplacee";
  /** Ce que la caméra montre MAINTENANT (noir / bâché / figé / autre visée) : la preuve du sabotage. */
  tamperFrame?: string;
};
import { reportZoneBreach } from "./zones-ops";

const JOURNAL_KEY = "vigilair-journal-v1";

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

export type FilterOrigin = Origin | "ALL" | "AMI" | "LIVE";

/** Inject REJEU RÉEL en cours : la bande, l'heure d'origine lue, la vitesse. */
export type RejeuState = {
  kind: RejeuTape["kind"];
  source: string;
  from: number;
  to: number;
  /** Heure d'origine de l'instant rejoué (ms). */
  clock: number;
  speed: number;
  n: number;
};

export type ClockMode = "live" | "replay";
/** « drone » : le chef désigne sur la carte le point où envoyer un de nos drones. */
export type CopTool = "lock" | "mesure" | "zone" | "drone" | "coins";

type VigilairState = {
  tracks: Track[];
  selectedId: string | null;
  /** Verrou automatique en place (la sélection vient de la console, pas de l'opérateur). */
  autoPick: AutoPick | null;
  /** L'opérateur peut couper le verrou auto ; il reste alors sans piste tant qu'il ne choisit pas. */
  autoLockOn: boolean;
  rejeu: RejeuState | null;
  alerts: AlertItem[];
  journal: JournalEntry[];
  running: boolean;
  now: number;
  originFilter: FilterOrigin;
  search: string;
  mapScale: MapScale;
  satLayer: SatLayer;
  /** Bascule auto de l'imagerie en couche Nuit quand il fait nuit à FTTJ (Visible = noir la nuit). */
  autoNight: boolean;
  /** Bascule auto en IR sur les vues larges (couverture monde continue, jour et nuit). */
  autoWideIr: boolean;
  /** Couche d'origine depuis laquelle la bascule auto a eu lieu, pour revenir à Visible. */
  satAutoFrom: SatLayer | null;
  satMeta: SatMeta | null;
  copTool: CopTool;
  /** Panneau « Phénomènes mondiaux » ouvert (crues/catastrophes lointaines, accès en un clic). */
  worldPhenomOpen: boolean;
  /** Route de navigation active (tracée sur le COP, surveillée par l'alarme). */
  navRoute: NavRoute | null;
  /** Alarme sonore quand un obstacle réel surgit sur la route active. */
  navAlarm: boolean;
  /** Surveillance changement auto : compare seul les passages Sentinel-2 des sites et alerte. */
  changeWatch: boolean;
  /** Seuil (% du cadre changé) au-delà duquel la surveillance changement sonne. */
  changeThreshold: number;
  /** Veille mouvement sur l'imagerie de NOS drones : compare deux trames et alerte un mouvement. */
  droneWatch: boolean;
  /** Seuil (% du cadre en mouvement) au-delà duquel la veille drone alerte. */
  droneThreshold: number;
  /** Cadence de la veille drone (secondes entre deux trames). Rapproché = suivi quasi continu. */
  droneCadence: number;
  /** N'alerter que sur une fenêtre horaire (ex. la nuit). Hors fenêtre : on suit/journalise, sans alerte. */
  droneNightOnly: boolean;
  /** Fenêtre d'armement : heure de début et de fin (0..23). 19→6 = la nuit. */
  droneArmFrom: number;
  droneArmTo: number;
  /** Dernier résultat d'analyse par drone (mouvement %, zones, indice de présence, capture), pour l'UI. */
  droneMotion: Record<string, DroneMotion>;
  /** Journal de connexion par source (drone/caméra) : derniers relevés (ok/erreur + heure). */
  droneLog: Record<string, { at: number; ok: boolean; msg: string }[]>;
  /** Re-scan périodique des sites distants : signale une caméra tombée / une nouvelle sur le périmètre. */
  siteNetWatch: boolean;
  /** Cadence du re-scan périodique des sites distants (minutes). */
  siteNetCadenceMin: number;
  /** Seuil d'alerte par secteur : si ≥ N caméras d'un même secteur tombent sur un cycle → attaque coordonnée. */
  siteNetSectorThreshold: number;
  ppi: PpiParams;
  history: HistSample[];
  clockMode: ClockMode;
  replayIndex: number;
  replayCount: number;
  /** Une injection RÉELLE est en cours (rejeu de trafic enregistré) : bandeau EXERCICE. */
  instruction: boolean;
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
  declutter: boolean;
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
  stewardFlags: StewardFlags;
  stewardHeldIr: boolean;
  weeklyOn: boolean;
  weeklyDay: number;
  weeklyHour: number;
  lastWeeklyAt: number;
  stewardLog: { at: number; text: string }[];
  select: (id: string | null) => void;
  lockTrack: (id: string | null) => void;
  setAutoLockOn: (on: boolean) => void;
  setOriginFilter: (v: FilterOrigin) => void;
  setSearch: (v: string) => void;
  setRunning: (v: boolean) => void;
  setMapScale: (v: MapScale) => void;
  setSatLayer: (v: SatLayer) => void;
  setAutoNight: (v: boolean) => void;
  setAutoWideIr: (v: boolean) => void;
  applyAutoLayer: () => void;
  setSatMeta: (v: SatMeta) => void;
  setCopTool: (v: CopTool) => void;
  setWorldPhenomOpen: (v: boolean) => void;
  setNavRoute: (r: NavRoute | null) => void;
  setNavAlarm: (v: boolean) => void;
  setChangeWatch: (v: boolean) => void;
  setChangeThreshold: (v: number) => void;
  setDroneWatch: (v: boolean) => void;
  setDroneThreshold: (v: number) => void;
  setDroneCadence: (v: number) => void;
  setDroneNightOnly: (v: boolean) => void;
  setDroneArmWindow: (from: number, to: number) => void;
  setDroneMotion: (id: string, res: DroneMotion) => void;
  pushDroneLog: (id: string, entry: { at: number; ok: boolean; msg: string }) => void;
  setSiteNetWatch: (v: boolean) => void;
  setSiteNetCadence: (min: number) => void;
  setSiteNetSectorThreshold: (n: number) => void;
  pushAlert: (a: AlertItem) => void;
  setAxisId: (id: string | null) => void;
  setPeakId: (id: string | null) => void;
  setShowPeaks: (on: boolean) => void;
  setGpsZone: (z: GpsZone | null) => void;
  setStewardFlag: (id: StewardParamId, on: boolean) => void;
  setWeekly: (patch: { on?: boolean; day?: number; hour?: number; lastAt?: number }) => void;
  pushSteward: (text: string, at: number) => void;
  setViewOrigin: (o: GeoOrigin) => void;
  setPpi: (patch: Partial<PpiParams>) => void;
  ackAlert: (id: string) => void;
  ackAll: () => void;
  /**
   * Verse le dossier scellé d'une piste. `cliche` : le serveur y met l'imagerie du lieu, le drone
   * marqué ; `contexte` : ce qui l'a fait verser (une capture automatique, en appui ou non).
   */
  fileBulletin: (trackId: string, opts?: { cliche?: boolean; contexte?: string }) => void;
  hydrateJournal: (rows: JournalEntry[]) => void;
  seekReplay: (index: number, play?: boolean) => void;
  scrubReplay: (delta: number) => void;
  returnToLive: () => void;
  lockLive: () => void;
  startRejeu: (tape: RejeuTape) => void;
  setRejeuSpeed: (speed: number) => void;
  stopRejeu: () => void;
  purgeInjects: () => void;
  setShowFriends: (v: boolean) => void;
  setShowLive: (v: boolean) => void;
  setThreatFloor: (v: ThreatFloor) => void;
  cycleThreatFloor: () => void;
  toggleDeclutter: () => void;
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
  /**
   * Capture EN APPUI : la scène ouverte reste à l'écran et la caméra ne bouge pas ; celle-ci
   * s'ajoute aux captures, que la bande Théâtre montre et rouvre d'un clic.
   */
  captureEnAppui: (opts: {
    lat: number;
    lon: number;
    kind: CaptureShot["kind"];
    title: string;
    body: string;
    source: string;
    id: string;
  }) => void;
  homeOrigin: () => void;
};

let loopStarted = false;
let liveTracks: Track[] = [];
const raidWarned = new Set<string>();
/** Pistes déjà signalées muettes / incohérentes : on prévient une fois, pas à chaque relevé. */
const coastWarned = new Set<string>();
const jumpWarned = new Set<string>();
/**
 * Bulles déjà signalées : clé (entrée/approche, bulle, piste) → piste. La piste est gardée à part :
 * la redécouper dans la clé au dernier « : » échouait sur un identifiant qui en contient (une piste
 * d'exercice porte l'identifiant du drone, « drone:… ») et l'alerte repartait à chaque tour.
 */
const zoneWarned = new Map<string, string>();
const phenomWarned = new Set<string>();
/** Drones déjà capturés seuls : une fois par drone et par session de la console. */
const capturesAuto = new Set<string>();
/** Drones entendus sans position déjà dits : une fois par adresse et par session de la console. */
const entendusDits = new Set<string>();
const snaps: Snap[] = [];
let replayView: Track[] | null = null;
let replayAcc = 0;
let lastSnapAt = 0;

function applyZoneAlerts(tracks: Track[], now: number, alerts: AlertItem[]): void {
  const zones = getLiveZones();
  const picture = evaluateZones(tracks, [...zones, ...mineZoneRows(), ...watchZoneRows()]);
  useVigilair.setState({ zonePicture: picture });
  const liveIds = new Set(tracks.map((t) => t.id));
  for (const [key, tid] of zoneWarned) {
    if (!liveIds.has(tid)) zoneWarned.delete(key);
  }
  if (useVigilair.getState().clockMode === "replay") return;
  // La règle de la veille du serveur (passagesDe) : la console le dit au bandeau et le consigne ;
  // le registre ne garde qu'un passage par bulle, piste et sorte en 20 min, qui qu'il vienne.
  for (const p of passagesDe(picture)) {
    const dedans = p.kind === "inside";
    const key = `${dedans ? "in" : "ap"}:${p.zoneId}:${p.trackId}`;
    if (zoneWarned.has(key)) continue;
    zoneWarned.set(key, p.trackId);
    alerts.push({
      id: `al-${dedans ? "zone" : "zoneap"}-${p.zoneId}-${p.trackId}`,
      trackId: p.trackId,
      at: now,
      level: dedans ? "critique" : "elevee",
      title: dedans
        ? `INTRUSION · ${p.zoneName} · ${p.callsign}`
        : `Approche · ${p.zoneName} · ${p.callsign}`,
      body: dedans
        ? `${p.distKm.toFixed(2)} km du centre. Bulle armée. AfriControl n'émet pas.`
        : `${p.distKm.toFixed(2)} km · fermeture sur la bulle.`,
      acked: false,
    });
    void reportZoneBreach({ data: p }).catch(() => undefined);
  }
}

export function peekTracks(): Track[] {
  return replayView ?? liveTracks;
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
  autoPick: null,
  autoLockOn: true,
  rejeu: null,
  alerts: [],
  journal: [],
  running: true,
  now: 0,
  originFilter: "ALL",
  search: "",
  mapScale: "ident",
  satLayer: "vis",
  autoNight: true,
  autoWideIr: true,
  satAutoFrom: null,
  satMeta: null,
  copTool: "lock",
  worldPhenomOpen: false,
  navRoute: null,
  navAlarm: true,
  changeWatch: false,
  changeThreshold: 8,
  droneWatch: false,
  droneThreshold: 6,
  droneCadence: 15,
  droneNightOnly: false,
  droneArmFrom: 19,
  droneArmTo: 6,
  droneMotion: {},
  droneLog: {},
  siteNetWatch: false,
  siteNetCadenceMin: 15,
  siteNetSectorThreshold: 2,
  ppi: DEFAULT_PPI,
  history: [],
  clockMode: "live",
  replayIndex: 0,
  replayCount: 0,
  instruction: false,
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
  declutter: false,
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
  stewardFlags: emptyFlags(),
  stewardHeldIr: false,
  weeklyOn: false,
  weeklyDay: 1,
  weeklyHour: 5,
  lastWeeklyAt: 0,
  stewardLog: [],
  // Un choix de l'opérateur annule le verrou auto : sa main prime toujours.
  select: (id) => set({ selectedId: id, autoPick: null }),
  setAutoLockOn: (on) => {
    const s = get();
    if (!on) {
      set({ autoLockOn: false, autoPick: null, selectedId: s.autoPick ? null : s.selectedId });
      return;
    }
    set({ autoLockOn: true, autoPick: null, selectedId: null });
    applyAutoLock(Date.now());
  },
  lockTrack: (id) => {
    liveTracks = liveTracks.map((t) => ({ ...t, locked: id != null && t.id === id }));
    if (replayView) {
      replayView = replayView.map((t) => ({ ...t, locked: id != null && t.id === id }));
    }
    set({ selectedId: id, autoPick: null, tracks: peekTracks() });
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
  setMapScale: (mapScale) => {
    // Changer d'échelle réévalue la bascule auto : en détail on rend « Visible » (archive nette),
    // en vue large on passe sur IR (couverture monde) ou Nuit la nuit.
    set({ mapScale });
    get().applyAutoLayer();
  },
  setSatLayer: (satLayer) => {
    // Choix opérateur : on efface le marqueur de bascule auto, puis on réapplique la règle
    // (s'il choisit Visible en vue large avec l'auto actif, on repasse aussitôt sur IR/Nuit).
    set({ satLayer, satAutoFrom: null });
    get().applyAutoLayer();
  },
  setAutoNight: (autoNight) => {
    set({ autoNight });
    if (autoNight || get().autoWideIr) get().applyAutoLayer();
    else if (get().satAutoFrom != null) get().applyAutoLayer();
  },
  setAutoWideIr: (autoWideIr) => {
    set({ autoWideIr });
    get().applyAutoLayer();
  },
  applyAutoLayer: () => {
    const s = get();
    // « Visible » ne vient du géostationnaire (couverture Meteosat/jour) que sur les vues larges
    // (tileZ < 11). En détail (z ≥ 11), « Visible » est l'archive Esri nette : on n'y touche pas.
    const visIsLive = SCALE[s.mapScale].tileZ < 11;
    const next = autoLayerSwitch(s.satLayer, s.satAutoFrom, {
      autoWideIr: s.autoWideIr,
      autoNight: s.autoNight,
      night: s.livePicture?.solar?.nightOps ?? null,
      visIsLive,
    });
    if (next) set(next);
  },
  setSatMeta: (satMeta) => set({ satMeta }),
  setCopTool: (copTool) => set({ copTool }),
  setWorldPhenomOpen: (worldPhenomOpen) => set({ worldPhenomOpen }),
  setNavRoute: (navRoute) => set({ navRoute }),
  setNavAlarm: (navAlarm) => set({ navAlarm }),
  setChangeWatch: (changeWatch) => set({ changeWatch }),
  setChangeThreshold: (changeThreshold) => set({ changeThreshold }),
  setDroneWatch: (droneWatch) => set({ droneWatch }),
  setDroneThreshold: (droneThreshold) => set({ droneThreshold }),
  setDroneCadence: (droneCadence) => set({ droneCadence }),
  setDroneNightOnly: (droneNightOnly) => set({ droneNightOnly }),
  setDroneArmWindow: (droneArmFrom, droneArmTo) => set({ droneArmFrom, droneArmTo }),
  setDroneMotion: (id, res) => set({ droneMotion: { ...get().droneMotion, [id]: res } }),
  pushDroneLog: (id, entry) =>
    set({ droneLog: { ...get().droneLog, [id]: [entry, ...(get().droneLog[id] ?? [])].slice(0, 12) } }),
  setSiteNetWatch: (siteNetWatch) => set({ siteNetWatch }),
  setSiteNetCadence: (siteNetCadenceMin) => set({ siteNetCadenceMin }),
  setSiteNetSectorThreshold: (siteNetSectorThreshold) => set({ siteNetSectorThreshold }),
  pushAlert: (a) => set({ alerts: [a, ...get().alerts].slice(0, 48) }),
  setAxisId: (axisId) => set({ axisId }),
  setPeakId: (peakId) => set({ peakId }),
  setShowPeaks: (showPeaks) => set({ showPeaks }),
  setGpsZone: (gpsZone) => set({ gpsZone }),
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
    if (id === "affinage") setTileRefine(on);
    if (id === "auto") get().setWatchAutoLayer(on);
    if (id === "horloge") set({ running: on });
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
  setPpi: (patch) => set({ ppi: { ...get().ppi, ...patch } }),
  ackAlert: (id) =>
    set({
      alerts: get().alerts.map((a) => (a.id === id ? { ...a, acked: true } : a)),
    }),
  ackAll: () => set({ alerts: get().alerts.map((a) => ({ ...a, acked: true })) }),
  fileBulletin: (trackId, opts) => {
    const t =
      liveTracks.find((x) => x.id === trackId) ??
      get().tracks.find((x) => x.id === trackId);
    if (!t) return;
    const plat = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
    if (!plat) return;
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
        method: opts?.contexte ? `${methodBlurb(t)} · ${opts.contexte}` : methodBlurb(t),
        launchLat: t.launchFix?.lat ?? null,
        launchLon: t.launchFix?.lon ?? null,
        launchAt: t.launchFix?.at ?? null,
        launchMethod: t.launchFix?.method ?? null,
        launchTile: t.launchFix ? tileRef(t.launchFix.lat, t.launchFix.lon) : null,
        corridor: t.corridor,
        injected: Boolean(t.injected),
        iffNote: iffEvidenceLine(t),
        cliche: Boolean(opts?.cliche),
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
  setShowFriends: (showFriends) => set({ showFriends }),
  setShowLive: (showLive) => set({ showLive }),
  toggleDeclutter: () => set({ declutter: !get().declutter }),
  setThreatFloor: (threatFloor) => set({ threatFloor }),
  cycleThreatFloor: () =>
    set({ threatFloor: nextThreatFloor(get().threatFloor) }),
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
  captureEnAppui: (opts) => {
    const st = get();
    const shot = buildCapture({ ...opts, tracks: peekTracks(), phenomena: st.phenomena });
    set({ captures: [shot, ...st.captures.filter((c) => c.id !== shot.id)].slice(0, 24) });
  },
  homeOrigin: () =>
    set({
      viewOrigin: HOME,
      capture: null,
      mapScale: get().watchMode ? "veille" : "ident",
    }),
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
    set({
      viewOrigin: { lat: best.lat, lon: best.lon },
      mapScale: "ident",
      satLayer: "vis",
      selectedId: best.id,
      clockMode: "live",
    });
    get().lockTrack(best.id);
  },
  startRejeu: (tape) => {
    if (get().copLock?.locked) return;
    const now = Date.now();
    replayView = null;
    liveTracks = liveTracks.filter((t) => t.feed !== "rejeu");
    rejeuRun = {
      tape,
      index: indexTape(tape),
      baseT: tape.from,
      startedAt: now,
      speed: 1,
      lastStep: 0,
      warned: new Set(),
    };
    useVigilair.setState({
      rejeu: {
        kind: tape.kind,
        source: tape.source,
        from: tape.from,
        to: tape.to,
        clock: tape.from,
        speed: 1,
        n: 0,
      },
    });
    stepRejeu(now, true);
    // La piste rejouée la plus proche de FTTJ ouvre le dossier ; la carte va la chercher.
    let focus: Track | null = null;
    let best = Infinity;
    for (const t of liveTracks) {
      if (t.feed !== "rejeu") continue;
      const d = haversineKm(t.lat, t.lon, HOME.lat, HOME.lon);
      if (d < best) {
        best = d;
        focus = t;
      }
    }
    const heard = Object.keys(tape.ac).length;
    const alert: AlertItem = {
      id: `al-rejeu-${now}`,
      trackId: focus?.id ?? "",
      at: now,
      level: "faible",
      title: `REJEU RÉEL · ${heard} avions enregistrés`,
      body: `${tape.kind === "poste" ? "Bande de ce poste" : "Archive réelle"} · ${rejeuClock(tape.from)} → ${rejeuClock(tape.to)} · ${tape.source}. Trafic réel rejoué, pas un contact live.`,
      acked: false,
      injected: true,
    };
    set({
      clockMode: "live",
      running: true,
      instruction: true,
      tracks: liveTracks,
      selectedId: focus?.id ?? null,
      autoPick: null,
      viewOrigin: focus ? { lat: focus.lat, lon: focus.lon } : get().viewOrigin,
      mapScale: focus ? "approche" : get().mapScale,
      now,
      alerts: [alert, ...get().alerts].slice(0, 48),
    });
  },
  setRejeuSpeed: (speed) => {
    const run = rejeuRun;
    const st = get().rejeu;
    if (!run || !st) return;
    const now = Date.now();
    run.baseT = rejeuNow(run, now);
    run.startedAt = now;
    run.speed = speed;
    set({ rejeu: { ...st, speed } });
  },
  stopRejeu: () => endRejeu(Date.now(), "arrêté par l'opérateur"),
  purgeInjects: () => {
    liveTracks = liveTracks.filter((t) => t.feed === "adsb");
    rejeuRun = null;
    replayView = null;
    const keep = new Set(liveTracks.map((t) => t.id));
    const selectedId = get().selectedId;
    set({
      clockMode: "live",
      tracks: liveTracks,
      instruction: false,
      now: Date.now(),
      running: true,
      selectedId: selectedId && keep.has(selectedId) ? selectedId : null,
      rejeu: null,
      alerts: get().alerts.filter(
        (a) => !a.injected && (!a.trackId || keep.has(a.trackId)),
      ),
    });
    applyAutoLock(Date.now());
  },
}));

type RejeuRun = {
  tape: RejeuTape;
  index: TapeIndex;
  /** Heure d'origine lue à `startedAt`. */
  baseT: number;
  startedAt: number;
  speed: number;
  lastStep: number;
  warned: Set<string>;
};

let rejeuRun: RejeuRun | null = null;

function rejeuNow(run: RejeuRun, now: number): number {
  return run.baseT + (now - run.startedAt) * run.speed;
}

/**
 * Avance le rejeu (1 Hz) : les pistes prennent la position que la bande avait à cette heure
 * d'origine. Elles portent feed « rejeu » et l'heure d'origine : jamais comptées comme live.
 */
function stepRejeu(now: number, force = false) {
  const run = rejeuRun;
  if (!run) return;
  if (!force && now - run.lastStep < 1000) return;
  run.lastStep = now;
  const t = rejeuNow(run, now);
  if (t > run.tape.to + 45_000) {
    endRejeu(now, "fin de bande");
    return;
  }
  const prevById = new Map<string, Track>();
  for (const x of liveTracks) if (x.feed === "rejeu") prevById.set(x.id, x);
  const next: Track[] = [];
  const alerts: AlertItem[] = [];
  for (const p of tapeAt(run.tape, t, run.index)) {
    const id = `rej-${p.ac.hex}`;
    const prev = prevById.get(id);
    const ac = { ...p.ac, emergency: emergencyLabel(p.ac.emergency) };
    // Le statut se fonde sur les relevés RÉELS de la bande, pas sur les pas d'interpolation (1 Hz).
    const base = avecStatutId({ ...liveAcToTrack(ac, now, prev), fixes: p.vus }, now);
    const trailAt = prev?.rejeu?.trailAt ?? 0;
    const moveTrail = !prev || now - trailAt >= 8000;
    next.push({
      ...base,
      id,
      feed: "rejeu",
      injected: true,
      trail: moveTrail ? base.trail : prev.trail,
      launchFix: base.launchFix ? { ...base.launchFix, method: "REJEU RÉEL 1090ES" } : null,
      rejeu: {
        posAt: p.posAt,
        kind: run.tape.kind,
        source: run.tape.source,
        trailAt: moveTrail ? now : trailAt,
      },
    });
    if (ac.emergency && !run.warned.has(id)) {
      run.warned.add(id);
      alerts.push({
        id: `al-rejeu-emg-${id}-${now}`,
        trackId: id,
        at: now,
        level: "moderee",
        title: `REJEU · ${base.callsign} · ${ac.emergency}`,
        body: `Urgence réelle enregistrée le ${rejeuClock(p.posAt)}. Rejeu, pas un contact live.`,
        acked: false,
        injected: true,
      });
    }
  }
  liveTracks = [...liveTracks.filter((x) => x.feed !== "rejeu"), ...next];
  const st = useVigilair.getState();
  const patch: Partial<VigilairState> = {};
  if (st.rejeu) patch.rejeu = { ...st.rejeu, clock: t, n: next.length };
  if (alerts.length > 0) patch.alerts = [...alerts, ...st.alerts].slice(0, 48);
  useVigilair.setState(patch);
}

function endRejeu(now: number, why: string) {
  if (!rejeuRun) return;
  const run = rejeuRun;
  rejeuRun = null;
  liveTracks = liveTracks.filter((t) => t.feed !== "rejeu");
  const s = useVigilair.getState();
  const others = liveTracks.some((t) => t.injected);
  const sel = s.selectedId;
  useVigilair.setState({
    rejeu: null,
    tracks: liveTracks,
    instruction: others ? s.instruction : false,
    selectedId: sel?.startsWith("rej-") ? null : sel,
    alerts: [
      {
        id: `al-rejeu-fin-${now}`,
        trackId: "",
        at: now,
        level: "faible" as const,
        title: "REJEU RÉEL terminé",
        body: `${why} · bande ${rejeuClock(run.tape.from)} → ${rejeuClock(run.tape.to)}. Retour à la veille réelle.`,
        acked: false,
        injected: true,
      },
      ...s.alerts,
    ].slice(0, 48),
  });
  applyAutoLock(now);
}

let exercicesA = 0;

/**
 * Pistes d'EXERCICE, une fois par seconde : la vraie télémétrie de chacun de nos drones que le chef
 * fait jouer comme intrus. Une liaison muette ou un exercice terminé retire la piste : jamais de
 * position extrapolée pour un exercice.
 */
function majExercices(now: number): void {
  if (now - exercicesA < 1000) return;
  exercicesA = now;
  const prev = new Map(liveTracks.filter((t) => t.feed === "exercice").map((t) => [t.id, t]));
  const next: Track[] = [];
  for (const d of dronesPeek()) {
    const plateforme = exerciceEnCours(d, now);
    if (!plateforme || !d.liaison) continue;
    const mesure = telemetriePour(d.id, now);
    if (!mesure) continue;
    const t = pisteExercice(d, plateforme, mesure, now, prev.get(`${PREFIXE_EXERCICE}${d.id}`));
    if (!t) continue;
    t.cpa = cpaSite(t);
    next.push(t);
  }
  if (next.length === 0 && prev.size === 0) return;
  liveTracks = [...liveTracks.filter((t) => t.feed !== "exercice"), ...next];
}

/** Un tour de veille : avance le rejeu et l'exercice, puis passe les règles d'alerte. */
function veiller() {
  const now = Date.now();
  stepRejeu(now);
  majExercices(now);
  const alerts: AlertItem[] = [];

  for (const t of liveTracks) {
    // Le CPA est purement HORIZONTAL : sans plafond d'altitude, un avion de ligne à la verticale
    // d'une mine afficherait une distance nulle « en rapprochement » et alerterait à chaque survol.
    const cpa = t.cpa;
    if (
      !t.siteWarned &&
      cpa &&
      siteApproach(t, cpa).relevant &&
      t.idState !== "hors-mandat" &&
      t.idState !== "perdu"
    ) {
      const plat = PLATFORM_BY_ID[t.truePlatformId];
      const level = plat?.threat ?? "moderee";
      if (level === "elevee" || level === "critique" || cpa.distKm < 1.6) {
        t.siteWarned = true;
        alerts.push({
          id: `al-${t.id}-cpa`,
          trackId: t.id,
          at: now,
          level: level === "faible" ? "moderee" : level,
          title: `${t.callsign} · approche ${cpa.name}`,
          body: `${cpa.distKm.toFixed(1)} km · ${cpa.etaS ? `ETA ${Math.max(1, Math.round(cpa.etaS))} s` : "CPA"}`,
          acked: false,
        });
      }
    }
  }

  // TRANSPONDEUR COUPÉ PRÈS D'UN SITE. C'était toute la raison d'être de la piste mémoire, et elle
  // restait muette : on la dessinait, sans jamais prévenir. Un aéronef BAS qui cesse d'émettre à
  // proximité d'un site protégé est précisément ce qu'un poste doit voir — c'est le geste de qui ne
  // veut pas être suivi. On prévient une fois par piste, et on oublie dès qu'elle ré-émet.
  // Le seuil n'est PAS celui de l'affichage : un agrégateur réseau livre couramment des positions
  // vieilles de quelques secondes, et le scope le dit (MÉM). Prévenir là-dessus noierait l'opérateur
  // sous des alertes de latence ordinaire ; on ne parle qu'au-delà d'un silence franc.
  for (const t of liveTracks) {
    const cpa = t.cpa;
    if (!t.coast || !cpa || !silentAlarm(t, cpa, COAST_ALERT_S).relevant) {
      coastWarned.delete(t.id);
      continue;
    }
    if (coastWarned.has(t.id)) continue;
    coastWarned.add(t.id);
    alerts.push({
      id: `al-${t.id}-coast`,
      trackId: t.id,
      at: now,
      level: "elevee",
      title: `${t.callsign} · transpondeur muet près de ${cpa.name}`,
      body: `Plus de relevé depuis ${t.coast.silentS} s à ${Math.round(t.altM)} m, ${cpa.distKm.toFixed(1)} km du site. Position estimée à ±${t.coast.radiusKm.toFixed(1)} km — ce n'est plus une mesure.`,
      acked: false,
    });
  }
  // RELEVÉ INVRAISEMBLABLE : détecté depuis le lot précédent, mais jamais remonté à l'opérateur.
  for (const t of liveTracks) {
    if (!t.suspectJump) {
      jumpWarned.delete(t.id);
      continue;
    }
    if (jumpWarned.has(t.id)) continue;
    jumpWarned.add(t.id);
    const dup = (t.suspect?.run ?? 0) >= DUP_ADDR_RUN;
    alerts.push({
      id: `al-${t.id}-jump`,
      trackId: t.id,
      at: now,
      level: dup ? "elevee" : "moderee",
      title: dup
        ? `${t.callsign} · adresse ICAO douteuse`
        : `${t.callsign} · relevé incohérent`,
      body: `${t.suspectJump}. Position refusée, piste tenue à l'estime. Incohérence du signal — aucune identité n'est mise en cause.`,
      acked: false,
    });
  }

  const raids = detectRaids(liveTracks);
  applyZoneAlerts(liveTracks, now, alerts);
  const raidsVivants = new Set(raids.map((r) => r.cle));
  for (const k of [...raidWarned]) {
    if (!raidsVivants.has(k)) raidWarned.delete(k);
  }
  for (const r of raids) {
    if (raidWarned.has(r.cle)) continue;
    raidWarned.add(r.cle);
    const injectedRaid = r.trackIds.every(
      (id) => liveTracks.find((t) => t.id === id)?.injected,
    );
    alerts.push({
      id: `al-raid-${r.cle}-${now}`,
      trackId: r.trackIds[0] ?? "",
      at: now,
      level: r.worst === "faible" ? "moderee" : r.worst,
      title: injectedRaid
        ? `EXERCICE · Raid · ${r.count} pistes ensemble`
        : `Raid · ${r.count} pistes ensemble`,
      body: `${r.count} pistes non amies volent ensemble près de ${r.lieu} : cap ${Math.round(r.cap)}°, ${Math.round(r.vitesseKmh)} km/h, ${r.leadCallsign} en tête. Mesuré sur les pistes reçues, rien n'est attribué. ${injectedRaid ? "Exercice — pas un contact réel." : "Le poste n'émet pas."}`,
      acked: false,
      injected: injectedRaid,
    });
  }

  liveTracks = liveTracks.filter(
    (t) => t.idState !== "perdu" || now - t.lastUpdate < 8000,
  );
  pruneTracks();

  // Toute alerte née d'une piste d'exercice ou de rejeu le dit, et n'est jamais relayée.
  const injectees = new Set(liveTracks.filter((t) => t.injected).map((t) => t.id));
  for (const a of alerts) {
    if (!a.trackId || !injectees.has(a.trackId)) continue;
    a.injected = true;
    if (!/^(EXERCICE|REJEU)/.test(a.title)) a.title = `EXERCICE · ${a.title}`;
  }
  const instruction = rejeuRun !== null || liveTracks.some((t) => t.feed === "exercice");
  if (instruction !== useVigilair.getState().instruction) useVigilair.setState({ instruction });

  if (alerts.length > 0) {
    const prev = useVigilair.getState().alerts;
    useVigilair.setState({
      alerts: [...alerts, ...prev].slice(0, 40),
    });
  }
}

export function bootVigilair() {
  if (typeof window === "undefined") return;
  if (!useVigilair.getState().instruction) {
    liveTracks = liveTracks.filter((t) => t.feed === "adsb");
    rejeuRun = null;
  }
  if (useVigilair.getState().now === 0) {
    const now = Date.now();
    pushSnap(now);
    useVigilair.setState({
      tracks: liveTracks,
      journal: loadJournal(),
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
    if (st.running && st.clockMode === "live") veiller();
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

export function trackVisible(t: Track, selectedId?: string | null): boolean {
  const s = useVigilair.getState();
  return passesPaintFilter(t, {
    showFriends: s.showFriends,
    showLive: s.showLive,
    threatFloor: s.threatFloor,
    declutter: s.declutter,
    poste: s.livePicture?.antenne,
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


/**
 * Verrou automatique : sans choix de l'opérateur (ou si sa piste a disparu), la sélection suit la
 * piste réelle prioritaire (voir auto-lock.ts). La caméra ne bouge pas : le panneau montre les
 * données, la veille de FTTJ reste à l'écran.
 */
function applyAutoLock(now: number) {
  const s = useVigilair.getState();
  if (!s.autoLockOn || s.clockMode === "replay") return;
  const sel = s.selectedId;
  const auto = s.autoPick && s.autoPick.id === sel ? s.autoPick : null;
  if (sel && !auto && liveTracks.some((t) => t.id === sel)) return;
  const pick = autoLockPick(liveTracks, now, auto);
  if (!pick) {
    if (auto || sel) useVigilair.setState({ autoPick: null, selectedId: null });
    return;
  }
  if (pick.id !== sel || pick.reason !== s.autoPick?.reason) {
    useVigilair.setState({ autoPick: pick, selectedId: pick.id });
  }
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
  // Jour/nuit à FTTJ connu : réévalue la bascule auto d'imagerie (IR en vue large, Nuit la nuit).
  useVigilair.getState().applyAutoLayer();
  for (const p of pic.phenomena ?? []) {
    if (p.kind === "feu") lockFire(p.id, Date.now());
  }
  if (useVigilair.getState().clockMode === "replay") return;
  const now = Date.now();
  const { tracks, born, emergencies } = mergeLiveTracks(liveTracks, pic.aircraft, now);
  liveTracks = tracks;
  // CPA SITE SUR LE TRAFIC RÉEL. Il n'était calculé que par la simulation : sur une piste 1090ES
  // réelle il restait nul, donc l'alerte « approche d'un site protégé » ne pouvait jamais partir —
  // exactement sur les pistes qui comptent. On le calcule ici, après la fusion, là où les zones
  // vivantes sont connues.
  for (const t of liveTracks) {
    if (t.feed === "adsb") t.cpa = cpaSite(t);
  }
  // NOS drones : une piste 1090ES à l'adresse d'un drone inscrit n'est AMIE (friendKind "drone",
  // que isFriend exclut des intrusions) qu'une fois confirmée par le chef — une adresse se copie.
  // D'ici là elle garde sa pleine évaluation, et le poste la recoupe avec la télémétrie du drone.
  const drones = dronesPeek();
  const constats = new Map<string, ReturnType<typeof constat1090>>();
  for (const t of liveTracks) {
    if (t.feed !== "adsb") continue;
    const hit = matchOwnDrone(drones, t.id.slice(5), t.callsign);
    if (hit) {
      const c = constat1090(hit, t, hit.liaison ? (telemetriePour(hit.id, now)?.position ?? null) : null, now);
      constats.set(t.id, c);
      t.friendKind = c.ami ? "drone" : undefined;
      t.ownDrone = hit.name;
    } else if (t.ownDrone) {
      // Drone retiré du registre entre deux relevés : on rend sa pleine évaluation.
      t.friendKind = undefined;
      t.ownDrone = undefined;
    }
  }
  const alerts: AlertItem[] = [];
  for (const tr of emergencies) {
    alerts.push({
      id: `al-emg-${tr.id}-${now}`,
      trackId: tr.id,
      at: now,
      level: "critique",
      title: `${tr.callsign} · ${tr.emergency}`,
      body: `Squawk d'urgence 1090ES live. ${tr.icaoType ?? ""} ${tr.reg ?? ""} · AfriControl n'émet pas.`.trim(),
      acked: false,
    });
  }
  for (const tr of born) {
    const d = haversineKm(tr.lat, tr.lon, AO.centerLat, AO.centerLon);
    const drone = droneDeclare(tr);
    if (constats.has(tr.id)) {
      // Piste à l'adresse d'un de nos drones : son alerte est dite plus bas, à chaque constat.
    } else if (drone) {
      // Un drone qui se déclare : catégorie B6, ou un des autres modèles reconnus à leur type OACI.
      alerts.push({
        id: `al-uav-${tr.id}`,
        trackId: tr.id,
        at: now,
        level: "elevee",
        title: `${tr.callsign} · UAS ADS-B (${drone.par === "B6" ? "B6" : drone.type})`,
        body: `UAV réel sur 1090ES — ${libelleDrone(drone)}${tr.reg ? ` · ${tr.reg}` : ""} · ${Math.round(d)} km de FTTJ.`,
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
  // Drones ENTENDUS SANS POSITION (Mode S seul, voir drones-entendus.ts) : reconnus à leur
  // catégorie B6 ou à leur seul type, dits une fois par session quand ce qu'on sait d'eux les place
  // au-dessus de l'Afrique ou du Moyen-Orient. Pas de capture : sans position, la caméra n'a pas
  // où aller. Leur piste aura cet identifiant le jour où une position arrivera.
  for (const de of pic.dronesEntendus?.rows ?? []) {
    if (!de.region || entendusDits.has(de.hex)) continue;
    entendusDits.add(de.hex);
    alerts.push({
      id: `al-uav-entendu-${de.hex}`,
      trackId: `live-${de.hex}`,
      at: now,
      level: "elevee",
      title: `${de.indicatif ?? de.hex.toUpperCase()} · UAS entendu sans position (${de.drone.par === "B6" ? "B6" : de.drone.type})`,
      body: `Mode S seul — ${libelleDrone(de.drone)}${de.registre ? ` · ${de.registre}` : ""} · ${ouLibelle(de)}.`,
      acked: false,
    });
  }
  // Piste 1090ES à l'adresse d'un de nos drones : dite quand le constat apparaît, et redite s'il
  // change de niveau (confirmée par le chef ; adresse copiée découverte quand la télémétrie arrive).
  // Élevée ou critique, elle est relayée au chef (Telegram / Signal) par le relais d'alertes.
  for (const [id, constat] of constats) {
    const alerte = `al-owndrone-${id}-${constat.niveau}`;
    if (useVigilair.getState().alerts.some((a) => a.id === alerte)) continue;
    alerts.push({
      id: alerte,
      trackId: id,
      at: now,
      level: constat.niveau,
      title: constat.titre,
      body: constat.corps,
      acked: false,
    });
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
    // graphiques sans sonner. Les feux FIRMS sonnent sur le théâtre élargi (Tchad, Darfour, AES) ;
    // au-delà (Sahel large, monde) ils restent muets : en saison sèche il y en a des dizaines par
    // jour, ils noieraient les alertes drone et intrusion.
    // EXCEPTION : un phénomène près d'un SITE SURVEILLÉ (minier intégré OU ajouté par l'opérateur)
    // sonne toujours, où qu'il soit sur le continent. Crue / séisme / volcan : rayon large (200 km,
    // impact régional). Feu : rayon serré (40 km) pour alerter dès qu'un foyer touche le périmètre
    // sans sonner sur chaque feu de brousse du Sahel à 150 km.
    const nm = nearestWatchSite(p.lat, p.lon);
    // Rayon d'alerte : propre au site s'il est réglé, sinon défaut par nature (feu serré, reste large).
    const nearRadiusKm = nm?.site.alertKm ?? (p.kind === "feu" ? 40 : 200);
    const nearMine = nm != null && nm.distKm <= nearRadiusKm;
    if (rank < 3 && !nearMine) continue;
    phenomWarned.add(p.id);
    // Feu : corps enrichi — foyers groupés, FRP, confiance, jour/nuit, ville la plus proche —
    // en gardant la vérité du capteur (pixel 375 m : un foyer, pas l'image d'une voiture).
    const mineTag = nearMine && nm ? ` · près de ${nm.site.short} (${Math.round(nm.distKm)} km)` : "";
    let body = `${p.body}${mineTag} · ouvrir capture 10 m`;
    let title = p.title;
    if (p.kind === "feu" && p.fire) {
      const city = nearestCity(p.lat, p.lon);
      const foyers = p.fire.count > 1 ? `${p.fire.count} foyers groupés · ` : "";
      title = `Feu ${p.title.replace(/^Point chaud /, "")} · ${p.fire.frp.toFixed(0)} MW`;
      body = `${foyers}${p.body} · ${city.name} à ${Math.round(city.distKm)} km${mineTag} · ouvrir capture 10 m`;
    }
    alerts.push({
      id: `al-nat-${p.id}`,
      trackId: "",
      at: now,
      level: p.level,
      title,
      body,
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
  applyAutoLock(now);
  // La caméra part seule pour un drone né au-dessus de l'Afrique ou du Moyen-Orient, Tchad compris
  // (ordre du chef), qu'il se déclare par la catégorie B6 ou par un type OACI de drone ; une fois
  // par drone et par session de la console, jamais pour un des nôtres confirmé. Le théâtre le plus
  // proche passe d'abord : un drone au-dessus du Tchad reprend la caméra à la capture automatique
  // d'un drone plus lointain ; une scène ouverte à la main reste à l'opérateur. Ailleurs, l'alerte
  // part et la capture attend le clic.
  const aCapturer = droneACapturer(
    born,
    (id) => constats.get(id)?.ami === true || capturesAuto.has(id),
  );
  const stNow = useVigilair.getState();
  const holdCamera = Boolean(stNow.lakeRouteId || stNow.mineId || stNow.waterId);
  if (aCapturer) {
    // Chaque drone capturé seul a son dossier scellé, le cliché du lieu en tête. Né pendant une
    // scène que la caméra garde, il est capturé EN APPUI : la scène ouverte reste à l'écran, la
    // sienne s'ajoute aux captures. Avant, il ne gardait que son alerte (vu en réel le 23 novembre
    // 2026 : un drone au-dessus du Qatar, né pendant la scène de BOOSTER au-dessus d'Israël).
    const { piste, drone, lieu, rang } = aCapturer;
    capturesAuto.add(piste.id);
    const scene = {
      lat: piste.lat,
      lon: piste.lon,
      kind: "uav" as const,
      title: `${piste.callsign} · UAV 10 m`,
      body: `Capture visible ≤ 10 m · ${libelleDrone(drone)} · ${lieu.pays}${lieu.km > 0 ? `, à ${Math.round(lieu.km)} km de sa côte` : ""}`,
      source: "1090ES",
      id: `${PREFIXE_CAPTURE_DRONE}${piste.id}`,
    };
    const ouverte = stNow.capture;
    const libre = cameraLibre(ouverte, rang);
    if (libre) stNow.openCapture({ ...scene, holdCamera });
    else stNow.captureEnAppui(scene);
    stNow.fileBulletin(piste.id, {
      cliche: true,
      contexte:
        !libre && ouverte
          ? `capture en appui, la scène « ${ouverte.title} » étant ouverte`
          : "capture automatique",
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
