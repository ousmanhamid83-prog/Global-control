/**
 * Liaison MAVLink avec NOS drones. Pour chaque drone inscrit qui a une adresse de liaison, le poste
 * se branche sur sa télémétrie, tient son état à jour et lui envoie les ordres du chef.
 *
 * Sur la liaison, le poste se présente comme une station sol (battement chaque seconde, système
 * 254 : pas celui de la station du pilote, dont l'arrêt déclenche la sécurité du drone) et demande
 * la télémétrie. Il n'y envoie rien d'autre que les ordres du chef. AfriControl lui-même n'émet
 * rien sur les ondes : c'est la radio du drone qui porte la liaison — sur le réseau du poste, ou par
 * sa radio de télémétrie branchée au poste (liaison série). Un drone peut avoir les deux : la
 * principale sert tant qu'elle vit, sinon celle de secours (réseau tombé, site isolé).
 */
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { closeSync, constants, openSync } from "node:fs";
import net from "node:net";
import tty from "node:tty";
import {
  appliquer,
  liaisonVivante,
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
  /** Liaison série : le port de la radio, lu et écrit par deux flux tty (chacun son descripteur). */
  serie: { lire: tty.ReadStream; ecrire: tty.WriteStream } | null;
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
  else if (l.serie) l.serie.ecrire.write(t);
  else if (l.udp && l.portStation !== null && l.vers.proto === "udp") {
    l.udp.send(t, l.portStation, l.vers.hote);
  }
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
  fermerSerie(l);
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

/**
 * Un port série tombé, dit au chef : débranché — la lecture finit, ou l'écriture échoue (EIO), selon
 * qui voit le premier la radio partie —, sinon l'erreur en clair.
 */
export function raisonSerie(chemin: string, e?: NodeJS.ErrnoException): string {
  return !e || e.code === "EIO"
    ? `port série ${chemin} fermé (radio débranchée ?)`
    : `port série ${chemin} : ${enClair(e)}`;
}

function fermerSerie(l: Lien): void {
  const s = l.serie;
  l.serie = null;
  s?.lire.destroy();
  s?.ecrire.destroy();
}

/**
 * La radio de télémétrie sur son port série : débit et mode brut réglés par stty (8N1, sans contrôle
 * de flux, sans écho ni traduction des fins de ligne, qui abîmeraient les trames), puis le port lu et
 * écrit par des flux tty — rien ne bloque un fil du serveur à attendre la radio. Débranchée, la
 * liaison est dite coupée et rouverte seule quand elle revient.
 */
function ouvrirSerie(l: Lien, chemin: string, debit: number): void {
  if (process.platform === "win32") {
    return coupee(
      l,
      "liaison série : sous Linux seulement pour l'instant, pas encore sous Windows",
    );
  }
  const reglage = [String(debit), "raw", "-echo", "-echoe", "-echok", "-crtscts", "clocal", "cs8"];
  execFile("stty", ["-F", chemin, ...reglage, "-cstopb", "-parenb"], (err) => {
    if (l.ferme) return;
    if (err) {
      return coupee(
        l,
        `port série ${chemin} absent ou refusé (radio débranchée ? compte hors du groupe dialout ?)`,
      );
    }
    const fds: number[] = [];
    try {
      // Sans attente : un port qui attendrait sa porteuse ne fige pas le serveur.
      const sans = constants.O_NOCTTY | constants.O_NONBLOCK;
      fds.push(openSync(chemin, constants.O_RDONLY | sans));
      fds.push(openSync(chemin, constants.O_WRONLY | sans));
    } catch (e) {
      for (const fd of fds) closeSync(fd);
      return coupee(l, `port série ${chemin} : ${enClair(e as NodeJS.ErrnoException)}`);
    }
    const lire = new tty.ReadStream(fds[0]!);
    const ecrire = new tty.WriteStream(fds[1]!);
    // libuv rouvre un terminal par son chemin et garde ce nouveau descripteur : le nôtre, resté en
    // double, se ferme ici — sinon chaque branchement de la radio en laisserait deux ouverts.
    for (const [fd, flux] of [
      [fds[0]!, lire],
      [fds[1]!, ecrire],
    ] as const) {
      if ((flux as unknown as { _handle?: { fd?: number } })._handle?.fd !== fd) closeSync(fd);
    }
    l.serie = { lire, ecrire };
    l.etat.lie = true;
    l.etat.erreur = null;
    l.reessaiMs = 2000;
    lire.on("data", (d: Buffer) => recevoir(l, d));
    const tombee = (e?: NodeJS.ErrnoException) => {
      if (l.serie?.lire === lire) coupee(l, raisonSerie(chemin, e));
    };
    lire.on("error", tombee);
    ecrire.on("error", tombee);
    lire.on("close", () => tombee());
  });
}

// Comme l'antenne 1090 : la liaison vit AVEC le serveur, jamais à sa place (unref partout).
function ouvrir(l: Lien): void {
  if (l.vers.proto === "serie") return ouvrirSerie(l, l.vers.chemin, l.vers.debit);
  const { hote, port } = l.vers;
  if (l.vers.proto === "tcp") {
    const s = net.createConnection({ host: hote, port });
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
    if (de.address !== hote) return; // le poste n'entend que la station nommée
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
  u.bind(port);
}

function fermer(l: Lien): void {
  l.ferme = true;
  clearInterval(l.horloge);
  if (l.reessai) clearTimeout(l.reessai);
  l.tcp?.destroy();
  l.udp?.close();
  fermerSerie(l);
}

/**
 * Met les liaisons d'accord avec le registre : ouvre celle d'un drone qui vient d'en recevoir une,
 * ferme celle d'un drone retiré ou dont l'adresse a changé. Une adresse refusée n'ouvre rien.
 */
export function synchroniserLiaisons(
  drones: readonly { id: string; liaison?: string; liaisonSecours?: string }[],
): void {
  const voulues = new Map<string, { id: string; adresse: string }>();
  for (const d of drones) {
    if (d.liaison) voulues.set(d.id, { id: d.id, adresse: d.liaison });
    if (d.liaisonSecours) voulues.set(`${d.id}${SECOURS}`, { id: d.id, adresse: d.liaisonSecours });
  }
  for (const [cle, l] of liens()) {
    if (voulues.get(cle)?.adresse !== l.adresse) {
      fermer(l);
      liens().delete(cle);
    }
  }
  for (const [cle, { id, adresse }] of voulues) {
    if (liens().has(cle)) continue;
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
      serie: null,
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
    liens().set(cle, l);
    ouvrir(l);
  }
}

/** La liaison de secours d'un drone se range sous son identifiant suivi de ceci. */
const SECOURS = "#secours";

/**
 * La liaison qui sert pour un drone : la principale tant qu'elle vit, sinon celle de secours si elle
 * vit ; aucune ne vit : la principale (ou la seule), qui dira pourquoi.
 */
function voie(id: string): { l: Lien; voie: "principale" | "secours" } | null {
  const principale = liens().get(id);
  const secours = liens().get(`${id}${SECOURS}`);
  const maintenant = Date.now();
  if (principale && liaisonVivante(principale.etat, maintenant))
    return { l: principale, voie: "principale" };
  if (secours && liaisonVivante(secours.etat, maintenant)) return { l: secours, voie: "secours" };
  if (principale) return { l: principale, voie: "principale" };
  return secours ? { l: secours, voie: "secours" } : null;
}

export function etatDrone(id: string): EtatDrone | null {
  const v = voie(id);
  return v ? { ...structuredClone(v.l.etat), voie: v.voie } : null;
}

/** L'état de chaque drone qui a une liaison, tel que le poste le tient, par la liaison qui sert. */
export function etatsDrones(): EtatDrone[] {
  const ids = new Set([...liens().values()].map((l) => l.etat.id));
  return [...ids].map((id) => etatDrone(id)!);
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
  const v = voie(id);
  if (!v) return { ok: false, suite: ["pas de liaison réglée pour ce drone"] };
  const l = v.l;
  const non = refus(ordre, p, l.etat, patrouille, reglages, Date.now());
  if (non) return { ok: false, suite: [`refusé par le poste : ${non}`] };
  if (l.occupe) return { ok: false, suite: ["un ordre est déjà en cours pour ce drone"] };
  l.occupe = true;
  try {
    const r = await executer(l, etapes(ordre, p, l.etat, patrouille));
    // La liaison de secours a servi : c'est dit, avec le reste, au journal.
    return v.voie === "secours" ? { ...r, suite: ["par la liaison de secours", ...r.suite] } : r;
  } finally {
    l.occupe = false;
  }
}
