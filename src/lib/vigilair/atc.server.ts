/**
 * Phonie ATC — réception seule. AfriControl se branche sur un flux audio produit par le PROPRE
 * récepteur de l'opérateur (clé SDR + rtl_airband / rtl_fm exposant un flux HTTP ou Icecast de la
 * bande aéronautique VHF publique, ou toute diffusion aéronautique en clair) et l'enregistre. Il
 * n'accorde aucune radio, ne décode aucune parole, n'émet rien : il lit un flux public et l'archive.
 *
 *   AFRICONTROL_ATC=http://127.0.0.1:8000/atc.mp3   flux audio du récepteur (vide = non configuré)
 *
 * L'enregistrement est activable / désactivable et sans limite de durée (segments de 10 min).
 * Chaque morceau reçu est écrit et DOUBLÉ aussitôt dans le dossier des copies, les deux forcés sur
 * le disque toutes les 10 s et à la fin du segment. Une erreur d'écriture (disque plein, clé des
 * copies retirée) est dite, jamais fatale au serveur ; un segment dont la copie a cassé est recopié
 * en entier à sa fin, dès que la copie remarche.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import {
  copieDe,
  copieRatee,
  ecritureEnCours,
  forcer,
  noterDefautCopie,
  noterEmpreinteFichier,
  rattraperCopies,
} from "../disque-poste.server.ts";
import { env } from "../env.server.ts";

const DIR = path.join(process.cwd(), "recordings", "atc");
const SEG_MS = 10 * 60_000;
const MAX_SEGMENTS = 96;
const COPIE_ATC = "copie de la phonie ATC";

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
  /** Le même segment, doublé au fil de l'eau dans le dossier des copies (null : copie en défaut). */
  copie: WriteStream | null;
  segStartedAt: number;
  segList: AtcSegment[];
  /** Dernier forçage sur le disque du segment en cours (ms). */
  forceA: number;
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
    copie: null,
    segStartedAt: 0,
    segList: [],
    forceA: 0,
    retryMs: 2000,
    timer: null,
  };
  return g.__afriAtc;
}

function endpoint(): string {
  return (env("AFRICONTROL_ATC") ?? "").trim();
}

/** Le nom d'un segment, à la milliseconde : deux segments ouverts dans la même seconde (arrêt puis
 * reprise aussitôt) ne s'écrasent plus. */
function segId(now: number): string {
  return `atc-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 23)}Z`;
}

/** Forcé sur le disque ; le fichier pas encore ouvert par son flux, rien à forcer. */
async function forcerSegment(f: WriteStream): Promise<void> {
  await forcer(String(f.path), false).catch(() => undefined);
}

/**
 * Segment terminé : le fichier et sa copie fermés, puis forcés sur le disque, et sa version finie
 * scellée (ses empreintes : le contrôle des copies le relit au contenu). Les segments dont la copie
 * avait cassé (celui-ci compris) sont alors recopiés en entier — sauf celui qui s'enregistre.
 */
function closeSegment(s: AtcState): void {
  const { file, copie } = s;
  s.file = null;
  s.copie = null;
  file?.end();
  copie?.end();
  if (!file) return;
  void (async () => {
    await finished(file).catch(() => undefined);
    await forcerSegment(file);
    if (copie) {
      await finished(copie).catch(() => undefined);
      await forcerSegment(copie);
    }
    ecritureEnCours(String(file.path), false);
    // Pas scellé ici (disque plein) : le contrôle suivant le scelle, le poste faisant foi.
    await noterEmpreinteFichier(String(file.path)).catch(() => undefined);
    await rattraperCopies(COPIE_ATC, s.file ? String(s.file.path) : null).catch((e: unknown) =>
      noterDefautCopie(COPIE_ATC, e),
    );
  })();
}

async function openSegment(s: AtcState): Promise<void> {
  const now = Date.now();
  await mkdir(DIR, { recursive: true });
  const id = segId(now);
  const ext = endpoint().match(/\.(\w{2,4})(\?|$)/)?.[1] ?? "aud";
  const chemin = path.join(DIR, `${id}.${ext}`);
  const file = createWriteStream(chemin);
  ecritureEnCours(chemin, true);
  file.on("error", (e) => {
    s.lastError = `enregistrement impossible : ${e.message}`;
  });
  s.file = file;
  s.copie = null;
  try {
    const vers = copieDe(chemin);
    await mkdir(path.dirname(vers), { recursive: true });
    const copie = createWriteStream(vers);
    copie.on("error", (e) => {
      if (s.copie === copie) s.copie = null;
      copieRatee(COPIE_ATC, chemin, e);
    });
    s.copie = copie;
  } catch (e) {
    copieRatee(COPIE_ATC, chemin, e);
  }
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
      const octets = Buffer.from(chunk);
      s.file?.write(octets);
      s.copie?.write(octets);
      // En cours d'enregistrement, forcés sur le disque toutes les 10 s : une coupure n'en perd pas plus.
      if (Date.now() - s.forceA >= 10_000) {
        s.forceA = Date.now();
        for (const f of [s.file, s.copie]) if (f) void forcerSegment(f);
      }
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
