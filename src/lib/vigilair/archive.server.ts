/**
 * Enregistrements archivés : des bandes de VRAI trafic 1090ES (la veille du poste) écrites sur
 * disque dans `recordings/`, consultables et téléchargeables. Rien n'est inventé — une archive est
 * une copie de ce que le poste a réellement entendu, avec son heure d'origine.
 *
 * Archivage automatique (activable / désactivable) toutes les 15 min dès que la bande couvre
 * 3 minutes ; plus un archivage manuel « maintenant ». Sur un vrai poste PC, les fichiers restent
 * sur le disque ; en conteneur cloud, ils vivent le temps de la session (d'où le téléchargement).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tapeUsable, type RejeuTape } from "./rejeu";

export type ArchiveMeta = {
  id: string;
  /** Quand la bande a été archivée (ms). */
  at: number;
  /** Heure d'origine du début / de la fin de la bande (ms). */
  from: number;
  to: number;
  frames: number;
  aircraft: number;
  bytes: number;
  trigger: "auto" | "manuel";
  source: string;
};

const DIR = path.join(process.cwd(), "recordings");
const INDEX = path.join(DIR, "index.json");
const MAX = 24;
const AUTO_MS = 15 * 60_000;
const CACHE_MAX = 4;

const g = globalThis as unknown as {
  __afriArch?: { metas: ArchiveMeta[]; json: Map<string, string>; auto: boolean; lastAt: number; loaded: boolean };
};

function st() {
  g.__afriArch ??= { metas: [], json: new Map(), auto: true, lastAt: 0, loaded: false };
  return g.__afriArch;
}

export function autoArchiveOn(): boolean {
  return st().auto;
}
export function setAutoArchive(on: boolean): void {
  st().auto = on;
}

async function ensureLoaded(): Promise<void> {
  const s = st();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const idx = JSON.parse(await readFile(INDEX, "utf8")) as ArchiveMeta[];
    if (Array.isArray(idx)) s.metas = idx.slice(0, MAX);
  } catch {
    /* pas encore d'archive sur ce poste */
  }
}

function tapeId(now: number): string {
  return `rejeu-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19)}Z`;
}

/** Archive la bande donnée (copie de ce qui a été entendu). Rejette une bande de moins de 3 min. */
export async function saveBand(tape: RejeuTape, trigger: ArchiveMeta["trigger"]): Promise<ArchiveMeta> {
  await ensureLoaded();
  if (!tapeUsable(tape)) throw new Error("bande trop courte (moins de 3 min de veille réelle)");
  const s = st();
  const now = Date.now();
  const id = tapeId(now);
  const json = JSON.stringify(tape);
  const meta: ArchiveMeta = {
    id,
    at: now,
    from: tape.from,
    to: tape.to,
    frames: tape.frames.length,
    aircraft: Object.keys(tape.ac).length,
    bytes: Buffer.byteLength(json),
    trigger,
    source: tape.source,
  };
  s.metas.unshift(meta);
  s.metas = s.metas.slice(0, MAX);
  s.json.set(id, json);
  for (const key of [...s.json.keys()].slice(CACHE_MAX)) s.json.delete(key);
  s.lastAt = now;
  // Disque : meilleur effort. Un conteneur en lecture seule n'empêche pas l'archive en mémoire.
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${id}.json`), json);
    await writeFile(INDEX, JSON.stringify(s.metas));
  } catch {
    /* pas de disque : l'archive reste en mémoire, téléchargeable cette session */
  }
  return meta;
}

/** Archivage automatique périodique, si activé et si la bande est exploitable. */
export async function maybeAutoArchive(tape: RejeuTape): Promise<void> {
  const s = st();
  if (!s.auto) return;
  if (Date.now() - s.lastAt < AUTO_MS) return;
  if (!tapeUsable(tape)) return;
  await saveBand(tape, "auto").catch(() => undefined);
}

export async function listArchives(): Promise<ArchiveMeta[]> {
  await ensureLoaded();
  return st().metas;
}

/** JSON d'une archive pour téléchargement : cache mémoire d'abord, sinon disque. */
export async function getArchiveJson(id: string): Promise<string | null> {
  await ensureLoaded();
  const s = st();
  const hit = s.json.get(id);
  if (hit) return hit;
  if (!s.metas.some((m) => m.id === id)) return null;
  try {
    return await readFile(path.join(DIR, `${id}.json`), "utf8");
  } catch {
    return null;
  }
}
