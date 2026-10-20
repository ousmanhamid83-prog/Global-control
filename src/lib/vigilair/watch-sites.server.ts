/**
 * Stockage SERVEUR des sites surveillés — partagé par tous les navigateurs qui parlent à ce poste et
 * conservé au redémarrage (fichier JSON sur le disque du poste, même schéma que les enregistrements).
 * Le client garde un miroir local pour peindre instantanément ; la vérité est ici. Réception seule.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSite, type SiteInput, type WatchSite } from "./watch-sites-core";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "watch-sites.json");
const MAX_SITES = 100;

const g = globalThis as unknown as { __afriWatchSites?: WatchSite[] };

async function load(): Promise<WatchSite[]> {
  if (g.__afriWatchSites) return g.__afriWatchSites;
  try {
    const raw = await readFile(FILE, "utf8");
    const arr: unknown = JSON.parse(raw);
    g.__afriWatchSites = Array.isArray(arr) ? (arr as WatchSite[]) : [];
  } catch {
    g.__afriWatchSites = [];
  }
  return g.__afriWatchSites;
}

async function persist(list: WatchSite[]): Promise<void> {
  g.__afriWatchSites = list;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list));
}

export async function listSitesServer(): Promise<WatchSite[]> {
  return [...(await load())];
}

export async function addSiteServer(input: SiteInput): Promise<{ ok: boolean; error?: string; sites?: WatchSite[] }> {
  const v = validateSite(input);
  if (!v.ok) return { ok: false, error: v.error };
  const list = await load();
  if (list.length >= MAX_SITES) return { ok: false, error: `maximum ${MAX_SITES} sites` };
  const next = [...list, v.site];
  await persist(next);
  return { ok: true, sites: next };
}

export async function removeSiteServer(id: string): Promise<WatchSite[]> {
  const next = (await load()).filter((s) => s.id !== id);
  await persist(next);
  return next;
}
