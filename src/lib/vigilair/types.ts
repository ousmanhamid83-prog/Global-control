export type Origin = "CN" | "TR" | "RU" | "IR" | "XX";

/** fatl / asecna : affiliation amie ; civil : trafic 1090ES coopératif hors zone ASECNA (neutre). */
export type FriendKind = "fatl" | "asecna" | "civil";

export type IffMode = "3/A" | "S" | "ADS-B" | "4";

export type IffM4State = "absent" | "valid" | "invalid" | "timeout" | "demande";

export type ModeSDf =
  | "DF0"
  | "DF4"
  | "DF5"
  | "DF11"
  | "DF16"
  | "DF17"
  | "DF20"
  | "DF21";

export type ModeSSurveillance = "none" | "els" | "ehs" | "adsb";

export type ModeSReply = {
  id: string;
  df: ModeSDf;
  label: string;
  icao24: string;
  at: number;
  siteId: string;
  siteName: string;
  bds: string | null;
  payload: string;
  solicited: boolean;
};

export type MlatFix = {
  lat: number;
  lon: number;
  quality: number;
  nSites: number;
  sites: string[];
  residualKm: number;
  adsbDeltaKm: number | null;
  spoofSuspect: boolean;
  at: number;
  note: string;
};

export type IffFix = {
  mode: IffMode;
  squawk: string;
  icao24: string | null;
  flightId: string;
  source: "iff-fatl" | "adsb-asecna" | "iff-ssr";
  /** Mode 4 crypto — réponse à un interrogateur externe, pas une émission VIGILAIR. */
  m4: IffM4State;
  m4At: number | null;
  m4Site: string | null;
  m4Note: string;
  /** Couche Mode S (ELS / EHS / ADS-B). Absent = pas de transpondeur 1090. */
  surveillance?: ModeSSurveillance;
  replies?: ModeSReply[];
  mlat?: MlatFix | null;
  /** Position revendiquée par DF17 — pour détecter une usurpation ADS-B. */
  adsbClaim?: { lat: number; lon: number } | null;
  lastReplyAt?: number | null;
};


export type UasClass =
  | "multirotor"
  | "fixed-wing"
  | "vtol"
  | "loitering"
  | "male"
  | "ucav"
  | "chasse";

export type Role =
  | "consumer"
  | "enterprise-isr"
  | "agriculture"
  | "logistics"
  | "isr"
  | "strike"
  | "loitering-munition"
  | "mothership"
  | "fighter"
  | "trainer"
  | "rotary"
  | "airliner"
  | "transport";

export type Threat = "faible" | "moderee" | "elevee" | "critique";

export type IdState =
  | "detecte"
  | "classification"
  | "candidat"
  | "confirme"
  | "hors-mandat"
  | "perdu";

export type SensorKind = "rf" | "radar" | "eoir" | "acoustic";

export type AudioChannel = "acoustic" | "analog-fpv" | "blocked-crypto" | "none";

export type AcousticBearing = {
  siteId: string;
  deg: number;
  quality: number;
};

export type AcousticState = {
  snrDb: number;
  bpfHz: number;
  harmonics: [number, number, number];
  bearings: AcousticBearing[];
  channel: AudioChannel;
  channelNote: string;
  splDb: number;
  locked: boolean;
};

export type PilotFix = {
  lat: number;
  lon: number;
  quality: number;
  method: string;
};

export type SiteCpa = {
  siteId: string;
  name: string;
  distKm: number;
  etaS: number | null;
  closing: boolean;
};

export type ProtectedSite = {
  id: string;
  name: string;
  kind: "aerodrome" | "palais" | "camp" | "pont" | "ministere";
  lat: number;
  lon: number;
  radiusKm: number;
};

export type AudioClip = {
  id: string;
  at: number;
  trackId: string;
  callsign: string;
  bpfHz: number;
  channel: AudioChannel;
  durationS: number;
  note: string;
};

export type TraceFix = {
  lat: number;
  lon: number;
  at: number;
  quality: number;
  method: string;
  predicted: boolean;
};

export type SigintStream = {
  id: string;
  label: string;
  state: "lock" | "scan" | "denied";
  detail: string;
};

export type EvidencePack = {
  satScene: string;
  satCredit: string;
  sarNote: string;
  sceneNote: string;
  launch: TraceFix;
  stop: TraceFix;
  c2: PilotFix | null;
  path: { lat: number; lon: number }[];
  sensors: SensorKind[];
  method: string;
  launchTile: string;
  c2Tile: string | null;
  stopTile: string;
};

export type DefensePosture = "veille" | "alerte" | "menace";

export type EwState = "idle" | "demande" | "effet" | "refuse";

export type EwRequest = {
  state: EwState;
  at: number;
  note: string;
};

export type Platform = {
  id: string;
  name: string;
  manufacturer: string;
  origin: Origin;
  originLabel: string;
  uasClass: UasClass;
  role: Role;
  threat: Threat;
  massKg: number;
  enduranceMin: number;
  rangeKm: number;
  ceilingM: number;
  cruiseKmh: number;
  maxKmh: number;
  rfBands: string[];
  protocol: string;
  remoteId: boolean;
  payload: string;
  cues: {
    rf: string;
    visual: string;
    kinematic: string;
    acoustic: string;
  };
  notes: string;
  /** Présent uniquement sur les fiches de la couche amis. */
  friendKind?: FriendKind;
};

export type Hypothesis = {
  platformId: string;
  score: number;
};

export type Track = {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  speedKmh: number;
  climbMs: number;
  trail: { lat: number; lon: number }[];
  truePlatformId: string;
  idState: IdState;
  confidence: number;
  origin: Origin | null;
  classGuess: UasClass | null;
  hypotheses: Hypothesis[];
  sensors: SensorKind[];
  firstSeen: number;
  lastUpdate: number;
  dwellS: number;
  confirmedAt: number | null;
  motion: "transit" | "loiter" | "ingress";
  loiterCx: number;
  loiterCy: number;
  loiterR: number;
  turnRate: number;
  acoustic: AcousticState | null;
  pilotFix: PilotFix | null;
  cpa: SiteCpa | null;
  siteWarned: boolean;
  launchFix: TraceFix | null;
  stopFix: TraceFix | null;
  locked: boolean;
  corridor: string | null;
  ew: EwRequest | null;
  /** Piste créée par un inject de formation (AAR). */
  injected?: boolean;
  /** FATL / ASECNA — affiliation amie, distincte de l'origine constructeur. */
  friendKind?: FriendKind;
  iff?: IffFix | null;
  /** Origine de la piste : sim COP, 1090ES live, ou Remote ID. */
  feed?: "sim" | "adsb" | "rid";
  icaoType?: string | null;
  reg?: string | null;
  emergency?: string | null;
  rssi?: number | null;
  /** Navigation Integrity Category (ADS-B). Bas = GNSS dégradé / jamming. */
  nic?: number | null;
  nacp?: number | null;
  military?: boolean;
  category?: string | null;
  /** Nationalité ICAO24 (allocation OACI, pas une simulation). */
  nation?: string | null;
};

export type SensorSite = {
  id: string;
  name: string;
  kind: SensorKind;
  lat: number;
  lon: number;
  rangeKm: number;
  online: boolean;
};

export type AlertItem = {
  id: string;
  trackId: string;
  at: number;
  level: Threat;
  title: string;
  body: string;
  acked: boolean;
  /** sigint = écoute passive. Les autres alertes n'ont pas de domaine. */
  domain?: "sigint";
  /** Ne pas relayer Telegram / Signal (inject de formation). */
  injected?: boolean;
  lat?: number;
  lon?: number;
};

export type JournalEntry = {
  id: string;
  at: number;
  trackId: string;
  callsign: string;
  platformId: string;
  origin: Origin;
  confidence: number;
  lat: number;
  lon: number;
  altM: number;
  sensors: SensorKind[];
  method: string;
  launchLat?: number;
  launchLon?: number;
  stopLat?: number;
  stopLon?: number;
  c2Lat?: number;
  c2Lon?: number;
  ewNote?: string;
  filedBy?: string;
  contentSha256?: string;
  prevSha256?: string | null;
  chainSha256?: string;
  pdfSha256?: string;
  injected?: boolean;
  pending?: boolean;
  fileError?: string;
};
