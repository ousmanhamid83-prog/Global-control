/**
 * Mosaïque locale du poste (imagerie hors ligne) — CÔTÉ SERVEUR, lue sur le disque à chaque
 * demande. Avant, le navigateur la chargeait comme fichier statique : en production, le serveur ne
 * sert que les fichiers copiés au moment du build, si bien qu'une mosaïque installée APRÈS le build
 * (le cas normal : le script de préparation construit d'abord) renvoyait 404 et la carte restait
 * sombre hors ligne. Mesuré : tuile posée après le build → HTTP 404.
 *
 *   public/sentinel/<z>/<x>/<y>.jpg     emplacement par défaut (celui des packs livrés)
 *   AFRICONTROL_IMAGERIE_TUILES=<dossier>   pour un autre dossier
 *
 * La couverture se lit dans les fichiers présents (voir mosaique-couverture) : toute tuile
 * installée, sur n'importe quelle zone, s'affiche hors ligne — plus seulement le carré de FTTJ.
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.server.ts";
import { couvertureDepuisTuiles, type RectTuiles } from "./mosaique-couverture.ts";

export function dossierMosaique(): string {
  return env("AFRICONTROL_IMAGERIE_TUILES") ?? join(process.cwd(), "public", "sentinel");
}

/** z, x, y entiers et dans la grille : rien d'autre ne sert à bâtir un chemin de fichier. */
export function tuileValide(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > 22) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

export async function lireTuileLocale(z: number, x: number, y: number): Promise<Uint8Array | null> {
  if (!tuileValide(z, x, y)) return null;
  try {
    return new Uint8Array(
      await readFile(join(dossierMosaique(), String(z), String(x), `${y}.jpg`)),
    );
  } catch {
    return null;
  }
}

const ENTIER = /^\d+$/;
const TUILE = /^(\d+)\.jpg$/;

function inventaire(dossier: string): { z: number; x: number; y: number }[] {
  if (!existsSync(dossier)) return [];
  const tuiles: { z: number; x: number; y: number }[] = [];
  for (const nz of readdirSync(dossier)) {
    if (!ENTIER.test(nz)) continue;
    const z = Number(nz);
    let colonnes: string[];
    try {
      colonnes = readdirSync(join(dossier, nz));
    } catch {
      continue;
    }
    for (const nx of colonnes) {
      if (!ENTIER.test(nx)) continue;
      const x = Number(nx);
      let fichiers: string[];
      try {
        fichiers = readdirSync(join(dossier, nz, nx));
      } catch {
        continue;
      }
      for (const f of fichiers) {
        const m = f.match(TUILE);
        if (m && tuileValide(z, x, Number(m[1]))) tuiles.push({ z, x, y: Number(m[1]) });
      }
    }
  }
  return tuiles;
}

export type CouvertureLocale = { rects: RectTuiles[]; zMax: number; tuiles: number };

const g = globalThis as unknown as {
  __africontrolCouverture?: { at: number; val: CouvertureLocale };
};
/** Relue au plus toutes les 60 s : une mosaïque installée pendant que le poste tourne apparaît vite. */
const FRAICHEUR_MS = 60_000;

export function couvertureLocale(): CouvertureLocale {
  const hit = g.__africontrolCouverture;
  if (hit && Date.now() - hit.at < FRAICHEUR_MS) return hit.val;
  const tuiles = inventaire(dossierMosaique());
  const val: CouvertureLocale = {
    rects: couvertureDepuisTuiles(tuiles),
    zMax: tuiles.reduce((m, t) => Math.max(m, t.z), 0),
    tuiles: tuiles.length,
  };
  g.__africontrolCouverture = { at: Date.now(), val };
  return val;
}
