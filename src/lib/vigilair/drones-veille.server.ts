/**
 * Veille de NOS drones sur le 1090ES, DANS LE SERVEUR : toujours active, console ouverte ou non.
 * Une piste à l'adresse d'un drone inscrit et pas confirmée par le chef (élevée), ou que la
 * télémétrie du drone place à plus de 2 km (critique : adresse copiée ?), est dite au chef sur
 * Telegram / Signal et notée au journal — une fois par épisode : tant que la piste garde ce niveau.
 * Redite dès que le niveau change, ou quand la piste revient après 10 min d'absence. La console
 * montre la même règle (constat1090) sans la renvoyer au relais : un seul avertissement.
 */
import { matchOwnDrone, type OwnDrone } from "./drones-core.ts";
import {
  BATTEMENT_MAX_MS,
  constat1090,
  liaisonVivante,
  type EtatDrone,
} from "./drones-pilotage.ts";
import type { LiveAc } from "./live-adsb.ts";

/** Une piste absente plus longtemps : son retour est un nouvel épisode, redit au chef. */
export const OUBLI_MS = 10 * 60_000;
/** La veille relit l'image du poste à ce rythme (l'antenne en donne une toutes les secondes). */
const RYTHME_MS = 5000;

export type Episode = { niveau: string; vu: number };

export type Avis = {
  id: string;
  niveau: "elevee" | "critique";
  titre: string;
  corps: string;
  trackId: string;
};

/**
 * Les avis à donner pour cette image ; la mémoire des épisodes est mise à jour. `etat` rend ce que
 * la liaison d'un drone en sait (null sans liaison) : une position n'y compte que fraîche.
 */
export function avisDrones1090(
  drones: OwnDrone[],
  aircraft: readonly LiveAc[],
  etat: (id: string) => EtatDrone | null,
  episodes: Map<string, Episode>,
  maintenant: number,
): Avis[] {
  for (const [cle, ep] of episodes) if (maintenant - ep.vu > OUBLI_MS) episodes.delete(cle);
  const avis: Avis[] = [];
  for (const ac of aircraft) {
    const drone = matchOwnDrone(drones, ac.hex, ac.flight);
    if (!drone) continue;
    const e = drone.liaison ? etat(drone.id) : null;
    const p = e && liaisonVivante(e, maintenant) ? e.position : null;
    const telemetrie = p && maintenant - p.a <= BATTEMENT_MAX_MS ? p : null;
    const c = constat1090(drone, ac, telemetrie, maintenant);
    const cle = ac.hex.toLowerCase();
    const avant = episodes.get(cle);
    episodes.set(cle, { niveau: c.niveau, vu: maintenant });
    if (avant?.niveau === c.niveau || c.niveau === "faible") continue;
    avis.push({
      id: `owndrone-${cle}-${c.niveau}-${maintenant}`,
      niveau: c.niveau,
      titre: c.titre,
      corps: c.corps,
      trackId: `live-${cle}`,
    });
  }
  return avis;
}

const g = globalThis as unknown as {
  __afriVeilleDrones?: Map<string, Episode>;
  __afriVeilleMinuterie?: ReturnType<typeof setInterval>;
};

/** Une image du poste passée à la veille : les avis donnés au chef et au journal. */
export async function veillerDrones1090(
  aircraft: readonly LiveAc[],
  maintenant = Date.now(),
): Promise<Avis[]> {
  const { listDronesServer } = await import("./drones.server");
  const { etatDrone } = await import("./drones-liaison.server");
  const drones = await listDronesServer();
  if (drones.length === 0) return [];
  const avis = avisDrones1090(
    drones,
    aircraft,
    etatDrone,
    (g.__afriVeilleDrones ??= new Map()),
    maintenant,
  );
  if (avis.length === 0) return avis;
  const { dispatchChefAlert, insertOpsLog } = await import("./staff");
  for (const a of avis) {
    // Le relais injoignable ou pas encore réglé n'arrête rien : le journal garde l'avis.
    await dispatchChefAlert({ id: a.id, title: a.titre, body: a.corps, level: a.niveau }).catch(
      () => undefined,
    );
    await insertOpsLog({
      userId: "veille-poste",
      actor: "Veille du poste",
      role: "poste",
      team: "poste",
      kind: "drone",
      title: a.titre,
      detail: a.corps,
      trackId: a.trackId,
      severity: a.niveau === "critique" ? "crit" : "warn",
    }).catch(() => undefined);
  }
  return avis;
}

/** Lancée au démarrage du serveur construit, une fois par processus. */
export function veillerEnContinu(): void {
  if (g.__afriVeilleMinuterie) return;
  g.__afriVeilleMinuterie = setInterval(() => {
    void import("./live-feeds")
      .then(async ({ imagePoste }) => {
        const image = await imagePoste();
        if (image) await veillerDrones1090(image.aircraft);
      })
      .catch(() => undefined);
  }, RYTHME_MS);
  g.__afriVeilleMinuterie.unref();
}
