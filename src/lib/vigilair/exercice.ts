/**
 * EXERCICE RÉEL : un de nos drones vole pour de vrai — programme de vol ArduPilot, sur l'appareil ou
 * en SITL, relié au poste par sa liaison MAVLink — et le chef lui fait jouer un intrus du catalogue.
 * Sa piste passe par le vrai moteur d'alerte (bulles, approche des sites, raids), marquée EXERCICE :
 * jamais relayée par Signal, jamais comptée comme un contact réel.
 */
import { PLATFORM_BY_ID } from "./catalog.ts";
import type { EtatDrone } from "./drones-pilotage";
import type { Track } from "./types";

/** Une mesure de la liaison : la position envoyée par l'autopilote, et son âge (ms). */
export type MesureLiaison = { position: NonNullable<EtatDrone["position"]>; ageMs: number };

export const PREFIXE_EXERCICE = "exe-";

/**
 * La piste d'exercice d'un drone. Rien n'est inventé : position, altitude, vitesse et cap sont ceux
 * que l'autopilote envoie, à l'heure de la mesure ; seule l'identité est jouée, et la piste le dit.
 * null si la plateforme n'existe pas au catalogue.
 */
export function pisteExercice(
  drone: { id: string; name: string },
  plateforme: string,
  mesure: MesureLiaison,
  maintenant: number,
  prev?: Track,
): Track | null {
  const p = PLATFORM_BY_ID[plateforme];
  if (!p) return null;
  const { position } = mesure;
  const at = maintenant - mesure.ageMs;
  const point = { lat: position.lat, lon: position.lon };
  const bouge = !prev || prev.lat !== position.lat || prev.lon !== position.lon;
  return {
    id: `${PREFIXE_EXERCICE}${drone.id}`,
    callsign: `EXE ${drone.name}`.slice(0, 24),
    lat: position.lat,
    lon: position.lon,
    altM: position.altM,
    heading: position.cap ?? prev?.heading ?? 0,
    speedKmh: position.vitesseMs * 3.6,
    climbMs: 0,
    trail: !prev ? [point] : bouge ? [...prev.trail, point].slice(-80) : prev.trail,
    truePlatformId: p.id,
    idState: "confirme",
    confidence: 100,
    confidenceNote:
      "Plateforme jouée par l'exercice, choisie par le chef : pas une identification.",
    origin: p.origin,
    classGuess: p.uasClass,
    hypotheses: [{ platformId: p.id, score: 100 }],
    sensors: ["liaison"],
    firstSeen: prev?.firstSeen ?? at,
    lastUpdate: at,
    dwellS: prev ? prev.dwellS + Math.max(0, (at - prev.lastUpdate) / 1000) : 0,
    confirmedAt: prev?.confirmedAt ?? at,
    // Calculé par la console après chaque mesure (il lui faut les zones vivantes).
    cpa: prev?.cpa ?? null,
    // Verrou « déjà prévenu » : la piste est reconstruite à chaque mesure, l'alerte ne part qu'une fois.
    siteWarned: prev?.siteWarned ?? false,
    launchFix: prev?.launchFix ?? {
      ...point,
      at,
      method: `vol d'exercice · liaison MAVLink de ${drone.name}`,
    },
    locked: prev?.locked ?? false,
    corridor: "Exercice",
    injected: true,
    feed: "exercice",
    exercice: { drone: drone.name, plateforme: p.id },
  };
}
