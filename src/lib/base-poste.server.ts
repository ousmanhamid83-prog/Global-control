/**
 * La base embarquée du poste sur disque — CÔTÉ SERVEUR. Sans DATABASE_URL, le poste garde sa base
 * PGLite dans data/base : journal, comptes, quarts, zones et preuves survivent à l'arrêt, sans
 * limite de durée. AFRICONTROL_BASE=memoire la garde en mémoire (perdue à l'arrêt) ; un autre
 * chemin la place ailleurs.
 *
 * Un seul serveur par dossier : deux PGLite ouverts sur les mêmes fichiers ne se voient pas et
 * corrompent la base (mesuré : illisible une fois les deux fermés). Le serveur qui tient la base
 * écoute sur 127.0.0.1, sur un port pris par le système, et y répond par un jeton tiré au hasard ;
 * data/base.verrou porte son pid, ce port et ce jeton. Le suivant ne reprend le verrou que si son
 * serveur est mort, si personne n'écoute plus sur ce port (le système ferme le port à la mort du
 * processus, même tué net, et au redémarrage de la machine) ou si on y répond autre chose. Un
 * serveur muet est cru vivant : le doute laisse le second en mémoire, et le dit, plutôt que
 * d'ouvrir deux fois la base.
 *
 * Coupure de courant : PGLite lance Postgres avec « -F » (fsync coupé) et son système de fichiers
 * Node (NODEFS) n'a pas de fsync : rien n'était jamais forcé sur le disque. Simulé (seul ce qui
 * est forcé survit à une coupure), 10 coupures sur 10 laissaient une base illisible. Le poste
 * ouvre donc PGLite avec un vrai fsync (ouvrirPgliteDurable) : chaque validation confirmée est
 * sur le disque.
 *
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { cp, open, readdir, rename, rm } from "node:fs/promises";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";
import { formatDate } from "./vigilair/format.ts";

/** `reprise` : la base était illisible au démarrage, et ce que le poste en a fait. */
export type EtatBase =
  | { mode: "disque"; dossier: string; reprise?: string }
  | { mode: "memoire"; raison: string };

const g = globalThis as typeof globalThis & { __afriBase?: EtatBase; __afriRepriseNotee?: boolean };

/** Où se trouve la base, ou null hors PGLite (DATABASE_URL : la base du déploiement). */
export function etatBase(): EtatBase | null {
  return g.__afriBase ?? null;
}

/** Où le poste garde sa base, d'après AFRICONTROL_BASE (vide : data/base). */
export function choisirBase(valeur: string | undefined, cwd: string): EtatBase {
  const v = valeur?.trim();
  if (v === "memoire") {
    return {
      mode: "memoire",
      raison: "AFRICONTROL_BASE=memoire : la base est perdue à l'arrêt du serveur",
    };
  }
  return { mode: "disque", dossier: path.resolve(cwd, v || path.join("data", "base")) };
}

/** Les paramètres de lancement de PGLite, sans « -F » : fsync rétabli, le WAL forcé par fsync
 * (fdatasync, la méthode par défaut, ne fait rien dans PGLite). */
export function parametresDurables(defauts: readonly string[]): string[] {
  return [...defauts.filter((p) => p !== "-F"), "-c", "fsync=on", "-c", "wal_sync_method=fsync"];
}

type FluxNodefs = { nfd?: number; node: unknown };
type ModulePglite = {
  FS: {
    filesystems: {
      NODEFS: {
        stream_ops: { fsync?: (flux: FluxNodefs) => number };
        realPath(node: unknown): string;
        tryFSOperation(f: () => number): number;
      };
    };
  };
};

/** Forcer un dossier sur le disque (création, renommage) ; Windows ne le permet pas, NTFS
 * journalise ses noms lui-même. Synchrone : pour le fsync de NODEFS, appelé par Postgres. */
function fsyncDossier(dossier: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(dossier, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Le fsync que NODEFS n'a pas : celui de Node, sur le vrai fichier, ou le vrai dossier. */
function brancherFsync(mod: unknown): void {
  const nodefs = (mod as ModulePglite).FS.filesystems.NODEFS;
  nodefs.stream_ops.fsync = (flux) =>
    nodefs.tryFSOperation(() => {
      if (typeof flux.nfd === "number") fsyncSync(flux.nfd);
      else fsyncDossier(nodefs.realPath(flux.node));
      return 0;
    });
}

/**
 * Forcer un fichier ou un dossier sur le disque, sans figer le serveur. Le fichier est ouvert en
 * lecture-écriture : Windows refuse de forcer un fichier ouvert en lecture seule (EPERM).
 */
async function forcer(chemin: string, dossier: boolean): Promise<void> {
  if (dossier && process.platform === "win32") return;
  const f = await open(chemin, dossier ? "r" : "r+");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}

/** Tout un dossier forcé sur le disque : une base neuve (l'outil de création de PGLite l'écrit
 * sans un seul fsync), une sauvegarde, une sauvegarde reprise. */
async function forcerArbre(dossier: string): Promise<void> {
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) await forcerArbre(p);
    else if (e.isFile()) await forcer(p, false);
  }
  await forcer(dossier, true);
}

/** Ce dont on se sert du NodeFS de PGLite : son init, qui prépare le module Emscripten. */
type DisqueNode = {
  init(
    pg: unknown,
    opts: unknown,
  ): Promise<{ emscriptenOpts: { preRun?: unknown; printErr?: unknown } }>;
};

/**
 * PGLite ouvert sur `dossier` avec un vrai fsync : chaque validation confirmée est sur le disque.
 * Le postmaster.pid laissé par un arrêt brutal est retiré : le verrou du poste garantit déjà
 * qu'aucun autre serveur ne tient la base, et vide (coupure pendant son écriture) il empêche
 * Postgres de démarrer (« lock file "postmaster.pid" is empty »). Une base neuve est forcée sur le
 * disque en entier. Base qui refuse de démarrer : l'erreur porte la raison que Postgres a écrite
 * (PGLite la tait et ne dit que « Aborted() »). `PGlite` et `NodeFS` : les classes de
 * @electric-sql/pglite.
 */
export async function ouvrirPgliteDurable<
  T extends { waitReady: Promise<void>; close(): Promise<void> },
>(
  PGlite: { new (options: Record<string, unknown>): T; defaultStartParams: string[] },
  NodeFS: new (dossier: string) => DisqueNode,
  dossier: string,
  options: Record<string, unknown>,
): Promise<T> {
  const neuve = !existsSync(path.join(dossier, "PG_VERSION"));
  rmSync(path.join(dossier, "postmaster.pid"), { force: true });
  const disque = new NodeFS(dossier);
  const init = disque.init.bind(disque);
  let raison = "";
  disque.init = async (pg, opts) => {
    const r = await init(pg, opts);
    const preRun = Array.isArray(r.emscriptenOpts.preRun) ? r.emscriptenOpts.preRun : [];
    const ecrire = r.emscriptenOpts.printErr;
    const printErr = (ligne: string) => {
      const m = /\b(?:FATAL|PANIC):\s+(.+)$/.exec(ligne);
      if (m) raison = m[1]!.trim();
      if (typeof ecrire === "function") ecrire(ligne);
    };
    return {
      ...r,
      emscriptenOpts: { ...r.emscriptenOpts, preRun: [...preRun, brancherFsync], printErr },
    };
  };
  const pg = new PGlite({
    ...options,
    fs: disque,
    startParams: parametresDurables(PGlite.defaultStartParams),
  });
  try {
    await pg.waitReady;
    if (neuve) await forcerArbre(dossier);
  } catch (e) {
    // Ses fichiers relâchés : Windows refuse de mettre de côté un dossier aux fichiers ouverts.
    await pg.close().catch(() => undefined);
    throw raison ? new Error(raison, { cause: e }) : e;
  }
  return pg;
}

/** Une sauvegarde par jour, à côté de la base (data/base.sauvegarde). */
export const SAUVEGARDE_MS = 24 * 3_600_000;
const sauvegardeDe = (dossier: string) => `${dossier}.sauvegarde`;

/** `runExclusive` : le verrou de PGLite que prend chaque requête. */
type BaseOuverte = {
  exec(sql: string): Promise<unknown>;
  runExclusive<R>(fn: () => Promise<R>): Promise<R>;
};

/**
 * Sauvegarde la base sans figer le serveur (copie et fsync synchrones : 0,4 à 1,2 s de serveur figé
 * pour une base de 40 Mo, mesuré). D'abord un CHECKPOINT : PGLite n'en fait pas de lui-même avant
 * 1 Go de WAL (max_wal_size), que chaque sauvegarde copierait et qu'une reprise rejouerait depuis
 * la création de la base. Puis la copie, sous le verrou des requêtes : aucune
 * requête, donc aucune écriture, pendant la copie (le serveur ne ferme jamais la base, il s'arrête)
 * — l'image d'un instant, cohérente comme après un arrêt net ; les requêtes attendent (0,5 à 0,75 s
 * pour 40 Mo), le reste du serveur tourne (figé 11 ms au plus). La copie est ensuite forcée sur le
 * disque, hors du verrou (rien d'autre n'y écrit), et mise à la place de la précédente. Rend sa
 * durée et l'attente imposée aux requêtes (ms).
 */
export async function sauvegarder(
  pg: BaseOuverte,
  dossier: string,
): Promise<{ ms: number; attenteMs: number }> {
  const t0 = Date.now();
  const sauvegarde = sauvegardeDe(dossier);
  const part = `${sauvegarde}.part`;
  await rm(part, { recursive: true, force: true });
  await pg.exec("checkpoint");
  const t1 = Date.now();
  await pg.runExclusive(() =>
    cp(dossier, part, {
      recursive: true,
      filter: (source) => path.basename(source) !== "postmaster.pid",
    }),
  );
  const attenteMs = Date.now() - t1;
  await forcerArbre(part);
  await rm(sauvegarde, { recursive: true, force: true });
  await rename(part, sauvegarde);
  await forcer(path.dirname(dossier), true);
  return { ms: Date.now() - t0, attenteMs };
}

/** L'âge de la sauvegarde (ms), ou l'infini s'il n'y en a pas. */
function ageSauvegarde(dossier: string): number {
  try {
    return Date.now() - statSync(sauvegardeDe(dossier)).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Sauvegarde tout de suite si la dernière a plus d'un jour (ou manque), puis chaque jour. */
export function programmerSauvegardes(pg: BaseOuverte, dossier: string): Promise<void> {
  const tenter = async () => {
    if (ageSauvegarde(dossier) < SAUVEGARDE_MS) return;
    try {
      const { ms, attenteMs } = await sauvegarder(pg, dossier);
      console.log(
        `[base] sauvegarde faite en ${ms} ms (requêtes en attente ${attenteMs} ms) : ${sauvegardeDe(dossier)}`,
      );
    } catch (e) {
      console.error(`[base] sauvegarde impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  setInterval(() => void tenter(), 3_600_000).unref();
  return tenter();
}

/**
 * La base est illisible au démarrage : mise de côté (jamais effacée), remplacée par sa sauvegarde,
 * ou à défaut par une base neuve. Si rien ne s'ouvre, pas même une base neuve, le problème n'est
 * pas la base : elle est remise en place, et null.
 */
async function reprendre<T>(
  ouvrir: (dossier?: string) => Promise<T>,
  dossier: string,
  motif: string,
): Promise<{ pg: T; reprise: string } | null> {
  const cote = `${dossier}.illisible-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await rename(dossier, cote);
  } catch {
    return null;
  }
  const sauvegarde = sauvegardeDe(dossier);
  const date = existsSync(path.join(sauvegarde, "PG_VERSION"))
    ? formatDate(statSync(sauvegarde).mtimeMs)
    : null;
  for (const depuis of date ? [date, null] : [null]) {
    await rm(dossier, { recursive: true, force: true });
    if (depuis) {
      await cp(sauvegarde, dossier, { recursive: true });
      await forcerArbre(dossier);
    }
    try {
      const pg = await ouvrir(dossier);
      const quoi = depuis
        ? `reprise de la sauvegarde du ${depuis} (heure du poste)`
        : `base neuve, ${date ? "la sauvegarde illisible elle aussi" : "sans sauvegarde"}`;
      return {
        pg,
        reprise: `Base illisible au démarrage (${motif}) : ${quoi} ; la base illisible est gardée dans ${cote}`,
      };
    } catch {
      // Tentative suivante.
    }
  }
  await rm(dossier, { recursive: true, force: true });
  await rename(cote, dossier);
  return null;
}

/** Une reprise de la base, écrite une fois au journal du poste (après les migrations). */
export async function noterReprise(pg: {
  query(sql: string, params: unknown[]): Promise<unknown>;
}): Promise<void> {
  const e = g.__afriBase;
  if (e?.mode !== "disque" || !e.reprise || g.__afriRepriseNotee) return;
  g.__afriRepriseNotee = true;
  await pg.query(
    `insert into ops_log (id, user_id, actor, role, team, kind, title, detail, severity)
     values ($1, 'poste', 'Base du poste', 'poste', 'poste', 'base', $2, $3, 'crit')`,
    [randomBytes(12).toString("hex"), "Base illisible au démarrage : le poste l'a reprise", e.reprise],
  );
}

const SECRET_VALIDE = /^[0-9a-f]{64}$/;

function lireSecret(fichier: string): string | null {
  try {
    const lu = readFileSync(fichier, "utf8").trim();
    return SECRET_VALIDE.test(lu) ? lu : null;
  } catch {
    return null;
  }
}

/**
 * Le secret qui signe les sessions de connexion, gardé à côté de la base sur disque
 * (data/base.secret, lisible du seul compte du serveur) : une session ouverte survit au redémarrage
 * comme la base qui la garde, au lieu de déconnecter tout le personnel. Base en mémoire, disque
 * refusé ou fichier abîmé : null — un secret tiré pour la vie du processus, comme avant.
 */
export function secretDuPoste(valeur: string | undefined, cwd: string): string | null {
  const choix = choisirBase(valeur, cwd);
  if (choix.mode !== "disque") return null;
  const fichier = `${choix.dossier}.secret`;
  try {
    mkdirSync(path.dirname(fichier), { recursive: true });
    const secret = randomBytes(32).toString("hex");
    // « wx » : jamais par-dessus un secret déjà là — celui d'avant le redémarrage, ou d'un autre
    // serveur — qui est alors relu.
    writeFileSync(fichier, `${secret}\n`, { mode: 0o600, flag: "wx" });
    return secret;
  } catch {
    return lireSecret(fichier);
  }
}

type Verrou = { pid: number; port: number; jeton: string };

function lire(fichier: string): Verrou | null {
  try {
    const v = JSON.parse(readFileSync(fichier, "utf8")) as Partial<Verrou>;
    return typeof v.pid === "number" && typeof v.port === "number" && typeof v.jeton === "string"
      ? { pid: v.pid, port: v.port, jeton: v.jeton }
      : null;
  } catch {
    return null;
  }
}

const memeVerrou = (a: Verrou | null, b: Verrou | null) =>
  a !== null && b !== null && a.pid === b.pid && a.port === b.port && a.jeton === b.jeton;

const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code ?? String(e);

function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return code(e) === "EPERM";
  }
}

/** Le serveur du verrou répond-il, avec son jeton ? Seul un refus net ou un autre jeton dit non. */
function serveurDuVerrou(v: Verrou, delaiMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let recu = "";
    const s = connect({ host: "127.0.0.1", port: v.port });
    const fin = (vivant: boolean) => {
      clearTimeout(minuterie);
      s.destroy();
      resolve(vivant);
    };
    const minuterie = setTimeout(() => fin(true), delaiMs);
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      recu += d;
      if (recu.length >= v.jeton.length) fin(recu.startsWith(v.jeton));
    });
    s.on("end", () => fin(recu === v.jeton));
    s.on("error", (e) => fin(code(e) !== "ECONNREFUSED"));
  });
}

/** Le témoin : répond le jeton à qui se connecte ; ne retient pas le processus. */
function temoin(jeton: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer((s) => s.end(jeton));
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      srv.unref();
      resolve(srv);
    });
  });
}

/** Refus `occupee` : un autre serveur, vivant, tient la base. */
export type Prise =
  { ok: true; liberer: () => void } | { ok: false; raison: string; occupee?: true };

/**
 * Prend le dossier de la base pour ce serveur : le crée, pose le verrou, ou dit pourquoi non.
 * `delaiMs` : l'attente de la réponse du serveur d'un verrou existant ; Windows met environ 2 s à
 * refuser une connexion vers un port local fermé.
 */
export async function prendreBase(dossier: string, delaiMs = 5000): Promise<Prise> {
  try {
    mkdirSync(dossier, { recursive: true });
  } catch (e) {
    return { ok: false, raison: `dossier ${dossier} impossible à créer (${code(e)})` };
  }
  const fichier = `${dossier}.verrou`;
  const jeton = randomBytes(16).toString("hex");
  let srv: Server;
  try {
    srv = await temoin(jeton);
  } catch (e) {
    return { ok: false, raison: `témoin du verrou impossible à ouvrir sur 127.0.0.1 (${code(e)})` };
  }
  const moi: Verrou = { pid: process.pid, port: (srv.address() as AddressInfo).port, jeton };
  const refus = (raison: string): Prise => {
    srv.close();
    return { ok: false, raison };
  };

  for (let essai = 0; essai < 3; essai += 1) {
    try {
      const fd = openSync(fichier, "wx");
      writeSync(fd, JSON.stringify(moi));
      closeSync(fd);
      const liberer = () => {
        srv.close();
        process.removeListener("exit", liberer);
        try {
          if (memeVerrou(lire(fichier), moi)) unlinkSync(fichier);
        } catch {
          // Déjà retiré.
        }
      };
      process.once("exit", liberer);
      return { ok: true, liberer };
    } catch (e) {
      if (code(e) !== "EEXIST") return refus(`verrou ${fichier} impossible à poser (${code(e)})`);
    }
    // Un verrou illisible peut être en cours d'écriture : relu un instant plus tard.
    let v = lire(fichier);
    if (!v) {
      await new Promise((r) => setTimeout(r, 100));
      v = lire(fichier);
    }
    if (v && processusVivant(v.pid) && (await serveurDuVerrou(v, delaiMs))) {
      srv.close();
      return {
        ok: false,
        raison: `base déjà ouverte par un autre serveur du poste (pid ${v.pid})`,
        occupee: true,
      };
    }
    // Mort, ou plus personne pour répondre : repris, s'il n'a pas changé entre-temps.
    if (v === null || memeVerrou(lire(fichier), v)) {
      try {
        unlinkSync(fichier);
      } catch {
        // Retiré par un autre entre-temps.
      }
    }
  }
  return refus(`verrou ${fichier} disputé`);
}

/**
 * Ouvre la base du poste : sur disque, verrou pris, ou en mémoire — choisi, refusé (verrou, disque
 * en lecture seule) ou base illisible, dit au journal du serveur. `ouvrir(dossier)` ouvre PGLite
 * sur ce dossier, ou en mémoire sans dossier.
 *
 * Tenue par un autre serveur, la base est attendue `attenteMs` : un serveur relancé aussitôt
 * arrêté trouve le précédent encore en train de finir ses requêtes (jusqu'à 7 s, arret-serveur.ts)
 * et la reprend dès qu'il est sorti, au lieu de tourner toute sa vie en mémoire.
 */
export async function ouvrirBase<T>(
  ouvrir: (dossier?: string) => Promise<T>,
  valeur: string | undefined,
  cwd: string,
  attenteMs = 10_000,
): Promise<T> {
  const choix = choisirBase(valeur, cwd);
  let raison = choix.mode === "memoire" ? choix.raison : "";
  if (choix.mode === "disque") {
    const fin = Date.now() + attenteMs;
    let prise = await prendreBase(choix.dossier);
    while (!prise.ok && prise.occupee && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 500));
      prise = await prendreBase(choix.dossier);
    }
    if (prise.ok) {
      try {
        const pg = await ouvrir(choix.dossier);
        g.__afriBase = choix;
        console.log(`[base] sur disque : ${choix.dossier}`);
        return pg;
      } catch (e) {
        const motif = e instanceof Error ? e.message : String(e);
        const r = await reprendre(ouvrir, choix.dossier, motif);
        if (r) {
          g.__afriBase = { ...choix, reprise: r.reprise };
          console.error(`[base] ${r.reprise}`);
          return r.pg;
        }
        prise.liberer();
        raison = `base de ${choix.dossier} illisible (${motif}) ; ses fichiers sont laissés tels quels`;
      }
    } else {
      raison = prise.raison;
    }
    console.error(`[base] EN MÉMOIRE, perdue à l'arrêt : ${raison}`);
  }
  const pg = await ouvrir();
  g.__afriBase = { mode: "memoire", raison };
  return pg;
}
