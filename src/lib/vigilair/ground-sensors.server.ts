/**
 * Capteurs SOL du périmètre — registre du poste (data/sensors.json) et leur entrée matérielle.
 *
 * Chaque capteur inscrit reçoit une CLÉ, montrée une fois au chef ; le poste n'en garde que
 * l'empreinte. Le capteur (ou sa passerelle : boîtier d'entrées, enregistreur vidéo, automate) dit
 * son état sur /api/capteur-sol avec cette clé, depuis le réseau du poste seulement. L'état affiché
 * est celui qu'il a dit (voir ground-sensors-core) : jamais posé à la main.
 *
 * Écritures : un changement d'état part sur le disque dans la seconde ; un simple « toujours OK »
 * au plus une fois par minute (un battement par capteur toutes les 30 s ne doit pas user le disque).
 * Le poste reçoit ; il n'envoie rien au capteur.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { ecrireFichierPoste, lireFichierPoste, listeJson } from "../disque-poste.server.ts";
import {
  appliquerMessage,
  avisEtat,
  avisRetour,
  etatCapteur,
  lireMessage,
  normaliserCapteur,
  silenceValide,
  TYPES,
  vueCapteur,
  type Avis,
  type GroundSensor,
  type GroundSensorVue,
  type SensorType,
} from "./ground-sensors-core.ts";
import { appelantSurPlace } from "./reseau-poste.ts";

/** Lu à chaque usage : le dossier du poste est celui où le serveur tourne. */
const fichier = () => path.join(process.cwd(), "data", "sensors.json");
const MAX = 1000;
/** Un capteur qui parle plus vite est refusé (429) : 10 messages par seconde au plus. */
const ECART_MIN_MS = 100;
/** La veille relit les capteurs à ce rythme : un silence se voit au plus 5 s après son délai. */
const RYTHME_VEILLE_MS = 5000;

const g = globalThis as unknown as {
  __afriSensors?: GroundSensor[];
  __afriSensorsLecture?: Promise<GroundSensor[]>;
  __afriSensorsFile?: Promise<void>;
  __afriSensorsPlan?: { at: number; minuterie: ReturnType<typeof setTimeout> };
  __afriSensorsDernier?: Map<string, number>;
  __afriSensorsDits?: Map<string, number>;
  __afriSensorsVeille?: ReturnType<typeof setInterval>;
};

/** Le registre en mémoire ; lu une seule fois, même si deux messages arrivent ensemble au départ. */
async function load(): Promise<GroundSensor[]> {
  if (g.__afriSensors) return g.__afriSensors;
  g.__afriSensorsLecture ??= (async () => {
    // Abîmé ou absent : sa copie (dossier des copies) ; rien de lisible : vide.
    const brut = (await lireFichierPoste(fichier(), listeJson<unknown>)) ?? [];
    g.__afriSensors ??= brut.map(normaliserCapteur).filter((s): s is GroundSensor => s !== null);
    return g.__afriSensors;
  })();
  await g.__afriSensorsLecture;
  return g.__afriSensors!;
}

/** Écrit le registre tel qu'il est à cet instant, une écriture après l'autre. */
function ecrire(): Promise<void> {
  const suite = (g.__afriSensorsFile ?? Promise.resolve()).then(() =>
    ecrireFichierPoste(fichier(), JSON.stringify(g.__afriSensors ?? [])),
  );
  g.__afriSensorsFile = suite.catch(() => undefined);
  return suite;
}

/** Une écriture au plus tard dans `delaiMs` ; une plus pressée avance celle qui attend. */
function planifierEcriture(delaiMs: number): void {
  const at = Date.now() + delaiMs;
  const plan = g.__afriSensorsPlan;
  if (plan && plan.at <= at) return;
  if (plan) clearTimeout(plan.minuterie);
  const minuterie = setTimeout(() => {
    g.__afriSensorsPlan = undefined;
    void ecrire().catch(() => undefined);
  }, delaiMs);
  minuterie.unref?.();
  g.__afriSensorsPlan = { at, minuterie };
}

async function remplacer(list: GroundSensor[]): Promise<void> {
  g.__afriSensors = list;
  await ecrire();
}

const empreinte = (cle: string) => createHash("sha256").update(cle, "utf8").digest("hex");

function cleValide(cle: string, attendue: string | null): boolean {
  if (!attendue || !cle || cle.length > 200) return false;
  return timingSafeEqual(Buffer.from(empreinte(cle), "hex"), Buffer.from(attendue, "hex"));
}

/** Clé neuve : 24 octets aléatoires, 32 caractères sûrs dans une URL. */
const nouvelleCle = () => randomBytes(24).toString("base64url");

export async function listSensorsServer(
  maintenant = Date.now(),
): Promise<{ maintenant: number; capteurs: GroundSensorVue[] }> {
  return { maintenant, capteurs: (await load()).map((s) => vueCapteur(s, maintenant)) };
}

export async function addSensorServer(input: {
  site?: string;
  type?: string;
  name?: string;
  silenceS?: unknown;
}): Promise<{ ok: boolean; error?: string; cle?: string; sensor?: GroundSensor }> {
  const site = (input?.site ?? "").trim().slice(0, 60);
  const name = (input?.name ?? "").trim().slice(0, 60);
  const type = (TYPES as string[]).includes(input?.type ?? "")
    ? (input.type as SensorType)
    : "autre";
  if (!site) return { ok: false, error: "site requis" };
  if (!name) return { ok: false, error: "nom requis" };
  const list = await load();
  if (list.length >= MAX) return { ok: false, error: `maximum ${MAX} capteurs` };
  const cle = nouvelleCle();
  const sensor: GroundSensor = {
    id: `sensor-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    site,
    type,
    name,
    at: Date.now(),
    empreinteCle: empreinte(cle),
    silenceS: silenceValide(input?.silenceS),
    recu: null,
    derniereAlarme: null,
  };
  await remplacer([sensor, ...list]);
  return { ok: true, cle, sensor };
}

/** Clé neuve pour un capteur : l'ancienne cesse aussitôt de valoir. */
export async function nouvelleCleServer(
  id: string,
): Promise<{ ok: boolean; error?: string; cle?: string; sensor?: GroundSensor }> {
  const list = await load();
  const s = list.find((x) => x.id === id);
  if (!s) return { ok: false, error: "capteur inconnu" };
  const cle = nouvelleCle();
  const sensor = { ...s, empreinteCle: empreinte(cle) };
  await remplacer(list.map((x) => (x.id === id ? sensor : x)));
  return { ok: true, cle, sensor };
}

export async function removeSensorServer(id: string): Promise<GroundSensor | null> {
  const list = await load();
  const s = list.find((x) => x.id === id) ?? null;
  if (s) await remplacer(list.filter((x) => x.id !== id));
  return s;
}

/**
 * Au chef et au journal, une fois par épisode. L'id fixé par l'épisode, déjà en base (redémarrage),
 * ne repart pas ; la console le montre sans le relayer (alert-relay).
 */
async function dire(a: Avis): Promise<void> {
  const dits = (g.__afriSensorsDits ??= new Map());
  if (dits.has(a.id)) return;
  dits.set(a.id, Date.now());
  if (dits.size > 5000) {
    const vieux = Date.now() - 86_400_000;
    for (const [id, t] of dits) if (t < vieux) dits.delete(id);
  }
  const { dispatchChefAlert, insertOpsLog } = await import("./staff");
  if (a.relayer) {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const deja = await sql<{ alert_id: string }>`
      select alert_id from alert_dispatch where alert_id = ${a.id}
    `;
    if (deja[0]) return;
    // Le relais injoignable ou pas encore réglé n'arrête rien : le journal garde l'avis.
    await dispatchChefAlert({ id: a.id, title: a.titre, body: a.corps, level: a.niveau }).catch(
      () => undefined,
    );
  }
  await insertOpsLog({
    userId: "veille-poste",
    actor: "Capteurs sol",
    role: "poste",
    team: "poste",
    kind: "capteur",
    title: a.titre,
    detail: a.corps,
    severity: a.niveau === "elevee" ? "crit" : a.niveau === "moderee" ? "warn" : "info",
  }).catch(() => undefined);
}

export type Reponse = { statut: number; corps: { ok: true } | { erreur: string } };

/**
 * Un message d'un capteur. `ip` : l'adresse de l'appelant ; `cle` : en-tête Authorization (Bearer)
 * ou paramètre « cle ». Un id inconnu et une mauvaise clé reçoivent la même réponse.
 */
export async function recevoirMessage(
  champs: Record<string, unknown>,
  cle: string,
  ip: string,
  maintenant = Date.now(),
): Promise<Reponse> {
  if (!appelantSurPlace(ip)) return { statut: 403, corps: { erreur: "hors du réseau du poste" } };
  const lu = lireMessage(champs);
  if ("erreur" in lu) return { statut: 400, corps: { erreur: lu.erreur } };
  const { id, etat, detail } = lu.message;
  const list = await load();
  const s = list.find((x) => x.id === id);
  if (!s || !cleValide(cle, s.empreinteCle)) {
    return { statut: 401, corps: { erreur: "clé refusée" } };
  }
  const derniers = (g.__afriSensorsDernier ??= new Map());
  if (maintenant - (derniers.get(id) ?? -Infinity) < ECART_MIN_MS) {
    return { statut: 429, corps: { erreur: "trop de messages" } };
  }
  derniers.set(id, maintenant);
  const avant = etatCapteur(s, maintenant).code;
  const apres = appliquerMessage(s, { etat, detail }, maintenant);
  g.__afriSensors = list.map((x) => (x.id === id ? apres : x));
  planifierEcriture(avant === etat ? 60_000 : 1000);
  if (avant !== etat) {
    // Aussitôt, sans attendre la veille : une alarme de deux secondes compte aussi.
    const avis = avisEtat(apres, maintenant) ?? avisRetour(apres, avant, maintenant);
    if (avis) void dire(avis).catch(() => undefined);
  }
  return { statut: 200, corps: { ok: true } };
}

/** Une ronde de la veille : les silences (et tout état resté sans avis, après un redémarrage). */
export async function veillerCapteurs(maintenant = Date.now()): Promise<Avis[]> {
  const avis = (await load())
    .map((s) => avisEtat(s, maintenant))
    .filter((a): a is Avis => a !== null);
  for (const a of avis) await dire(a).catch(() => undefined);
  return avis;
}

/** Lancée au démarrage du serveur construit, une fois par processus. */
export function veillerCapteursEnContinu(): void {
  if (g.__afriSensorsVeille) return;
  g.__afriSensorsVeille = setInterval(() => {
    void veillerCapteurs().catch(() => undefined);
  }, RYTHME_VEILLE_MS);
  g.__afriSensorsVeille.unref();
}
