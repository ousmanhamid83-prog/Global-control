/**
 * Enregistreur du poste : le trafic 1090ES réellement reçu (antenne + réseau), une image toutes
 * les 15 s au plus, même sans console ouverte (enregistrerEnContinu, lancé au démarrage). Chaque
 * image est GARDÉE SANS LIMITE dès sa réception : une ligne dans data/trafic/1090ES-<jour>.jsonl,
 * forcée sur le disque et doublée dans le dossier des copies. Les 30 dernières minutes restent en
 * mémoire : la bande « poste » de l'inject REJEU RÉEL ; sans 3 minutes enregistrées, on sert
 * l'archive réelle livrée avec le logiciel.
 */

import path from "node:path";
import { ajouterFichierPoste, noterDefautCopie } from "../disque-poste.server.ts";
import { jourPoste } from "./format.ts";
import type { LiveAc } from "./live-adsb";
import {
  tapeMeta,
  tapeRow,
  tapeUsable,
  type RejeuTape,
  type TapeMeta,
  type TapeRow,
} from "./rejeu.ts";

const KEEP_MS = 30 * 60_000;
const STEP_MS = 15_000;

const g = globalThis as unknown as {
  __afriRejeu?: RejeuTape;
  __afriTrafic?: Promise<void>;
  __afriEnregistreur?: ReturnType<typeof setInterval>;
};

/** Le fichier du trafic reçu le jour du poste où tombe `at`. */
export function fichierTrafic(at: number): string {
  return path.join(process.cwd(), "data", "trafic", `1090ES-${jourPoste(at)}.jsonl`);
}

/** Une image gardée : ajoutée, dans l'ordre de réception, au fichier du jour et à sa copie. */
function garder(at: number, rows: TapeRow[], ac: Record<string, TapeMeta>): void {
  const ligne = `${JSON.stringify({ at, rows, ac })}\n`;
  g.__afriTrafic = (g.__afriTrafic ?? Promise.resolve())
    .then(() => ajouterFichierPoste(fichierTrafic(at), ligne, "copie du trafic reçu"))
    .then(() => noterDefautCopie("enregistrement du trafic reçu", null))
    .catch((e: unknown) => noterDefautCopie("enregistrement du trafic reçu", e));
}

/** Attend que toutes les images reçues soient gardées. */
export function traficGarde(): Promise<void> {
  return g.__afriTrafic ?? Promise.resolve();
}

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
  const ac: Record<string, TapeMeta> = {};
  for (const a of rows) ac[a.hex] = tp.ac[a.hex] = tapeMeta(a);
  const lignes = rows.map(tapeRow);
  tp.frames.push({ at, rows: lignes });
  garder(at, lignes, ac);
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

/** La bande du poste telle quelle (pour l'archivage), même courte. */
export function currentPosteTape(): RejeuTape {
  return tape();
}

/**
 * Enregistre l'image du poste toutes les 15 s, même sans console ouverte : l'antenne et le dernier
 * relevé réseau, sans jamais lancer de relevé Internet (imagePoste). Une fois par processus.
 */
export function enregistrerEnContinu(): void {
  if (g.__afriEnregistreur) return;
  g.__afriEnregistreur = setInterval(() => {
    void import("./live-feeds")
      .then(async ({ imagePoste }) => {
        const image = await imagePoste();
        if (image) recordFrame(Date.now(), image.aircraft);
      })
      .catch(() => undefined);
  }, 5_000);
  g.__afriEnregistreur.unref();
}
