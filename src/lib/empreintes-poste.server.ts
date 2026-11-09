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
import path from "node:path";

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

/** La taille et le SHA-256 d'un fichier, lu au fil de l'eau. */
export async function hacherFichier(fichier: string): Promise<{ t: number; h: string }> {
  const h = createHash("sha256");
  let t = 0;
  for await (const morceau of createReadStream(fichier) as AsyncIterable<Buffer>) {
    h.update(morceau);
    t += morceau.length;
  }
  return { t, h: h.digest("hex") };
}
