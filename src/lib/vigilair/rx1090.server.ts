/**
 * Antenne 1090 locale : AfriControl se branche sur le port brut de dump1090 (trames AVR, 30002 par
 * défaut) et décode lui-même chaque trame. Écoute seule — le poste n'interroge pas, n'émet pas.
 *
 *   AFRICONTROL_1090=127.0.0.1:30002   récepteur (hôte:port) ; « off » pour couper la liaison
 *   AFRICONTROL_ANTENNE=12.1331,15.0339 position de l'antenne (décodage sol, portée physique)
 */

import net from "node:net";
import { env } from "@/lib/env.server";
import { RxTable, type RxAircraft, type RxFrameView, type RxStats } from "./adsb-decode";
import { emergencyLabel, type LiveAc } from "./live-adsb";

const FRAME_RING = 200;
const RATE_WINDOW_S = 10;
const SILENT_MS = 90_000;
const DEFAULT_ENDPOINT = "127.0.0.1:30002";
const DEFAULT_ANTENNA = { lat: 12.1331, lon: 15.0339 };
/**
 * Une position plus vieille ne part pas comme piste fraîche : antenne coupée, la piste vieillit
 * côté poste puis passe « perdue », au lieu de rester affichée comme si elle volait encore.
 */
const POS_MAX_AGE_MS = 20_000;

type SeqFrame = RxFrameView & { seq: number };

type RxState = {
  enabled: boolean;
  host: string;
  port: number;
  antenna: { lat: number; lon: number };
  table: RxTable;
  sock: net.Socket | null;
  connected: boolean;
  connectedAt: number | null;
  lastLineAt: number | null;
  lastError: string | null;
  retryMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  buf: string;
  frames: SeqFrame[];
  seq: number;
  buckets: { s: number; n: number }[];
  startedAt: number;
};

export type ReceiverStatus = {
  enabled: boolean;
  endpoint: string;
  connected: boolean;
  connectedAt: number | null;
  lastLineAt: number | null;
  lastError: string | null;
  msgPerS: number;
  heard: number;
  positioned: number;
  stats: RxStats;
  antenna: { lat: number; lon: number };
};

export type ReceiverFeed = {
  status: ReceiverStatus;
  frames: SeqFrame[];
  seq: number;
};

function parseEndpoint(raw: string | undefined): { enabled: boolean; host: string; port: number } {
  const v = (raw ?? DEFAULT_ENDPOINT).trim();
  if (/^(off|non|0|false|aucun)$/i.test(v)) return { enabled: false, host: "", port: 0 };
  const m = v.match(/^\[?([^\]]+?)\]?(?::(\d{1,5}))?$/);
  const host = m?.[1] ?? "127.0.0.1";
  const port = Number(m?.[2] ?? 30002);
  return { enabled: true, host, port: port > 0 && port < 65536 ? port : 30002 };
}

function parseAntenna(raw: string | undefined): { lat: number; lon: number } {
  const [lat, lon] = (raw ?? "").split(",").map((x) => Number(x.trim()));
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat!) <= 90 && Math.abs(lon!) <= 180) {
    return { lat: lat!, lon: lon! };
  }
  return DEFAULT_ANTENNA;
}

const g = globalThis as unknown as { __vigilairRx1090?: RxState };

function state(): RxState {
  if (g.__vigilairRx1090) return g.__vigilairRx1090;
  // Les anciens noms VIGILAIR_* restent lus : un poste déjà déployé ne perd pas son antenne.
  const ep = parseEndpoint(env("AFRICONTROL_1090") ?? env("VIGILAIR_1090"));
  const antenna = parseAntenna(env("AFRICONTROL_ANTENNE") ?? env("VIGILAIR_ANTENNE"));
  const st: RxState = {
    ...ep,
    antenna,
    table: new RxTable(antenna),
    sock: null,
    connected: false,
    connectedAt: null,
    lastLineAt: null,
    lastError: null,
    retryMs: 2000,
    timer: null,
    buf: "",
    frames: [],
    seq: 0,
    buckets: [],
    startedAt: Date.now(),
  };
  g.__vigilairRx1090 = st;
  return st;
}

function countRate(st: RxState, now: number) {
  const s = Math.floor(now / 1000);
  const last = st.buckets[st.buckets.length - 1];
  if (last && last.s === s) last.n += 1;
  else st.buckets.push({ s, n: 1 });
  while (st.buckets.length && st.buckets[0]!.s <= s - RATE_WINDOW_S) st.buckets.shift();
}

function onData(st: RxState, chunk: string) {
  const now = Date.now();
  st.buf += chunk;
  // Une trame AVR finit par « ; » (suivi ou non d'un saut de ligne selon la version de dump1090).
  let cut = st.buf.indexOf(";");
  while (cut >= 0) {
    const line = `${st.buf.slice(0, cut).trim()};`;
    st.buf = st.buf.slice(cut + 1);
    st.lastLineAt = now;
    const view = st.table.ingest(line, now);
    if (view) {
      st.seq += 1;
      st.frames.push({ ...view, seq: st.seq });
      if (st.frames.length > FRAME_RING) st.frames.splice(0, st.frames.length - FRAME_RING);
      countRate(st, now);
    }
    cut = st.buf.indexOf(";");
  }
  // Flux qui n'est pas de l'AVR (mauvais port, Beast binaire…) : on ne laisse pas le tampon gonfler.
  if (st.buf.length > 4096) {
    st.buf = "";
    st.lastError = "flux reçu mais pas au format AVR (port 30002 attendu, pas 30005)";
  }
}

function schedule(st: RxState) {
  if (st.timer || !st.enabled) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    connect(st);
  }, st.retryMs);
  st.retryMs = Math.min(st.retryMs * 2, 30_000);
}

function connect(st: RxState) {
  if (!st.enabled || st.sock) return;
  const sock = net.createConnection({ host: st.host, port: st.port });
  st.sock = sock;
  sock.setEncoding("latin1");
  sock.setKeepAlive(true, 30_000);
  sock.setTimeout(SILENT_MS);
  sock.on("connect", () => {
    st.connected = true;
    st.connectedAt = Date.now();
    st.lastError = null;
    st.retryMs = 2000;
  });
  sock.on("data", (chunk: string) => onData(st, chunk));
  sock.on("timeout", () => {
    st.lastError = "aucune trame depuis 90 s";
    sock.destroy();
  });
  sock.on("error", (e: NodeJS.ErrnoException) => {
    st.lastError =
      e.code === "ECONNREFUSED"
        ? "ECONNREFUSED · connexion refusée (dump1090 lancé avec --net ?)"
        : e.code === "ETIMEDOUT" || e.code === "EHOSTUNREACH"
          ? `${e.code} · récepteur injoignable sur le réseau`
          : (e.code ?? e.message);
  });
  sock.on("close", () => {
    st.sock = null;
    st.connected = false;
    st.buf = "";
    schedule(st);
  });
}

/** Démarre la liaison au premier appel ; ensuite elle vit avec le serveur et se relance seule. */
function ensure(): RxState {
  const st = state();
  if (st.enabled && !st.sock && !st.timer) connect(st);
  return st;
}

/**
 * Juste après le démarrage du poste, laisse à la liaison le temps de s'ouvrir et à la première
 * paire de positions d'arriver (1,5 s au plus). Ensuite, ne fait jamais attendre.
 */
export async function receiverReady(maxMs = 1500): Promise<void> {
  const st = ensure();
  if (!st.enabled) return;
  const until = st.startedAt + maxMs;
  while (Date.now() < until && !(st.connected && st.table.positioned(Date.now(), POS_MAX_AGE_MS).length > 0)) {
    if (st.lastError && !st.connected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function receiverStatus(now = Date.now()): ReceiverStatus {
  const st = ensure();
  st.table.prune(now);
  const windowN = st.buckets
    .filter((b) => b.s > Math.floor(now / 1000) - RATE_WINDOW_S)
    .reduce((a, b) => a + b.n, 0);
  return {
    enabled: st.enabled,
    endpoint: st.enabled ? `${st.host}:${st.port}` : "coupée",
    connected: st.connected,
    connectedAt: st.connectedAt,
    lastLineAt: st.lastLineAt,
    lastError: st.lastError,
    msgPerS: Math.round((windowN / RATE_WINDOW_S) * 10) / 10,
    heard: st.table.ac.size,
    positioned: st.table.positioned(now, POS_MAX_AGE_MS).length,
    stats: { ...st.table.stats },
    antenna: st.antenna,
  };
}

function toLiveAc(a: RxAircraft, now: number): LiveAc {
  const sq = a.squawk;
  const emRaw = a.emergency ?? (sq === "7700" || sq === "7600" || sq === "7500" ? sq : null);
  return {
    hex: a.hex,
    flight: a.flight || a.hex.toUpperCase(),
    lat: a.lat!,
    lon: a.lon!,
    altM: a.onGround ? 0 : (a.altFt ?? 0) * 0.3048,
    gsKmh: (a.gsKt ?? 0) * 1.852,
    track: a.trackDeg ?? 0,
    climbMs: (a.vrateFpm ?? 0) * 0.00508,
    squawk: sq,
    icaoType: null,
    reg: null,
    rssi: null,
    emergency: emergencyLabel(emRaw),
    seenS: Math.max(0, (now - a.posAt) / 1000),
    onGround: a.onGround,
    category: a.category,
    nic: a.nic,
    nacp: null,
    sil: null,
    military: false,
    via: "antenne",
  };
}

/** Avions positionnés par l'antenne depuis moins d'une minute, au format des pistes 1090ES. */
export function receiverAircraft(now = Date.now()): LiveAc[] {
  const st = ensure();
  return st.table.positioned(now, POS_MAX_AGE_MS).map((a) => toLiveAc(a, now));
}

/** Écoute brute : les dernières trames reçues après `after` (numéro de séquence), sans filtre. */
export function receiverFeed(after: number, max = 80): ReceiverFeed {
  const st = ensure();
  const frames = st.frames.filter((f) => f.seq > after).slice(-max);
  return { status: receiverStatus(), frames, seq: st.seq };
}
