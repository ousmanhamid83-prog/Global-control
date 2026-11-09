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
 * Copies (dossier des copies, voir disque-poste.server.ts) : chaque écriture du journal de Postgres
 * (pg_wal) est refaite aussitôt dans copies/ecritures et forcée avec lui, avant que la validation
 * soit confirmée ; une copie complète de la base est prise chaque jour à chaud, les requêtes
 * continuant pendant (copies/jour-AAAA-MM-JJ, toutes gardées). Base illisible au démarrage, ou
 * absente (dossier effacé, disque du poste remplacé) alors que ses copies sont là : la copie la plus
 * récente, puis les écritures doublées depuis — rien de perdu. Une base neuve (plus aucune copie
 * lisible) range d'abord l'ancienne génération dans copies/avant-<date> : gardée, jamais réécrite.
 *
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";
import {
  choisirCopies,
  forcer,
  forcerArbre,
  fsyncDossier,
  noterDefautCopie,
} from "./disque-poste.server.ts";
import { formatDate, jourPoste } from "./vigilair/format.ts";

/** `reprise` : la base était illisible au démarrage, et ce que le poste en a fait. */
export type EtatBase =
  | { mode: "disque"; dossier: string; reprise?: string }
  | { mode: "memoire"; raison: string };

const g = globalThis as typeof globalThis & {
  __afriBase?: EtatBase;
  __afriRepriseNotee?: boolean;
  __afriEcritures?: Ecritures;
  /** Où une base neuve a rangé l'ancienne génération (copies, écritures doublées). */
  __afriRangee?: string;
};

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
 * (fdatasync, la méthode par défaut, ne fait rien dans PGLite). Sans le suivi du démarrage : sa
 * minuterie de 10 s survivait à une ouverture ratée (une copie illisible essayée à la reprise) et
 * gardait en mémoire tout le Postgres raté, ~180 Mo chaque fois. */
export function parametresDurables(defauts: readonly string[]): string[] {
  return [
    ...defauts.filter((p) => p !== "-F"),
    ...["-c", "fsync=on", "-c", "wal_sync_method=fsync", "-c", "log_startup_progress_interval=0"],
  ];
}

const SEGMENT_WAL = /^[0-9A-F]{24}$/;

/** Le nom du segment du journal d'écritures (pg_wal/<24 chiffres>) qu'est ce chemin, ou null. */
function segmentWal(chemin: string): string | null {
  const nom = path.basename(chemin);
  return path.basename(path.dirname(chemin)) === "pg_wal" && SEGMENT_WAL.test(nom) ? nom : null;
}

/**
 * Les écritures doublées : chaque écriture de Postgres dans un segment de son journal est refaite
 * au même endroit dans copies/ecritures, et forcée sur le disque avec la sienne, avant que la
 * validation soit confirmée. Une copie qui échoue (disque plein, clé retirée) ne fait jamais
 * échouer la base : le doublement s'arrête, le défaut est dit, un marqueur posé à côté de la base
 * (`marqueur`, il survit à un arrêt), et la prochaine copie du jour ou la prochaine ouverture le
 * remet en route en recopiant le journal de la base.
 */
class Ecritures {
  private fds = new Map<string, number>();
  actif = true;
  /** Une panne réparée en recopiant le journal de la base : une copie neuve doit suivre (des
   * segments écrits pendant la panne ont pu quitter son journal depuis). */
  remettre = false;
  readonly dossier: string;
  readonly marqueur: string;

  /** Le dossier est créé d'avance : une base neuve écrit son journal dès sa création. */
  constructor(dossier: string, marqueur: string) {
    this.dossier = dossier;
    this.marqueur = marqueur;
    this.essayer(() => mkdirSync(dossier, { recursive: true }));
  }

  private essayer(faire: () => void): void {
    if (!this.actif) return;
    try {
      faire();
    } catch (e) {
      this.actif = false;
      for (const nom of [...this.fds.keys()]) this.fermer(nom);
      noterDefautCopie("écritures doublées de la base", e);
      try {
        writeFileSync(this.marqueur, `${new Date().toISOString()}\n`);
      } catch {
        // Le disque du poste refuse aussi : le défaut reste dit tant que le serveur tourne.
      }
    }
  }

  ecrire(nom: string, octets: Uint8Array, position: number): void {
    this.essayer(() => {
      let fd = this.fds.get(nom);
      if (fd === undefined) {
        fd = openSync(path.join(this.dossier, nom), constants.O_RDWR | constants.O_CREAT);
        this.fds.set(nom, fd);
      }
      writeSync(fd, octets, 0, octets.length, position);
    });
  }

  forcer(nom: string): void {
    this.essayer(() => {
      const fd = this.fds.get(nom);
      if (fd !== undefined) fsyncSync(fd);
    });
  }

  fermer(nom: string): void {
    const fd = this.fds.get(nom);
    if (fd === undefined) return;
    this.fds.delete(nom);
    try {
      closeSync(fd);
    } catch {
      // Déjà fermé.
    }
  }

  /**
   * Recopie les segments du journal de la base (`pgWal`, à partir de `depuis`, tous si null) et
   * reprend le doublement. Sans panne notée, seuls les segments absents sont recopiés : le miroir,
   * écrit en même temps que le journal, n'en sait jamais moins que lui, et un journal abîmé
   * n'écrase pas des écritures saines. Synchrone : Postgres tourne dans le même fil, aucune
   * écriture ne peut s'y glisser.
   */
  realigner(pgWal: string, depuis: string | null): void {
    try {
      const panne = !this.actif || existsSync(this.marqueur);
      mkdirSync(this.dossier, { recursive: true });
      for (const nom of readdirSync(pgWal)) {
        if (!SEGMENT_WAL.test(nom) || (depuis !== null && nom < depuis)) continue;
        const cible = path.join(this.dossier, nom);
        if (!panne && existsSync(cible)) continue;
        this.fermer(nom);
        copyFileSync(path.join(pgWal, nom), cible);
        const fd = openSync(cible, "r+");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      fsyncDossier(this.dossier);
      rmSync(this.marqueur, { force: true });
      if (panne) this.remettre = true;
      this.actif = true;
      noterDefautCopie("écritures doublées de la base", null);
    } catch (e) {
      this.actif = false;
      noterDefautCopie("écritures doublées de la base", e);
    }
  }
}

type FluxNodefs = { nfd?: number; node: unknown; shared?: { refcount: number } };
type OpsNodefs = {
  fsync?: (flux: FluxNodefs) => number;
  write(
    flux: FluxNodefs,
    tampon: Uint8Array,
    debut: number,
    longueur: number,
    position: number,
    ...reste: unknown[]
  ): number;
  close(flux: FluxNodefs): void;
};
type ModulePglite = {
  FS: {
    filesystems: {
      NODEFS: {
        stream_ops: OpsNodefs;
        realPath(node: unknown): string;
        tryFSOperation(f: () => number): number;
      };
    };
  };
};

/**
 * Les crochets du poste sur NODEFS : le fsync qu'il n'a pas (celui de Node, sur le vrai fichier ou
 * le vrai dossier) et, avec `ecritures`, les écritures du journal doublées et forcées avec lui.
 */
function crochets(ecritures: Ecritures | null) {
  return (mod: unknown): void => {
    const nodefs = (mod as ModulePglite).FS.filesystems.NODEFS;
    const segments = new WeakMap<FluxNodefs, string | null>();
    const segment = (flux: FluxNodefs) => {
      let nom = segments.get(flux);
      if (nom === undefined) {
        nom = segmentWal(nodefs.realPath(flux.node));
        segments.set(flux, nom);
      }
      return nom;
    };
    nodefs.stream_ops.fsync = (flux) =>
      nodefs.tryFSOperation(() => {
        if (typeof flux.nfd === "number") {
          fsyncSync(flux.nfd);
          const nom = ecritures && segment(flux);
          if (nom) ecritures.forcer(nom);
        } else {
          fsyncDossier(nodefs.realPath(flux.node));
        }
        return 0;
      });
    if (!ecritures) return;
    const ecrire = nodefs.stream_ops.write;
    nodefs.stream_ops.write = (flux, tampon, debut, longueur, position, ...reste) => {
      const n = ecrire(flux, tampon, debut, longueur, position, ...reste);
      const nom = segment(flux);
      if (nom) ecritures.ecrire(nom, new Uint8Array(tampon.buffer, tampon.byteOffset + debut, n), position);
      return n;
    };
    const fermer = nodefs.stream_ops.close;
    nodefs.stream_ops.close = (flux) => {
      fermer(flux);
      const nom = segment(flux);
      if (nom && !(flux.shared && flux.shared.refcount > 0)) ecritures.fermer(nom);
    };
  };
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
 * (PGLite la tait et ne dit que « Aborted() »). Avec `copies`, chaque écriture du journal est
 * doublée dans copies/ecritures ; une fois la base ouverte, ce miroir est réaligné sur son journal.
 * `PGlite` et `NodeFS` : les classes de @electric-sql/pglite.
 */
export async function ouvrirPgliteDurable<
  T extends { waitReady: Promise<void>; close(): Promise<void> },
>(
  PGlite: { new (options: Record<string, unknown>): T; defaultStartParams: string[] },
  NodeFS: new (dossier: string) => DisqueNode,
  dossier: string,
  options: Record<string, unknown>,
  copies?: string,
): Promise<T> {
  const neuve = !existsSync(path.join(dossier, "PG_VERSION"));
  rmSync(path.join(dossier, "postmaster.pid"), { force: true });
  if (neuve && copies) {
    g.__afriRangee = undefined;
    try {
      const avant = rangerAncienneGeneration(copies);
      if (avant) {
        g.__afriRangee = avant;
        console.error(`[base] base neuve : l'ancienne génération est rangée dans ${avant}`);
      }
    } catch (e) {
      noterDefautCopie("écritures doublées de la base", e);
    }
  }
  const ecritures = copies
    ? new Ecritures(path.join(copies, "ecritures"), `${dossier}.ecritures-en-panne`)
    : null;
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
      emscriptenOpts: { ...r.emscriptenOpts, preRun: [...preRun, crochets(ecritures)], printErr },
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
  if (ecritures) {
    // PGLite ne fait de point de contrôle qu'aux copies : son journal garde tout depuis la dernière,
    // et le miroir avec lui ce qu'il faut pour la rejouer.
    ecritures.realigner(path.join(dossier, "pg_wal"), null);
    g.__afriEcritures = ecritures;
  }
  return pg;
}

/**
 * Une base neuve (première ouverture, ou plus aucune copie lisible) commence une nouvelle
 * génération, et les segments de son journal reprennent les mêmes noms que ceux de l'ancienne :
 * doublés au même endroit, ils écraseraient les siens. Les écritures doublées et les copies de
 * l'ancienne génération sont donc d'abord rangées dans copies/avant-<date> — gardées, jamais
 * effacées ni réécrites, plus jamais mêlées à la nouvelle. Rend ce dossier, ou null s'il n'y avait
 * rien à ranger. Les copies des fichiers du poste (copies/fichiers) restent où elles sont.
 */
function rangerAncienneGeneration(copies: string): string | null {
  let noms: string[];
  try {
    noms = readdirSync(copies).filter(
      (n) =>
        n === "ecritures" || n.endsWith(".part") || existsSync(path.join(copies, n, "base", "backup_label")),
    );
  } catch {
    return null; // pas encore de dossier des copies
  }
  if (noms.length === 0) return null;
  const avant = path.join(copies, `avant-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(avant);
  for (const n of noms) renameSync(path.join(copies, n), path.join(avant, n));
  fsyncDossier(avant);
  fsyncDossier(copies);
  return avant;
}

/** Ce qu'il faut d'une base ouverte pour la copier à chaud. */
type BaseInterrogeable = {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
};

/** Le premier segment du journal qu'une copie rejoue, et l'heure de la copie, lus dans son
 * backup_label. */
function lireEtiquette(etiquette: string): { premier: string; debut: number } | null {
  const premier = /^START WAL LOCATION: .*\(file ([0-9A-F]{24})\)$/m.exec(etiquette)?.[1];
  const quand = /^START TIME: (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) GMT$/m.exec(etiquette);
  if (!premier || !quand) return null;
  return { premier, debut: Date.parse(`${quand[1]}T${quand[2]}Z`) };
}

/**
 * Copie à chaud de la base dans `copies/<nom>/base`. Postgres est prévenu (pg_backup_start), les
 * fichiers sont copiés pendant que les requêtes continuent ; la copie, faite d'instants
 * différents, se recolle à l'ouverture grâce à son backup_label et aux segments du journal de la
 * même période, copiés avec elle. Les registres du poste (`registres/*.json`) sont copiés à côté.
 * Mesuré : 300 validations pendant une copie, la plus longue en 2 ms (la copie sous le verrou des
 * requêtes les faisait attendre 0,5 à 2 s). Rend sa durée (ms).
 */
export async function copierBase(
  pg: BaseInterrogeable,
  dossier: string,
  copies: string,
  nom: string,
  registres: string,
): Promise<number> {
  const t0 = Date.now();
  const dest = path.join(copies, nom);
  const part = `${dest}.part`;
  await rm(part, { recursive: true, force: true });
  await pg.query("select pg_backup_start($1, true)", [nom]);
  let fin: { lsn: string; labelfile: string } | undefined;
  try {
    await cp(dossier, path.join(part, "base"), {
      recursive: true,
      filter: (source) => !segmentWal(source) && path.basename(source) !== "postmaster.pid",
    });
  } finally {
    fin = (
      await pg.query<{ lsn: string; labelfile: string }>(
        "select lsn::text as lsn, labelfile from pg_backup_stop(false)",
      )
    ).rows[0];
  }
  const etiquette = fin && lireEtiquette(fin.labelfile);
  if (!fin || !etiquette) throw new Error("copie sans étiquette de Postgres");
  await writeFile(path.join(part, "base", "backup_label"), fin.labelfile);
  // pg_backup_stop a changé de segment : du premier à celui de la fin, plus rien ne s'y écrit.
  const dernier = (
    await pg.query<{ nom: string }>("select pg_walfile_name($1::pg_lsn) as nom", [fin.lsn])
  ).rows[0]!.nom;
  const pgWal = path.join(dossier, "pg_wal");
  for (const seg of await readdir(pgWal)) {
    if (SEGMENT_WAL.test(seg) && seg >= etiquette.premier && seg <= dernier) {
      await copyFile(path.join(pgWal, seg), path.join(part, "base", "pg_wal", seg));
    }
  }
  // Des écritures doublées en défaut repartent d'ici : avec cette copie, rien ne manque plus.
  const ecritures = g.__afriEcritures;
  if (ecritures && !ecritures.actif) ecritures.realigner(pgWal, etiquette.premier);
  await mkdir(path.join(part, "fichiers"), { recursive: true });
  for (const f of await readdir(registres).catch(() => [])) {
    if (f.endsWith(".json")) await copyFile(path.join(registres, f), path.join(part, "fichiers", f));
  }
  await forcerArbre(part);
  await rename(part, dest);
  await forcer(copies, true);
  if (ecritures) ecritures.remettre = false;
  return Date.now() - t0;
}

/**
 * Une copie par jour (copies/jour-AAAA-MM-JJ, jour du poste) : tout de suite si celle du jour
 * manque, puis à chaque nouveau jour (vu toutes les 5 min). Toutes sont gardées. Des écritures
 * doublées en panne (clé des copies retirée) ou tout juste réparées : une copie de remise en route
 * (copies/remise-<date>) dès que le dossier des copies répond, sans attendre le lendemain.
 */
export function programmerCopies(
  pg: BaseInterrogeable,
  dossier: string,
  copies: string,
  registres: string,
): Promise<void> {
  let enCours = false;
  const tenter = async () => {
    if (enCours) return;
    // Écritures doublées en panne : elles repartent dès que leur dossier répond (le journal de la
    // base y est recopié), puis une copie de remise en route. Leur dossier muet : pas de copie de
    // plus — jamais une copie entière toutes les 5 min.
    const ecritures = g.__afriEcritures;
    if (ecritures && !ecritures.actif) ecritures.realigner(path.join(dossier, "pg_wal"), null);
    const remise = ecritures?.actif === true && ecritures.remettre;
    const jour = `jour-${jourPoste(Date.now())}`;
    const faite = existsSync(path.join(copies, jour, "base", "backup_label"));
    if (faite && !remise) return;
    const nom = faite ? `remise-${new Date().toISOString().replace(/[:.]/g, "-")}` : jour;
    enCours = true;
    try {
      const ms = await copierBase(pg, dossier, copies, nom, registres);
      noterDefautCopie("copie du jour de la base", null);
      const quoi = faite ? "de remise en route" : "du jour";
      console.log(`[base] copie ${quoi} faite en ${ms} ms : ${path.join(copies, nom)}`);
    } catch (e) {
      noterDefautCopie("copie du jour de la base", e);
    } finally {
      enCours = false;
    }
  };
  setInterval(() => void tenter(), 300_000).unref();
  return tenter();
}

type CopieDeBase = { nom: string; base: string; premier: string; debut: number };

/** Les copies de la base, de la plus récente à la plus ancienne. */
async function copiesDeLaBase(copies: string): Promise<CopieDeBase[]> {
  const trouvees: CopieDeBase[] = [];
  for (const nom of await readdir(copies).catch(() => [])) {
    if (nom.endsWith(".part")) continue; // inachevée : arrêtée en pleine copie
    const base = path.join(copies, nom, "base");
    try {
      const e = lireEtiquette(await readFile(path.join(base, "backup_label"), "utf8"));
      if (e) trouvees.push({ nom, base, ...e });
    } catch {
      // Pas une copie de la base (écritures, fichiers, relevé…), ou une copie inachevée.
    }
  }
  return trouvees.sort((a, b) => b.premier.localeCompare(a.premier) || b.debut - a.debut);
}

/** Les copies de la base pour la Division : où, si le dossier répond, combien, la plus récente. */
export async function etatCopies(copies: string): Promise<{
  dossier: string;
  joignable: boolean;
  nombre: number;
  derniere: string | null;
}> {
  const liste = await copiesDeLaBase(copies);
  return {
    dossier: copies,
    joignable: await stat(copies).then(
      (s) => s.isDirectory(),
      () => false,
    ),
    nombre: liste.length,
    derniere: liste[0] ? formatDate(liste[0].debut) : null,
  };
}

/**
 * La base est illisible au démarrage : mise de côté (jamais effacée), puis la copie la plus
 * récente, avec les écritures doublées qui l'ont suivie — rien de perdu ; à défaut les copies plus
 * anciennes, puis une base neuve. Si rien ne s'ouvre, pas même une base neuve, le problème n'est
 * pas la base : elle est remise en place, et null.
 */
async function reprendre<T>(
  ouvrir: (dossier?: string) => Promise<T>,
  dossier: string,
  motif: string,
  copies: string,
): Promise<{ pg: T; reprise: string } | null> {
  // Absente (dossier effacé, disque du poste remplacé ; le verrou l'a recréé vide) : rien à mettre
  // de côté.
  const existait = existsSync(dossier);
  const vide = !existait || readdirSync(dossier).length === 0;
  const cote = vide ? null : `${dossier}.illisible-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (cote) {
    try {
      await rename(dossier, cote);
    } catch {
      return null;
    }
  }
  const dire = (quoi: string) =>
    cote
      ? `Base illisible au démarrage (${motif}) : ${quoi} ; la base illisible est gardée dans ${cote}`
      : `Base absente au démarrage : ${quoi}`;
  const candidates = await copiesDeLaBase(copies);
  const doublees = path.join(copies, "ecritures");
  for (const c of candidates) {
    await rm(dossier, { recursive: true, force: true });
    try {
      await cp(c.base, dossier, { recursive: true });
      for (const seg of await readdir(doublees).catch(() => [])) {
        if (SEGMENT_WAL.test(seg) && seg >= c.premier) {
          await copyFile(path.join(doublees, seg), path.join(dossier, "pg_wal", seg));
        }
      }
      await forcerArbre(dossier);
      const pg = await ouvrir(dossier);
      const quand = formatDate(c.debut);
      return {
        pg,
        reprise: dire(
          `reprise de la copie du ${quand} (heure du poste), puis des écritures doublées qui l'ont suivie`,
        ),
      };
    } catch {
      // Copie suivante, plus ancienne.
    }
  }
  await rm(dossier, { recursive: true, force: true });
  try {
    const pg = await ouvrir(dossier);
    const rangee = g.__afriRangee
      ? ` ; l'ancienne génération (copies, écritures doublées) est rangée dans ${g.__afriRangee}`
      : "";
    return {
      pg,
      reprise: dire(`base neuve, ${candidates.length ? "aucune copie lisible" : "sans copie"}${rangee}`),
    };
  } catch {
    // Pas même une base neuve.
  }
  await rm(dossier, { recursive: true, force: true });
  if (cote) await rename(cote, dossier);
  else if (existait) await mkdir(dossier, { recursive: true });
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
    [
      randomBytes(12).toString("hex"),
      `${e.reprise.startsWith("Base absente") ? "Base absente" : "Base illisible"} au démarrage : le poste l'a reprise`,
      e.reprise,
    ],
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
      const copies = choisirCopies(process.env.AFRICONTROL_COPIES, cwd);
      try {
        // Absente alors que ses copies sont là : reprise, pas une base vierge par-dessus.
        if (
          !existsSync(path.join(choix.dossier, "PG_VERSION")) &&
          (await copiesDeLaBase(copies)).length > 0
        ) {
          throw new Error("fichiers de la base absents (PG_VERSION manque)");
        }
        const pg = await ouvrir(choix.dossier);
        g.__afriBase = choix;
        console.log(`[base] sur disque : ${choix.dossier}`);
        return pg;
      } catch (e) {
        const motif = e instanceof Error ? e.message : String(e);
        const r = await reprendre(ouvrir, choix.dossier, motif, copies);
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
