/**
 * Enregistreur du poste : garde les 30 dernières minutes de trafic 1090ES réellement reçu
 * (antenne + réseau), une image toutes les 15 s au plus. C'est la bande « poste » de l'inject
 * REJEU RÉEL. Sans 3 minutes enregistrées, on sert l'archive réelle livrée avec le logiciel.
 */

import type { LiveAc } from "./live-adsb";
import { tapeMeta, tapeRow, tapeUsable, type RejeuTape } from "./rejeu";

const KEEP_MS = 30 * 60_000;
const STEP_MS = 15_000;

const g = globalThis as unknown as { __afriRejeu?: RejeuTape };

function tape(): RejeuTape {
  g.__afriRejeu ??= {
    kind: "poste",
    source: "1090ES reçu par ce poste (antenne + adsb.lol / adsb.fi)",
    from: 0,
    to: 0,
    ac: {},
    frames: [],
  };
  return g.__afriRejeu;
}

export function recordFrame(at: number, aircraft: LiveAc[]): void {
  const tp = tape();
  const last = tp.frames.at(-1);
  if (last && at - last.at < STEP_MS) return;
  // Une position en cache réseau garde son vrai âge (retard) : la lecture la replace à son heure.
  const rows = aircraft.filter((a) => a.seenS <= 120);
  if (rows.length === 0) return;
  for (const a of rows) tp.ac[a.hex] = tapeMeta(a);
  tp.frames.push({ at, rows: rows.map(tapeRow) });
  const cut = at - KEEP_MS;
  if (tp.frames[0]!.at < cut) {
    tp.frames = tp.frames.filter((f) => f.at >= cut);
    const live = new Set(tp.frames.flatMap((f) => f.rows.map((r) => r[0])));
    for (const hex of Object.keys(tp.ac)) if (!live.has(hex)) delete tp.ac[hex];
  }
  tp.from = tp.frames[0]!.at;
  tp.to = at;
}

let archive: RejeuTape | null = null;

async function loadArchive(): Promise<RejeuTape | null> {
  if (archive) return archive;
  try {
    const raw = (await import("./rejeu-archive.json?raw")).default;
    const parsed = JSON.parse(raw) as RejeuTape;
    archive = tapeUsable(parsed) ? parsed : null;
  } catch {
    archive = null;
  }
  return archive;
}

/** La bande du poste si elle couvre 3 minutes, sinon l'archive réelle. */
export async function rejeuTape(): Promise<RejeuTape | null> {
  const tp = tape();
  if (tapeUsable(tp)) return structuredClone(tp);
  return loadArchive();
}
