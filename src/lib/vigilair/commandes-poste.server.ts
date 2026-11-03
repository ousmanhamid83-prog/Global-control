/**
 * Commandes du poste — CÔTÉ SERVEUR : les bascules enregistrées sur le poste, et l'exécution de
 * toute commande, quel que soit le canal (console, bot Signal).
 *
 * Les bascules vivent dans data/commandes-poste.json, à côté de poste.env : elles survivent au
 * redémarrage même sans Postgres (la base embarquée, elle, repart vide). Sur un disque en lecture
 * seule, une bascule vaut jusqu'au redémarrage, et la console le dit.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMMANDES,
  LIBELLE_CANAL,
  aide,
  analyser,
  basculesValides,
  commandeActive,
  executerImage,
  lignesSources,
  type Bascules,
  type Canal,
} from "./commandes-poste";
import { imagePoste } from "./live-feeds";

export type ResultatCommande = {
  ok: boolean;
  /** Nom de la commande reconnue ; null si la ligne n'en est pas une, ou une inconnue. */
  commande: string | null;
  lignes: string[];
  /** Temps d'exécution sur le serveur du poste, en millisecondes. */
  ms: number;
};

export type EtatBascules = {
  bascules: Bascules;
  /** « fichier » : enregistré sur le poste ; « memoire » : jusqu'au redémarrage. */
  enregistrement: "fichier" | "memoire";
};

type Etat = EtatBascules & { charge: boolean };

const g = globalThis as typeof globalThis & { __afriCommandes?: Etat };

function fichier(): string {
  return path.join(process.cwd(), "data", "commandes-poste.json");
}

async function etat(): Promise<Etat> {
  const e = (g.__afriCommandes ??= { bascules: {}, enregistrement: "fichier", charge: false });
  if (!e.charge) {
    e.charge = true;
    try {
      e.bascules = basculesValides(JSON.parse(await readFile(fichier(), "utf8")));
    } catch {
      // Pas encore de fichier (ou illisible) : les réglages de livraison.
    }
  }
  return e;
}

export async function lireBascules(): Promise<EtatBascules> {
  const e = await etat();
  return { bascules: e.bascules, enregistrement: e.enregistrement };
}

/** Active ou désactive une commande sur un canal ; effet immédiat, puis enregistré sur le poste. */
export async function basculer(nom: string, canal: Canal, actif: boolean): Promise<EtatBascules> {
  const c = COMMANDES.find((x) => x.nom === nom);
  if (!c) throw new Error(`Commande inconnue : ${nom}`);
  if (c.fixe) throw new Error(`/${nom} ne se désactive pas`);
  const e = await etat();
  e.bascules = { ...e.bascules, [nom]: { ...e.bascules[nom], [canal]: actif } };
  try {
    const f = fichier();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(`${f}.part`, `${JSON.stringify(e.bascules, null, 2)}\n`);
    await rename(`${f}.part`, f);
    e.enregistrement = "fichier";
  } catch {
    e.enregistrement = "memoire";
  }
  return { bascules: e.bascules, enregistrement: e.enregistrement };
}

async function capteurs(maintenant: number): Promise<string[]> {
  const lignes = lignesSources(await imagePoste(), maintenant);
  const ia = await import("./ia-poste.server");
  const indispo = ia.iaIndisponible();
  lignes.push(indispo ? `  ✖ IA du poste : ${indispo.erreur}` : "  ✔ IA du poste : réglée");
  return lignes;
}

async function notice(question: string): Promise<string[]> {
  if (!question) return ["/notice attend une question : /notice comment relier Signal ?"];
  const passages = await (await import("./savoir-poste.server")).noticePour(question);
  if (passages.length === 0) return [`La notice du poste ne répond pas à « ${question} ».`];
  return passages.flatMap((p) => [`[${p.titre}]`, p.texte]);
}

/** /ia : l'agent répond ; sans IA, les lignes des commandes consultées et la notice. */
async function ia(question: string, canal: Canal): Promise<{ ok: boolean; lignes: string[] }> {
  if (!question) {
    return {
      ok: false,
      lignes: ["/ia attend une question : /ia que se passe-t-il au nord du poste ?"],
    };
  }
  const r = await (await import("./agent-poste.server")).repondre(question, canal);
  const consultees = r.competences.length
    ? [`Commandes consultées : ${r.competences.join(", ")}.`]
    : [];
  if (r.ok) return { ok: true, lignes: [...r.text.split("\n"), ...consultees] };
  return {
    ok: false,
    lignes: [
      `${r.error} — sans IA : les valeurs reçues et la notice, sans rédaction.`,
      ...r.faits,
      ...r.notice.map((p) => `[Notice] ${p.titre}`),
      ...consultees,
    ],
  };
}

/** /briefing : rédigé par l'IA du poste à partir des commandes activées du canal. */
async function briefing(canal: Canal): Promise<{ ok: boolean; lignes: string[] }> {
  const r = await (await import("./agent-poste.server")).briefing(canal);
  return r.ok
    ? {
        ok: true,
        lignes: [...r.text.split("\n"), `Commandes consultées : ${r.competences.join(", ")}.`],
      }
    : { ok: false, lignes: [r.error] };
}

/** Exécute une ligne « /commande argument » reçue sur un canal. */
export async function lancer(texte: string, canal: Canal): Promise<ResultatCommande> {
  const t0 = performance.now();
  const fin = (r: Omit<ResultatCommande, "ms">): ResultatCommande => ({
    ...r,
    ms: Math.round((performance.now() - t0) * 100) / 100,
  });
  const a = analyser(texte);
  if (!a) {
    return fin({ ok: false, commande: null, lignes: ["Une commande commence par « / » : /aide."] });
  }
  if ("inconnue" in a) {
    return fin({
      ok: false,
      commande: null,
      lignes: [`Commande inconnue : /${a.inconnue}. /aide pour la liste.`],
    });
  }
  const { commande, argument } = a;
  const { bascules } = await etat();
  if (!commandeActive(commande, canal, bascules)) {
    return fin({
      ok: false,
      commande: commande.nom,
      lignes: [
        `/${commande.nom} est désactivée au poste pour ${LIBELLE_CANAL[canal]}. Le chef de division l'active dans Capteurs › Outils › Commandes du poste.`,
      ],
    });
  }
  const maintenant = Date.now();
  if (commande.nom === "aide") {
    return fin({ ok: true, commande: "aide", lignes: aide(argument, canal, bascules) });
  }
  if (commande.nom === "capteurs") {
    return fin({ ok: true, commande: "capteurs", lignes: await capteurs(maintenant) });
  }
  if (commande.nom === "ia") return fin({ commande: "ia", ...(await ia(argument, canal)) });
  if (commande.nom === "briefing") {
    return fin({ commande: "briefing", ...(await briefing(canal)) });
  }
  if (commande.nom === "notice") {
    return fin({ ok: true, commande: "notice", lignes: await notice(argument) });
  }
  const active = (nom: string) => {
    const c = COMMANDES.find((x) => x.nom === nom);
    return c != null && commandeActive(c, canal, bascules);
  };
  const lignes = executerImage(commande.nom, argument, await imagePoste(), maintenant, active);
  return fin({ ok: true, commande: commande.nom, lignes: lignes ?? [] });
}
