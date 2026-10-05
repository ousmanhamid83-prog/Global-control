/**
 * Phonie ATC — réception seule. AfriControl se branche sur un flux audio produit par le PROPRE
 * récepteur de l'opérateur (clé SDR + rtl_airband / rtl_fm exposant un flux HTTP ou Icecast de la
 * bande aéronautique VHF publique, ou toute diffusion aéronautique en clair) et l'enregistre. Il
 * n'accorde aucune radio, ne décode aucune parole, n'émet rien : il lit un flux public et l'archive.
 *
 *   AFRICONTROL_ATC=http://127.0.0.1:8000/atc.mp3   flux audio du récepteur (vide = non configuré)
 *
 * L'enregistrement est activable / désactivable et sans limite de durée (segments de 10 min).
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env.server";

const DIR = path.join(process.cwd(), "recordings", "atc");
const SEG_MS = 10 * 60_000;
const MAX_SEGMENTS = 96;

export type AtcSegment = { id: string; at: number; bytes: number };

export type AtcStatus = {
  configured: boolean;
  endpoint: string;
  recording: boolean;
  connected: boolean;
  bytes: number;
  segments: number;
  startedAt: number | null;
  lastChunkAt: number | null;
  lastError: string | null;
};

type AtcState = {
  on: boolean;
  connected: boolean;
  bytes: number;
  startedAt: number | null;
  lastChunkAt: number | null;
  lastError: string | null;
  abort: AbortController | null;
  file: WriteStream | null;
  segStartedAt: number;
  segList: AtcSegment[];
  retryMs: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const g = globalThis as unknown as { __afriAtc?: AtcState };

function state(): AtcState {
  g.__afriAtc ??= {
    on: false,
    connected: false,
    bytes: 0,
    startedAt: null,
    lastChunkAt: null,
    lastError: null,
    abort: null,
    file: null,
    segStartedAt: 0,
    segList: [],
    retryMs: 2000,
    timer: null,
  };
  return g.__afriAtc;
}

function endpoint(): string {
  return (env("AFRICONTROL_ATC") ?? "").trim();
}

function segId(now: number): string {
  return `atc-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19)}Z`;
}

function closeSegment(s: AtcState): void {
  if (s.file) {
    s.file.end();
    s.file = null;
  }
}

async function openSegment(s: AtcState): Promise<void> {
  const now = Date.now();
  await mkdir(DIR, { recursive: true });
  const id = segId(now);
  const ext = endpoint().match(/\.(\w{2,4})(\?|$)/)?.[1] ?? "aud";
  const file = createWriteStream(path.join(DIR, `${id}.${ext}`));
  s.file = file;
  s.segStartedAt = now;
  s.segList.unshift({ id: `${id}.${ext}`, at: now, bytes: 0 });
  s.segList = s.segList.slice(0, MAX_SEGMENTS);
}

async function pump(s: AtcState): Promise<void> {
  const url = endpoint();
  if (!url) {
    s.lastError = "aucun flux ATC configuré (AFRICONTROL_ATC)";
    s.on = false;
    return;
  }
  const ctrl = new AbortController();
  s.abort = ctrl;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "audio/*" } });
    if (!res.ok || !res.body) throw new Error(`flux ${res.status}`);
    s.connected = true;
    s.lastError = null;
    s.retryMs = 2000;
    await openSegment(s);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!s.on) break;
      if (Date.now() - s.segStartedAt >= SEG_MS) {
        closeSegment(s);
        await openSegment(s);
      }
      s.file?.write(Buffer.from(chunk));
      s.bytes += chunk.byteLength;
      s.lastChunkAt = Date.now();
      const seg = s.segList[0];
      if (seg) seg.bytes += chunk.byteLength;
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) {
      s.lastError = e instanceof Error ? e.message : "flux coupé";
    }
  } finally {
    s.connected = false;
    closeSegment(s);
    s.abort = null;
    // Reconnexion tant que l'enregistrement reste demandé (le récepteur a pu redémarrer).
    if (s.on) {
      s.timer = setTimeout(() => void pump(s), s.retryMs);
      s.retryMs = Math.min(s.retryMs * 2, 30_000);
    }
  }
}

export function atcStart(): AtcStatus {
  const s = state();
  if (!endpoint()) {
    s.lastError = "aucun flux ATC configuré (AFRICONTROL_ATC)";
    return atcStatus();
  }
  if (!s.on) {
    s.on = true;
    s.startedAt = Date.now();
    void pump(s);
  }
  return atcStatus();
}

export function atcStop(): AtcStatus {
  const s = state();
  s.on = false;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  s.abort?.abort();
  closeSegment(s);
  s.connected = false;
  return atcStatus();
}

export function atcStatus(): AtcStatus {
  const s = state();
  return {
    configured: Boolean(endpoint()),
    endpoint: endpoint() || "—",
    recording: s.on,
    connected: s.connected,
    bytes: s.bytes,
    segments: s.segList.length,
    startedAt: s.startedAt,
    lastChunkAt: s.lastChunkAt,
    lastError: s.lastError,
  };
}

export async function atcSegments(): Promise<AtcSegment[]> {
  const s = state();
  // Mémoire d'abord (session en cours), complétée par ce qui est sur le disque.
  const seen = new Set(s.segList.map((x) => x.id));
  const out = [...s.segList];
  try {
    const files = await readdir(DIR);
    for (const f of files) {
      if (seen.has(f) || !/^atc-.*\.\w+$/.test(f)) continue;
      const st = await stat(path.join(DIR, f));
      out.push({ id: f, at: st.mtimeMs, bytes: st.size });
    }
  } catch {
    /* pas encore de segments */
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_SEGMENTS);
}

/** Un segment audio (base64) pour téléchargement. */
export async function atcSegmentData(id: string): Promise<{ id: string; b64: string } | null> {
  if (!/^atc-[\w-]+\.\w+$/.test(id)) return null;
  try {
    const buf = await readFile(path.join(DIR, id));
    return { id, b64: buf.toString("base64") };
  } catch {
    return null;
  }
}
