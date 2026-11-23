/**
 * Veille des BULLES, DANS LE SERVEUR : toujours active, console ouverte ou non.
 *
 * Mêmes pistes que la console (l'image du poste fusionnée par mergeLiveTracks, nos drones reconnus
 * à leur adresse 1090ES une fois confirmés par le chef, les pistes d'exercice de nos drones), mêmes
 * bulles (celles du poste, les sites miniers, les sites ajoutés), même règle (evaluateZones puis
 * passagesDe). Chaque passage est consigné au registre des bulles et au journal, en RÉEL comme en
 * EXERCICE : une vraie entrée ouvre un incident de sûreté et part au chef, une vraie approche part
 * au chef ; un exercice n'est jamais dit au chef. La console consigne les mêmes passages quand elle
 * est ouverte : le registre n'en garde qu'un par bulle, piste et sorte en 20 minutes.
 */
import { matchOwnDrone, exerciceEnCours, type OwnDrone } from "./drones-core.ts";
import {
  BATTEMENT_MAX_MS,
  constat1090,
  liaisonVivante,
  type EtatDrone,
} from "./drones-pilotage.ts";
import { pisteExercice, PREFIXE_EXERCICE } from "./exercice.ts";
import { mergeLiveTracks, type LiveAc } from "./live-adsb.ts";
import { mineZoneRows } from "./mines.ts";
import type { Track } from "./types";
import { siteEnBulle } from "./watch-sites-core.ts";
import {
  bulleDeLigne,
  DEFAULT_ZONES,
  evaluateZones,
  passagesDe,
  type Passage,
  type ZoneRow,
} from "./zones.ts";

const g = globalThis as unknown as {
  __afriVeilleBulles?: Track[];
  __afriConsignation?: Promise<unknown>;
};

/** Qui consigne : l'opérateur dont la console a vu le passage, ou la veille du poste. */
export type Auteur = { userId: string; actor: string; role: string; team: string };

export const VEILLE_DU_POSTE: Auteur = {
  userId: "veille-poste",
  actor: "Veille du poste",
  role: "poste",
  team: "poste",
};

/** Les bulles du poste (registre en base ; les bulles par défaut posées au premier usage). */
export async function lireBulles(): Promise<ZoneRow[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const n = await sql<{ n: number }>`select count(*)::int as n from protected_zone`;
  if ((n[0]?.n ?? 0) === 0) {
    for (const z of DEFAULT_ZONES) {
      await sql`
        insert into protected_zone (id, name, kind, lat, lon, radius_km, armed, note)
        values (${z.id}, ${z.name}, ${z.kind}, ${z.lat}, ${z.lon}, ${z.radiusKm}, ${z.armed}, ${z.note})
        on conflict (id) do nothing
      `;
    }
  }
  const rows = await sql<{
    id: string;
    name: string;
    kind: string;
    lat: number;
    lon: number;
    radius_km: number;
    armed: boolean;
    note: string;
  }>`
    select id, name, kind, lat, lon, radius_km, armed, note
    from protected_zone
    order by name
  `;
  return rows.map(bulleDeLigne);
}

/**
 * Un passage au registre des bulles et au journal ; `fresh` faux s'il y était déjà (même bulle,
 * même piste, même sorte, moins de 20 minutes), et alors rien d'autre ne part.
 */
export function consignerPassage(p: Passage, auteur: Auteur): Promise<{ fresh: boolean }> {
  // Une consignation après l'autre : la console et la veille peuvent voir le même passage à la même
  // milliseconde ; lire puis écrire le registre d'un bloc évite qu'il soit écrit deux fois.
  const suite = (g.__afriConsignation ?? Promise.resolve()).then(() => consigner(p, auteur));
  g.__afriConsignation = suite.catch(() => undefined);
  return suite;
}

async function consigner(p: Passage, auteur: Auteur): Promise<{ fresh: boolean }> {
  const { getSql } = await import("@/lib/db");
  const { dispatchChefAlert, insertOpsLog, insertSecurityIncident, mintId } =
    await import("./staff");
  const sql = await getSql();
  const recent = await sql<{ id: string }>`
    select id from zone_breach
    where zone_id = ${p.zoneId}
      and track_id = ${p.trackId}
      and kind = ${p.kind}
      and created_at > now() - interval '20 minutes'
    limit 1
  `;
  if (recent[0]) return { fresh: false };
  const id = await mintId();
  await sql`
    insert into zone_breach (id, zone_id, zone_name, track_id, callsign, dist_km, kind, uas, exercice, actor)
    values (
      ${id}, ${p.zoneId}, ${p.zoneName}, ${p.trackId}, ${p.callsign},
      ${p.distKm}, ${p.kind}, ${p.uas}, ${p.exercice}, ${auteur.actor}
    )
  `;
  const km = p.distKm.toFixed(2);
  const journal = (title: string, detail: string, severity: "info" | "warn" | "crit") =>
    insertOpsLog({ ...auteur, kind: "zone", title, detail, trackId: p.trackId, severity });
  if (p.exercice) {
    // Exercice : au journal, marqué comme tel — ni incident de sûreté, ni alerte du chef.
    const sorte = p.kind === "approach" ? "Approche" : "Intrusion";
    await journal(
      `EXERCICE · ${sorte} · ${p.zoneName} · ${p.callsign}`,
      `${km} km · vol d'exercice de notre drone, pas un contact réel`,
      "info",
    );
  } else if (p.kind === "inside") {
    const title = `Intrusion · ${p.zoneName} · ${p.callsign}`;
    const detail = `${p.callsign} dans la bulle ${p.zoneName} (${km} km du centre). AfriControl n'émet pas.`;
    const incident = await insertSecurityIncident({
      userId: auteur.userId,
      actor: auteur.actor,
      kind: "zone_breach",
      title,
      detail,
      workRecap: `Bulle ${p.zoneName}. Piste ${p.callsign}. Lecture seule — aucun effet RF.`,
    });
    await dispatchChefAlert({ id: incident.id, title, body: detail, level: "critique" }).catch(
      () => [],
    );
    await journal(title, detail, "crit");
  } else {
    const title = `Approche · ${p.zoneName} · ${p.callsign}`;
    const detail = `${km} km · fermeture sur la bulle.`;
    await dispatchChefAlert({ id: `zoneap-${id}`, title, body: detail, level: "elevee" }).catch(
      () => [],
    );
    await journal(title, detail, "warn");
  }
  return { fresh: true };
}

/** La télémétrie fraîche d'un de nos drones, ou null (pas de liaison, liaison muette, trop vieille). */
function telemetrie(
  d: OwnDrone,
  etat: (id: string) => EtatDrone | null,
  maintenant: number,
): NonNullable<EtatDrone["position"]> | null {
  const e = d.liaison ? etat(d.id) : null;
  const p = e && liaisonVivante(e, maintenant) ? e.position : null;
  return p && maintenant - p.a <= BATTEMENT_MAX_MS ? p : null;
}

/**
 * Les pistes de la veille, comme la console les fait : l'image fusionnée, nos drones reconnus (amis
 * une fois confirmés par le chef), les pistes d'exercice de nos drones.
 */
export function pistesDeVeille(
  avant: Track[],
  aircraft: readonly LiveAc[],
  drones: OwnDrone[],
  etat: (id: string) => EtatDrone | null,
  maintenant: number,
): Track[] {
  const { tracks } = mergeLiveTracks(
    avant.filter((t) => t.feed === "adsb"),
    [...aircraft],
    maintenant,
  );
  // Comme la console : une piste à l'adresse d'un de nos drones n'est amie qu'une fois confirmée par
  // le chef (une adresse se copie) ; sinon elle garde sa pleine évaluation.
  for (const t of tracks) {
    const hit = matchOwnDrone(drones, t.id.slice(5), t.callsign);
    if (!hit) continue;
    const ami = constat1090(hit, t, telemetrie(hit, etat, maintenant), maintenant).ami;
    t.friendKind = ami ? "drone" : undefined;
    t.ownDrone = hit.name;
  }
  const exercices: Track[] = [];
  for (const d of drones) {
    const plateforme = exerciceEnCours(d, maintenant);
    const p = plateforme ? telemetrie(d, etat, maintenant) : null;
    if (!plateforme || !p) continue;
    const prev = avant.find((t) => t.id === `${PREFIXE_EXERCICE}${d.id}`);
    const t = pisteExercice(
      d,
      plateforme,
      { position: p, ageMs: maintenant - p.a },
      maintenant,
      prev,
    );
    if (t) exercices.push(t);
  }
  return [...tracks, ...exercices];
}

/** Une image du poste passée à la veille des bulles : les passages consignés. */
export async function veillerBulles(
  aircraft: readonly LiveAc[],
  maintenant = Date.now(),
): Promise<Passage[]> {
  const { listDronesServer } = await import("./drones.server");
  const { etatDrone } = await import("./drones-liaison.server");
  const { listSitesServer } = await import("./watch-sites.server");
  const pistes = pistesDeVeille(
    g.__afriVeilleBulles ?? [],
    aircraft,
    await listDronesServer(),
    etatDrone,
    maintenant,
  );
  g.__afriVeilleBulles = pistes;
  const bulles = [
    ...(await lireBulles()),
    ...mineZoneRows(),
    ...(await listSitesServer()).map(siteEnBulle),
  ];
  const passages = passagesDe(evaluateZones(pistes, bulles));
  for (const p of passages) await consignerPassage(p, VEILLE_DU_POSTE).catch(() => undefined);
  return passages;
}
