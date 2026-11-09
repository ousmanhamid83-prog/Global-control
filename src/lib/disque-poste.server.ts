/**
 * Le disque du poste — CÔTÉ SERVEUR. Tout ce que le poste garde est écrit pour survivre à une
 * coupure de courant (forcé sur le disque, jamais à moitié) et DOUBLÉ aussitôt dans le dossier des
 * copies : AFRICONTROL_COPIES, sinon data/copies. Un autre disque (ou une clé) y est conseillé : la
 * copie survit alors aussi à la panne du disque du poste.
 *
 * Une copie qui échoue (disque plein, clé retirée) ne bloque jamais le poste : l'écriture principale
 * est faite, le défaut est retenu et affiché dans la Division. Quand la copie remarche, chaque
 * fichier manqué pendant le défaut est recopié en entier ; alors seulement le défaut s'efface.
 *
 * Chaque version finie d'un fichier gardé est scellée (taille, SHA-256, HMAC par la clé du poste :
 * empreintes-poste.server.ts) ; le contrôle des copies s'en sert pour comparer au contenu, et
 * réparer le côté abîmé (controle-copies.server.ts).
 *
 * Tout étant gardé sans limite, ce qui ne sert plus qu'en archive est compressé (gzip), sans
 * jamais rien risquer : le compressé est écrit à part, forcé, relu et comparé à l'original avant
 * que l'original soit effacé (compresserFichiers). Une reprise relit les deux (restaurerArbre).
 *
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { createHash } from "node:crypto";
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
import { disquesPhysiques } from "./disque-physique.server.ts";
import {
  cleDuPoste,
  type Empreinte,
  hacherFichier,
  hacherTexte,
  ligneEmpreinte,
  lireEmpreintes,
} from "./empreintes-poste.server.ts";

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

/** La place libre du disque du poste et de celui des copies, leurs disques physiques, et s'ils ne
 * font qu'un. */
export type PlaceDisques = {
  poste: Place | null;
  copies: Place | null;
  /** Les disques physiques de chacun (sda, nvme0n1 ; sous Windows leur numéro) ; null : pas
   * reconnus, les volumes sont alors comparés. */
  disques: { poste: string[] | null; copies: string[] | null };
  memeDisque: boolean;
};

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
 * disque plein n'empêche de rien garder. Le même disque PHYSIQUE pour le poste et ses copies est
 * signalé — deux partitions d'un même disque comprises : sa panne emporterait les deux. Disques pas
 * reconnus (dossier réseau, autre système) : les volumes sont comparés.
 */
export async function placeDisques(): Promise<PlaceDisques> {
  const poste = dossierRegistres();
  const copies = dossierCopies();
  const volume = (d: string) =>
    stat(d).then(
      (s) => s.dev,
      () => null,
    );
  const [p, c, vp, vc, dp, dc] = await Promise.all([
    place(poste),
    place(copies),
    volume(poste),
    volume(copies),
    disquesPhysiques(poste),
    disquesPhysiques(copies),
  ]);
  return {
    poste: p,
    copies: c,
    disques: { poste: dp, copies: dc },
    memeDisque: surLeMemeDisque(dp, dc, vp, vc),
  };
}

/** Le poste et ses copies sur un même disque : un disque physique en commun (deux partitions d'un
 * disque, un RAID qui le contient) ; leurs disques pas reconnus, le même volume. */
export function surLeMemeDisque(
  disquesPoste: string[] | null,
  disquesCopies: string[] | null,
  volumePoste: number | null,
  volumeCopies: number | null,
): boolean {
  if (disquesPoste !== null && disquesCopies !== null) {
    return disquesPoste.some((d) => disquesCopies.includes(d));
  }
  return volumePoste !== null && volumePoste === volumeCopies;
}

/** Ce qui n'a pas pu être doublé dans les copies, et depuis quand (ms). */
export type DefautCopie = { quoi: string; raison: string; depuis: number };

/** Les empreintes scellées du poste, relues de son journal (voir empreintes-poste.server.ts). */
export type EtatEmpreintes = {
  /** Clé illisible : null, rien ne se scelle. */
  cle: Buffer | null;
  index: Map<string, Empreinte[]>;
  fausses: number;
  coupees: number;
};

const g = globalThis as typeof globalThis & {
  __afriDefautsCopies?: Map<string, DefautCopie>;
  __afriManquees?: Map<string, Set<string>>;
  __afriFiles?: Map<string, Promise<void>>;
  __afriEnEcriture?: Set<string>;
  /** Par dossier du serveur (les essais en changent) : ses empreintes, relues une fois. */
  __afriEmpreintes?: { racine: string; etat: Promise<EtatEmpreintes> };
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
export function enFile(fichier: string, travail: () => Promise<void>): Promise<void> {
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
export async function recopierDurable(source: string, cible: string): Promise<void> {
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

/** Écrit un fichier du poste (registre, index) et sa copie, aussitôt. Son empreinte est scellée
 * d'abord : coupé entre les deux, le fichier reste à sa version d'avant, scellée elle aussi. */
export function ecrireFichierPoste(fichier: string, contenu: string): Promise<void> {
  const quoi = "copie des registres";
  return enFile(fichier, async () => {
    await noterEmpreinte(fichier, hacherTexte(contenu));
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

/** Ce que le poste garde et double, relatif au dossier du serveur : les registres (data/*.json) et
 * le journal des empreintes, l'archive des bandes (recordings/*.json), le trafic reçu, le relevé
 * Internet, la phonie. Ni poste.env ni les clés (data/base.secret, data/empreintes.cle). */
const GARDES: [string, RegExp][] = [
  ["data", /\.json$|^empreintes\.jsonl$/],
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

/** Les fichiers gardés, tels qu'ils sont sur le disque du poste : ni les .part (écritures et
 * compressions inachevées), ni le fichier qu'un flux écrit encore (segment de phonie). */
export async function fichiersGardes(): Promise<string[]> {
  const liste: string[] = [];
  for (const [dossier, nom] of GARDES) {
    const d = path.join(process.cwd(), dossier);
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(d, e.name);
      if (e.isFile() && nom.test(e.name) && !e.name.endsWith(".part") && !enEcriture().has(f)) {
        liste.push(f);
      }
    }
  }
  return liste;
}

/** `fichier` est-il l'un de ceux que le poste garde (et non une copie) ? */
function estGarde(fichier: string): boolean {
  const dossier = path.dirname(path.resolve(fichier));
  const nom = path.basename(fichier);
  return GARDES.some(([d, n]) => dossier === path.join(process.cwd(), d) && n.test(nom));
}

/** Le chemin d'un fichier du poste relatif au dossier du serveur, séparé par « / » partout. */
export function relatif(fichier: string): string {
  return path.relative(process.cwd(), path.resolve(fichier)).split(path.sep).join("/");
}

/** Le journal des empreintes scellées (data/empreintes.jsonl) : doublé et contrôlé comme le reste.
 * Sa clé, data/empreintes.cle, ne quitte pas le poste. */
export function journalEmpreintes(): string {
  return path.join(dossierRegistres(), "empreintes.jsonl");
}

async function chargerEmpreintes(): Promise<EtatEmpreintes> {
  const cle = cleDuPoste(path.join(dossierRegistres(), "empreintes.cle"));
  let texte = "";
  for (const f of [journalEmpreintes(), copieDe(journalEmpreintes())]) {
    try {
      texte = await readFile(f, "utf8");
      break;
    } catch {
      // Absent ou illisible : sa copie, sinon aucune empreinte encore.
    }
  }
  if (!cle) return { cle, index: new Map(), fausses: 0, coupees: 0 };
  return { cle, ...lireEmpreintes(cle, texte) };
}

/** Les empreintes scellées du poste, relues une fois (sur son journal, sinon sa copie). */
export function empreintes(): Promise<EtatEmpreintes> {
  const racine = process.cwd();
  if (g.__afriEmpreintes?.racine !== racine) {
    g.__afriEmpreintes = { racine, etat: chargerEmpreintes() };
  }
  return g.__afriEmpreintes.etat;
}

/** Scelle une version finie d'un fichier gardé : dans le journal des empreintes, forcée et doublée.
 * Clé illisible : rien n'est scellé (le contrôle le dit). */
export async function noterEmpreinte(fichier: string, v: { t: number; h: string }): Promise<void> {
  const etat = await empreintes();
  if (!etat.cle) return;
  const e = { f: relatif(fichier), ...v };
  await ajouterFichierPoste(
    journalEmpreintes(),
    ligneEmpreinte(etat.cle, e),
    "copie des empreintes",
  );
  const avant = etat.index.get(e.f)?.[0];
  etat.index.set(e.f, avant ? [e, avant] : [e]);
}

/** Scelle un fichier fini tel qu'il est sur le disque (un segment de phonie fermé). */
export async function noterEmpreinteFichier(fichier: string): Promise<void> {
  await noterEmpreinte(fichier, await hacherFichier(fichier));
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
  const scelles: [string, { t: number; h: string }][] = [];
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
      // Un fichier gardé (trafic, relevé d'un jour passé) : son compressé est sa version finie.
      if (estGarde(`${fichier}.gz`)) scelles.push([`${fichier}.gz`, await hacherFichier(part)]);
      await rename(part, `${fichier}.gz`);
      faits.push(fichier);
    } catch (e) {
      await unlink(part).catch(() => undefined);
      throw e;
    }
  }
  if (faits.length === 0) return 0;
  await forcer(dossier, true);
  for (const [f, v] of scelles) await noterEmpreinte(f, v);
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
