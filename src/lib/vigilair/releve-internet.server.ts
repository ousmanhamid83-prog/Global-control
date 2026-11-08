/**
 * Relevé Internet du poste, sur décision du chef de division — CÔTÉ SERVEUR.
 *
 * Activé (à la livraison, comme avant) : le poste relève ses sources Internet — ADS-B des
 * agrégateurs, METAR, TAF, SIGMET, météo spatiale, phénomènes — quand la console ou le bot en a
 * besoin, toutes les 20 s au plus. Coupé : plus rien ne sort du poste pour le relevé ; l'image ne
 * garde que l'antenne du poste et le dernier relevé, qui vieillit à vue, et ce qui ne vient que
 * d'Internet est dit « non reçu ». Coupé, le chef peut encore « relever maintenant » : un relevé,
 * un seul, à son ordre, journalisé.
 *
 * L'état survit au redémarrage (data/releve-internet.json) ; il vit sur globalThis, car le serveur
 * construit a plusieurs copies de chaque module.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type Interne = {
  actif: boolean;
  chargement: Promise<void> | null;
  enregistrement: "fichier" | "memoire";
  /** Dernier relevé fait sur ordre du chef (ms) ; null : aucun depuis le démarrage. */
  ordreA: number | null;
};

const g = globalThis as typeof globalThis & { __afriReleveInternet?: Interne };

function fichier(): string {
  return path.join(process.cwd(), "data", "releve-internet.json");
}

async function charger(e: Interne): Promise<void> {
  try {
    const lu = JSON.parse(await readFile(fichier(), "utf8")) as { actif?: unknown };
    // Seul un « false » écrit coupe : un fichier abîmé ne coupe pas le relevé en silence.
    e.actif = lu.actif !== false;
  } catch {
    // Pas de fichier : activé, comme à la livraison.
  }
}

async function etat(): Promise<Interne> {
  const e = (g.__afriReleveInternet ??= {
    actif: true,
    chargement: null,
    enregistrement: "fichier",
    ordreA: null,
  });
  await (e.chargement ??= charger(e));
  return e;
}

export type EtatReleveInternet = {
  actif: boolean;
  enregistrement: "fichier" | "memoire";
  ordreA: number | null;
};

function vue(e: Interne): EtatReleveInternet {
  return { actif: e.actif, enregistrement: e.enregistrement, ordreA: e.ordreA };
}

/** Le poste peut-il relever Internet de lui-même ? (Un ordre du chef passe outre, voir live-feeds.) */
export async function releveInternetActif(): Promise<boolean> {
  return (await etat()).actif;
}

export async function lireReleve(): Promise<EtatReleveInternet> {
  return vue(await etat());
}

/** Le chef active ou coupe le relevé : effet à la prochaine demande, puis enregistré sur le poste. */
export async function basculerReleve(actif: boolean): Promise<EtatReleveInternet> {
  const e = await etat();
  e.actif = actif;
  try {
    const f = fichier();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(`${f}.part`, `${JSON.stringify({ actif }, null, 2)}\n`);
    await rename(`${f}.part`, f);
    e.enregistrement = "fichier";
  } catch {
    e.enregistrement = "memoire";
  }
  return vue(e);
}

/** Un relevé vient d'être fait sur ordre du chef. */
export async function noterOrdre(at: number): Promise<void> {
  (await etat()).ordreA = at;
}
