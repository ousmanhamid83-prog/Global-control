/**
 * Registre « nos drones » côté client — cache serveur + miroir local (comme routes/sites/capteurs).
 * `dronesPeek()` est une lecture SYNCHRONE : le store s'en sert pour marquer AMI la piste live d'un
 * drone inscrit, sans attendre le réseau. AfriControl suit et analyse ; il ne pilote pas.
 */

import { droneAdd, droneRemove, droneSetRoi, droneSetRule, droneSetZones, dronesList, onvifDiscover, registerCameras, scanRange, scanSource } from "./drones-api";
import type { OwnDrone } from "./drones-core";

export type { OwnDrone, SourceKind, ArmRule } from "./drones-core";
export { effectiveUrl, matchOwnDrone, normIdent, sourceArmRule, sourceZones } from "./drones-core";

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
  kind?: string;
  name: string;
  ident: string;
  site: string;
  snapshotUrl?: string;
  host?: string;
  port?: number | string;
  path?: string;
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
export async function setDroneRoi(id: string, roi: { x: number; y: number }[]): Promise<void> {
  try {
    const res = await droneSetRoi({ data: { id, roi } });
    if (res?.drones) set(res.drones);
  } catch {
    /* réessayable */
  }
}
/** Définit plusieurs zones (secteurs) pour une source — polygones normalisés 0..1. */
export async function setDroneZones(id: string, zones: { x: number; y: number }[][]): Promise<void> {
  try {
    const res = await droneSetZones({ data: { id, zones } });
    if (res?.drones) set(res.drones);
  } catch {
    /* réessayable */
  }
}
/** Règle d'armement propre à une source (null = hérite du global). */
export async function setDroneRule(
  id: string,
  rule: { nightOnly: boolean; armFrom: number; armTo: number } | null,
): Promise<void> {
  try {
    const res = await droneSetRule({ data: { id, rule } });
    if (res?.drones) set(res.drones);
  } catch {
    /* réessayable */
  }
}
/** Scan auto : renvoie le flux découvert (port/chemin) pour pré-remplir la fiche. */
export async function scanSourceClient(host: string): Promise<Awaited<ReturnType<typeof scanSource>>> {
  return scanSource({ data: { host } });
}
/** Découverte ONVIF : liste les caméras du réseau (sans taper d'IP). */
export async function discoverOnvifClient(timeoutMs = 3000): Promise<Awaited<ReturnType<typeof onvifDiscover>>> {
  return onvifDiscover({ data: { timeoutMs } });
}
/** Scan de plage : balaie un sous-réseau distant (au bout de l'antenne) pour trouver les caméras. */
export async function scanRangeClient(spec: string): Promise<Awaited<ReturnType<typeof scanRange>>> {
  return scanRange({ data: { spec } });
}
/** Enregistrement en lot de caméras (découvertes ONVIF ou par scan de plage). */
export async function registerCamerasClient(
  list: { host?: string; port?: number | string; path?: string; name?: string; site?: string; url?: string }[],
  scan = false,
): Promise<Awaited<ReturnType<typeof registerCameras>>> {
  const res = await registerCameras({ data: { list, scan } });
  if (res?.drones) set(res.drones);
  return res;
}
