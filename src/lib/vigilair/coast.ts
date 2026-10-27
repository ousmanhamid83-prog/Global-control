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
