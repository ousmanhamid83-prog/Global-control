/**
 * Verrou automatique. Quand l'opérateur n'a rien choisi, la console garde l'œil sur la piste
 * RÉELLE qui compte le plus, et le panneau de droite montre ses vraies données (transpondeur,
 * METAR, SIGMET, GNSS). Seules les pistes 1090ES vraiment entendues (réseau ou antenne du poste)
 * sont candidates : jamais un inject, jamais un rejeu, jamais une piste perdue.
 *
 * Ordre : urgence (7500 / 7600 / 7700) > UAS catégorie B6 > militaire > GNSS douteux (NIC < 5)
 * > plus proche de FTTJ. Urgence et B6 comptent sur le théâtre élargi (Tchad, Darfour, AES) ;
 * militaire et GNSS sur Tchad et Darfour. Ailleurs seule la distance compte : une urgence à
 * Johannesburg ne doit pas voler l'écran de N'Djamena.
 *
 * Le choix de l'opérateur prime toujours : le store ne rappelle ce module que tant que la
 * sélection courante est vide ou vient de lui.
 */

import { HOME, haversineKm, theaterOf, theaterRank } from "./geo.ts";
import type { Track } from "./types";

export type AutoPick = {
  id: string;
  /** 0 urgence · 1 B6 · 2 militaire · 3 GNSS · 4 proximité. Plus bas = plus grave. */
  cls: number;
  reason: string;
  distKm: number;
};

/** Même seuil que la télémétrie : une piste muette depuis 45 s n'est plus « entendue ». */
export const AUTO_FRESH_MS = 45_000;

/** Une piste « plus proche » ne remplace la courante que si elle l'est nettement. */
const NEAR_SWITCH_RATIO = 0.7;

export function isAutoCandidate(t: Track, now: number): boolean {
  return (
    t.feed === "adsb" &&
    !t.injected &&
    t.idState !== "perdu" &&
    now - t.lastUpdate < AUTO_FRESH_MS &&
    Number.isFinite(t.lat) &&
    Number.isFinite(t.lon)
  );
}

export function classify(t: Track): AutoPick {
  const distKm = haversineKm(t.lat, t.lon, HOME.lat, HOME.lon);
  const rank = theaterRank(theaterOf(t.lat, t.lon));
  const near = `${Math.round(distKm)} km de FTTJ`;
  if (rank >= 3 && t.emergency) {
    return { id: t.id, cls: 0, reason: `urgence ${t.emergency} · ${near}`, distKm };
  }
  if (rank >= 3 && t.category?.toUpperCase() === "B6") {
    return { id: t.id, cls: 1, reason: `UAS catégorie B6 · ${near}`, distKm };
  }
  if (rank >= 4 && t.military) {
    return { id: t.id, cls: 2, reason: `militaire · ${near}`, distKm };
  }
  if (rank >= 4 && t.nic != null && t.nic < 5) {
    return { id: t.id, cls: 3, reason: `GNSS douteux · NIC ${t.nic} · ${near}`, distKm };
  }
  return { id: t.id, cls: 4, reason: `plus proche de FTTJ · ${near}`, distKm };
}

function better(a: AutoPick, b: AutoPick): boolean {
  return a.cls !== b.cls ? a.cls < b.cls : a.distKm < b.distKm;
}

/**
 * Piste à verrouiller, ou null s'il n'y a rien de réel à suivre. `current` est le verrou auto en
 * place : il est gardé tant qu'il reste entendu et que rien de plus grave n'apparaît, pour que le
 * panneau ne saute pas d'un avion à l'autre à chaque rafraîchissement.
 */
export function autoLockPick(tracks: Track[], now: number, current?: AutoPick | null): AutoPick | null {
  let best: AutoPick | null = null;
  let kept: AutoPick | null = null;
  for (const t of tracks) {
    if (!isAutoCandidate(t, now)) continue;
    const c = classify(t);
    if (current && t.id === current.id) kept = c;
    if (!best || better(c, best)) best = c;
  }
  if (!best) return null;
  if (!kept || kept.id === best.id) return best;
  if (best.cls < kept.cls) return best;
  if (best.cls === 4 && kept.cls === 4 && best.distKm < kept.distKm * NEAR_SWITCH_RATIO) return best;
  return kept;
}
