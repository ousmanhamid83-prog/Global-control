/** 1090ES dump1090 / readsb — fusion en pistes VIGILAIR. VIGILAIR n'émet pas. */

import type { Phenomenon } from "./capture";
import { PLATFORM_BY_ID } from "./catalog";
import { FRIEND_BY_ID } from "./catalog-friends";
import { AO, haversineKm } from "./geo";
import { M4_ABSENT_CIVIL } from "./iff";
import type { IffFix, ModeSReply, Track, UasClass } from "./types";

export const LIVE_CREDIT =
  "Capteurs réels · antenne 1090 du poste (dump1090) · 1090ES adsb.lol/readsb · METAR/TAF/SIGMET NOAA · GNSS NIC + NOAA SWPC · FTTJ AWC · registre adsbdb. Pas un radar primaire FATL. VIGILAIR n'émet pas.";

export type LiveAc = {
  hex: string;
  flight: string;
  lat: number;
  lon: number;
  altM: number;
  gsKmh: number;
  track: number;
  climbMs: number;
  squawk: string | null;
  icaoType: string | null;
  reg: string | null;
  rssi: number | null;
  emergency: string | null;
  seenS: number;
  onGround: boolean;
  category: string | null;
  nic: number | null;
  nacp: number | null;
  sil: number | null;
  military: boolean;
  /** « antenne » : entendu par le récepteur du poste ; sinon agrégateur réseau (adsb.fi / adsb.lol). */
  via?: "antenne" | "reseau";
};

export type SigmetRow = {
  fir: string;
  firName: string;
  hazard: string;
  qualifier: string | null;
  raw: string;
  coords: { lat: number; lon: number }[];
  validFrom: string | null;
  validTo: string | null;
  inAo: boolean;
};

export type JamCell = {
  lat: number;
  lon: number;
  n: number;
  bad: number;
  pct: number;
  level: "low" | "medium" | "high";
};

export type SourceHealth = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type LivePicture = {
  at: number;
  /** Heure du dernier relevé par liaison, quand elle diffère de `at` (antenne vs réseau en cache). */
  sourceAt?: Record<string, number>;
  source: string;
  aircraft: LiveAc[];
  localN: number;
  sahelN: number;
  emergencies: LiveAc[];
  metar: MetarRow[];
  taf: TafRow[];
  space: SpaceWx;
  sigmets: SigmetRow[];
  jam: JamCell[];
  airport: AirportRow | null;
  alerts: SwpcAlert[];
  solar: SolarDay;
  sources: SourceHealth[];
  errors: string[];
  phenomena: Phenomenon[];
};

export type MetarRow = {
  icao: string;
  name: string;
  raw: string;
  tempC: number | null;
  dewC: number | null;
  windDir: number | null;
  windKt: number | null;
  visM: number | null;
  qnh: number | null;
  wx: string | null;
  cat: string | null;
  lat: number | null;
  lon: number | null;
  obsAt: string | null;
};

export type TafRow = {
  icao: string;
  raw: string;
};

export type SpaceWx = {
  kp: number;
  kpTime: string | null;
  gScale: string;
  note: string;
  gpsWeek: number;
  gpsTowS: number;
  xrayClass: string;
  xrayFlux: number | null;
  xrayAt: string | null;
};

export type AirportRow = {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevM: number;
  rwy: string | null;
  rwyM: number | null;
  freqs: string | null;
  country: string | null;
};

export type SwpcAlert = {
  code: string;
  at: string | null;
  kind: string;
  title: string;
  impact: string | null;
};

export type SolarDay = {
  sunrise: string;
  sunset: string;
  civilBegin: string;
  civilEnd: string;
  dayLengthMin: number;
  nightOps: boolean;
};

export function isLiveFeed(t: { feed?: string | null }): boolean {
  return t.feed === "adsb";
}

export function countLive(tracks: Track[]): {
  n: number;
  local: number;
  emergency: number;
  military: number;
  uav: number;
} {
  let n = 0;
  let local = 0;
  let emergency = 0;
  let military = 0;
  let uav = 0;
  for (const t of tracks) {
    if (t.idState === "perdu" || t.feed !== "adsb") continue;
    n += 1;
    if (haversineKm(t.lat, t.lon, AO.centerLat, AO.centerLon) <= 120) local += 1;
    if (t.emergency) emergency += 1;
    if (t.military) military += 1;
    if (t.category?.toUpperCase() === "B6") uav += 1;
  }
  return { n, local, emergency, military, uav };
}

export function emergencyLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c === "7700" || c === "general") return "7700 urgence générale";
  if (c === "7600" || c === "nordo") return "7600 panne radio";
  if (c === "7500" || c === "unlawful") return "7500 intervention illicite";
  if (c === "lifeguard") return "lifeguard / médical";
  if (c === "minfuel") return "minfuel";
  if (c === "downed") return "downed";
  if (c === "none") return null;
  return code;
}

function squawkOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\D/g, "").slice(0, 4);
  return s.length === 4 ? s : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseDump1090(ac: unknown[]): LiveAc[] {
  const out: LiveAc[] = [];
  for (const row of ac) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const lat = num(r.lat);
    const lon = num(r.lon);
    if (lat == null || lon == null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const hex = String(r.hex ?? "").toLowerCase().replace(/^~/, "");
    if (!/^[0-9a-f]{6}$/.test(hex)) continue;
    const altBaro = r.alt_baro;
    const onGround = altBaro === "ground" || r.airground === "gnd";
    const altFt =
      num(altBaro) ??
      num(r.alt_geom) ??
      (onGround ? 0 : null);
    if (altFt == null) continue;
    const gsKt = num(r.gs) ?? num(r.tas) ?? 0;
    const track = num(r.track) ?? num(r.true_heading) ?? num(r.mag_heading) ?? 0;
    const roc = num(r.baro_rate) ?? num(r.geom_rate) ?? 0;
    const flight = String(r.flight ?? r.r ?? hex)
      .trim()
      .toUpperCase()
      .slice(0, 8);
    const sq = squawkOf(r.squawk);
    const emRaw =
      (typeof r.emergency === "string" && r.emergency !== "none" ? r.emergency : null) ??
      (sq === "7700" || sq === "7600" || sq === "7500" ? sq : null);
    const dbFlags = num(r.dbFlags) ?? 0;
    out.push({
      hex,
      flight: flight || hex.toUpperCase(),
      lat,
      lon,
      altM: onGround ? 0 : altFt * 0.3048,
      gsKmh: gsKt * 1.852,
      track: ((track % 360) + 360) % 360,
      climbMs: roc * 0.00508,
      squawk: sq,
      icaoType: typeof r.t === "string" && r.t ? r.t : null,
      reg: typeof r.r === "string" && r.r ? r.r : null,
      rssi: num(r.rssi),
      emergency: emergencyLabel(emRaw),
      seenS: num(r.seen_pos) ?? num(r.seen) ?? 0,
      onGround,
      category: typeof r.category === "string" ? r.category : null,
      nic: num(r.nic),
      nacp: num(r.nac_p) ?? num(r.nacp),
      sil: num(r.sil),
      military: dbFlags % 2 === 1 || r.military === true,
    });
  }
  return out;
}

const TYPE_MAP: { prefix: string; id: string }[] = [
  { prefix: "A38", id: "asecna-wide" },
  { prefix: "A35", id: "asecna-wide" },
  { prefix: "A33", id: "asecna-wide" },
  { prefix: "A34", id: "asecna-wide" },
  { prefix: "A30", id: "asecna-wide" },
  { prefix: "B77", id: "asecna-wide" },
  { prefix: "B78", id: "asecna-wide" },
  { prefix: "B74", id: "asecna-wide" },
  { prefix: "A31", id: "asecna-a320" },
  { prefix: "A32", id: "asecna-a320" },
  { prefix: "A20", id: "asecna-a320" },
  { prefix: "A21", id: "asecna-a320" },
  { prefix: "A19", id: "asecna-a320" },
  { prefix: "B73", id: "asecna-b737" },
  { prefix: "B38", id: "asecna-b737" },
  { prefix: "B39", id: "asecna-b737" },
  { prefix: "AT7", id: "asecna-atr72" },
  { prefix: "AT4", id: "asecna-atr72" },
  { prefix: "E17", id: "asecna-e190" },
  { prefix: "E19", id: "asecna-e190" },
  { prefix: "E29", id: "asecna-e190" },
  { prefix: "DH8", id: "asecna-atr72" },
  { prefix: "C13", id: "asecna-unk" },
  { prefix: "GLF", id: "asecna-biz" },
  { prefix: "CL6", id: "asecna-biz" },
  { prefix: "C56", id: "asecna-biz" },
  { prefix: "C68", id: "asecna-biz" },
  { prefix: "F2T", id: "asecna-biz" },
  { prefix: "E50", id: "asecna-biz" },
  { prefix: "E55", id: "asecna-biz" },
  { prefix: "PC1", id: "asecna-biz" },
  { prefix: "BE4", id: "asecna-biz" },
  { prefix: "C208", id: "asecna-unk" },
];

export function platformIdForType(t: string | null): string {
  if (!t) return "asecna-unk";
  const u = t.toUpperCase();
  for (const row of TYPE_MAP) {
    if (u.startsWith(row.prefix)) return row.id;
  }
  return "asecna-unk";
}

function mintLiveIff(ac: LiveAc, now: number): IffFix {
  const reply: ModeSReply = {
    id: `df17-${ac.hex}-${now}`,
    df: "DF17",
    label: "ADS-B squitter 1090ES",
    icao24: ac.hex.toUpperCase(),
    at: now,
    siteId: ac.via === "antenne" ? "antenne-1090" : "live-1090",
    siteName: ac.via === "antenne" ? "1090ES antenne du poste" : "1090ES réseau",
    bds: "0,5",
    payload: `${ac.lat.toFixed(4)} ${ac.lon.toFixed(4)} FL${Math.max(0, Math.round(ac.altM / 30.48))}`,
    solicited: false,
  };
  return {
    mode: "ADS-B",
    squawk: ac.squawk ?? "0000",
    icao24: ac.hex.toUpperCase(),
    flightId: ac.flight,
    source: "adsb-asecna",
    m4: "absent",
    m4At: null,
    m4Site: null,
    m4Note: M4_ABSENT_CIVIL,
    surveillance: "adsb",
    replies: [reply],
    mlat: null,
    adsbClaim: { lat: ac.lat, lon: ac.lon },
    lastReplyAt: now,
  };
}

function classFromCategory(cat: string | null): UasClass | null {
  if (!cat) return null;
  const c = cat.toUpperCase();
  if (c === "B6") return "fixed-wing";
  if (c === "A7") return "vtol";
  return null;
}

export function liveAcToTrack(ac: LiveAc, now: number, prev?: Track): Track {
  const uav = ac.category?.toUpperCase() === "B6";
  const platId = uav ? "adsb-uav" : platformIdForType(ac.icaoType);
  const plat =
    PLATFORM_BY_ID[platId] ?? FRIEND_BY_ID[platId] ?? FRIEND_BY_ID["asecna-unk"]!;
  const trail = prev
    ? [...prev.trail, { lat: ac.lat, lon: ac.lon }].slice(-80)
    : [{ lat: ac.lat, lon: ac.lon }];
  const dist = haversineKm(ac.lat, ac.lon, AO.centerLat, AO.centerLon);
  const corridor =
    dist <= 120
      ? "Volume ident FTTJ · 1090ES"
      : dist <= 2500
        ? "FIR Sahel / AES · 1090ES"
        : "1090ES hors théâtre";
  const catClass = classFromCategory(ac.category);
  return {
    id: `live-${ac.hex}`,
    callsign: ac.flight,
    lat: ac.lat,
    lon: ac.lon,
    altM: ac.altM,
    heading: ac.track,
    speedKmh: ac.gsKmh,
    climbMs: ac.climbMs,
    trail,
    truePlatformId: plat.id,
    idState: uav ? "candidat" : "confirme",
    confidence: uav ? 72 : 99,
    origin: uav ? "XX" : "XX",
    classGuess: catClass ?? plat.uasClass,
    hypotheses: [{ platformId: plat.id, score: uav ? 72 : 99 }],
    sensors: [],
    firstSeen: prev?.firstSeen ?? now,
    lastUpdate: now,
    dwellS: prev ? prev.dwellS + Math.max(0, (now - prev.lastUpdate) / 1000) : 0,
    confirmedAt: prev?.confirmedAt ?? (uav ? null : now),
    motion: ac.onGround ? "loiter" : "transit",
    loiterCx: ac.lat,
    loiterCy: ac.lon,
    loiterR: 0.02,
    turnRate: 0,
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: true,
    launchFix: prev?.launchFix ?? {
      lat: ac.lat,
      lon: ac.lon,
      at: now,
      quality: ac.nic != null ? Math.min(95, 40 + ac.nic * 5) : 90,
      method: "ADS-B 1090ES live",
      predicted: false,
    },
    stopFix: null,
    locked: prev?.locked ?? false,
    corridor,
    ew: null,
    friendKind: uav ? undefined : (plat.friendKind ?? "asecna"),
    iff: mintLiveIff(ac, now),
    feed: "adsb",
    icaoType: ac.icaoType,
    reg: ac.reg,
    emergency: ac.emergency,
    rssi: ac.rssi,
    nic: ac.nic,
    nacp: ac.nacp,
    military: ac.military,
    category: ac.category,
    nation: icaoNation(ac.hex),
  };
}

export function mergeLiveTracks(
  existing: Track[],
  incoming: LiveAc[],
  now: number,
): { tracks: Track[]; born: Track[]; emergencies: Track[] } {
  const prevByHex = new Map<string, Track>();
  for (const t of existing) {
    if (t.feed === "adsb") prevByHex.set(t.id.slice(5), t);
  }
  const seen = new Set<string>();
  const nextLive: Track[] = [];
  const born: Track[] = [];
  const emergencies: Track[] = [];
  for (const ac of incoming) {
    if (seen.has(ac.hex)) continue;
    seen.add(ac.hex);
    const prev = prevByHex.get(ac.hex);
    const t = liveAcToTrack(ac, now, prev);
    nextLive.push(t);
    if (!prev) born.push(t);
    if (t.emergency && (!prev || prev.emergency !== t.emergency)) emergencies.push(t);
  }
  const stale: Track[] = [];
  for (const [hex, t] of prevByHex) {
    if (seen.has(hex)) continue;
    if (now - t.lastUpdate < 45_000) {
      stale.push({ ...t, lastUpdate: t.lastUpdate });
    } else {
      stale.push({ ...t, idState: "perdu", lastUpdate: now });
    }
  }
  const rest = existing.filter((t) => t.feed !== "adsb");
  return {
    tracks: [...nextLive, ...stale.filter((t) => t.idState !== "perdu"), ...rest],
    born,
    emergencies,
  };
}

export function gpsTime(at = Date.now()): { week: number; towS: number } {
  const GPS_EPOCH = Date.UTC(1980, 0, 6, 0, 0, 0);
  const leapMs = 18_000;
  const gpsMs = at - GPS_EPOCH + leapMs;
  const week = Math.floor(gpsMs / 604_800_000);
  const towS = (gpsMs % 604_800_000) / 1000;
  return { week, towS };
}

/** Allocation OACI des adresses Mode S 24 bits — Annexe 10, pas une estimation. */
const ICAO_RANGES: [number, number, string][] = [
  [0x004000, 0x0043ff, "Zimbabwe"],
  [0x006000, 0x006fff, "Mozambique"],
  [0x008000, 0x00ffff, "Afrique du Sud"],
  [0x010000, 0x017fff, "Égypte"],
  [0x018000, 0x01ffff, "Libye"],
  [0x020000, 0x027fff, "Maroc"],
  [0x028000, 0x02ffff, "Tunisie"],
  [0x030000, 0x0303ff, "Botswana"],
  [0x032000, 0x032fff, "Burundi"],
  [0x034000, 0x034fff, "Cameroun"],
  [0x035000, 0x0353ff, "Comores"],
  [0x036000, 0x036fff, "Congo"],
  [0x038000, 0x038fff, "Côte d'Ivoire"],
  [0x03e000, 0x03efff, "Gabon"],
  [0x040000, 0x040fff, "Éthiopie"],
  [0x042000, 0x042fff, "Guinée équatoriale"],
  [0x044000, 0x044fff, "Ghana"],
  [0x046000, 0x046fff, "Guinée"],
  [0x048000, 0x0483ff, "Guinée-Bissau"],
  [0x04a000, 0x04a3ff, "Lesotho"],
  [0x04c000, 0x04cfff, "Kenya"],
  [0x050000, 0x050fff, "Liberia"],
  [0x054000, 0x054fff, "Madagascar"],
  [0x058000, 0x058fff, "Malawi"],
  [0x05c000, 0x05cfff, "Mali"],
  [0x05e000, 0x05e3ff, "Mauritanie"],
  [0x060000, 0x0603ff, "Maurice"],
  [0x062000, 0x062fff, "Niger"],
  [0x064000, 0x064fff, "Nigeria"],
  [0x068000, 0x068fff, "Ouganda"],
  [0x06a000, 0x06a3ff, "Qatar"],
  [0x06c000, 0x06cfff, "Centrafrique"],
  [0x06e000, 0x06efff, "Rwanda"],
  [0x070000, 0x070fff, "Sénégal"],
  [0x074000, 0x0743ff, "Seychelles"],
  [0x076000, 0x0763ff, "Sierra Leone"],
  [0x078000, 0x078fff, "Somalie"],
  [0x07a000, 0x07a3ff, "Eswatini"],
  [0x07c000, 0x07cfff, "Soudan"],
  [0x080000, 0x080fff, "Tanzanie"],
  [0x084000, 0x084fff, "Tchad"],
  [0x088000, 0x088fff, "Togo"],
  [0x08a000, 0x08afff, "Zambie"],
  [0x08c000, 0x08cfff, "RDC"],
  [0x090000, 0x090fff, "Angola"],
  [0x094000, 0x0943ff, "Bénin"],
  [0x096000, 0x0963ff, "Cap-Vert"],
  [0x098000, 0x0983ff, "Djibouti"],
  [0x09a000, 0x09afff, "Gambie"],
  [0x09c000, 0x09cfff, "Burkina Faso"],
  [0x09e000, 0x09e3ff, "São Tomé"],
  [0x0a0000, 0x0a7fff, "Algérie"],
  [0x0c0000, 0x0cffff, "Canada"],
  [0x0d0000, 0x0d7fff, "Mexique"],
  [0x0e0000, 0x0effff, "Amérique centrale"],
  [0x300000, 0x33ffff, "Italie"],
  [0x340000, 0x37ffff, "Espagne"],
  [0x380000, 0x3bffff, "France"],
  [0x3c0000, 0x3fffff, "Allemagne"],
  [0x400000, 0x43ffff, "Royaume-Uni"],
  [0x440000, 0x447fff, "Autriche"],
  [0x448000, 0x44ffff, "Belgique"],
  [0x450000, 0x457fff, "Bulgarie"],
  [0x458000, 0x45ffff, "Danemark"],
  [0x468000, 0x46ffff, "Finlande"],
  [0x470000, 0x477fff, "Grèce"],
  [0x478000, 0x47ffff, "Hongrie"],
  [0x480000, 0x487fff, "Norvège"],
  [0x488000, 0x48ffff, "Pays-Bas"],
  [0x490000, 0x497fff, "Pologne"],
  [0x498000, 0x49ffff, "Portugal"],
  [0x4a0000, 0x4a7fff, "Tchéquie"],
  [0x4a8000, 0x4affff, "Roumanie"],
  [0x4b0000, 0x4b7fff, "Suède"],
  [0x4b8000, 0x4bffff, "Suisse"],
  [0x4c8000, 0x4cffff, "Turquie"],
  [0x500000, 0x5003ff, "Saint-Marin"],
  [0x502000, 0x5023ff, "Irlande"],
  [0x600000, 0x6003ff, "Arménie"],
  [0x600800, 0x600bff, "Biélorussie"],
  [0x601000, 0x6013ff, "Géorgie"],
  [0x680000, 0x6803ff, "Azerbaïdjan"],
  [0x710000, 0x717fff, "Arabie saoudite"],
  [0x718000, 0x71ffff, "Corée du Sud"],
  [0x740000, 0x747fff, "Israël"],
  [0x750000, 0x77ffff, "Iran"],
  [0x780000, 0x7bffff, "Chine"],
  [0x7c0000, 0x7fffff, "Australie"],
  [0x800000, 0x83ffff, "Inde"],
  [0x840000, 0x87ffff, "Japon"],
  [0x880000, 0x887fff, "Thaïlande"],
  [0x888000, 0x88ffff, "VNM / KHM / LAO"],
  [0x890000, 0x890fff, "Liban"],
  [0x8a0000, 0x8a7fff, "Émirats"],
  [0x900000, 0x9fffff, "Océanie"],
  [0xa00000, 0xafffff, "États-Unis"],
  [0xc00000, 0xc3ffff, "Canada"],
  [0xc80000, 0xc87fff, "Nouvelle-Zélande"],
  [0xe00000, 0xe3ffff, "Argentine"],
  [0xe40000, 0xe7ffff, "Brésil"],
  [0xe80000, 0xe80fff, "Chili"],
  [0xf00000, 0xf07fff, "Fédération de Russie"],
];

export function icaoNation(hex: string): string | null {
  const n = parseInt(hex.replace(/[^0-9a-f]/gi, "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return null;
  let lo = 0;
  let hi = ICAO_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = ICAO_RANGES[mid]!;
    if (n < row[0]) hi = mid - 1;
    else if (n > row[1]) lo = mid + 1;
    else return row[2];
  }
  return null;
}

function watClock(minUtc: number): string {
  let m = Math.round(minUtc) + 60;
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hourAngle(latRad: number, decl: number, zenithDeg: number): number | null {
  const cosHa =
    Math.cos((zenithDeg * Math.PI) / 180) / (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl);
  if (cosHa <= -1 || cosHa >= 1) return null;
  return Math.acos(cosHa);
}

/** Lever / coucher / crépuscule civil FTTJ — NOAA Solar Calculator, WAT (UTC+1). */
export function solarFttj(at = Date.now()): SolarDay {
  const lat = 12.1337;
  const lon = 15.034;
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86_400_000;
  const gamma = (2 * Math.PI) / 365 * (doy - 1 + 12 / 24);
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latRad = (lat * Math.PI) / 180;
  const haRise = hourAngle(latRad, decl, 90.833) ?? 1.5;
  const haCivil = hourAngle(latRad, decl, 96) ?? haRise + 0.2;
  const sunrise = 720 - 4 * (lon + (haRise * 180) / Math.PI) - eqtime;
  const sunset = 720 - 4 * (lon - (haRise * 180) / Math.PI) - eqtime;
  const civilBegin = 720 - 4 * (lon + (haCivil * 180) / Math.PI) - eqtime;
  const civilEnd = 720 - 4 * (lon - (haCivil * 180) / Math.PI) - eqtime;
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  return {
    sunrise: watClock(sunrise),
    sunset: watClock(sunset),
    civilBegin: watClock(civilBegin),
    civilEnd: watClock(civilEnd),
    dayLengthMin: Math.max(0, Math.round(sunset - sunrise)),
    nightOps: nowMin < sunrise || nowMin > sunset,
  };
}

export function jamFromAircraft(ac: LiveAc[]): JamCell[] {
  const grid = new Map<string, { n: number; bad: number; lat: number; lon: number }>();
  for (const a of ac) {
    if (a.nic == null && a.nacp == null) continue;
    const gi = Math.round(a.lat / 2) * 2;
    const gj = Math.round(a.lon / 2) * 2;
    const k = `${gi}:${gj}`;
    const bad = (a.nic != null && a.nic < 5) || (a.nacp != null && a.nacp < 5);
    const g = grid.get(k) ?? { n: 0, bad: 0, lat: gi, lon: gj };
    g.n += 1;
    if (bad) g.bad += 1;
    grid.set(k, g);
  }
  const out: JamCell[] = [];
  for (const g of grid.values()) {
    if (g.n < 2) continue;
    const pct = (g.bad / g.n) * 100;
    const level: JamCell["level"] = pct > 10 ? "high" : pct >= 2 ? "medium" : "low";
    out.push({ lat: g.lat, lon: g.lon, n: g.n, bad: g.bad, pct, level });
  }
  return out.sort((a, b) => b.pct - a.pct).slice(0, 24);
}

export function xrayClassOf(flux: number | null): string {
  if (flux == null || flux <= 0) return "—";
  if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
  if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
  if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
  if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
  return `A${(flux / 1e-8).toFixed(1)}`;
}

export function nicLabel(nic: number | null): string {
  if (nic == null) return "—";
  if (nic >= 8) return `NIC ${nic} OK`;
  if (nic >= 5) return `NIC ${nic} moyen`;
  return `NIC ${nic} dégradé`;
}
