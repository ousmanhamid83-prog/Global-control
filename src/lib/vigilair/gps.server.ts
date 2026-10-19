/**
 * GPS du poste — CÔTÉ SERVEUR. Lit le NMEA d'un récepteur GPS branché sur le poste et en tire la
 * POSITION et l'HEURE UTC réelles. Lecture seule : le poste ne commande rien, n'émet rien.
 *
 *   AFRICONTROL_GPS=127.0.0.1:2947      flux NMEA en TCP (gpsd `gpspipe -r`, ser2net, device réseau)
 *   AFRICONTROL_GPS=/dev/ttyUSB0        récepteur USB/série (Linux/macOS) — baud via AFRICONTROL_GPS_BAUD (défaut 9600)
 *   AFRICONTROL_GPS=off                 coupe la liaison (défaut : non réglée = coupée)
 *
 * L'antenne satellite/GPS seule ne suffit pas : il faut un RÉCEPTEUR (clé USB GPS, module u-blox,
 * ou le terminal qui sort la trame NMEA). Le navigateur ne voit que la position/heure, jamais le flux.
 */

import net from "node:net";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { env } from "@/lib/env.server";

const SILENT_MS = 15_000;
const FIX_MAX_AGE_MS = 15_000;

export type GpsFix = {
  lat: number;
  lon: number;
  altM: number | null;
  sats: number | null;
  hdop: number | null;
  utc: string | null; // ISO 8601 si date+heure connues, sinon hh:mm:ss
  at: number;
};

type GpsState = {
  enabled: boolean;
  kind: "tcp" | "serial";
  source: string;
  host: string;
  port: number;
  baud: number;
  sock: net.Socket | null;
  stream: fs.ReadStream | null;
  connected: boolean;
  lastLineAt: number | null;
  lastError: string | null;
  retryMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  buf: string;
  fix: GpsFix | null;
  lastDate: string | null; // ddmmyy du RMC, pour composer un ISO complet
};

function parseConfig(raw: string | undefined, baudRaw: string | undefined) {
  const v = (raw ?? "").trim();
  const baud = Number(baudRaw) > 0 ? Math.trunc(Number(baudRaw)) : 9600;
  if (!v || /^(off|non|0|false|aucun)$/i.test(v)) {
    return { enabled: false, kind: "tcp" as const, source: "", host: "", port: 0, baud };
  }
  // Device série : chemin POSIX ou port COM Windows.
  if (v.startsWith("/") || /^com\d+$/i.test(v)) {
    return { enabled: true, kind: "serial" as const, source: v, host: "", port: 0, baud };
  }
  const m = v.replace(/^tcp:/i, "").match(/^\[?([^\]]+?)\]?(?::(\d{1,5}))?$/);
  const host = m?.[1] ?? "127.0.0.1";
  const port = Number(m?.[2] ?? 2947);
  return { enabled: true, kind: "tcp" as const, source: `${host}:${port}`, host, port: port > 0 && port < 65536 ? port : 2947, baud };
}

const g = globalThis as unknown as { __africontrolGps?: GpsState };

function state(): GpsState {
  if (g.__africontrolGps) return g.__africontrolGps;
  const cfg = parseConfig(env("AFRICONTROL_GPS") ?? env("VIGILAIR_GPS"), env("AFRICONTROL_GPS_BAUD"));
  const st: GpsState = {
    ...cfg,
    sock: null,
    stream: null,
    connected: false,
    lastLineAt: null,
    lastError: null,
    retryMs: 2000,
    timer: null,
    buf: "",
    fix: null,
    lastDate: null,
  };
  g.__africontrolGps = st;
  if (st.enabled) connect(st);
  return st;
}

/** ddmm.mmmm (NMEA) → degrés décimaux signés. */
function nmeaCoord(v: string, hemi: string): number | null {
  if (!v) return null;
  const dot = v.indexOf(".");
  if (dot < 3) return null;
  const deg = Number(v.slice(0, dot - 2));
  const min = Number(v.slice(dot - 2));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  let d = deg + min / 60;
  if (hemi === "S" || hemi === "W") d = -d;
  return d;
}

/** hhmmss(.ss) + ddmmyy → ISO 8601 UTC, ou hh:mm:ss si la date manque. */
function nmeaTime(t: string, date: string | null): string | null {
  if (!t || t.length < 6) return null;
  const hh = t.slice(0, 2), mm = t.slice(2, 4), ss = t.slice(4, 6);
  if (date && date.length === 6) {
    const dd = date.slice(0, 2), mo = date.slice(2, 4), yy = date.slice(4, 6);
    return `20${yy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`;
  }
  return `${hh}:${mm}:${ss}`;
}

function checksumOk(line: string): boolean {
  const star = line.lastIndexOf("*");
  if (star < 0) return true; // certains flux n'ont pas de checksum : on ne rejette pas
  const body = line.slice(1, star);
  const want = parseInt(line.slice(star + 1, star + 3), 16);
  if (!Number.isFinite(want)) return true;
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return c === want;
}

function onLine(st: GpsState, raw: string) {
  const line = raw.trim();
  if (!line.startsWith("$") || !checksumOk(line)) return;
  const f = line.replace(/\*[0-9A-Fa-f]{2}$/, "").split(",");
  const type = f[0]!.slice(3); // GGA / RMC, quel que soit le talker (GP/GN/GL…)
  const now = Date.now();
  st.lastLineAt = now;
  if (type === "RMC") {
    if (f[9]) st.lastDate = f[9];
    if (f[2] !== "A") return; // void = pas de fix valide
    const lat = nmeaCoord(f[3]!, f[4]!);
    const lon = nmeaCoord(f[5]!, f[6]!);
    if (lat == null || lon == null) return;
    st.fix = {
      lat, lon,
      altM: st.fix?.altM ?? null,
      sats: st.fix?.sats ?? null,
      hdop: st.fix?.hdop ?? null,
      utc: nmeaTime(f[1]!, st.lastDate),
      at: now,
    };
  } else if (type === "GGA") {
    if (!f[6] || f[6] === "0") return; // fix quality 0 = pas de fix
    const lat = nmeaCoord(f[2]!, f[3]!);
    const lon = nmeaCoord(f[4]!, f[5]!);
    if (lat == null || lon == null) return;
    st.fix = {
      lat, lon,
      altM: Number.isFinite(Number(f[9])) ? Number(f[9]) : null,
      sats: Number.isFinite(Number(f[7])) ? Number(f[7]) : null,
      hdop: Number.isFinite(Number(f[8])) ? Number(f[8]) : null,
      utc: nmeaTime(f[1]!, st.lastDate),
      at: now,
    };
  }
}

function onData(st: GpsState, chunk: string) {
  st.buf += chunk;
  let nl: number;
  while ((nl = st.buf.indexOf("\n")) >= 0) {
    const line = st.buf.slice(0, nl);
    st.buf = st.buf.slice(nl + 1);
    onLine(st, line);
  }
  if (st.buf.length > 8192) st.buf = ""; // flux non-NMEA : on ne laisse pas gonfler
}

function schedule(st: GpsState) {
  if (st.timer || !st.enabled) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    connect(st);
  }, st.retryMs);
  st.retryMs = Math.min(st.retryMs * 2, 30_000);
}

function connect(st: GpsState) {
  if (!st.enabled || st.sock || st.stream) return;
  if (st.kind === "tcp") {
    const sock = net.createConnection({ host: st.host, port: st.port });
    st.sock = sock;
    sock.setEncoding("latin1");
    sock.setKeepAlive(true, 30_000);
    sock.setTimeout(SILENT_MS * 4);
    sock.on("connect", () => {
      st.connected = true;
      st.lastError = null;
      st.retryMs = 2000;
    });
    sock.on("data", (c: string) => onData(st, c));
    const drop = (msg: string) => {
      st.connected = false;
      st.sock = null;
      st.lastError = msg;
      schedule(st);
    };
    sock.on("error", (e) => drop(e instanceof Error ? e.message : "erreur socket"));
    sock.on("timeout", () => { sock.destroy(); drop("silence NMEA (pas de trame)"); });
    sock.on("close", () => { if (st.sock) drop("liaison fermée"); });
    return;
  }
  // Série : on règle le baud au mieux (POSIX), puis on lit le device comme un flux.
  const open = () => {
    try {
      const stream = fs.createReadStream(st.source, { encoding: "latin1" });
      st.stream = stream;
      stream.on("open", () => { st.connected = true; st.lastError = null; st.retryMs = 2000; });
      stream.on("data", (c) => onData(st, typeof c === "string" ? c : c.toString("latin1")));
      const drop = (msg: string) => {
        st.connected = false;
        st.stream = null;
        st.lastError = msg;
        schedule(st);
      };
      stream.on("error", (e) => drop(e instanceof Error ? e.message : "erreur device"));
      stream.on("close", () => { if (st.stream) drop("device fermé"); });
    } catch (e) {
      st.connected = false;
      st.stream = null;
      st.lastError = e instanceof Error ? e.message : "ouverture device échouée";
      schedule(st);
    }
  };
  if (process.platform === "win32") {
    open();
  } else {
    const flag = process.platform === "darwin" ? "-f" : "-F";
    execFile("stty", [flag, st.source, String(st.baud), "raw", "-echo"], () => open());
  }
}

/** La dernière position valide, si elle est récente. Sinon null. */
export function gpsFix(): { lat: number; lon: number } | null {
  const st = state();
  if (!st.enabled || !st.fix) return null;
  if (Date.now() - st.fix.at > FIX_MAX_AGE_MS) return null;
  return { lat: st.fix.lat, lon: st.fix.lon };
}

export type GpsStatus = {
  configured: boolean;
  kind: "tcp" | "serial" | null;
  source: string;
  connected: boolean;
  hasFix: boolean;
  lat: number | null;
  lon: number | null;
  altM: number | null;
  sats: number | null;
  hdop: number | null;
  utc: string | null;
  ageS: number | null;
  error: string | null;
};

export function gpsStatus(): GpsStatus {
  const st = state();
  const fresh = st.fix && Date.now() - st.fix.at <= FIX_MAX_AGE_MS ? st.fix : null;
  return {
    configured: st.enabled,
    kind: st.enabled ? st.kind : null,
    source: st.source,
    connected: st.connected,
    hasFix: Boolean(fresh),
    lat: fresh?.lat ?? null,
    lon: fresh?.lon ?? null,
    altM: fresh?.altM ?? null,
    sats: fresh?.sats ?? null,
    hdop: fresh?.hdop ?? null,
    utc: fresh?.utc ?? null,
    ageS: st.fix ? Math.round((Date.now() - st.fix.at) / 1000) : null,
    error: st.lastError,
  };
}
