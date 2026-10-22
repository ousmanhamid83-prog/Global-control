/**
 * Registre « nos drones » côté client — cache serveur + miroir local (comme routes/sites/capteurs).
 * `dronesPeek()` est une lecture SYNCHRONE : le store s'en sert pour marquer AMI la piste live d'un
 * drone inscrit, sans attendre le réseau. AfriControl suit et analyse ; il ne pilote pas.
 */

import { droneAdd, droneRemove, dronesList } from "./drones-api";
import type { OwnDrone } from "./drones-core";

export type { OwnDrone } from "./drones-core";
export { matchOwnDrone, normIdent } from "./drones-core";

const MIRROR_KEY = "africontrol.drones.mirror.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: OwnDrone[] | null = null;

function readMirror(): OwnDrone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as OwnDrone[]) : [];
  } catch {
    return [];
  }
}
function writeMirror(list: OwnDrone[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(list));
  } catch {
    /* quota / privé */
  }
}
function set(list: OwnDrone[]): void {
  cache = list;
  writeMirror(list);
  listeners.forEach((l) => l());
}

export function dronesSnapshot(): OwnDrone[] {
  if (!cache) cache = readMirror();
  return cache;
}
/** Lecture synchrone directe (store) — identique au snapshot mais au nom explicite côté moteur. */
export function dronesPeek(): OwnDrone[] {
  return dronesSnapshot();
}
export function subscribeDrones(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export async function hydrateDrones(): Promise<void> {
  try {
    const list = await dronesList();
    set(Array.isArray(list) ? list : []);
  } catch {
    /* poste injoignable : on garde le miroir */
  }
}
export async function addDrone(input: {
  name: string;
  ident: string;
  site: string;
  snapshotUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await droneAdd({ data: input });
    if (res.ok && res.drones) set(res.drones);
    return { ok: res.ok, error: res.error };
  } catch {
    return { ok: false, error: "poste injoignable" };
  }
}
export async function removeDrone(id: string): Promise<void> {
  try {
    const res = await droneRemove({ data: { id } });
    if (res?.drones) set(res.drones);
  } catch {
    /* réessayable */
  }
}
