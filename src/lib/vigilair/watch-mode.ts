/** Mode veille opérationnel — COP vivant, réveil auto, pas un gel de poste. */

import type { DefensePosture } from "./types";
import type { SatLayer } from "./sat";
import type { MapScale } from "./geo";

export const WATCH_KEY = "vigilair-watch-mode";
export const WATCH_REDIM_MS = 45_000;

export type WatchWake = {
  wake: boolean;
  reason: string;
  ident: boolean;
};

export function evaluateWatch(opts: {
  posture: DefensePosture;
  unackedHot: number;
  uav: number;
  intrusion: boolean;
  emergency: number;
  theaterHit: number;
  globeHit: number;
}): WatchWake {
  if (opts.posture === "menace") {
    return { wake: true, reason: "Posture menace", ident: true };
  }
  if (opts.intrusion) {
    return { wake: true, reason: "Intrusion bulle", ident: true };
  }
  if (opts.emergency > 0) {
    return {
      wake: true,
      reason: `${opts.emergency} urgence 1090`,
      ident: false,
    };
  }
  if (opts.theaterHit > 0) {
    return { wake: true, reason: `${opts.theaterHit} phénomène théâtre`, ident: true };
  }
  if (opts.globeHit > 0) {
    return { wake: true, reason: `${opts.globeHit} phénomène globe`, ident: false };
  }
  if (opts.posture === "alerte") {
    return { wake: true, reason: "Posture alerte", ident: false };
  }
  if (opts.uav > 0) {
    return { wake: true, reason: `${opts.uav} UAV B6`, ident: false };
  }
  if (opts.unackedHot > 0) {
    return {
      wake: true,
      reason: `${opts.unackedHot} alerte non acquittée`,
      ident: false,
    };
  }
  return { wake: false, reason: "RAS", ident: false };
}

/** Jour → visible. Nuit → IR. Ne vole pas thermique / relief / choix manuel. */
export function autoSatLayer(
  night: boolean,
  current: SatLayer,
  auto: boolean,
): SatLayer | null {
  if (!auto) return null;
  if (night && current === "vis") return "ir";
  if (!night && (current === "ir" || current === "nv")) return "vis";
  return null;
}

export function persistWatchMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) sessionStorage.setItem(WATCH_KEY, "1");
    else sessionStorage.removeItem(WATCH_KEY);
  } catch {
    /* quota / privé */
  }
}

export function loadWatchMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(WATCH_KEY) === "1";
  } catch {
    return false;
  }
}

export function watchHomeScale(_current: MapScale): MapScale {
  return "veille";
}
