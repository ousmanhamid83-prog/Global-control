/**
 * Registre des « sites distants » (réseaux de caméras au bout des liaisons antenne) — partagé par le
 * poste (data/sitenets.json). On y mémorise la PLAGE d'adresses de chaque site et la dernière liste de
 * caméras vues, pour re-scanner d'un clic et signaler une caméra TOMBÉE ou une NOUVELLE. Présence
 * d'équipement, jamais d'identité.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandRange } from "./scan2d";
import { diffCameras, type SiteNet } from "./sitenet-core";

export type { SiteNet } from "./sitenet-core";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "sitenets.json");
const MAX = 50;

const g = globalThis as unknown as { __afriSiteNets?: SiteNet[] };

async function load(): Promise<SiteNet[]> {
  if (g.__afriSiteNets) return g.__afriSiteNets;
  try {
    const raw = await readFile(FILE, "utf8");
    const arr: unknown = JSON.parse(raw);
    g.__afriSiteNets = Array.isArray(arr) ? (arr as SiteNet[]) : [];
  } catch {
    g.__afriSiteNets = [];
  }
  return g.__afriSiteNets;
}

async function persist(list: SiteNet[]): Promise<void> {
  g.__afriSiteNets = list;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list));
}

export async function listSiteNetsServer(): Promise<SiteNet[]> {
  return [...(await load())];
}

export async function addSiteNetServer(input: { name?: string; range?: string }): Promise<{ ok: boolean; error?: string; sitenets?: SiteNet[] }> {
  const name = (input?.name ?? "").trim().slice(0, 60);
  const range = (input?.range ?? "").trim().slice(0, 64);
  if (!name) return { ok: false, error: "nom requis" };
  if (!range) return { ok: false, error: "plage requise" };
  if (expandRange(range).length === 0) return { ok: false, error: "plage invalide ou trop large (un /24 max, ex. 10.20.0.0/24)" };
  const list = await load();
  if (list.length >= MAX) return { ok: false, error: `maximum ${MAX} sites distants` };
  const site: SiteNet = {
    id: `net:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    range,
    at: Date.now(),
  };
  const next = [site, ...list];
  await persist(next);
  return { ok: true, sitenets: next };
}

export async function removeSiteNetServer(id: string): Promise<SiteNet[]> {
  const next = (await load()).filter((s) => s.id !== id);
  await persist(next);
  return next;
}

/**
 * Enregistre le résultat d'un balayage d'un site : met à jour la liste de caméras + l'horodatage, et
 * renvoie le DIFF avec le relevé précédent (apparues / disparues). `cams` = adresses « host:port ».
 */
export async function recordSiteScanServer(id: string, cams: unknown): Promise<{ added: string[]; removed: string[]; sitenets: SiteNet[] }> {
  const curr = Array.isArray(cams) ? cams.filter((x): x is string => typeof x === "string").slice(0, 256) : [];
  let added: string[] = [];
  let removed: string[] = [];
  const next = (await load()).map((s) => {
    if (s.id !== id) return s;
    const d = diffCameras(s.cams, curr);
    added = d.added;
    removed = d.removed;
    return { ...s, cams: curr, lastScanAt: Date.now() };
  });
  await persist(next);
  return { added, removed, sitenets: next };
}
