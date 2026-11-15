/**
 * Liaison MAVLink avec NOS drones. Pour chaque drone inscrit qui a une adresse de liaison, le poste
 * se branche sur sa télémétrie, tient son état à jour et lui envoie les ordres du chef.
 *
 * Sur la liaison, le poste se présente comme une station sol (battement chaque seconde, système
 * 254 : pas celui de la station du pilote, dont l'arrêt déclenche la sécurité du drone) et demande
 * la télémétrie. Il n'y envoie rien d'autre que les ordres du chef. AfriControl lui-même n'émet
 * toujours rien sur les ondes : c'est la radio du drone qui porte la liaison.
 */
import dgram from "node:dgram";
import net from "node:net";
import {
  appliquer,
  etapes,
  etatVide,
  lireLiaison,
  refus,
  resultatEnClair,
  type AdresseLiaison,
  type Etape,
  type EtatDrone,
  type OrdreDrone,
  type ParametresOrdre,
  type ReglagesPilotage,
} from "./drones-pilotage.ts";
import type { Patrouille } from "./drones-core.ts";
import {
  battement,
  LecteurMavlink,
  missionNombre,
  missionPoint,
  ORDRE,
  ordreAller,
  ordreLong,
  trame,
  type MessageMav,
  type PointMission,
} from "./mavlink.ts";

/** Le poste sur la liaison : système 254, composant « station de mission » (190). */
const POSTE = { sys: 254, comp: 190 };
/** Télémétrie demandée au drone : message, puis son rythme (fois par seconde). */
const TELEMETRIE: readonly (readonly [number, number])[] = [
  [33, 4], // position
  [1, 1], // batterie
  [24, 1], // GPS
  [42, 1], // point de mission en cours
  [242, 0.2], // point de départ
];
/** Un ordre sans accusé est redit ; au bout de ces envois, le drone est dit sans réponse. */
const ENVOIS = 4;
const ATTENTE_ACCUSE_MS = 1500;
/** Le drone a répondu « en cours » : son accusé final est attendu ce temps-là, sans redire. */
const ATTENTE_EN_COURS_MS = 10_000;
const POSITION_VIEILLE_MS = 5000;

type Lien = {
  adresse: string;
  vers: AdresseLiaison;
  etat: EtatDrone;
  lecteur: LecteurMavlink;
  seq: number;
  tcp: net.Socket | null;
  udp: dgram.Socket | null;
  /** UDP : le port d'où parle la station, appris de ses datagrammes ; c'est là qu'on répond. */
  portStation: number | null;
  reessai: ReturnType<typeof setTimeout> | null;
  reessaiMs: number;
  horloge: ReturnType<typeof setInterval>;
  demandeA: number;
  /** L'ordre en cours écoute les messages du drone. */
  ecoute: ((m: MessageMav) => void) | null;
  occupe: boolean;
  ferme: boolean;
};

const g = globalThis as unknown as { __afriLiensDrones?: Map<string, Lien> };
const liens = (): Map<string, Lien> => (g.__afriLiensDrones ??= new Map());

function envoyer(l: Lien, m: { id: number; charge: Uint8Array }): void {
  const t = trame(l.seq, POSTE.sys, POSTE.comp, m.id, m.charge);
  l.seq = (l.seq + 1) & 0xff;
  if (l.tcp) l.tcp.write(t);
  else if (l.udp && l.portStation !== null) l.udp.send(t, l.portStation, l.vers.hote);
}

function demanderTelemetrie(l: Lien, maintenant: number): void {
  l.demandeA = maintenant;
  for (const [message, parSeconde] of TELEMETRIE) {
    envoyer(l, ordreLong(l.etat.cible!, ORDRE.RYTHME, [message, 1e6 / parSeconde]));
  }
}

function recevoir(l: Lien, octets: Uint8Array): void {
  const maintenant = Date.now();
  for (const m of l.lecteur.lire(octets)) {
    const connu = l.etat.cible !== null;
    appliquer(l.etat, m, maintenant);
    if (!connu && l.etat.cible) demanderTelemetrie(l, maintenant);
    const c = l.etat.cible;
    if (c && m.sys === c.sys && m.comp === c.comp) l.ecoute?.(m);
  }
  l.etat.signe = l.lecteur.signees > 0;
}

/** Chaque seconde : le battement du poste, et la télémétrie redemandée si la position se tait. */
function tic(l: Lien): void {
  if (!l.etat.lie) return;
  envoyer(l, battement());
  const maintenant = Date.now();
  const p = l.etat.position;
  const muette = !p || maintenant - p.a > POSITION_VIEILLE_MS;
  if (l.etat.cible && muette && maintenant - l.demandeA > POSITION_VIEILLE_MS) {
    demanderTelemetrie(l, maintenant);
  }
}

function coupee(l: Lien, erreur: string | null): void {
  l.etat.lie = false;
  if (erreur) l.etat.erreur = erreur;
  l.tcp = null;
  l.udp = null;
  l.portStation = null;
  l.lecteur = new LecteurMavlink();
  if (l.ferme || l.reessai) return;
  l.reessai = setTimeout(() => {
    l.reessai = null;
    ouvrir(l);
  }, l.reessaiMs);
  l.reessai.unref();
  l.reessaiMs = Math.min(l.reessaiMs * 2, 30_000);
}

const enClair = (e: NodeJS.ErrnoException): string =>
  e.code === "ECONNREFUSED"
    ? "connexion refusée : rien n'écoute à cette adresse"
    : e.code === "EADDRINUSE"
      ? "port déjà pris sur le poste"
      : e.code === "ETIMEDOUT" || e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH"
        ? "station injoignable sur le réseau"
        : (e.code ?? e.message);

// Comme l'antenne 1090 : la liaison vit AVEC le serveur, jamais à sa place (unref partout).
function ouvrir(l: Lien): void {
  if (l.vers.proto === "tcp") {
    const s = net.createConnection({ host: l.vers.hote, port: l.vers.port });
    s.unref();
    l.tcp = s;
    s.on("connect", () => {
      l.etat.lie = true;
      l.etat.erreur = null;
      l.reessaiMs = 2000;
    });
    s.on("data", (d: Buffer) => recevoir(l, d));
    s.on("error", (e: NodeJS.ErrnoException) => {
      l.etat.erreur = enClair(e);
    });
    s.on("close", () => {
      if (l.tcp === s) coupee(l, null);
    });
    return;
  }
  const u = dgram.createSocket("udp4");
  u.unref();
  l.udp = u;
  u.on("message", (d, de) => {
    if (de.address !== l.vers.hote) return; // le poste n'entend que la station nommée
    l.portStation = de.port;
    l.etat.lie = true;
    l.etat.erreur = null;
    recevoir(l, d);
    l.lecteur.oublier();
  });
  u.on("error", (e: NodeJS.ErrnoException) => {
    u.close();
    if (l.udp === u) coupee(l, enClair(e));
  });
  u.bind(l.vers.port);
}

function fermer(l: Lien): void {
  l.ferme = true;
  clearInterval(l.horloge);
  if (l.reessai) clearTimeout(l.reessai);
  l.tcp?.destroy();
  l.udp?.close();
}

/**
 * Met les liaisons d'accord avec le registre : ouvre celle d'un drone qui vient d'en recevoir une,
 * ferme celle d'un drone retiré ou dont l'adresse a changé. Une adresse refusée n'ouvre rien.
 */
export function synchroniserLiaisons(drones: readonly { id: string; liaison?: string }[]): void {
  const voulues = new Map(drones.filter((d) => d.liaison).map((d) => [d.id, d.liaison!]));
  for (const [id, l] of liens()) {
    if (voulues.get(id) !== l.adresse) {
      fermer(l);
      liens().delete(id);
    }
  }
  for (const [id, adresse] of voulues) {
    if (liens().has(id)) continue;
    const vers = lireLiaison(adresse);
    if ("erreur" in vers) continue;
    const l: Lien = {
      adresse,
      vers,
      etat: etatVide(id),
      lecteur: new LecteurMavlink(),
      seq: 0,
      tcp: null,
      udp: null,
      portStation: null,
      reessai: null,
      reessaiMs: 2000,
      horloge: setInterval(() => tic(l), 1000),
      demandeA: 0,
      ecoute: null,
      occupe: false,
      ferme: false,
    };
    l.horloge.unref();
    liens().set(id, l);
    ouvrir(l);
  }
}

/** L'état de chaque drone qui a une liaison, tel que le poste le tient. */
export function etatsDrones(): EtatDrone[] {
  return [...liens().values()].map((l) => structuredClone(l.etat));
}

export function etatDrone(id: string): EtatDrone | null {
  const l = liens().get(id);
  return l ? structuredClone(l.etat) : null;
}

/** Le premier message du drone que `garde` retient, ou null au bout de `ms`. */
function attendre<T>(l: Lien, garde: (m: MessageMav) => T | null, ms: number): Promise<T | null> {
  return new Promise((fini) => {
    const finir = (v: T | null) => {
      clearTimeout(delai);
      l.ecoute = null;
      fini(v);
    };
    const delai = setTimeout(() => finir(null), ms);
    l.ecoute = (m) => {
      const v = garde(m);
      if (v !== null) finir(v);
    };
  });
}

/** Les textes que le drone a dits depuis `debut` (raison d'un refus d'armement…), en une ligne. */
function dits(l: Lien, debut: number): string {
  const t = l.etat.textes.filter((x) => x.a >= debut).map((x) => x.texte);
  return t.length ? ` — le drone dit : ${t.reverse().join(" ; ")}` : "";
}

/** Un ordre direct : envoyé, redit tant que l'accusé manque, jugé sur la réponse du drone. */
async function ordonner(
  l: Lien,
  ordre: number,
  ecrire: (redite: number) => { id: number; charge: Uint8Array },
): Promise<string | null> {
  const debut = Date.now();
  const accuse = (ms: number) =>
    attendre(l, (m) => (m.nom === "COMMAND_ACK" && m.ordre === ordre ? m.resultat : null), ms);
  for (let redite = 0; redite < ENVOIS; redite++) {
    const reponse = accuse(ATTENTE_ACCUSE_MS);
    envoyer(l, ecrire(redite));
    let resultat = await reponse;
    while (resultat === 5) resultat = await accuse(ATTENTE_EN_COURS_MS);
    if (resultat === 0) return null;
    if (resultat !== null) return `${resultatEnClair(resultat)}${dits(l, debut)}`;
  }
  return `sans réponse du drone après ${ENVOIS} envois`;
}

/** Charge une mission : le poste annonce le nombre de points, le drone les demande un à un. */
async function charger(l: Lien, points: PointMission[]): Promise<string | null> {
  const cible = l.etat.cible!;
  let envoye = missionNombre(cible, points.length);
  for (let redite = 0; redite < ENVOIS;) {
    const suite = attendre(
      l,
      (m) =>
        m.nom === "MISSION_REQUEST"
          ? { point: m.seq }
          : m.nom === "MISSION_ACK"
            ? { fin: m.resultat }
            : null,
      ATTENTE_ACCUSE_MS,
    );
    envoyer(l, envoye);
    const r = await suite;
    if (r === null) {
      redite += 1;
      continue;
    }
    if ("fin" in r) return r.fin === 0 ? null : `mission refusée par le drone (code ${r.fin})`;
    const pt = points[r.point];
    if (!pt) return `le drone demande le point ${r.point}, qui n'existe pas`;
    envoye = missionPoint(cible, r.point, pt);
    redite = 0;
  }
  return `sans réponse du drone après ${ENVOIS} envois`;
}

/** Envoie les étapes au drone, dans l'ordre, et s'arrête à la première qui échoue. */
async function executer(l: Lien, liste: Etape[]): Promise<{ ok: boolean; suite: string[] }> {
  const cible = l.etat.cible!;
  const suite: string[] = [];
  for (const e of liste) {
    const echec =
      e.quoi === "mission"
        ? await charger(l, e.points)
        : e.quoi === "aller"
          ? await ordonner(l, ORDRE.ALLER, () => ordreAller(cible, e.lat, e.lon, e.hauteurM))
          : await ordonner(l, e.ordre, (redite) => ordreLong(cible, e.ordre, e.p, redite));
    suite.push(`${e.nom} : ${echec ?? "accepté"}`);
    if (echec) return { ok: false, suite };
  }
  return { ok: true, suite };
}

/**
 * LE SEUL CHEMIN d'un ordre vers un drone : le poste vérifie d'abord (refus), puis envoie les
 * étapes. Rend ce qui s'est passé, étape par étape, pour le journal. Un ordre à la fois par drone.
 */
export async function commander(
  id: string,
  ordre: OrdreDrone,
  p: ParametresOrdre,
  patrouille: Patrouille | undefined,
  reglages: ReglagesPilotage,
): Promise<{ ok: boolean; suite: string[] }> {
  const l = liens().get(id);
  if (!l) return { ok: false, suite: ["pas de liaison réglée pour ce drone"] };
  const non = refus(ordre, p, l.etat, patrouille, reglages, Date.now());
  if (non) return { ok: false, suite: [`refusé par le poste : ${non}`] };
  if (l.occupe) return { ok: false, suite: ["un ordre est déjà en cours pour ce drone"] };
  l.occupe = true;
  try {
    return await executer(l, etapes(ordre, p, l.etat, patrouille));
  } finally {
    l.occupe = false;
  }
}
