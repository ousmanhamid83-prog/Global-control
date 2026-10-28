/**
 * PISTE MÉMOIRE (coasting) et PLAUSIBILITÉ CINÉMATIQUE — cœur PUR, testable.
 *
 * Deux manques du radar, qui se soignent ensemble :
 *
 *  1) PISTE MUETTE. Une piste qui cesse d'émettre restait affichée, FIGÉE à sa dernière position,
 *     et dessinée exactement comme un retour vivant. À 800 km/h, un symbole peut être 10 km à côté
 *     sans que l'opérateur puisse le savoir. On fait ce que fait un radar : on la tient EN MÉMOIRE,
 *     on extrapole sa position à l'estime (dernier cap, dernière vitesse), on fait grandir un rayon
 *     d'incertitude avec le silence, et on l'abandonne au-delà du délai. Le symbole dit alors qu'il
 *     est prédit, pas mesuré. Intérêt direct pour la sûreté : un aéronef qui COUPE son transpondeur
 *     en approche d'un site ne disparaît plus en silence, il devient une piste mémoire signalée.
 *
 *  2) SAUT INVRAISEMBLABLE. Toute position reçue était acceptée telle quelle : une trame brouillée
 *     ou falsifiée pouvait téléporter une piste. On vérifie que le déplacement est physiquement
 *     atteignable dans le temps écoulé ; sinon on refuse le saut et on continue à l'estime.
 *
 * Analyse de SIGNAL et de cinématique, jamais d'identité. Dépend seulement de la géométrie.
 */
import { destPoint, haversineKm } from "./geo.ts";

export type CoastCfg = {
  /** Silence au-delà duquel la piste n'est plus tenue en mémoire (s). */
  dropAfterS: number;
  /**
   * Incertitude accumulée par seconde de silence, en fraction de la distance parcourue : l'estime
   * suppose un cap et une vitesse constants, ce qui se dégrade d'autant plus vite qu'on va vite.
   */
  spreadFrac: number;
  /** Rayon d'incertitude minimal dès la première seconde de silence (km). */
  minRadiusKm: number;
  /** Vitesse sol maximale crédible (km/h) : au-delà, le saut de position est invraisemblable. */
  maxSpeedKmh: number;
  /** Variation d'altitude maximale crédible (m/s). */
  maxClimbMs: number;
};

export const DEFAULT_COAST_CFG: CoastCfg = {
  dropAfterS: 45,
  spreadFrac: 0.25,
  minRadiusKm: 0.3,
  maxSpeedKmh: 1500,
  maxClimbMs: 80,
};

/** Navigation à l'estime : où serait la piste après `dtS` secondes au même cap et à la même vitesse. */
export function deadReckon(
  p: { lat: number; lon: number; heading: number; speedKmh: number },
  dtS: number,
): { lat: number; lon: number } {
  if (!(dtS > 0) || !(p.speedKmh > 0)) return { lat: p.lat, lon: p.lon };
  return destPoint(p.lat, p.lon, p.heading, (p.speedKmh * dtS) / 3600);
}

/**
 * Rayon d'incertitude d'une piste tenue en mémoire : il grandit avec le silence, proportionnellement
 * à la distance parcourue à l'estime. Une piste lente dérive peu, une piste rapide beaucoup.
 */
export function coastRadiusKm(
  speedKmh: number,
  silentS: number,
  cfg: CoastCfg = DEFAULT_COAST_CFG,
): number {
  if (!(silentS > 0)) return 0;
  const parcouru = (Math.max(0, speedKmh) * silentS) / 3600;
  return Math.max(cfg.minRadiusKm, parcouru * cfg.spreadFrac);
}

/** Vitesse sol qu'impliquerait ce déplacement dans ce laps de temps (km/h). */
export function impliedSpeedKmh(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  dtS: number,
): number {
  if (!(dtS > 0)) return Infinity;
  return (haversineKm(aLat, aLon, bLat, bLon) / dtS) * 3600;
}

export type JumpVerdict = {
  /** Le nouveau point est-il physiquement atteignable depuis le précédent ? */
  ok: boolean;
  /** Vitesse sol qu'il aurait fallu tenir. */
  impliedKmh: number;
  reason?: string;
};

/**
 * Ce nouveau relevé est-il crédible ? On compare le déplacement au temps écoulé (vitesse impliquée)
 * et la variation d'altitude au temps écoulé. Un écart impossible trahit une trame brouillée, un
 * décodage faux, ou une position falsifiée — jamais une identité, seulement une incohérence physique.
 */
export function checkJump(
  prev: { lat: number; lon: number; altM: number },
  next: { lat: number; lon: number; altM: number },
  dtS: number,
  cfg: CoastCfg = DEFAULT_COAST_CFG,
): JumpVerdict {
  const impliedKmh = impliedSpeedKmh(prev.lat, prev.lon, next.lat, next.lon, dtS);
  // Deux relevés dans la même milliseconde : rien à conclure, on laisse passer.
  if (!(dtS > 0)) return { ok: true, impliedKmh: 0 };
  if (impliedKmh > cfg.maxSpeedKmh) {
    return {
      ok: false,
      impliedKmh,
      reason: `saut de position : ${Math.round(impliedKmh)} km/h impliqués`,
    };
  }
  const climbMs = Math.abs(next.altM - prev.altM) / dtS;
  if (climbMs > cfg.maxClimbMs) {
    return {
      ok: false,
      impliedKmh,
      reason: `saut d'altitude : ${Math.round(climbMs)} m/s impliqués`,
    };
  }
  return { ok: true, impliedKmh };
}

/**
 * Relevés refusés d'affilée au-delà desquels ce n'est plus une trame ratée mais, très probablement,
 * DEUX ÉMETTEURS sur la même adresse ICAO : leurs positions alternent, donc chaque relevé contredit
 * le précédent. Un dédoublonnage par adresse ne peut pas le voir — il garde simplement le dernier.
 */
export const DUP_ADDR_RUN = 3;

/**
 * Fenêtre sur laquelle on compte les relevés refusés. Compter les refus CONSÉCUTIFS ne marche pas :
 * deux émetteurs qui alternent donnent « faux refusé, vrai accepté, faux refusé… », et un compteur
 * remis à zéro à chaque bonne trame ne dépasse jamais 1 — précisément sur le cas qu'il vise.
 * Ce qui trahit une adresse partagée, c'est la RÉPÉTITION dans le temps, pas l'enchaînement.
 */
export const DUP_ADDR_WINDOW_MS = 60_000;

/**
 * En deçà de cet âge, une position est considérée comme fraîche : le recalage est négligeable et on
 * n'encombre pas le scope d'une mention. Au-delà, l'opérateur doit savoir que le point est estimé.
 */
export const FRESH_S = 5;

/**
 * Silence à partir duquel on PRÉVIENT (et plus seulement on affiche). Bien au-delà de la latence
 * normale d'un agrégateur réseau, sinon chaque relevé ordinaire déclencherait une alerte.
 */
export const COAST_ALERT_S = 30;

export type SuspectState = {
  /** Relevés refusés comptés dans l'épisode courant. */
  run: number;
  /** Début de l'épisode (ms) : sert à dire sur quelle durée les incidents se sont produits. */
  since: number;
  /** Dernier incident (ms). L'épisode se ferme `windowMs` après LUI, pas après le premier. */
  at: number;
};

/**
 * L'épisode est-il encore ouvert ? On mesure depuis le DERNIER incident : tant que les relevés
 * incohérents continuent d'arriver, l'anomalie reste vivante. L'ancrer sur le premier la ferait
 * expirer au milieu d'un brouillage toujours en cours, et l'alerte clignoterait à chaque fenêtre.
 */
export function suspectActive(
  s: { at: number } | null | undefined,
  now: number,
  windowMs = DUP_ADDR_WINDOW_MS,
): boolean {
  return !!s && now - s.at <= windowMs;
}

/**
 * Enregistre un relevé refusé. Tant que l'épisode est ouvert on cumule ; sinon on en ouvre un neuf.
 * Une trame ratée isolée garde son motif physique ; la répétition devient une adresse ICAO
 * vraisemblablement tenue par deux émetteurs.
 */
export function noteJump(
  prev: SuspectState | null | undefined,
  now: number,
  reason: string,
  windowMs = DUP_ADDR_WINDOW_MS,
): SuspectState & { label: string; dupAddr: boolean } {
  const open = suspectActive(prev, now, windowMs);
  const run = open ? prev!.run + 1 : 1;
  const since = open ? prev!.since : now;
  const dupAddr = run >= DUP_ADDR_RUN;
  return {
    run,
    since,
    at: now,
    dupAddr,
    label: dupAddr
      ? `adresse ICAO partagée ? ${run} relevés incohérents en ${Math.round((now - since) / 1000)} s`
      : reason,
  };
}

export type CoastState = {
  /** Depuis combien de secondes la piste n'a plus rien émis. */
  silentS: number;
  /** Position extrapolée à l'estime. */
  lat: number;
  lon: number;
  /** Rayon d'incertitude autour de cette position (km). */
  radiusKm: number;
  /** Le silence dépasse le délai : la piste doit être abandonnée. */
  drop: boolean;
};

/**
 * Tient une piste muette : extrapole sa position, mesure l'incertitude, et dit quand l'abandonner.
 * `lastUpdate` est l'heure du DERNIER retour réel — pas celle du dernier affichage.
 */
export function stepCoast(
  t: { lat: number; lon: number; heading: number; speedKmh: number; lastUpdate: number },
  nowMs: number,
  cfg: CoastCfg = DEFAULT_COAST_CFG,
): CoastState {
  const silentS = Math.max(0, (nowMs - t.lastUpdate) / 1000);
  const p = deadReckon(t, silentS);
  return {
    silentS,
    lat: p.lat,
    lon: p.lon,
    radiusKm: coastRadiusKm(t.speedKmh, silentS, cfg),
    drop: silentS > cfg.dropAfterS,
  };
}
