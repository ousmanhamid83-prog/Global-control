/**
 * Registre « sites distants » côté client — cache serveur + miroir local (comme drones/sites).
 * Mémorise la plage réseau de chaque site distant pour re-scanner d'un clic et détecter une caméra
 * tombée / nouvelle. Présence d'équipement, jamais d'identité.
 */

import { siteNetAdd, siteNetRecordScan, siteNetRemove, siteNetsList } from "./sitenets-api";
import type { SiteNet } from "./sitenet-core";

export type { SiteNet, SiteNetEvent } from "./sitenet-core";
export { appendHistory, camKey, diffCameras, groupSites, perimeterSummaryLines, sectorHealth } from "./sitenet-core";

const MIRROR_KEY = "africontrol.sitenets.mirror.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: SiteNet[] | null = null;

function readMirror(): SiteNet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as SiteNet[]) : [];
  } catch {
    return [];
  }
}
function writeMirror(list: SiteNet[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(list));
  } catch {
    /* quota / privé */
  }
}
function set(list: SiteNet[]): void {
  cache = list;
  writeMirror(list);
  listeners.forEach((l) => l());
}

export function siteNetsSnapshot(): SiteNet[] {
  if (!cache) cache = readMirror();
  return cache;
}
export function subscribeSiteNets(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export async function hydrateSiteNets(): Promise<void> {
  try {
    const list = await siteNetsList();
    set(Array.isArray(list) ? list : []);
  } catch {
    /* poste injoignable : on garde le miroir */
  }
}
export async function addSiteNet(name: string, range: string, group = ""): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await siteNetAdd({ data: { name, range, group } });
    if (res.ok && res.sitenets) set(res.sitenets);
    return { ok: res.ok, error: res.error };
  } catch {
    return { ok: false, error: "poste injoignable" };
  }
}
export async function removeSiteNet(id: string): Promise<void> {
  try {
    const res = await siteNetRemove({ data: { id } });
    if (res?.sitenets) set(res.sitenets);
  } catch {
    /* réessayable */
  }
}
export async function recordSiteScan(id: string, cams: string[]): Promise<{ added: string[]; removed: string[] }> {
  try {
    const res = await siteNetRecordScan({ data: { id, cams } });
    if (res?.sitenets) set(res.sitenets);
    return { added: res.added ?? [], removed: res.removed ?? [] };
  } catch {
    return { added: [], removed: [] };
  }
}
