/**
 * Suivi de NOS drones côté console : ce que le poste tient de chaque drone par sa liaison, relevé
 * chaque seconde tant qu'une vue le regarde et qu'un drone a une liaison. Les ordres du chef
 * partent d'ici vers le poste, qui vérifie et envoie.
 */
import { dronesSnapshot, hydrateDrones } from "./drones";
import {
  droneConfirmer1090,
  droneFond,
  droneLiaison,
  droneOrdre,
  dronePatrouille,
  dronesEtats,
  dronesReglages,
  fetchDroneFrame,
} from "./drones-api";
import { effectiveUrl, type OwnDrone, type Patrouille } from "./drones-core";
import { chargerImage, poserImageFond } from "./drones-dessin";
import type { Calage, PointGeo } from "./drones-fond";
import {
  BATTEMENT_MAX_MS,
  liaisonVivante,
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
  /** L'heure de la console quand ce relevé est arrivé. */
  recu: number;
  /** Point désigné sur la carte pour « aller à un point ». */
  designe: { lat: number; lon: number } | null;
  /** Calage en cours : les coins de l'image de cette source, cliqués sur la carte (0 à 4). */
  calage: { id: string; coins: PointGeo[] } | null;
};

const VIDE: Suivi = { etats: [], reglages: null, a: 0, recu: 0, designe: null, calage: null };
let suivi: Suivi = VIDE;
const ecouteurs = new Set<() => void>();
let horloge: ReturnType<typeof setInterval> | null = null;

function poser(s: Suivi): void {
  suivi = s;
  ecouteurs.forEach((l) => l());
}

export async function releverSuivi(): Promise<void> {
  try {
    // Attendre AVANT de recopier l'état : recopié avant, il effacerait ce que le chef a fait
    // pendant l'attente (un coin cliqué, un point désigné).
    const releve = await dronesEtats();
    poser({ ...suivi, ...releve, recu: Date.now() });
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

/** Un relevé plus vieux ne recoupe plus rien : le drone a pu faire 300 m entre-temps. */
const RELEVE_FRAIS_MS = 15_000;

/**
 * Où la liaison situe un drone, pour recouper une piste 1090ES à son adresse : seulement d'un relevé
 * frais et d'une liaison vivante. Hors d'une vue qui suit les drones, le relevé est redemandé ici,
 * pour le tour suivant.
 */
export function telemetriePour(
  id: string,
  maintenant: number,
): { lat: number; lon: number } | null {
  if (maintenant - suivi.recu > 2000) void releverSuivi();
  if (maintenant - suivi.recu > RELEVE_FRAIS_MS) return null;
  const e = suivi.etats.find((x) => x.id === id);
  return e && liaisonVivante(e, suivi.a) ? e.position : null;
}

export function designerPoint(point: { lat: number; lon: number } | null): void {
  poser({ ...suivi, designe: point });
}

/** Calage à la main : commence (ou abandonne, null) la pose des quatre coins d'une source. */
export function calerSource(id: string | null): void {
  poser({ ...suivi, calage: id ? { id, coins: [] } : null });
}

/** Un clic sur la carte pendant un calage : le coin suivant, jusqu'au quatrième. */
export function poserCoin(point: PointGeo): void {
  const c = suivi.calage;
  if (!c || c.coins.length >= 4) return;
  poser({ ...suivi, calage: { id: c.id, coins: [...c.coins, point] } });
}

const enClair = (e: unknown): string => (e instanceof Error ? e.message : "poste injoignable");

/**
 * Une image de la source vient d'arriver : la carte la garde, et la pose si son fond est réglé.
 * Pour une emprise calculée, la liaison est relevée à cet instant : c'est là qu'était le drone.
 */
export async function imagePourFond(source: OwnDrone, image: HTMLImageElement): Promise<void> {
  let position: EtatDrone["position"] = null;
  if (source.fond?.mode === "drone") {
    await releverSuivi();
    const e = suivi.etats.find((x) => x.id === source.id);
    const fraiche = e?.position && suivi.a - e.position.a <= BATTEMENT_MAX_MS;
    position = e && fraiche && liaisonVivante(e, suivi.a) ? e.position : null;
  }
  poserImageFond(source, image, Date.now(), position);
  poser({ ...suivi });
}

/** Relève l'image d'une source à la demande, pour son fond de carte. Rend l'erreur, ou null. */
export async function releverImageFond(source: OwnDrone): Promise<string | null> {
  const url = effectiveUrl(source);
  if (!url) return "cette source n'a pas d'adresse d'image";
  try {
    const r = await fetchDroneFrame({ data: { url } });
    if (!r.ok || !r.dataUrl) return r.error ?? "image indisponible";
    await imagePourFond(source, await chargerImage(r.dataUrl));
    return null;
  } catch (e) {
    return enClair(e);
  }
}

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

export const reglerLiaison = (
  id: string,
  adresse: string,
  secours = false,
): Promise<string | null> => regler(() => droneLiaison({ data: { id, adresse, secours } }));

export const reglerPatrouille = (
  id: string,
  patrouille: Patrouille | null,
): Promise<string | null> => regler(() => dronePatrouille({ data: { id, patrouille } }));

export const reglerFond = (id: string, fond: Calage | null): Promise<string | null> =>
  regler(() => droneFond({ data: { id, fond } }));

export const confirmerPiste1090 = (id: string, confirmer: boolean): Promise<string | null> =>
  regler(() => droneConfirmer1090({ data: { id, confirmer } }));

export async function reglerPilotage(r: ReglagesPilotage): Promise<string | null> {
  try {
    const reglages = await dronesReglages({ data: r });
    poser({ ...suivi, reglages });
    return null;
  } catch (e) {
    return enClair(e);
  }
}
