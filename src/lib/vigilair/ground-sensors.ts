/**
 * Capteurs sol côté client — cache serveur + miroir local (comme routes/sites). Partagé par le poste.
 */

import { sensorAdd, sensorRemove, sensorSetState, sensorsList } from "./ground-sensors-api";
import type { GroundSensor, SensorType } from "./ground-sensors.server";
import { registreVideServeur } from "./ssr-snapshot";

export type { GroundSensor, SensorType, SensorState } from "./ground-sensors.server";

const MIRROR_KEY = "africontrol.sensors.mirror.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: GroundSensor[] | null = null;

function readMirror(): GroundSensor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as GroundSensor[]) : [];
  } catch {
    return [];
  }
}
function writeMirror(list: GroundSensor[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(list));
  } catch {
    /* quota / privé */
  }
}
function set(list: GroundSensor[]): void {
  cache = list;
  writeMirror(list);
  listeners.forEach((l) => l());
}

export function sensorsSnapshot(): GroundSensor[] {
  if (!cache) cache = readMirror();
  return cache;
}

/**
 * Instantané SERVEUR : vide et de référence stable. React appelle cette fonction au rendu
 * serveur ET pendant l'hydratation du client ; lui donner l'instantané vivant ferait rendre
 * au client le miroir `localStorage` que le HTML du serveur ne contenait pas.
 */
export function sensorsServerSnapshot(): GroundSensor[] {
  return registreVideServeur<GroundSensor>();
}
export function subscribeSensors(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export async function hydrateSensors(): Promise<void> {
  try {
    const list = await sensorsList();
    set(Array.isArray(list) ? list : []);
  } catch {
    /* poste injoignable : on garde le miroir */
  }
}
export async function addSensor(site: string, type: SensorType, name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await sensorAdd({ data: { site, type, name } });
    if (res.ok && res.sensors) set(res.sensors);
    return { ok: res.ok, error: res.error };
  } catch {
    return { ok: false, error: "poste injoignable" };
  }
}
export async function setSensorState(id: string, state: GroundSensor["state"]): Promise<void> {
  try {
    const res = await sensorSetState({ data: { id, state } });
    if (res?.sensors) set(res.sensors);
  } catch {
    /* réessayable */
  }
}
export async function removeSensor(id: string): Promise<void> {
  try {
    const res = await sensorRemove({ data: { id } });
    if (res?.sensors) set(res.sensors);
  } catch {
    /* réessayable */
  }
}
