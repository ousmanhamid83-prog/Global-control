/**
 * OpenDroneID — ASTM F3411-22a / ASD-STAN EN 4709-002.
 * Décodeur binaire réel (25 octets / message). VIGILAIR n'émet pas le broadcast.
 */

export const RID_NOTE =
  "Remote ID ASTM F3411 / ASD-STAN 4709. Trames Wi-Fi NAN / Bluetooth 4-5. VIGILAIR n'émet pas. Le navigateur n'écoute pas le 2,4 GHz : coller un dump hex terrain, ou lire les trames RID des UAS du COP qui broadcast.";

export const RID_SIZE = 25;
export const RID_VERSION = 2;

export type RidMsgType = 0 | 1 | 2 | 3 | 4 | 5;

export const RID_TYPE_LABEL: Record<RidMsgType, string> = {
  0: "Basic ID",
  1: "Location / Vector",
  2: "Authentication",
  3: "Self-ID",
  4: "System (opérateur)",
  5: "Operator ID",
};

export const UA_TYPE_LABEL = [
  "non déclaré",
  "avion",
  "hélicoptère / multirotor",
  "autogire",
  "hybride",
  "ornithoptère",
  "planeur",
  "cerf-volant",
  "ballon libre",
  "ballon captif",
  "dirigeable",
  "parachute",
  "fusée",
  "captif",
  "obstacle sol",
  "autre",
] as const;

export const ID_TYPE_LABEL = [
  "non déclaré",
  "n° série",
  "immat. CAA",
  "UUID UTM",
  "session spécifique",
] as const;

export const STATUS_LABEL = [
  "non déclaré",
  "sol",
  "en vol",
  "urgence",
  "panne RID",
] as const;

export type RidField = { k: string; v: string };

export type RidDecoded = {
  ok: boolean;
  type: RidMsgType | null;
  typeLabel: string;
  version: number;
  hex: string;
  fields: RidField[];
  error?: string;
};

function u8(b: Uint8Array, i: number) {
  return b[i] ?? 0;
}

function i32le(b: Uint8Array, i: number) {
  const x =
    u8(b, i) | (u8(b, i + 1) << 8) | (u8(b, i + 2) << 16) | (u8(b, i + 3) << 24);
  return x | 0;
}

function u16le(b: Uint8Array, i: number) {
  return u8(b, i) | (u8(b, i + 1) << 8);
}

function ascii(b: Uint8Array, start: number, n: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = u8(b, start + i);
    if (c === 0) break;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}

function putI32le(b: Uint8Array, i: number, v: number) {
  b[i] = v & 0xff;
  b[i + 1] = (v >> 8) & 0xff;
  b[i + 2] = (v >> 16) & 0xff;
  b[i + 3] = (v >> 24) & 0xff;
}

function putU16le(b: Uint8Array, i: number, v: number) {
  b[i] = v & 0xff;
  b[i + 1] = (v >> 8) & 0xff;
}

export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ").toUpperCase();
}

export function parseHexDump(raw: string): Uint8Array | null {
  const clean = raw
    .replace(/0x/gi, " ")
    .replace(/[^0-9a-fA-F]/g, " ")
    .trim();
  if (!clean) return null;
  const parts = clean.split(/\s+/).filter(Boolean);
  const bytes: number[] = [];
  if (parts.length === 1 && parts[0]!.length >= 10 && parts[0]!.length % 2 === 0) {
    const s = parts[0]!;
    for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
  } else {
    for (const p of parts) {
      if (p.length > 2) {
        for (let i = 0; i < p.length; i += 2) bytes.push(parseInt(p.slice(i, i + 2), 16));
      } else {
        bytes.push(parseInt(p, 16));
      }
    }
  }
  if (bytes.some((n) => Number.isNaN(n))) return null;
  return new Uint8Array(bytes);
}

export function decodeRidMessage(bytes: Uint8Array): RidDecoded {
  if (bytes.length < RID_SIZE) {
    return {
      ok: false,
      type: null,
      typeLabel: "—",
      version: 0,
      hex: bytesToHex(bytes),
      fields: [],
      error: `Trame trop courte (${bytes.length} o, attendu ${RID_SIZE}).`,
    };
  }
  const msg = bytes.subarray(0, RID_SIZE);
  const type = ((u8(msg, 0) >> 4) & 0xf) as RidMsgType;
  const version = u8(msg, 0) & 0xf;
  const hex = bytesToHex(msg);
  const typeLabel = RID_TYPE_LABEL[type] ?? `type ${type}`;
  const fields: RidField[] = [
    { k: "Version", v: String(version) },
    { k: "Type", v: typeLabel },
  ];

  if (type === 0) {
    const idType = u8(msg, 1) & 0xf;
    const uaType = (u8(msg, 1) >> 4) & 0xf;
    fields.push({ k: "ID type", v: ID_TYPE_LABEL[idType] ?? String(idType) });
    fields.push({ k: "UA type", v: UA_TYPE_LABEL[uaType] ?? String(uaType) });
    fields.push({ k: "UAS ID", v: ascii(msg, 2, 20) || "—" });
  } else if (type === 1) {
    const b1 = u8(msg, 1);
    const status = b1 & 0xf;
    const heightType = (b1 >> 5) & 1;
    const ew = (b1 >> 6) & 1;
    const speedMult = (b1 >> 7) & 1;
    let dir = u8(msg, 2);
    if (dir !== 361 && dir !== 0xff) dir = (dir + (ew ? 180 : 0)) % 360;
    const hs = u8(msg, 3) * (speedMult ? 0.75 : 0.25);
    const vs = (u8(msg, 4) << 24 >> 24) * 0.5;
    const lat = i32le(msg, 5) / 1e7;
    const lon = i32le(msg, 9) / 1e7;
    const altBaro = u16le(msg, 13) / 2 - 1000;
    const altGeo = u16le(msg, 15) / 2 - 1000;
    const height = u16le(msg, 17) / 2 - 1000;
    fields.push({ k: "Statut", v: STATUS_LABEL[status] ?? String(status) });
    fields.push({ k: "Latitude", v: lat.toFixed(6) });
    fields.push({ k: "Longitude", v: lon.toFixed(6) });
    fields.push({ k: "Cap", v: dir === 0xff ? "inconnu" : `${dir}°` });
    fields.push({ k: "Vh", v: `${hs.toFixed(1)} m/s` });
    fields.push({ k: "Vz", v: `${vs.toFixed(1)} m/s` });
    fields.push({ k: "Alt. baro", v: `${altBaro.toFixed(0)} m` });
    fields.push({ k: "Alt. géo", v: `${altGeo.toFixed(0)} m` });
    fields.push({ k: "Hauteur", v: `${height.toFixed(0)} m ${heightType ? "AGL" : "ATO"}` });
  } else if (type === 3) {
    fields.push({ k: "Desc. type", v: String(u8(msg, 1) & 0xf) });
    fields.push({ k: "Texte", v: ascii(msg, 2, 23) || "—" });
  } else if (type === 4) {
    const lat = i32le(msg, 2) / 1e7;
    const lon = i32le(msg, 6) / 1e7;
    fields.push({ k: "Opérateur lat", v: lat.toFixed(6) });
    fields.push({ k: "Opérateur lon", v: lon.toFixed(6) });
    fields.push({ k: "Classification", v: String(u8(msg, 1)) });
  } else if (type === 5) {
    fields.push({ k: "Operator ID type", v: String(u8(msg, 1) & 0xf) });
    fields.push({ k: "Operator ID", v: ascii(msg, 2, 20) || "—" });
  } else if (type === 2) {
    fields.push({ k: "Auth type", v: String(u8(msg, 1) & 0xf) });
    fields.push({ k: "Page", v: String(u8(msg, 2)) });
  } else {
    return {
      ok: false,
      type,
      typeLabel,
      version,
      hex,
      fields,
      error: `Type OpenDroneID ${type} non géré.`,
    };
  }

  return { ok: true, type, typeLabel, version, hex, fields };
}

export function decodeRidDump(raw: string): RidDecoded[] {
  const bytes = parseHexDump(raw);
  if (!bytes || bytes.length === 0) return [];
  const out: RidDecoded[] = [];
  if (bytes.length < RID_SIZE) {
    out.push(decodeRidMessage(bytes));
    return out;
  }
  for (let i = 0; i + RID_SIZE <= bytes.length; i += RID_SIZE) {
    out.push(decodeRidMessage(bytes.subarray(i, i + RID_SIZE)));
  }
  const rem = bytes.length % RID_SIZE;
  if (rem && bytes.length > RID_SIZE) {
    out.push(decodeRidMessage(bytes.subarray(bytes.length - rem)));
  }
  return out;
}

export function encodeBasicId(opts: {
  uasId: string;
  idType?: number;
  uaType?: number;
}): Uint8Array {
  const b = new Uint8Array(RID_SIZE);
  b[0] = (0 << 4) | RID_VERSION;
  b[1] = ((opts.uaType ?? 2) << 4) | (opts.idType ?? 1);
  const id = opts.uasId.slice(0, 20);
  for (let i = 0; i < id.length; i++) b[2 + i] = id.charCodeAt(i);
  return b;
}

export function encodeLocation(opts: {
  lat: number;
  lon: number;
  altM: number;
  speedMs: number;
  heading: number;
  status?: number;
}): Uint8Array {
  const b = new Uint8Array(RID_SIZE);
  b[0] = (1 << 4) | RID_VERSION;
  const heading = ((opts.heading % 360) + 360) % 360;
  const ew = heading >= 180 ? 1 : 0;
  const dir = Math.round(heading >= 180 ? heading - 180 : heading);
  const speedMult = opts.speedMs > 63.75 ? 1 : 0;
  const hs = Math.min(255, Math.round(opts.speedMs / (speedMult ? 0.75 : 0.25)));
  b[1] = (opts.status ?? 2) | (0 << 5) | (ew << 6) | (speedMult << 7);
  b[2] = dir;
  b[3] = hs;
  b[4] = 0;
  putI32le(b, 5, Math.round(opts.lat * 1e7));
  putI32le(b, 9, Math.round(opts.lon * 1e7));
  const encAlt = Math.max(0, Math.min(65535, Math.round((opts.altM + 1000) * 2)));
  putU16le(b, 13, encAlt);
  putU16le(b, 15, encAlt);
  putU16le(b, 17, Math.round((0 + 1000) * 2));
  return b;
}

export function encodeSelfId(text: string): Uint8Array {
  const b = new Uint8Array(RID_SIZE);
  b[0] = (3 << 4) | RID_VERSION;
  b[1] = 0;
  const t = text.slice(0, 23);
  for (let i = 0; i < t.length; i++) b[2 + i] = t.charCodeAt(i);
  return b;
}

export function packRidPack(msgs: Uint8Array[]): string {
  const all = new Uint8Array(msgs.length * RID_SIZE);
  msgs.forEach((m, i) => all.set(m.subarray(0, RID_SIZE), i * RID_SIZE));
  return bytesToHex(all);
}
