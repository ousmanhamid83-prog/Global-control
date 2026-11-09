/**
 * Le disque du poste — CÔTÉ SERVEUR. Tout ce que le poste garde est écrit pour survivre à une
 * coupure de courant (forcé sur le disque, jamais à moitié) et DOUBLÉ aussitôt dans le dossier des
 * copies : AFRICONTROL_COPIES, sinon data/copies. Un autre disque (ou une clé) y est conseillé : la
 * copie survit alors aussi à la panne du disque du poste.
 *
 * Une copie qui échoue (disque plein, clé retirée) ne bloque jamais le poste : l'écriture principale
 * est faite, le défaut est retenu et affiché dans la Division. Quand la copie remarche, chaque
 * fichier manqué pendant le défaut est recopié en entier ; alors seulement le défaut s'efface. Un
 * dossier des copies changé (un autre disque, une autre clé) reçoit tout ce qui était déjà gardé
 * (alignerCopies).
 *
 * Tout étant gardé sans limite, ce qui ne sert plus qu'en archive est compressé (gzip), sans
 * jamais rien risquer : le compressé est écrit à part, forcé, relu et comparé à l'original avant
 * que l'original soit effacé (compresserFichiers). Une reprise relit les deux (restaurerArbre).
 *
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  openSync,
} from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

/** Où vont les copies : AFRICONTROL_COPIES (relatif au dossier du serveur), sinon data/copies. */
export function choisirCopies(valeur: string | undefined, cwd: string): string {
  const v = valeur?.trim();
  return v ? path.resolve(cwd, v) : path.join(cwd, "data", "copies");
}

/** Le dossier des copies du serveur lancé dans `cwd`. */
export function dossierCopies(cwd = process.cwd()): string {
  const cle = "AFRICONTROL_COPIES"; // écrite dans poste.env par scripts/poste/preparer-poste
  return choisirCopies(process.env[cle], cwd);
}

/** Le dossier des registres du poste (data/*.json). */
export function dossierRegistres(): string {
  return path.join(process.cwd(), "data");
}

/** La place d'un disque, en octets. */
export type Place = { libre: number; total: number };

/** La place libre du disque du poste et de celui des copies, et s'ils ne font qu'un. */
export type PlaceDisques = { poste: Place | null; copies: Place | null; memeDisque: boolean };

async function place(dossier: string): Promise<Place | null> {
  try {
    const s = await statfs(dossier);
    return { libre: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/**
 * Tout est gardé sans limite : la place libre est donc montrée dans la Division, avant que le
 * disque plein n'empêche de rien garder. Le même disque pour le poste et ses copies est signalé :
 * sa panne emporterait les deux.
 */
export async function placeDisques(): Promise<PlaceDisques> {
  const poste = dossierRegistres();
  const copies = dossierCopies();
  const disque = (d: string) =>
    stat(d).then(
      (s) => s.dev,
      () => null,
    );
  const [p, c, dp, dc] = await Promise.all([
    place(poste),
    place(copies),
    disque(poste),
    disque(copies),
  ]);
  return { poste: p, copies: c, memeDisque: dp !== null && dp === dc };
}

/** Ce qui n'a pas pu être doublé dans les copies, et depuis quand (ms). */
export type DefautCopie = { quoi: string; raison: string; depuis: number };

const g = globalThis as typeof globalThis & {
  __afriDefautsCopies?: Map<string, DefautCopie>;
  __afriManquees?: Map<string, Set<string>>;
  __afriFiles?: Map<string, Promise<void>>;
  __afriEnEcriture?: Set<string>;
  /** La dernière recopie complète : la marque laissée dans le dossier des copies, et le jour. */
  __afriAligne?: { marque: string; jour: string };
};
const defauts = () => (g.__afriDefautsCopies ??= new Map());

/** Les copies en défaut (registres, trafic, écritures de la base…), les plus anciennes d'abord. */
export function defautsCopies(): DefautCopie[] {
  return [...defauts().values()].sort((a, b) => a.depuis - b.depuis);
}

/** Retient un défaut de copie (le premier instant, pas le dernier) ; `null` : la copie remarche. */
export function noterDefautCopie(quoi: string, erreur: unknown): void {
  if (erreur === null) {
    defauts().delete(quoi);
    return;
  }
  if (defauts().has(quoi)) return;
  const raison = erreur instanceof Error ? erreur.message : String(erreur);
  defauts().set(quoi, { quoi, raison, depuis: Date.now() });
  console.error(`[copies] ${quoi} en défaut : ${raison}`);
}

/** Les fichiers dont la copie a raté, par sorte de copie : à recopier en entier au retour. */
function manquees(quoi: string): Set<string> {
  const m = (g.__afriManquees ??= new Map());
  let s = m.get(quoi);
  if (!s) m.set(quoi, (s = new Set()));
  return s;
}

/** La copie de `fichier` a raté (dossier des copies absent, disque plein) : le défaut est dit, et
 * le fichier sera recopié en entier dès que la copie remarche. */
export function copieRatee(quoi: string, fichier: string, erreur: unknown): void {
  manquees(quoi).add(fichier);
  noterDefautCopie(quoi, erreur);
}

/** Les écritures d'un même fichier, l'une après l'autre dans l'ordre des appels : deux registres
 * écrits en même temps ne se mêlent pas, et le dernier appel est le dernier écrit. */
function enFile(fichier: string, travail: () => Promise<void>): Promise<void> {
  const files = (g.__afriFiles ??= new Map());
  const p = (files.get(fichier) ?? Promise.resolve()).then(travail);
  const fin = p.catch(() => undefined);
  files.set(fichier, fin);
  void fin.then(() => {
    if (files.get(fichier) === fin) files.delete(fichier);
  });
  return p;
}

/** Forcer un dossier sur le disque (création, renommage) ; Windows ne le permet pas, NTFS
 * journalise ses noms lui-même. Synchrone : pour le fsync de NODEFS, appelé par Postgres. */
export function fsyncDossier(dossier: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(dossier, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Forcer un fichier ou un dossier sur le disque, sans figer le serveur. Le fichier est ouvert en
 * lecture-écriture : Windows refuse de forcer un fichier ouvert en lecture seule (EPERM).
 */
export async function forcer(chemin: string, dossier: boolean): Promise<void> {
  if (dossier && process.platform === "win32") return;
  const f = await open(chemin, dossier ? "r" : "r+");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}

/** Tout un dossier forcé sur le disque : une base neuve (l'outil de création de PGLite l'écrit
 * sans un seul fsync), une copie, une copie reprise. */
export async function forcerArbre(dossier: string): Promise<void> {
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) await forcerArbre(p);
    else if (e.isFile()) await forcer(p, false);
  }
  await forcer(dossier, true);
}

/** Écrit `fichier` sans jamais le laisser à moitié : un .part forcé sur le disque, renommé, le
 * dossier forcé. Une coupure laisse l'ancien contenu ou le nouveau, entier. */
export async function ecrireDurable(fichier: string, contenu: string): Promise<void> {
  await mkdir(path.dirname(fichier), { recursive: true });
  const part = `${fichier}.part`;
  const f = await open(part, "w");
  try {
    await f.writeFile(contenu);
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(part, fichier);
  await forcer(path.dirname(fichier), true);
}

/** Ajoute `ligne` au bout de `fichier`, forcée sur le disque. */
export async function ajouterDurable(fichier: string, ligne: string): Promise<void> {
  await mkdir(path.dirname(fichier), { recursive: true });
  const f = await open(fichier, "a");
  try {
    await f.appendFile(ligne);
    await f.sync();
  } finally {
    await f.close();
  }
}

/** La copie d'un fichier du poste : même chemin, relatif au dossier du serveur, sous copies/fichiers. */
export function copieDe(fichier: string, copies = dossierCopies()): string {
  return path.join(copies, "fichiers", path.relative(process.cwd(), path.resolve(fichier)));
}

/** Recopie `source` en entier sur `cible`, jamais à moitié (un .part forcé, renommé). */
async function recopierDurable(source: string, cible: string): Promise<void> {
  await mkdir(path.dirname(cible), { recursive: true });
  const part = `${cible}.part`;
  await copyFile(source, part);
  await forcer(part, false);
  await rename(part, cible);
  await forcer(path.dirname(cible), true);
}

/**
 * La copie remarche : chaque fichier manqué pendant le défaut est recopié en entier, puis le défaut
 * s'efface — pas avant. `enCours` : un fichier encore en train de s'écrire (segment de phonie),
 * laissé pour sa fin. Jette si une recopie échoue : le défaut reste.
 */
export async function rattraperCopies(quoi: string, enCours: string | null = null): Promise<void> {
  const liste = manquees(quoi);
  for (const f of [...liste]) {
    if (f === enCours) continue;
    try {
      await recopierDurable(f, copieDe(f));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || existsSync(f)) throw e;
      // Compressé depuis (un jour passé) : sa copie, à qui il manquait des lignes, devient ce
      // compressé entier. Sinon effacé depuis (par le chef) : plus rien à recopier.
      if (existsSync(`${f}.gz`)) {
        await recopierDurable(`${f}.gz`, `${copieDe(f)}.gz`);
        await unlink(copieDe(f)).catch(() => undefined);
      }
    }
    liste.delete(f);
  }
  if (liste.size === 0) noterDefautCopie(quoi, null);
}

/** Écrit un fichier du poste (registre, index) et sa copie, aussitôt. */
export function ecrireFichierPoste(fichier: string, contenu: string): Promise<void> {
  const quoi = "copie des registres";
  return enFile(fichier, async () => {
    await ecrireDurable(fichier, contenu);
    try {
      await ecrireDurable(copieDe(fichier), contenu);
    } catch (e) {
      copieRatee(quoi, fichier, e);
      return;
    }
    manquees(quoi).delete(fichier);
    await rattraperCopies(quoi).catch((e: unknown) => noterDefautCopie(quoi, e));
  });
}

/** Ajoute une ligne à un fichier du poste (trafic reçu) et à sa copie, aussitôt. Une copie qui a
 * manqué des lignes est ensuite recopiée en entier. */
export function ajouterFichierPoste(fichier: string, ligne: string, quoi: string): Promise<void> {
  return enFile(fichier, async () => {
    await ajouterDurable(fichier, ligne);
    try {
      await ajouterDurable(copieDe(fichier), ligne);
    } catch (e) {
      copieRatee(quoi, fichier, e);
      return;
    }
    await rattraperCopies(quoi).catch((e: unknown) => noterDefautCopie(quoi, e));
  });
}

/** Ce que le poste garde et double, relatif au dossier du serveur : les registres (data/*.json),
 * l'archive des bandes (recordings/*.json), le trafic reçu, le relevé Internet, la phonie. */
const GARDES: [string, RegExp][] = [
  ["data", /\.json$/],
  ["recordings", /\.json$/],
  [path.join("data", "trafic"), /^/],
  [path.join("data", "releve"), /^/],
  [path.join("recordings", "atc"), /^/],
];

const enEcriture = () => (g.__afriEnEcriture ??= new Set());

/** `fichier` s'écrit au fil d'un flux (`oui`), puis est fini et forcé : la recopie l'attend. */
export function ecritureEnCours(fichier: string, oui: boolean): void {
  if (oui) enEcriture().add(fichier);
  else enEcriture().delete(fichier);
}

/**
 * Un dossier des copies changé (un autre disque, une autre clé, vidé) n'a rien de ce qui était déjà
 * gardé, et les fichiers du jour n'y recevraient que leurs lignes nouvelles. Au démarrage, chaque
 * jour, et dès que la marque laissée dans ce dossier n'est plus la bonne : chaque fichier gardé
 * dont la copie manque ou n'a pas sa taille y est recopié en entier, dans la file du fichier — une
 * ligne qui arrive passe avant ou après, jamais entre l'ancienne copie et la nouvelle. Le fichier
 * qu'un flux écrit encore (segment de phonie) attend sa fin. Rend le nombre de fichiers recopiés ;
 * jette si une recopie échoue (tout est refait au contrôle suivant).
 */
export async function alignerCopies(jour: string, copies = dossierCopies()): Promise<number> {
  const marque = path.join(copies, "recopie-faite");
  const lue = await readFile(marque, "utf8").catch(() => null);
  if (lue !== null && lue === g.__afriAligne?.marque && jour === g.__afriAligne.jour) return 0;
  let recopies = 0;
  for (const [dossier, nom] of GARDES) {
    const d = path.join(process.cwd(), dossier);
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(d, e.name);
      if (!e.isFile() || !nom.test(e.name) || e.name.endsWith(".part") || enEcriture().has(f)) {
        continue;
      }
      await enFile(f, async () => {
        const [original, copie] = await Promise.all([
          stat(f).catch(() => null),
          stat(copieDe(f, copies)).catch(() => null),
        ]);
        if (original === null || copie?.size === original.size) return;
        await recopierDurable(f, copieDe(f, copies));
        recopies++;
      });
    }
  }
  const nouvelle = `${new Date().toISOString()} ${randomUUID()}\n`;
  await ecrireDurable(marque, nouvelle);
  g.__afriAligne = { marque: nouvelle, jour };
  return recopies;
}

/** Le contenu d'un registre-liste : une liste JSON, sinon une erreur (la copie est alors lue). */
export function listeJson<T>(texte: string): T[] {
  const v: unknown = JSON.parse(texte);
  if (!Array.isArray(v)) throw new Error("pas une liste");
  return v as T[];
}

/**
 * Lit un fichier du poste avec `lire` (qui jette s'il est abîmé) ; absent ou abîmé, sa copie.
 * null si ni l'un ni l'autre ne se lit.
 */
export async function lireFichierPoste<T>(
  fichier: string,
  lire: (texte: string) => T,
): Promise<T | null> {
  for (const f of [fichier, copieDe(fichier)]) {
    try {
      return lire(await readFile(f, "utf8"));
    } catch {
      // Absent ou abîmé : la copie.
    }
  }
  return null;
}

/** L'empreinte (sha256) de ce que donne un flux. */
async function empreinte(flux: AsyncIterable<Buffer>): Promise<string> {
  const h = createHash("sha256");
  for await (const morceau of flux) h.update(morceau);
  return h.digest("hex");
}

/**
 * Compresse des fichiers d'un même dossier (`fichier` → `fichier.gz`) sans jamais rien risquer :
 * chaque compressé est écrit à part (.gz.part), forcé sur le disque, relu et comparé à l'original,
 * puis renommé ; le dossier forcé, alors seulement les originaux sont effacés. Coupé n'importe où,
 * l'original ou le compressé entier reste (les deux, au pire : l'original prime à la relecture).
 * Un compressé relu différent est jeté et dit (l'original reste). Rend les octets gagnés.
 */
export async function compresserFichiers(dossier: string, noms: string[]): Promise<number> {
  let gagne = 0;
  const faits: string[] = [];
  for (const nom of noms) {
    const fichier = path.join(dossier, nom);
    const part = `${fichier}.gz.part`;
    try {
      await pipeline(createReadStream(fichier), createGzip(), createWriteStream(part));
      await forcer(part, false);
      const [avant, apres] = await Promise.all([
        empreinte(createReadStream(fichier)),
        empreinte(createReadStream(part).pipe(createGunzip())),
      ]);
      if (avant !== apres) throw new Error(`${fichier} : le compressé relu diffère de l'original`);
      gagne += (await stat(fichier)).size - (await stat(part)).size;
      await rename(part, `${fichier}.gz`);
      faits.push(fichier);
    } catch (e) {
      await unlink(part).catch(() => undefined);
      throw e;
    }
  }
  if (faits.length === 0) return 0;
  await forcer(dossier, true);
  for (const f of faits) await unlink(f);
  await forcer(dossier, true);
  return gagne;
}

/** Tout un dossier compressé, sauf ce que `garder` désigne ; déjà compressé, rien à refaire. */
export async function compresserArbre(
  dossier: string,
  garder: (nom: string) => boolean = () => false,
): Promise<number> {
  let gagne = 0;
  const noms: string[] = [];
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) gagne += await compresserArbre(path.join(dossier, e.name), garder);
    else if (
      e.isFile() &&
      !e.name.endsWith(".gz") &&
      !e.name.endsWith(".part") &&
      !garder(e.name)
    ) {
      noms.push(e.name);
    }
  }
  return gagne + (await compresserFichiers(dossier, noms));
}

/**
 * Recopie un dossier en partie compressé tel qu'il était : chaque `x.gz` redevient `x` (sauf si
 * `x` est encore là, compression coupée avant d'effacer l'original : il prime), les compressés
 * inachevés (.gz.part) sont laissés.
 */
export async function restaurerArbre(source: string, cible: string): Promise<void> {
  await mkdir(cible, { recursive: true });
  const entrees = await readdir(source, { withFileTypes: true });
  const noms = new Set(entrees.map((e) => e.name));
  for (const e of entrees) {
    const s = path.join(source, e.name);
    if (e.isDirectory()) await restaurerArbre(s, path.join(cible, e.name));
    else if (e.name.endsWith(".gz.part")) continue;
    else if (e.name.endsWith(".gz")) {
      const nom = e.name.slice(0, -3);
      if (!noms.has(nom)) {
        await pipeline(
          createReadStream(s),
          createGunzip(),
          createWriteStream(path.join(cible, nom)),
        );
      }
    } else await copyFile(s, path.join(cible, e.name));
  }
}

const JOURNALIER = /-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * Les fichiers du jour (trafic reçu, relevé) d'avant `jour` (AAAA-MM-JJ, exclu), dans chacun des
 * `dossiers`, compressés : ils ne s'écrivent plus. Un dossier absent : rien à faire.
 */
export async function compresserJournaliers(dossiers: string[], jour: string): Promise<number> {
  let gagne = 0;
  for (const d of dossiers) {
    const noms = (await readdir(d).catch(() => [] as string[])).filter((n) => {
      const m = JOURNALIER.exec(n);
      return m !== null && m[1]! < jour;
    });
    gagne += await compresserFichiers(d, noms);
  }
  return gagne;
}
