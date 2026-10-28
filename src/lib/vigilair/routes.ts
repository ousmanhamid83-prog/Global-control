/**
 * Routes mémorisées côté client — cache serveur + miroir local (comme watch-sites). La vérité est
 * sur le poste ; le miroir peint instantanément au chargement. Partagé entre navigateurs du poste.
 */

import type { NamedPoint } from "./nav";
import { routeAdd, routeRemove, routesList } from "./routes-api";
import type { SavedRoute } from "./routes.server";
import { registreVideServeur } from "./ssr-snapshot";

export type { SavedRoute } from "./routes.server";

const MIRROR_KEY = "africontrol.routes.mirror.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: SavedRoute[] | null = null;

function readMirror(): SavedRoute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

function writeMirror(list: SavedRoute[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(list));
  } catch {
    /* quota / privé : reste en mémoire */
  }
}

function set(list: SavedRoute[]): void {
  cache = list;
  writeMirror(list);
  listeners.forEach((l) => l());
}

export function routesSnapshot(): SavedRoute[] {
  if (!cache) cache = readMirror();
  return cache;
}

/**
 * Instantané SERVEUR : vide et de référence stable. React appelle cette fonction au rendu
 * serveur ET pendant l'hydratation du client ; lui donner l'instantané vivant ferait rendre
 * au client le miroir `localStorage` que le HTML du serveur ne contenait pas.
 */
export function routesServerSnapshot(): SavedRoute[] {
  return registreVideServeur<SavedRoute>();
}

export function subscribeRoutes(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function hydrateRoutes(): Promise<void> {
  try {
    const list = await routesList();
    set(Array.isArray(list) ? list : []);
  } catch {
    /* poste injoignable : on garde le miroir */
  }
}

export async function saveRoute(name: string, points: NamedPoint[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await routeAdd({ data: { name, points } });
    if (res.ok && res.routes) set(res.routes);
    return { ok: res.ok, error: res.error };
  } catch {
    return { ok: false, error: "poste injoignable" };
  }
}

export async function deleteRoute(id: string): Promise<void> {
  try {
    const res = await routeRemove({ data: { id } });
    if (res?.routes) set(res.routes);
  } catch {
    /* réessayable */
  }
}
