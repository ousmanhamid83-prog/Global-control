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
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { closeSync, existsSync, fsyncSync, openSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rename, stat, statfs } from "node:fs/promises";
import path from "node:path";

/** Où vont les copies : AFRICONTROL_COPIES (relatif au dossier du serveur), sinon data/copies. */
export function choisirCopies(valeur: string | undefined, cwd: string): string {
  const v = valeur?.trim();
  return v ? path.resolve(cwd, v) : path.join(cwd, "data", "copies");
}

/** Le dossier des copies de ce serveur. */
export function dossierCopies(): string {
  return choisirCopies(process.env.AFRICONTROL_COPIES, process.cwd());
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
      // Effacé depuis (par le chef) : plus rien à recopier.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || existsSync(f)) throw e;
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
