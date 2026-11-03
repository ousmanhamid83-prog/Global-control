/**
 * Compétences de l'agent IA du poste : les commandes du poste qu'il consulte lui-même, choisies
 * selon la question. Ce sont exactement les commandes de la console (commandes-poste), donc les
 * mêmes valeurs, les mêmes « non reçu », et les mêmes bascules : une commande désactivée pour un
 * canal ne nourrit pas non plus l'agent de ce canal (le bot ne fait pas dire à l'IA ce que /trafic
 * lui refuse).
 *
 * L'IA rédige à partir de ces lignes ; sans IA, la console les montre telles quelles. Module pur,
 * testable sous node.
 */
import { executerImage, lignesSources } from "./commandes-poste.ts";
import { ORDRE, PAS_DE_RELEVE, normaliser, sujetsDe } from "./faits-capteurs.ts";
import { IA_CONTACTS_VUS } from "./ia-limites.ts";
import type { LivePicture } from "./live-adsb.ts";

export type Competence = { nom: string; argument: string };

const SOLEIL = /\b(soleil|nuit|nocturne|jour|lever|coucher|crepuscule|aube|obscurite)\b/;
const PHENOMENES =
  /\b(feux?|incendies?|seismes?|crues?|inondations?|tempetes?|volcans?|phenomenes?|catastrophes?|cyclones?)\b/;
// « marche », « fonctionne » seuls ne suffisent pas : « comment marche le garde-fou ? » est une
// question d'usage.
const CAPTEURS = /\b(capteurs?|sources?|antennes?|recepteurs?|pannes?)\b/;

/** Les contacts du relevé que la question nomme (indicatif ou adresse ICAO), trois au plus. */
function pistesCitees(question: string, pic: LivePicture | null): string[] {
  if (!pic) return [];
  const mots = new Set(question.toUpperCase().split(/[^A-Z0-9]+/));
  const vues: string[] = [];
  for (const a of pic.aircraft) {
    const indicatif = a.flight.trim().toUpperCase();
    if (indicatif.length >= 3 && mots.has(indicatif)) vues.push(indicatif);
    else if (mots.has(a.hex.toUpperCase())) vues.push(a.hex);
    if (vues.length === 3) break;
  }
  return vues;
}

/**
 * Les commandes à consulter pour une question. Aucune pour une question d'usage (la notice y
 * répond). Les sujets de l'image (/urgences, /meteo…), ou la /situation entière quand la question
 * la demande — ou quand rien d'autre n'y répond. Plus /soleil, /phenomenes, /capteurs et la
 * /piste de chaque contact nommé, quand la question en parle.
 */
export function competencesPour(
  question: string,
  pic: LivePicture | null,
  notice: number,
): Competence[] {
  const sujets = sujetsDe(question);
  if (sujets === null) return [];
  const q = normaliser(question);
  const autres: Competence[] = [
    ...(SOLEIL.test(q) ? [{ nom: "soleil", argument: "" }] : []),
    ...(PHENOMENES.test(q) ? [{ nom: "phenomenes", argument: "" }] : []),
    ...(CAPTEURS.test(q) ? [{ nom: "capteurs", argument: "" }] : []),
    ...pistesCitees(question, pic).map((id) => ({ nom: "piste", argument: id })),
  ];
  const image =
    sujets.length === ORDRE.length
      ? [{ nom: "situation", argument: "" }]
      : sujets.length > 0
        ? sujets.map((s) => ({ nom: s, argument: s === "trafic" ? String(IA_CONTACTS_VUS) : "" }))
        : autres.length > 0 || notice > 0
          ? []
          : [{ nom: "situation", argument: "" }];
  return [...image, ...autres];
}

export type Consultation = {
  /** Les commandes consultées, telles que l'opérateur les taperait (« /piste TST101 »). */
  noms: string[];
  /** Leurs lignes, l'heure du relevé une seule fois en tête. */
  lignes: string[];
};

/**
 * Exécute les compétences retenues ET activées sur le canal (`active`). `piste` : la piste ciblée
 * depuis son dossier, rappelée en tête, champ par champ.
 */
export function consulter(
  choisies: Competence[],
  pic: LivePicture | null,
  maintenant: number,
  active: (nom: string) => boolean,
  piste = "",
): Consultation {
  const retenues = choisies.filter((c) => active(c.nom));
  if (retenues.length === 0) return { noms: [], lignes: [] };
  const lignes = piste
    ? ["Piste ciblée (champs reçus) :", ...piste.split("\n").map((l) => `  ${l}`)]
    : [];
  for (const c of retenues) {
    const sortie =
      c.nom === "capteurs"
        ? lignesSources(pic, maintenant)
        : (executerImage(c.nom, c.argument, pic, maintenant, active) ?? []);
    for (const l of sortie) {
      const commune = l === PAS_DE_RELEVE || l.startsWith("Dernier relevé des capteurs :");
      if (!commune || !lignes.includes(l)) lignes.push(l);
    }
  }
  return {
    noms: retenues.map((c) => `/${c.nom}${c.argument ? ` ${c.argument}` : ""}`),
    lignes,
  };
}
