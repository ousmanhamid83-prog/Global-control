/**
 * Suivi de NOS drones côté console : ce que le poste tient de chaque drone par sa liaison, relevé
 * chaque seconde tant qu'une vue le regarde et qu'un drone a une liaison. Les ordres du chef
 * partent d'ici vers le poste, qui vérifie et envoie.
 */
import { dronesSnapshot, hydrateDrones } from "./drones";
import {
  droneLiaison,
  droneOrdre,
  dronePatrouille,
  dronesEtats,
  dronesReglages,
} from "./drones-api";
import type { Patrouille } from "./drones-core";
import {
  ORDRES_DRONE,
  type EtatDrone,
  type OrdreDrone,
  type ParametresOrdre,
  type ReglagesPilotage,
} from "./drones-pilotage";
import { withChefSeal } from "./seal-client";

export type Suivi = {
  etats: EtatDrone[];
  reglages: ReglagesPilotage | null;
  /** L'heure DU POSTE à ce relevé : c'est à elle que se compare l'âge d'un battement. */
  a: number;
  /** Point désigné sur la carte pour « aller à un point ». */
  designe: { lat: number; lon: number } | null;
};

const VIDE: Suivi = { etats: [], reglages: null, a: 0, designe: null };
let suivi: Suivi = VIDE;
const ecouteurs = new Set<() => void>();
let horloge: ReturnType<typeof setInterval> | null = null;

function poser(s: Suivi): void {
  suivi = s;
  ecouteurs.forEach((l) => l());
}

export async function releverSuivi(): Promise<void> {
  try {
    poser({ ...suivi, ...(await dronesEtats()) });
  } catch {
    /* poste injoignable : le dernier relevé reste, et son heure le fait voir muet */
  }
}

/** Un premier relevé donne les réglages ; ensuite, seulement tant qu'un drone a une liaison. */
function tic(): void {
  if (!suivi.reglages || dronesSnapshot().some((d) => d.liaison)) void releverSuivi();
}

export function subscribeSuivi(l: () => void): () => void {
  ecouteurs.add(l);
  if (!horloge) {
    tic();
    horloge = setInterval(tic, 1000);
  }
  return () => {
    ecouteurs.delete(l);
    if (ecouteurs.size === 0 && horloge) {
      clearInterval(horloge);
      horloge = null;
    }
  };
}
export const suiviSnapshot = (): Suivi => suivi;
export const suiviServeur = (): Suivi => VIDE;

export function designerPoint(point: { lat: number; lon: number } | null): void {
  poser({ ...suivi, designe: point });
}

const enClair = (e: unknown): string => (e instanceof Error ? e.message : "poste injoignable");

/** Un ordre du chef : le sceau est demandé pour ceux qui l'exigent, puis le poste vérifie et envoie. */
export async function ordonnerDrone(
  id: string,
  ordre: OrdreDrone,
  p: ParametresOrdre,
): Promise<{ ok: boolean; suite: string[] }> {
  const envoi = () => droneOrdre({ data: { id, ordre, ...p } });
  try {
    const r = await (ORDRES_DRONE.find((o) => o.id === ordre)!.sceau
      ? withChefSeal(envoi)
      : envoi());
    void releverSuivi();
    return r;
  } catch (e) {
    return { ok: false, suite: [enClair(e)] };
  }
}

/** Un réglage du registre par le chef ; réussi, le registre de la console est relu. Rend l'erreur. */
async function regler(
  appel: () => Promise<{ ok: boolean; error?: string }>,
): Promise<string | null> {
  try {
    const r = await appel();
    if (!r.ok) return r.error ?? "refusé";
    await hydrateDrones();
    return null;
  } catch (e) {
    return enClair(e);
  }
}

export const reglerLiaison = (id: string, adresse: string): Promise<string | null> =>
  regler(() => droneLiaison({ data: { id, adresse } }));

export const reglerPatrouille = (
  id: string,
  patrouille: Patrouille | null,
): Promise<string | null> => regler(() => dronePatrouille({ data: { id, patrouille } }));

export async function reglerPilotage(r: ReglagesPilotage): Promise<string | null> {
  try {
    poser({ ...suivi, reglages: await dronesReglages({ data: r }) });
    return null;
  } catch (e) {
    return enClair(e);
  }
}
