/**
 * Sites surveillés — le périmètre de sécurité n'est jamais complet d'usine. L'opérateur ajoute ses
 * sites (camp, poste avancé, forage, village, pont) ; ils comptent comme les sites miniers intégrés :
 * un phénomène proche SONNE, le périmètre est évalué contre l'intrusion, et le site est comparable
 * en avant/après.
 *
 * Stockage SERVEUR (partagé par tous les navigateurs du poste, conservé au redémarrage). Un miroir
 * local (navigateur) sert à peindre et à faire sonner les alertes dès le chargement, avant la
 * réponse serveur. La logique pure (validation, plus-proche) vit dans watch-sites-core (testable).
 */

import { MINES } from "./mines";
import { nearestFrom, type NearWatch, type SiteInput, type WatchSite } from "./watch-sites-core";
import { watchSiteAdd, watchSiteRemove, watchSitesList } from "./watch-sites-api";
import type { ZoneRow } from "./zones";
import { registreVideServeur } from "./ssr-snapshot";

export type { NearWatch, SiteInput, WatchSite } from "./watch-sites-core";
export { validateSite, nearestFrom } from "./watch-sites-core";

const MIRROR_KEY = "africontrol.watchsites.mirror.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: WatchSite[] | null = null;

function isValid(s: unknown): s is WatchSite {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    o.name.trim().length > 0 &&
    typeof o.lat === "number" &&
    Number.isFinite(o.lat) &&
    typeof o.lon === "number" &&
    Number.isFinite(o.lon) &&
    typeof o.radiusKm === "number" &&
    Number.isFinite(o.radiusKm) &&
    o.radiusKm > 0
  );
}

function readMirror(): WatchSite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isValid) : [];
  } catch {
    return [];
  }
}

function writeMirror(list: WatchSite[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(list));
  } catch {
    /* mode privé / quota : la liste reste au moins en mémoire pour la session */
  }
}

/** Lecture synchrone (cache mémoire, initialisé depuis le miroir local au premier accès). */
function read(): WatchSite[] {
  if (!cache) cache = readMirror();
  return cache;
}

function set(list: WatchSite[]): void {
  cache = list;
  writeMirror(list);
  listeners.forEach((l) => l());
}

/** Liste des sites (référence stable tant que rien ne change : OK pour useSyncExternalStore). */
export function watchSitesSnapshot(): WatchSite[] {
  return read();
}

/**
 * Instantané SERVEUR : vide et de référence stable. React appelle cette fonction au rendu
 * serveur ET pendant l'hydratation du client ; lui donner l'instantané vivant ferait rendre
 * au client le miroir `localStorage` que le HTML du serveur ne contenait pas.
 */
export function watchSitesServerSnapshot(): WatchSite[] {
  return registreVideServeur<WatchSite>();
}

export function subscribeWatchSites(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Charge la liste partagée depuis le poste et remplace le cache local. À appeler au démarrage. */
export async function hydrateFromServer(): Promise<void> {
  try {
    const sites = await watchSitesList();
    set(Array.isArray(sites) ? sites.filter(isValid) : []);
  } catch {
    /* poste injoignable (rare, c'est localhost) : on garde le miroir local */
  }
}

export async function addCustomSite(input: SiteInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await watchSiteAdd({ data: input });
    if (res.ok && res.sites) set(res.sites.filter(isValid));
    return { ok: res.ok, error: res.error };
  } catch {
    return { ok: false, error: "poste injoignable" };
  }
}

export async function removeCustomSite(id: string): Promise<void> {
  try {
    const res = await watchSiteRemove({ data: { id } });
    if (res?.sites) set(res.sites.filter(isValid));
  } catch {
    /* ignore : réessayable */
  }
}

function allWatchPoints(): NearWatch[] {
  const mines: NearWatch[] = MINES.map((m) => ({ id: m.id, name: m.name, short: m.short, custom: false, lat: m.lat, lon: m.lon }));
  const custom: NearWatch[] = read().map((s) => ({ id: s.id, name: s.name, short: s.name, custom: true, lat: s.lat, lon: s.lon, alertKm: s.alertKm }));
  return [...mines, ...custom];
}

/** Site surveillé le plus proche (minier intégré OU ajouté). Remplace nearestMine côté alertes. */
export function nearestWatchSite(lat: number, lon: number): { site: NearWatch; distKm: number } | null {
  return nearestFrom(allWatchPoints(), lat, lon);
}

/** Les sites ajoutés comme périmètres armés (carte + évaluation intrusion). */
export function watchZoneRows(): ZoneRow[] {
  return read().map((s) => ({
    id: s.id,
    name: s.name,
    kind: "custom" as const,
    lat: s.lat,
    lon: s.lon,
    radiusKm: s.radiusKm,
    armed: s.armed !== false,
    note: "site surveillé ajouté par l'opérateur",
  }));
}
