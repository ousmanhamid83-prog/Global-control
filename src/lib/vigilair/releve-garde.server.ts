/**
 * Le relevé Internet reçu, gardé sans limite. Quand le chef l'a activé, chaque relevé apporte, en
 * plus des aéronefs (gardés avec le trafic reçu, voir rejeu.server.ts) : METAR, TAF, SIGMET,
 * météo spatiale et ses alertes, l'aérodrome, les phénomènes. Chaque rubrique est écrite dans
 * data/releve/releve-<jour>.jsonl (jour du poste), forcée et doublée, seulement quand elle change :
 * une ligne { at, <rubriques changées> } — l'état à une heure donnée est, pour chaque rubrique, sa
 * dernière valeur écrite avant. Le relevé revient toutes les 20 s ; le flux X du soleil change
 * chaque minute (≈ 250 octets), la météo toutes les 30 à 60 min, les phénomènes plus rarement
 * (mesuré : 83 phénomènes, 40 SIGMET, 14 METAR, 7 TAF ≈ 56 Ko en tout).
 *
 * Ne comptent pas pour dire qu'une rubrique a changé : l'ordre des listes (les sources le
 * varient), l'heure GPS de la météo spatiale (recalculée), l'heure redonnée aux phénomènes à
 * chaque relevé (GDACS). Les SIGMET redits en phénomènes n'y sont pas : ils sont gardés tels que
 * reçus.
 */
import path from "node:path";
import { ajouterFichierPoste, noterDefautCopie } from "../disque-poste.server.ts";
import { jourPoste } from "./format.ts";
import type { LivePicture } from "./live-adsb";

type Rubriques = ReturnType<typeof rubriquesDuReleve>;

const g = globalThis as unknown as {
  __afriReleveGarde?: { derniers: Map<string, string>; file: Promise<void> };
};

/** Le fichier du relevé reçu le jour du poste où tombe `at`. */
export function fichierReleve(at: number): string {
  return path.join(process.cwd(), "data", "releve", `releve-${jourPoste(at)}.jsonl`);
}

const triee = <T>(liste: T[], cle: (x: T) => string) =>
  [...liste].sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));

/** Ce que le relevé a reçu, rubrique par rubrique, listes triées. */
export function rubriquesDuReleve(p: LivePicture) {
  const { gpsWeek: _semaine, gpsTowS: _seconde, ...space } = p.space;
  return {
    metar: triee(p.metar, (m) => `${m.icao} ${m.raw}`),
    taf: triee(p.taf, (t) => `${t.icao} ${t.raw}`),
    sigmets: triee(p.sigmets, (s) => `${s.fir} ${s.hazard} ${s.validFrom ?? ""} ${s.raw}`),
    space,
    airport: p.airport,
    alerts: triee(p.alerts, (a) => `${a.at ?? ""} ${a.code} ${a.title}`),
    phenomenes: triee(
      p.phenomena.filter((x) => !x.id.startsWith("sig-")),
      (x) => x.id,
    ),
  };
}

/** La clé qui dit si une rubrique a changé : sans l'heure redonnée aux phénomènes. */
function cle(nom: string, valeur: unknown): string {
  if (nom !== "phenomenes") return JSON.stringify(valeur);
  return JSON.stringify((valeur as Rubriques["phenomenes"]).map(({ at: _heure, ...x }) => x));
}

/** Garde les rubriques d'un relevé qui ont changé depuis les dernières gardées, dans l'ordre. */
export function garderReleve(p: LivePicture): Promise<void> {
  const etat = (g.__afriReleveGarde ??= { derniers: new Map(), file: Promise.resolve() });
  const changees: Partial<Rubriques> = {};
  for (const [nom, valeur] of Object.entries(rubriquesDuReleve(p))) {
    const c = cle(nom, valeur);
    if (etat.derniers.get(nom) === c) continue;
    etat.derniers.set(nom, c);
    (changees as Record<string, unknown>)[nom] = valeur;
  }
  if (Object.keys(changees).length === 0) return etat.file;
  const ligne = `${JSON.stringify({ at: p.at, ...changees })}\n`;
  etat.file = etat.file
    .then(() => ajouterFichierPoste(fichierReleve(p.at), ligne, "copie du relevé Internet"))
    .then(() => noterDefautCopie("enregistrement du relevé Internet", null))
    .catch((e: unknown) => noterDefautCopie("enregistrement du relevé Internet", e));
  return etat.file;
}
