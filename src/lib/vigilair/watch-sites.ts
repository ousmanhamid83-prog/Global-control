/**
 * Sites surveillés ajoutés par l'opérateur — le périmètre de sécurité n'est jamais complet d'usine.
 * L'opérateur ajoute ses propres sites (camp, poste avancé, forage, village, pont…) avec leurs
 * coordonnées ; ils comptent alors comme les sites miniers intégrés : un phénomène (crue, feu,
 * séisme) à proximité SONNE, le périmètre est évalué pour l'intrusion drone, et le site est
 * sélectionnable dans le comparateur avant/après.
 *
 * Stockage local au poste (navigateur). Lecture seule côté capteurs : on n'émet rien, on surveille.
 * La logique pure (validation, plus-proche) vit dans watch-sites-core (testable sous node).
 */

import { MINES } from "./mines";
import {
  nearestFrom,
  validateSite,
  type NearWatch,
  type SiteInput,
  type WatchSite,
} from "./watch-sites-core";
import type { ZoneRow } from "./zones";

export type { NearWatch, SiteInput, WatchSite } from "./watch-sites-core";
export { validateSite, nearestFrom } from "./watch-sites-core";

const KEY = "africontrol.watchsites.v1";
const MAX_SITES = 50;

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
    o.lat >= -90 &&
    o.lat <= 90 &&
    typeof o.lon === "number" &&
    Number.isFinite(o.lon) &&
    o.lon >= -180 &&
    o.lon <= 180 &&
    typeof o.radiusKm === "number" &&
    Number.isFinite(o.radiusKm) &&
    o.radiusKm > 0
  );
}

function read(): WatchSite[] {
  if (cache) return cache;
  if (typeof window === "undefined") return (cache = []);
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(arr) ? arr.filter(isValid) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: WatchSite[]): void {
  cache = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* mode privé / quota : la liste reste au moins en mémoire pour la session */
  }
  listeners.forEach((l) => l());
}

/** Liste des sites ajoutés (référence stable tant que rien ne change : OK pour useSyncExternalStore). */
export function watchSitesSnapshot(): WatchSite[] {
  return read();
}

export function subscribeWatchSites(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function addCustomSite(input: SiteInput): { ok: boolean; error?: string } {
  const v = validateSite(input);
  if (!v.ok) return { ok: false, error: v.error };
  const list = read();
  if (list.length >= MAX_SITES) return { ok: false, error: `maximum ${MAX_SITES} sites` };
  write([...list, v.site]);
  return { ok: true };
}

export function removeCustomSite(id: string): void {
  write(read().filter((s) => s.id !== id));
}

function allWatchPoints(): NearWatch[] {
  const mines: NearWatch[] = MINES.map((m) => ({ id: m.id, name: m.name, short: m.short, custom: false, lat: m.lat, lon: m.lon }));
  const custom: NearWatch[] = read().map((s) => ({ id: s.id, name: s.name, short: s.name, custom: true, lat: s.lat, lon: s.lon }));
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
    armed: true,
    note: "site surveillé ajouté par l'opérateur",
  }));
}
