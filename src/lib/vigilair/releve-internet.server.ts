/**
 * Relevé Internet du poste, sur décision du chef de division — CÔTÉ SERVEUR.
 *
 * Coupé à la livraison (décision du chef de division : rien ne sort du poste sans son ordre) :
 * l'image ne garde que l'antenne du poste et le dernier relevé, qui vieillit à vue, et ce qui ne
 * vient que d'Internet est dit « non reçu » ; le chef peut « relever maintenant » : un relevé, un
 * seul, à son ordre, journalisé. Activé par le chef : le poste relève ses sources Internet —
 * ADS-B des agrégateurs, METAR, TAF, SIGMET, météo spatiale, phénomènes — quand la console ou le
 * bot en a besoin, toutes les 20 s au plus.
 *
 * L'état survit au redémarrage (data/releve-internet.json) ; il vit sur globalThis, car le serveur
 * construit a plusieurs copies de chaque module.
 */
import { ecrireFichierPoste, lireFichierPoste } from "../disque-poste.server.ts";
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
  // Illisible : sa copie, qui garde la dernière décision du chef. Seul un « true » écrit active :
  // un fichier abîmé, sans copie lisible, laisse le relevé coupé, rien ne sort.
  const lu = await lireFichierPoste(fichier(), (t) => JSON.parse(t) as { actif?: unknown } | null);
  e.actif = lu?.actif === true;
}

async function etat(): Promise<Interne> {
  const e = (g.__afriReleveInternet ??= {
    actif: false,
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
    await ecrireFichierPoste(fichier(), `${JSON.stringify({ actif }, null, 2)}\n`);
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
