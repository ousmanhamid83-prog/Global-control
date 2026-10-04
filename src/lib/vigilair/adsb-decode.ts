/**
 * Décodeur Mode S / ADS-B 1090ES pour les trames brutes AVR (« *8D4840D6…; ») que dump1090 sert
 * sur son port 30002. VIGILAIR écoute seulement : il n'interroge pas et n'émet pas.
 *
 * Module autonome (aucun import à l'exécution) : il tourne côté serveur et sous `node --test`.
 * Références : DO-260B, et « The 1090 MHz Riddle » (J. Sun) pour les vecteurs de test.
 */

/** Générateur Mode S x^24 + … (0x1FFF409), sans le bit de tête. */
const POLY = 0xfff409;
const CPR_MAX = 131072; // 2^17
const CALLSIGN_CHARS =
  "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** CRC-24 Mode S des `n` premiers octets. */
export function crc24(bytes: Uint8Array, n: number): number {
  let crc = 0;
  for (let i = 0; i < n; i++) {
    crc ^= bytes[i]! << 16;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x800000 ? ((crc << 1) ^ POLY) & 0xffffff : (crc << 1) & 0xffffff;
    }
  }
  return crc;
}

/**
 * Syndrome : CRC des données XOR champ de parité. 0 pour un squitter DF17/18 intact ; l'adresse
 * OACI de l'avion pour les réponses DF0/4/5/16/20/21 (parité superposée à l'adresse).
 */
export function crcSyndrome(bytes: Uint8Array): number {
  const n = bytes.length;
  const parity = (bytes[n - 3]! << 16) | (bytes[n - 2]! << 8) | bytes[n - 1]!;
  return crc24(bytes, n - 3) ^ parity;
}

/** Bits `start` … `start + len - 1` (0 = bit de poids fort du premier octet). */
function bits(b: Uint8Array, start: number, len: number): number {
  let v = 0;
  for (let i = start; i < start + len; i++) v = v * 2 + ((b[i >> 3]! >> (7 - (i & 7))) & 1);
  return v;
}

const mod = (a: number, b: number) => a - b * Math.floor(a / b);
const hex6 = (n: number) => n.toString(16).padStart(6, "0");

/** Longueur attendue selon le format descendant : courte (56 bits) ou longue (112 bits). */
function expectedBytes(df: number): number {
  return df >= 16 ? 14 : 7;
}

export type AvrFrame = { hex: string; bytes: Uint8Array; df: number };

/**
 * Une ligne du port brut dump1090 : « *HEX; », ou « @TTTTTTTTTTTTHEX; » avec l'horodatage MLAT
 * 12 MHz devant. Tout le reste est ignoré.
 */
export function parseAvrLine(line: string): AvrFrame | null {
  const s = line.trim();
  if (s.length < 16 || !s.endsWith(";")) return null;
  let hex: string;
  if (s[0] === "*") hex = s.slice(1, -1);
  else if (s[0] === "@") hex = s.slice(13, -1);
  else return null;
  if (!/^[0-9A-Fa-f]+$/.test(hex) || (hex.length !== 14 && hex.length !== 28)) return null;
  const bytes = hexToBytes(hex);
  const df = bytes[0]! >> 3;
  if (bytes.length !== expectedBytes(df > 24 ? 24 : df)) return null;
  return { hex: hex.toUpperCase(), bytes, df };
}

/** Code d'identité 13 bits (C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4) → squawk à 4 chiffres. */
export function decodeId13(id: number): string {
  const bit = (k: number) => (id >> (12 - k)) & 1;
  const a = bit(5) * 4 + bit(3) * 2 + bit(1);
  const b = bit(11) * 4 + bit(9) * 2 + bit(7);
  const c = bit(4) * 4 + bit(2) * 2 + bit(0);
  const d = bit(12) * 4 + bit(10) * 2 + bit(8);
  return `${a}${b}${c}${d}`;
}

/** Code d'altitude 13 bits (DF0/4/16/20). Pas de 25 ft seulement ; Gillham et métrique → null. */
export function decodeAc13(ac: number): number | null {
  if (ac === 0) return null;
  const m = (ac >> 6) & 1;
  const q = (ac >> 4) & 1;
  if (m || !q) return null;
  const n = ((ac & 0x1f80) >> 2) | ((ac & 0x20) >> 1) | (ac & 0xf);
  return n * 25 - 1000;
}

/** Champ altitude 12 bits d'un squitter de position en vol (bit Q au 8e rang). */
function decodeAlt12(alt: number): number | null {
  if (alt === 0) return null;
  if (!((alt >> 4) & 1)) return null;
  const n = ((alt & 0xfe0) >> 1) | (alt & 0xf);
  return n * 25 - 1000;
}

/**
 * NIC déduit du type de position, sans le complément NIC (le plus prudent des deux quand le type
 * en admet deux). NIC < 5 : position GNSS douteuse, signe possible de brouillage.
 */
function nicOfTc(tc: number): number | null {
  const table: Record<number, number> = {
    5: 11, 6: 10, 7: 8, 8: 0,
    9: 11, 10: 10, 11: 8, 12: 7, 13: 6, 14: 5, 15: 4, 16: 2, 17: 1, 18: 0,
    20: 11, 21: 10, 22: 0,
  };
  return table[tc] ?? null;
}

const EMERGENCY = [null, "general", "lifeguard", "minfuel", "nordo", "unlawful", "downed", null];

/** Vitesse sol codée en « mouvement » sur 7 bits (squitter de surface), en nœuds. */
function decodeMovement(mov: number): number | null {
  if (mov === 0 || mov > 124) return null;
  if (mov === 1) return 0;
  if (mov <= 8) return 0.125 + (mov - 2) * 0.125;
  if (mov <= 12) return 1 + (mov - 9) * 0.25;
  if (mov <= 38) return 2 + (mov - 13) * 0.5;
  if (mov <= 93) return 15 + (mov - 39);
  if (mov <= 108) return 70 + (mov - 94) * 2;
  if (mov <= 123) return 100 + (mov - 109) * 5;
  return 175;
}

export type ModeSMsg =
  | { kind: "ident"; icao: string; df: number; callsign: string; category: string | null }
  | {
      kind: "pos";
      icao: string;
      df: number;
      tc: number;
      surface: boolean;
      odd: boolean;
      latCpr: number;
      lonCpr: number;
      altFt: number | null;
      gnssAlt: boolean;
      nic: number | null;
      gsKt: number | null;
      trackDeg: number | null;
    }
  | {
      kind: "vel";
      icao: string;
      df: number;
      gsKt: number | null;
      trackDeg: number | null;
      vrateFpm: number | null;
      airspeed: boolean;
    }
  | { kind: "status"; icao: string; df: number; emergency: string | null; squawk: string }
  | { kind: "alt"; icao: string; df: number; altFt: number | null }
  | { kind: "squawk"; icao: string; df: number; squawk: string }
  | { kind: "allcall"; icao: string; df: number }
  | { kind: "other"; icao: string; df: number; tc: number | null };

export type DecodeResult =
  | { ok: true; msg: ModeSMsg }
  | { ok: false; reason: "crc" | "adresse inconnue" | "format" };

/**
 * Décode une trame. `known` dit si une adresse a été entendue récemment en clair (DF11/17/18) :
 * sans elle, une réponse DF4/5/20/21 dont la parité donne une adresse jamais vue est un bruit.
 */
export function decodeFrame(f: AvrFrame, known: (icao: string) => boolean): DecodeResult {
  const b = f.bytes;
  const df = f.df;
  const syn = crcSyndrome(b);

  if (df === 17 || df === 18) {
    if (syn !== 0) return { ok: false, reason: "crc" };
    if (df === 18) {
      const cf = bits(b, 5, 3);
      // CF 0 : ADS-B d'un émetteur non transpondeur ; CF 6 : ADS-R. Les autres n'ont pas d'adresse OACI.
      if (cf !== 0 && cf !== 6) return { ok: true, msg: { kind: "other", icao: hex6(bits(b, 8, 24)), df, tc: null } };
    }
    const icao = hex6(bits(b, 8, 24));
    return { ok: true, msg: decodeExtendedSquitter(b, icao, df) };
  }

  if (df === 11) {
    if ((syn & 0xffff80) !== 0) return { ok: false, reason: "crc" };
    return { ok: true, msg: { kind: "allcall", icao: hex6(bits(b, 8, 24)), df } };
  }

  if (df === 0 || df === 4 || df === 5 || df === 16 || df === 20 || df === 21) {
    const icao = hex6(syn);
    if (!known(icao)) return { ok: false, reason: "adresse inconnue" };
    const field = bits(b, 19, 13);
    if (df === 5 || df === 21) return { ok: true, msg: { kind: "squawk", icao, df, squawk: decodeId13(field) } };
    return { ok: true, msg: { kind: "alt", icao, df, altFt: decodeAc13(field) } };
  }

  return { ok: false, reason: "format" };
}

function decodeExtendedSquitter(b: Uint8Array, icao: string, df: number): ModeSMsg {
  const tc = bits(b, 32, 5);

  if (tc >= 1 && tc <= 4) {
    let callsign = "";
    for (let i = 0; i < 8; i++) callsign += CALLSIGN_CHARS[bits(b, 40 + i * 6, 6)];
    const ca = bits(b, 37, 3);
    const set = "DCBA"[tc - 1]!;
    return {
      kind: "ident",
      icao,
      df,
      callsign: callsign.replace(/[#\s]+$/g, "").replace(/#/g, "").trim(),
      category: ca === 0 ? null : `${set}${ca}`,
    };
  }

  if (tc >= 5 && tc <= 8) {
    const mov = bits(b, 37, 7);
    const trkOk = bits(b, 44, 1) === 1;
    return {
      kind: "pos",
      icao,
      df,
      tc,
      surface: true,
      odd: bits(b, 53, 1) === 1,
      latCpr: bits(b, 54, 17),
      lonCpr: bits(b, 71, 17),
      altFt: 0,
      gnssAlt: false,
      nic: nicOfTc(tc),
      gsKt: decodeMovement(mov),
      trackDeg: trkOk ? (bits(b, 45, 7) * 360) / 128 : null,
    };
  }

  if ((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) {
    const alt = bits(b, 40, 12);
    const gnss = tc >= 20;
    return {
      kind: "pos",
      icao,
      df,
      tc,
      surface: false,
      odd: bits(b, 53, 1) === 1,
      latCpr: bits(b, 54, 17),
      lonCpr: bits(b, 71, 17),
      altFt: gnss ? (alt ? alt * 3.28084 : null) : decodeAlt12(alt),
      gnssAlt: gnss,
      nic: nicOfTc(tc),
      gsKt: null,
      trackDeg: null,
    };
  }

  if (tc === 19) {
    const st = bits(b, 37, 3);
    const sVr = bits(b, 68, 1);
    const vr = bits(b, 69, 9);
    const vrateFpm = vr === 0 ? null : (vr - 1) * 64 * (sVr ? -1 : 1);
    if (st === 1 || st === 2) {
      const k = st === 2 ? 4 : 1;
      const vEw = bits(b, 46, 10);
      const vNs = bits(b, 57, 10);
      if (vEw === 0 || vNs === 0) {
        return { kind: "vel", icao, df, gsKt: null, trackDeg: null, vrateFpm, airspeed: false };
      }
      const ew = (vEw - 1) * k * (bits(b, 45, 1) ? -1 : 1);
      const ns = (vNs - 1) * k * (bits(b, 56, 1) ? -1 : 1);
      const trackDeg = mod((Math.atan2(ew, ns) * 180) / Math.PI, 360);
      return { kind: "vel", icao, df, gsKt: Math.hypot(ew, ns), trackDeg, vrateFpm, airspeed: false };
    }
    if (st === 3 || st === 4) {
      const hdgOk = bits(b, 45, 1) === 1;
      const as = bits(b, 57, 10);
      return {
        kind: "vel",
        icao,
        df,
        gsKt: as === 0 ? null : (as - 1) * (st === 4 ? 4 : 1),
        trackDeg: hdgOk ? (bits(b, 46, 10) * 360) / 1024 : null,
        vrateFpm,
        airspeed: true,
      };
    }
    return { kind: "other", icao, df, tc };
  }

  if (tc === 28 && bits(b, 37, 3) === 1) {
    return {
      kind: "status",
      icao,
      df,
      emergency: EMERGENCY[bits(b, 40, 3)] ?? null,
      squawk: decodeId13(bits(b, 43, 13)),
    };
  }

  return { kind: "other", icao, df, tc };
}

/** Nombre de zones de longitude à une latitude donnée (NZ = 15). */
export function cprNL(lat: number): number {
  const a = Math.abs(lat);
  if (a < 1e-9) return 59;
  if (Math.abs(a - 87) < 1e-9) return 2;
  if (a > 87) return 1;
  const nz = 15;
  const x = 1 - (1 - Math.cos(Math.PI / (2 * nz))) / Math.cos((Math.PI / 180) * a) ** 2;
  return Math.floor((2 * Math.PI) / Math.acos(x));
}

/** Décodage global en vol : une trame paire et une impaire (moins de 10 s d'écart). */
export function cprGlobal(
  even: { lat: number; lon: number },
  odd: { lat: number; lon: number },
  oddNewer: boolean,
): { lat: number; lon: number } | null {
  const latE = even.lat / CPR_MAX;
  const lonE = even.lon / CPR_MAX;
  const latO = odd.lat / CPR_MAX;
  const lonO = odd.lon / CPR_MAX;
  const j = Math.floor(59 * latE - 60 * latO + 0.5);
  let rlatE = (360 / 60) * (mod(j, 60) + latE);
  let rlatO = (360 / 59) * (mod(j, 59) + latO);
  if (rlatE >= 270) rlatE -= 360;
  if (rlatO >= 270) rlatO -= 360;
  // Les deux trames doivent tomber dans la même bande de longitude, sinon on attend la suivante.
  if (cprNL(rlatE) !== cprNL(rlatO)) return null;
  const lat = oddNewer ? rlatO : rlatE;
  const nl = cprNL(lat);
  const ni = Math.max(nl - (oddNewer ? 1 : 0), 1);
  const m = Math.floor(lonE * (nl - 1) - lonO * nl + 0.5);
  let lon = (360 / ni) * (mod(m, ni) + (oddNewer ? lonO : lonE));
  if (lon >= 180) lon -= 360;
  return { lat, lon };
}

/**
 * Décodage local autour d'une position de référence : valable à moins de 180 NM en vol, 45 NM
 * au sol (zones de 90° au lieu de 360°).
 */
export function cprLocal(
  latCpr: number,
  lonCpr: number,
  odd: boolean,
  refLat: number,
  refLon: number,
  surface: boolean,
): { lat: number; lon: number } {
  const span = surface ? 90 : 360;
  const i = odd ? 1 : 0;
  const latC = latCpr / CPR_MAX;
  const lonC = lonCpr / CPR_MAX;
  const dLat = span / (60 - i);
  const j = Math.floor(refLat / dLat) + Math.floor(mod(refLat, dLat) / dLat - latC + 0.5);
  const lat = dLat * (j + latC);
  const ni = cprNL(lat) - i;
  const dLon = ni > 0 ? span / ni : span;
  const m = Math.floor(refLon / dLon) + Math.floor(mod(refLon, dLon) / dLon - lonC + 0.5);
  return { lat, lon: dLon * (m + lonC) };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

type Cpr = { lat: number; lon: number; at: number; surface: boolean };

export type RxAircraft = {
  hex: string;
  flight: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
  altFt: number | null;
  onGround: boolean;
  gsKt: number | null;
  trackDeg: number | null;
  vrateFpm: number | null;
  squawk: string | null;
  emergency: string | null;
  nic: number | null;
  posAt: number;
  /** Après une position rejetée : la suivante doit venir d'un décodage global. */
  resync: boolean;
  seenAt: number;
  msgs: number;
  even: Cpr | null;
  odd: Cpr | null;
};

export type RxFrameView = {
  at: number;
  raw: string;
  df: number;
  icao: string | null;
  ok: boolean;
  text: string;
};

export type RxStats = {
  lines: number;
  decoded: number;
  crc: number;
  unknownAddr: number;
  format: number;
  positions: number;
  rejectedPos: number;
};

/** Au-delà, aucune antenne au sol n'entend un avion : c'est un décodage faux, pas un contact. */
const MAX_RANGE_KM = 800;
/** Saut maximal admis entre deux positions : 0,35 km/s ≈ 680 kt, plus 2 km de marge. */
const MAX_KM_PER_S = 0.35;
export const RX_STALE_MS = 60_000;

/**
 * Table des avions entendus par l'antenne. Pas de filtre d'altitude ni de distance : seuls sont
 * écartés les trames à CRC faux, les adresses jamais entendues en clair et les positions
 * physiquement impossibles (saut, ou plus de 800 km de l'antenne).
 */
export class RxTable {
  readonly ac = new Map<string, RxAircraft>();
  readonly stats: RxStats = {
    lines: 0,
    decoded: 0,
    crc: 0,
    unknownAddr: 0,
    format: 0,
    positions: 0,
    rejectedPos: 0,
  };

  readonly ref: { lat: number; lon: number } | null;

  constructor(ref: { lat: number; lon: number } | null) {
    this.ref = ref;
  }

  private entry(icao: string, now: number): RxAircraft {
    let a = this.ac.get(icao);
    if (!a) {
      a = {
        hex: icao,
        flight: null,
        category: null,
        lat: null,
        lon: null,
        altFt: null,
        onGround: false,
        gsKt: null,
        trackDeg: null,
        vrateFpm: null,
        squawk: null,
        emergency: null,
        nic: null,
        posAt: 0,
        resync: false,
        seenAt: now,
        msgs: 0,
        even: null,
        odd: null,
      };
      this.ac.set(icao, a);
    }
    a.seenAt = now;
    a.msgs += 1;
    return a;
  }

  private known = (now: number) => (icao: string) => {
    const a = this.ac.get(icao);
    return a != null && now - a.seenAt < RX_STALE_MS;
  };

  /** Une ligne du port 30002. Retourne ce qui a été compris, pour l'écoute brute. */
  ingest(line: string, now: number): RxFrameView | null {
    const f = parseAvrLine(line);
    if (!f) return null;
    this.stats.lines += 1;
    const r = decodeFrame(f, this.known(now));
    if (!r.ok) {
      if (r.reason === "crc") this.stats.crc += 1;
      else if (r.reason === "adresse inconnue") this.stats.unknownAddr += 1;
      else this.stats.format += 1;
      return { at: now, raw: f.hex, df: f.df, icao: null, ok: false, text: `DF${f.df} · ${r.reason}` };
    }
    this.stats.decoded += 1;
    const m = r.msg;
    const a = this.entry(m.icao, now);
    return { at: now, raw: f.hex, df: f.df, icao: m.icao.toUpperCase(), ok: true, text: this.apply(a, m, now) };
  }

  private apply(a: RxAircraft, m: ModeSMsg, now: number): string {
    switch (m.kind) {
      case "ident":
        if (m.callsign) a.flight = m.callsign;
        if (m.category) a.category = m.category;
        return `identification ${m.callsign || "—"}${m.category ? ` · cat ${m.category}` : ""}`;
      case "pos":
        return this.position(a, m, now);
      case "vel":
        if (m.gsKt != null) a.gsKt = m.gsKt;
        if (m.trackDeg != null) a.trackDeg = m.trackDeg;
        if (m.vrateFpm != null) a.vrateFpm = m.vrateFpm;
        return `vitesse ${m.gsKt != null ? `${Math.round(m.gsKt)} kt${m.airspeed ? " air" : ""}` : "—"} · ${
          m.trackDeg != null ? `${Math.round(m.trackDeg)}°` : "—"
        }${m.vrateFpm != null ? ` · ${m.vrateFpm > 0 ? "+" : ""}${m.vrateFpm} ft/min` : ""}`;
      case "status":
        a.squawk = m.squawk;
        a.emergency = m.emergency;
        return `état · squawk ${m.squawk}${m.emergency ? ` · urgence ${m.emergency}` : ""}`;
      case "alt":
        if (m.altFt != null && !a.onGround) a.altFt = m.altFt;
        return `altitude ${m.altFt != null ? `${m.altFt} ft` : "non codée 25 ft"}`;
      case "squawk":
        a.squawk = m.squawk;
        return `squawk ${m.squawk}`;
      case "allcall":
        return "réponse all-call";
      default:
        return m.tc != null ? `squitter TC ${m.tc}` : `DF${m.df}`;
    }
  }

  private position(a: RxAircraft, m: Extract<ModeSMsg, { kind: "pos" }>, now: number): string {
    const cpr: Cpr = { lat: m.latCpr, lon: m.lonCpr, at: now, surface: m.surface };
    if (m.odd) a.odd = cpr;
    else a.even = cpr;
    if (m.altFt != null) a.altFt = m.altFt;
    if (m.nic != null) a.nic = m.nic;
    if (m.surface) {
      if (m.gsKt != null) a.gsKt = m.gsKt;
      if (m.trackDeg != null) a.trackDeg = m.trackDeg;
    }
    const recent = !a.resync && a.lat != null && a.lon != null && now - a.posAt < 30_000;
    let fix: { lat: number; lon: number } | null = null;
    if (m.surface) {
      const ref = recent ? { lat: a.lat!, lon: a.lon! } : this.ref;
      if (ref) fix = cprLocal(m.latCpr, m.lonCpr, m.odd, ref.lat, ref.lon, true);
    } else if (recent) {
      fix = cprLocal(m.latCpr, m.lonCpr, m.odd, a.lat!, a.lon!, false);
    } else if (a.even && a.odd && !a.even.surface && !a.odd.surface && Math.abs(a.even.at - a.odd.at) <= 10_000) {
      fix = cprGlobal(a.even, a.odd, m.odd);
    }
    const tag = `${m.surface ? "position sol" : "position"} ${m.odd ? "impaire" : "paire"}${
      m.altFt != null && !m.surface ? ` · ${Math.round(m.altFt)} ft${m.gnssAlt ? " GNSS" : ""}` : ""
    }${m.nic != null ? ` · NIC ${m.nic}` : ""}`;
    if (!fix) return `${tag} · en attente de la trame ${m.odd ? "paire" : "impaire"}`;
    const jumpKm = recent ? haversineKm(a.lat!, a.lon!, fix.lat, fix.lon) : 0;
    const maxKm = 2 + ((now - a.posAt) / 1000) * MAX_KM_PER_S;
    const far = this.ref ? haversineKm(this.ref.lat, this.ref.lon, fix.lat, fix.lon) > MAX_RANGE_KM : false;
    if ((recent && jumpKm > maxKm) || far) {
      this.stats.rejectedPos += 1;
      // La dernière bonne position reste affichée ; la suivante devra se recaler en global.
      a.resync = true;
      return `${tag} · rejetée (${far ? "hors portée physique" : `saut ${Math.round(jumpKm)} km`})`;
    }
    a.lat = fix.lat;
    a.lon = fix.lon;
    a.onGround = m.surface;
    if (m.surface) a.altFt = 0;
    a.posAt = now;
    a.resync = false;
    this.stats.positions += 1;
    return `${tag} · ${fix.lat.toFixed(4)} ${fix.lon.toFixed(4)}`;
  }

  /** Oublie les avions muets depuis plus d'une minute. */
  prune(now: number): void {
    for (const [k, a] of this.ac) if (now - a.seenAt > RX_STALE_MS) this.ac.delete(k);
  }

  /** Avions dont la dernière position a moins de `maxAgeMs` (une minute par défaut). */
  positioned(now: number, maxAgeMs = RX_STALE_MS): RxAircraft[] {
    return [...this.ac.values()].filter(
      (a) => a.lat != null && a.lon != null && now - a.posAt <= maxAgeMs && (a.altFt != null || a.onGround),
    );
  }
}
