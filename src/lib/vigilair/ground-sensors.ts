/**
 * Capteurs sol côté console : la liste lue sur le poste, relue toutes les quelques secondes (voir
 * SensorWatch). Pas de miroir local : un état gardé dans le navigateur serait un état périmé
 * affiché comme présent — « OK » ne se dit que sur ce que le poste vient de lire.
 */

import { sensorAdd, sensorNewKey, sensorRemove, sensorsList } from "./ground-sensors-api";
import type { GroundSensorVue, SensorType } from "./ground-sensors-core";
import { registreVideServeur } from "./ssr-snapshot";

export type { GroundSensorVue, SensorType } from "./ground-sensors-core";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: GroundSensorVue[] = registreVideServeur<GroundSensorVue>();
/** Heure du serveur à la dernière lecture : les « il y a » se comptent sur elle. */
let heure = 0;

function set(capteurs: GroundSensorVue[], maintenant: number): void {
  cache = capteurs;
  heure = maintenant;
  listeners.forEach((l) => l());
}

export function sensorsSnapshot(): GroundSensorVue[] {
  return cache;
}

/** Instantané du rendu serveur : vide et de référence stable (voir ssr-snapshot). */
export function sensorsServerSnapshot(): GroundSensorVue[] {
  return registreVideServeur<GroundSensorVue>();
}

export function sensorsHeureServeur(): number {
  return heure;
}

export function subscribeSensors(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function hydrateSensors(): Promise<void> {
  try {
    const r = await sensorsList();
    set(Array.isArray(r?.capteurs) ? r.capteurs : [], r?.maintenant ?? Date.now());
  } catch {
    /* poste injoignable : la prochaine lecture réessaie */
  }
}

const raison = (e: unknown) => (e instanceof Error && e.message ? e.message : "poste injoignable");

export async function addSensor(
  site: string,
  type: SensorType,
  name: string,
  silenceS: number,
): Promise<{ ok: boolean; error?: string; cle?: string; id?: string }> {
  try {
    const r = await sensorAdd({ data: { site, type, name, silenceS } });
    await hydrateSensors();
    return r;
  } catch (e) {
    return { ok: false, error: raison(e) };
  }
}

export async function newSensorKey(
  id: string,
): Promise<{ ok: boolean; error?: string; cle?: string }> {
  try {
    return await sensorNewKey({ data: { id } });
  } catch (e) {
    return { ok: false, error: raison(e) };
  }
}

export async function removeSensor(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await sensorRemove({ data: { id } });
    await hydrateSensors();
    return r;
  } catch (e) {
    return { ok: false, error: raison(e) };
  }
}
