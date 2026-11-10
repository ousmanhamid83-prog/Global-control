/**
 * Les empreintes des fichiers gardés par le poste — CÔTÉ SERVEUR. Pour chaque version qu'il finit
 * d'un fichier (registre écrit, segment de phonie fermé, journal d'un jour compressé), le poste
 * scelle sa taille et son SHA-256 par sa clé (HMAC-SHA256), dans un journal qui ne fait que
 * s'allonger. Au contrôle des copies, elles disent AU CONTENU — pas à la taille — si le fichier du
 * poste et sa copie sont bons, et lequel l'est quand ils diffèrent.
 *
 * La clé (data/empreintes.cle, lisible du seul compte du serveur) ne quitte jamais le poste : elle
 * n'est pas copiée. Une empreinte modifiée dans le journal, ici ou dans les copies, ne se rescelle
 * pas sans elle ; elle est écartée et comptée.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

/** Une version finie d'un fichier gardé : son chemin relatif au dossier du serveur (séparé par
 * « / »), sa taille en octets, son SHA-256 en hexadécimal. */
export type Empreinte = { f: string; t: number; h: string };

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * La clé du poste : tirée une fois (32 octets), gardée dans `fichier`, lisible du seul compte du
 * serveur, jamais tirée par-dessus une clé lisible. Abîmée, elle est mise de côté (jamais effacée)
 * et une neuve est tirée : les empreintes scellées par l'ancienne sont alors écartées et le contrôle
 * les reprend sur les fichiers du poste. Illisible (droits) : null — rien ne se scelle, c'est dit.
 */
export function cleDuPoste(fichier: string): Buffer | null {
  const tirer = () => {
    mkdirSync(path.dirname(fichier), { recursive: true });
    const cle = randomBytes(32);
    writeFileSync(fichier, `${cle.toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    return cle;
  };
  try {
    return tirer();
  } catch {
    // Déjà là : relue.
  }
  let texte: string;
  try {
    texte = readFileSync(fichier, "utf8").trim();
  } catch {
    return null;
  }
  if (HEX64.test(texte)) return Buffer.from(texte, "hex");
  try {
    renameSync(fichier, `${fichier}.abimee-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    return tirer();
  } catch {
    return null;
  }
}

/** La clé du poste si elle est là et lisible, sans jamais en tirer une : à la reprise, le disque du
 * poste a pu être remplacé, et une clé neuve ne vérifierait aucun sceau. */
export function lireCleDuPoste(fichier: string): Buffer | null {
  try {
    const texte = readFileSync(fichier, "utf8").trim();
    return HEX64.test(texte) ? Buffer.from(texte, "hex") : null;
  } catch {
    return null;
  }
}

/** Ce qui désigne une clé sans la révéler : un sceau posé par une autre clé (une ancienne, mise de
 * côté abîmée) se reconnaît, et n'est pas pris pour un faux. */
export function idCle(cle: Buffer): string {
  return createHmac("sha256", cle)
    .update("identifiant de la clé du poste")
    .digest("hex")
    .slice(0, 16);
}

/** Le sceau d'une empreinte : HMAC-SHA256, par la clé du poste, de son chemin, sa taille et son
 * SHA-256. */
export function sceller(cle: Buffer, e: Empreinte): string {
  return createHmac("sha256", cle).update(`${e.f}\n${e.t}\n${e.h}`).digest("hex");
}

/** Une ligne du journal : précédée d'un saut de ligne, pour qu'une ligne coupée par un arrêt en
 * pleine écriture n'avale jamais la suivante. */
export function ligneEmpreinte(cle: Buffer, e: Empreinte): string {
  return `\n${JSON.stringify({ f: e.f, t: e.t, h: e.h, s: sceller(cle, e) })}`;
}

/** Les empreintes d'un journal : par fichier, ses deux dernières versions scellées (la plus récente
 * d'abord : coupé entre son empreinte et son écriture, un fichier reste à la version d'avant, bonne
 * elle aussi). `fausses` : au sceau faux (modifiées hors du poste, ou une autre clé), écartées ;
 * `coupees` : illisibles (arrêt en pleine écriture), ignorées. */
export function lireEmpreintes(
  cle: Buffer,
  texte: string,
): { index: Map<string, Empreinte[]>; fausses: number; coupees: number } {
  const index = new Map<string, Empreinte[]>();
  let fausses = 0;
  let coupees = 0;
  for (const ligne of texte.split("\n")) {
    if (!ligne) continue;
    let v: Partial<Record<"f" | "t" | "h" | "s", unknown>>;
    try {
      v = JSON.parse(ligne) as typeof v;
    } catch {
      coupees++;
      continue;
    }
    const { f, t, h, s } = v;
    if (
      typeof f !== "string" ||
      typeof t !== "number" ||
      typeof h !== "string" ||
      typeof s !== "string" ||
      !HEX64.test(s) ||
      !timingSafeEqual(Buffer.from(s, "hex"), Buffer.from(sceller(cle, { f, t, h }), "hex"))
    ) {
      fausses++;
      continue;
    }
    const avant = index.get(f)?.[0];
    index.set(f, avant ? [{ f, t, h }, avant] : [{ f, t, h }]);
  }
  return { index, fausses, coupees };
}

/** La taille et le SHA-256 d'un contenu. */
export function hacherTexte(contenu: string): { t: number; h: string } {
  return {
    t: Buffer.byteLength(contenu),
    h: createHash("sha256").update(contenu).digest("hex"),
  };
}

/** La taille et le SHA-256 de ce qui passe dans un flux. */
async function hacherFlux(flux: AsyncIterable<Buffer>): Promise<{ t: number; h: string }> {
  const h = createHash("sha256");
  let t = 0;
  for await (const morceau of flux) {
    h.update(morceau);
    t += morceau.length;
  }
  return { t, h: h.digest("hex") };
}

/** La taille et le SHA-256 d'un fichier, lu au fil de l'eau. */
export function hacherFichier(fichier: string): Promise<{ t: number; h: string }> {
  return hacherFlux(createReadStream(fichier) as AsyncIterable<Buffer>);
}

/** La taille et le SHA-256 du contenu d'origine d'un fichier compressé (gzip). Abîmé : jette. */
async function hacherCompresse(fichier: string): Promise<{ t: number; h: string }> {
  let v = { t: 0, h: "" };
  await pipeline(createReadStream(fichier), createGunzip(), async (flux: AsyncIterable<Buffer>) => {
    v = await hacherFlux(flux);
  });
  return v;
}

/**
 * Les empreintes du contenu d'un dossier, par chemin relatif (« / ») : un fichier compressé
 * (« x.gz ») compte pour son contenu d'origine (« x »), l'original primant s'il est encore là (coupé
 * entre la compression et l'effacement) ; les écritures inachevées (« .part ») ne comptent pas, ni
 * ce que `ignorer` écarte. Un fichier illisible jette.
 */
export async function empreintesDossier(
  dossier: string,
  ignorer: (chemin: string) => boolean,
): Promise<Map<string, { t: number; h: string }>> {
  const vues = new Map<string, { t: number; h: string }>();
  const hacher = async (r: string, faire: () => Promise<{ t: number; h: string }>) => {
    try {
      vues.set(r, await faire());
    } catch (e) {
      throw new Error(`${r} illisible (${(e as Error).message})`);
    }
  };
  const parcourir = async (d: string, rel: string): Promise<void> => {
    const entrees = await readdir(d, { withFileTypes: true });
    const noms = new Set(entrees.map((e) => e.name));
    for (const e of entrees) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await parcourir(p, r);
      else if (!e.isFile() || e.name.endsWith(".part")) continue;
      else if (e.name.endsWith(".gz")) {
        const x = r.slice(0, -3);
        if (!noms.has(e.name.slice(0, -3))) await hacher(x, () => hacherCompresse(p));
      } else if (!ignorer(r)) await hacher(r, () => hacherFichier(p));
    }
  };
  await parcourir(dossier, "");
  return vues;
}

/** Les empreintes d'un dossier entier (une copie de la base) : chemin, taille et SHA-256 de chaque
 * fichier, scellés ensemble par la clé du poste. */
export type Manifeste = {
  v: 1;
  /** L'identifiant de la clé qui l'a scellé, ou null (clé du poste illisible). */
  cle: string | null;
  fichiers: [string, number, string][];
  /** HMAC-SHA256, par cette clé, de la version et des fichiers ; ou null. */
  s: string | null;
};

const sceauManifeste = (cle: Buffer, m: Pick<Manifeste, "v" | "fichiers">) =>
  createHmac("sha256", cle)
    .update(JSON.stringify({ v: m.v, fichiers: m.fichiers }))
    .digest("hex");

/** Le manifeste de `dossier` tel qu'il est sur le disque, scellé par `cle` (si elle est lisible). */
export async function manifesteDossier(
  dossier: string,
  cle: Buffer | null,
  ignorer: (chemin: string) => boolean,
): Promise<Manifeste> {
  const vues = await empreintesDossier(dossier, ignorer);
  const fichiers = [...vues].map(([f, v]): [string, number, string] => [f, v.t, v.h]);
  const corps = { v: 1 as const, cle: cle ? idCle(cle) : null, fichiers };
  return { ...corps, s: cle ? sceauManifeste(cle, corps) : null };
}

/** Un dossier relu contre son manifeste. `scelle` : le sceau est celui de la clé du poste. */
export type Verdict =
  { sain: true; scelle: boolean; octets: number } | { sain: false; raison: string; octets: number };

/**
 * `dossier` relu au contenu contre son manifeste (`texte`) : chaque fichier présent, entier, à son
 * SHA-256, aucun en plus. Le sceau est vérifié quand le manifeste vient de la clé
 * du poste (`cle`) — faux, le dossier est donné abîmé ; posé par une autre clé (une ancienne) ou
 * sans clé du poste (disque du poste remplacé), le contenu seul est vérifié.
 */
export async function verifierDossier(
  dossier: string,
  texte: string,
  cle: Buffer | null,
  ignorer: (chemin: string) => boolean,
): Promise<Verdict> {
  let m: Manifeste;
  try {
    m = JSON.parse(texte) as Manifeste;
    const bien = (x: unknown): x is [string, number, string] =>
      Array.isArray(x) &&
      typeof x[0] === "string" &&
      typeof x[1] === "number" &&
      typeof x[2] === "string" &&
      HEX64.test(x[2]);
    if (m.v !== 1 || !Array.isArray(m.fichiers) || !m.fichiers.every(bien)) throw new Error();
  } catch {
    return { sain: false, raison: "ses empreintes sont illisibles", octets: 0 };
  }
  let scelle = false;
  if (cle && m.cle === idCle(cle)) {
    const attendu = Buffer.from(sceauManifeste(cle, m), "hex");
    if (
      typeof m.s !== "string" ||
      !HEX64.test(m.s) ||
      !timingSafeEqual(Buffer.from(m.s, "hex"), attendu)
    ) {
      return {
        sain: false,
        raison: "ses empreintes ne portent pas le sceau du poste (modifiées ?)",
        octets: 0,
      };
    }
    scelle = true;
  }
  let vues: Map<string, { t: number; h: string }>;
  try {
    vues = await empreintesDossier(dossier, ignorer);
  } catch (e) {
    return { sain: false, raison: (e as Error).message, octets: 0 };
  }
  const octets = [...vues.values()].reduce((s, v) => s + v.t, 0);
  for (const [f, , h] of m.fichiers) {
    const v = vues.get(f);
    if (!v) return { sain: false, raison: `${f} manque`, octets };
    if (v.h !== h) return { sain: false, raison: `${f} diffère de son empreinte`, octets };
    vues.delete(f);
  }
  const enTrop = [...vues.keys()][0];
  if (enTrop !== undefined) return { sain: false, raison: `${enTrop} en trop`, octets };
  return { sain: true, scelle, octets };
}
