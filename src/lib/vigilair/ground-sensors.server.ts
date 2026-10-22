/**
 * Capteurs SOL de périmètre (caméra / barrière / radar) — registre partagé par le poste
 * (data/sensors.json). C'est l'ENTRÉE prévue pour la détection temps réel véhicule/personne au sol,
 * que l'imagerie satellite ne peut pas faire. États manuels pour l'instant ; un vrai capteur viendra
 * pousser son état sur ce registre (addSensorServer / setSensorStateServer) quand le matériel est câblé.
 * Réception / lecture seule côté air : le poste n'émet rien.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SensorType = "camera" | "barriere" | "radar" | "autre";
export type SensorState = "ok" | "alarme" | "hs";
export type GroundSensor = { id: string; site: string; type: SensorType; name: string; state: SensorState; at: number };

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "sensors.json");
const MAX = 1000;
const TYPES: SensorType[] = ["camera", "barriere", "radar", "autre"];
const STATES: SensorState[] = ["ok", "alarme", "hs"];

const g = globalThis as unknown as { __afriSensors?: GroundSensor[] };

async function load(): Promise<GroundSensor[]> {
  if (g.__afriSensors) return g.__afriSensors;
  try {
    const raw = await readFile(FILE, "utf8");
    const arr: unknown = JSON.parse(raw);
    g.__afriSensors = Array.isArray(arr) ? (arr as GroundSensor[]) : [];
  } catch {
    g.__afriSensors = [];
  }
  return g.__afriSensors;
}

async function persist(list: GroundSensor[]): Promise<void> {
  g.__afriSensors = list;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list));
}

export async function listSensorsServer(): Promise<GroundSensor[]> {
  return [...(await load())];
}

export async function addSensorServer(input: { site?: string; type?: string; name?: string }): Promise<{ ok: boolean; error?: string; sensors?: GroundSensor[] }> {
  const site = (input?.site ?? "").trim();
  const name = (input?.name ?? "").trim();
  const type = (TYPES as string[]).includes(input?.type ?? "") ? (input!.type as SensorType) : "autre";
  if (!site) return { ok: false, error: "site requis" };
  if (!name) return { ok: false, error: "nom requis" };
  const list = await load();
  if (list.length >= MAX) return { ok: false, error: `maximum ${MAX} capteurs` };
  const sensor: GroundSensor = { id: `sensor:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, site: site.slice(0, 60), type, name: name.slice(0, 60), state: "ok", at: Date.now() };
  const next = [sensor, ...list];
  await persist(next);
  return { ok: true, sensors: next };
}

export async function setSensorStateServer(id: string, state: string): Promise<GroundSensor[]> {
  const st = (STATES as string[]).includes(state) ? (state as SensorState) : "ok";
  const next = (await load()).map((s) => (s.id === id ? { ...s, state: st, at: Date.now() } : s));
  await persist(next);
  return next;
}

export async function removeSensorServer(id: string): Promise<GroundSensor[]> {
  const next = (await load()).filter((s) => s.id !== id);
  await persist(next);
  return next;
}
