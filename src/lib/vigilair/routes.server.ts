/**
 * Routes sûres mémorisées — stockage SERVEUR partagé par tous les navigateurs du poste et conservé
 * au redémarrage (data/routes.json), comme les sites surveillés. Une route validée sur le terrain se
 * garde et se repartage. Réception / lecture seule.
 */

import { ecrireFichierPoste, lireFichierPoste, listeJson } from "../disque-poste.server.ts";
import path from "node:path";
import type { NamedPoint } from "./nav";

export type SavedRoute = { id: string; name: string; points: NamedPoint[]; at: number };

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "routes.json");
const MAX_ROUTES = 500;
const MAX_POINTS = 60;

const g = globalThis as unknown as { __afriRoutes?: SavedRoute[] };

function cleanPoints(raw: unknown): NamedPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedPoint[] = [];
  for (const p of raw.slice(0, MAX_POINTS)) {
    const o = p as Record<string, unknown>;
    const lat = Number(o?.lat);
    const lon = Number(o?.lon);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180) {
      out.push({ lat, lon, name: typeof o?.name === "string" ? o.name.slice(0, 40) : undefined });
    }
  }
  return out;
}

async function load(): Promise<SavedRoute[]> {
  if (g.__afriRoutes) return g.__afriRoutes;
  // Abîmé ou absent : sa copie (dossier des copies) ; rien de lisible : vide.
  g.__afriRoutes = (await lireFichierPoste(FILE, listeJson<SavedRoute>)) ?? [];
  return g.__afriRoutes;
}

async function persist(list: SavedRoute[]): Promise<void> {
  g.__afriRoutes = list;
  await ecrireFichierPoste(FILE, JSON.stringify(list));
}

export async function listRoutesServer(): Promise<SavedRoute[]> {
  return [...(await load())];
}

export async function addRouteServer(input: { name: string; points: unknown }): Promise<{ ok: boolean; error?: string; routes?: SavedRoute[] }> {
  const name = (input?.name ?? "").trim();
  if (!name) return { ok: false, error: "nom requis" };
  if (name.length > 60) return { ok: false, error: "nom trop long" };
  const points = cleanPoints(input?.points);
  if (points.length < 2) return { ok: false, error: "route incomplète (2 points min)" };
  const list = await load();
  if (list.length >= MAX_ROUTES) return { ok: false, error: `maximum ${MAX_ROUTES} routes` };
  const route: SavedRoute = { id: `route:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, points, at: Date.now() };
  const next = [route, ...list];
  await persist(next);
  return { ok: true, routes: next };
}

export async function removeRouteServer(id: string): Promise<SavedRoute[]> {
  const next = (await load()).filter((r) => r.id !== id);
  await persist(next);
  return next;
}
