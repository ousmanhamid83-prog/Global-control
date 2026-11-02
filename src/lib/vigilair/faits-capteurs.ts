/**
 * Réponse SANS IA à une question sur l'image live : les faits bruts du dernier relevé des capteurs,
 * choisis selon le sujet de la question, sans rédaction ni interprétation. Quand le serveur d'IA
 * n'est pas réglé ou ne répond pas, la console répond quand même : chaque ligne est une valeur
 * reçue (un contact, un METAR, un Kp), jamais une conclusion — ce n'est pas l'assistant qui juge,
 * c'est l'opérateur qui lit.
 */
import { AO, haversineKm } from "./geo.ts";
import type { LiveAc, LivePicture } from "./live-adsb.ts";

export type Sujet = "trafic" | "urgences" | "militaires" | "meteo" | "espace" | "sigmet" | "gnss";

/** Ordre de présentation des faits, du plus urgent au plus général. */
const ORDRE: Sujet[] = ["urgences", "militaires", "trafic", "gnss", "sigmet", "meteo", "espace"];

// Mots qui désignent chaque sujet, sur la question en minuscules et sans accents.
const SUJETS: [Sujet, RegExp][] = [
  ["urgences", /\b(urgences?|7500|7600|7700|detresse|mayday|squawk|detourne\w*)\b/],
  ["militaires", /\b(militaires?|armees?|chasseurs?)\b/],
  [
    "trafic",
    /\b(avions?|contacts?|trafic|aeronefs?|appareils?|vols?|volent|vole|pistes?|survol\w*|proches?|approch\w*|ciel|helicopteres?|drones?)\b/,
  ],
  [
    "meteo",
    /\b(meteo|temps|metar|taf|vents?|visibilite|nuages?|orages?|pluies?|temperatures?|chaleur|qnh|poussieres?|brumes?|sable)\b/,
  ],
  ["espace", /\b(kp|solaires?|geomagnetique|spatiale?|eruptions?|rayons?|swpc|aurores?)\b/],
  ["sigmet", /\b(sigmets?|cendres?|turbulences?|givrage)\b/],
  ["gnss", /\b(gnss|gps|brouillages?|brouille\w*|jam\w*|leurrages?|nic|nacp|spoof\w*)\b/],
];

// Inquiétude ou menace : tout ce qui, dans le relevé, peut alerter.
const INQUIETUDE =
  /\b(inquiet\w*|menaces?|dangers?|dangereu\w*|suspects?|risques?|alertes?|anorma\w*|anomalies?)\b/;
const SUJETS_INQUIETUDE: Sujet[] = ["urgences", "militaires", "trafic", "gnss"];

// Vue d'ensemble demandée.
const ENSEMBLE = /\b(situation|posture|resume|bilan|point|etat|synthese|briefing|neuf|calme)\b/;

// Question d'usage (« comment régler… ») : une valeur de capteur n'y répond jamais, la notice si.
const USAGE =
  /\b(regler|installer|brancher|configurer|parametrer|lancer|activer|desactiver|ajouter|relier|mettre|changer|couper|arreter|telecharger|utiliser|ouvrir|afficher|exporter)\b/;

function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

/**
 * Les sujets d'une question, dans l'ordre de présentation. `null` : question d'usage, à laquelle
 * les capteurs n'ont rien à répondre. Un tableau vide : aucun sujet reconnu.
 */
export function sujetsDe(question: string): Sujet[] | null {
  const q = normaliser(question);
  if (USAGE.test(q)) return null;
  if (ENSEMBLE.test(q)) return [...ORDRE];
  const vus = new Set(SUJETS.filter(([, re]) => re.test(q)).map(([s]) => s));
  if (INQUIETUDE.test(q)) for (const s of SUJETS_INQUIETUDE) vus.add(s);
  return ORDRE.filter((s) => vus.has(s));
}

/**
 * Les n contacts les plus proches du poste, une ligne factuelle chacun : rien que des champs reçus,
 * et la distance au poste. Sans elle, rien ne disait au modèle que « le plus proche » peut être à
 * des milliers de kilomètres (mesuré le 2 novembre 2026 : 2 493 km).
 */
export function contactsProches(ac: LiveAc[], n: number): string[] {
  return ac
    .map((a) => ({ a, km: haversineKm(AO.centerLat, AO.centerLon, a.lat, a.lon) }))
    .sort((x, y) => x.km - y.km)
    .slice(0, n)
    .map(({ a, km }) =>
      [
        a.flight,
        a.hex,
        a.icaoType ?? "?",
        a.reg ?? "",
        `FL${Math.round(a.altM / 30.48)}`,
        `nic=${a.nic ?? "?"}`,
        `à ${Math.round(km)} km`,
        a.military ? "MIL" : "",
        a.emergency ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    );
}

/** Les sujets tirés des trames 1090, quand aucune n'est parvenue. */
const MUETS_1090: Record<Exclude<Sujet, "meteo" | "sigmet" | "espace">, string> = {
  urgences: "Urgences (7500/7600/7700) : inconnues",
  militaires: "Contacts militaires : inconnus",
  trafic: "Trafic 1090ES : inconnu",
  gnss: "GNSS dégradé (NIC/NACp des avions) : inconnu",
};

const retrait = (lignes: string[]) => lignes.map((l) => `  ${l}`);

/** La source a répondu au dernier relevé (identifiants des sources de l'image : « 1090 », « metar »…). */
function recu(pic: LivePicture, id: string): boolean {
  return pic.sources.some((s) => s.id === id && s.ok);
}

/** Des trames 1090 sont parvenues : par l'antenne du poste (« rx ») ou par l'ADS-B Internet. */
function entendu(pic: LivePicture): boolean {
  return recu(pic, "rx") || recu(pic, "1090");
}

/**
 * Une source muette n'est jamais dite vide : « SIGMET : aucun » quand rien n'a été reçu rassurerait
 * à tort. Hors ligne, l'antenne entend encore, mais METAR, SIGMET, météo spatiale et marquage
 * militaire n'arrivent que par Internet.
 */
function lignesDe(s: Sujet, pic: LivePicture, n: number): string[] {
  if (s !== "meteo" && s !== "sigmet" && s !== "espace" && !entendu(pic)) {
    return [`${MUETS_1090[s]}, aucune trame 1090 reçue (antenne et ADS-B Internet muets).`];
  }
  switch (s) {
    case "urgences":
      return pic.emergencies.length === 0
        ? ["Urgences (7500/7600/7700) : aucune."]
        : [`Urgences : ${pic.emergencies.length}`, ...retrait(contactsProches(pic.emergencies, 6))];
    case "militaires": {
      if (!recu(pic, "1090")) {
        return ["Contacts militaires : inconnus, le marquage vient de l'ADS-B Internet, non reçu."];
      }
      const mil = pic.aircraft.filter((a) => a.military);
      return mil.length === 0
        ? ["Contacts militaires : aucun."]
        : [
            `Contacts militaires : ${mil.length}, les plus proches de FTTJ :`,
            ...retrait(contactsProches(mil, n)),
          ];
    }
    case "trafic":
      return pic.aircraft.length === 0
        ? ["1090ES : aucun contact dans le dernier relevé."]
        : [
            `1090ES : ${pic.aircraft.length} contacts en Afrique, ${pic.sahelN} au Sahel, ` +
              `${pic.localN} à moins de 120 km de FTTJ. Les plus proches de FTTJ :`,
            ...retrait(contactsProches(pic.aircraft, n)),
          ];
    case "gnss": {
      const chaudes = pic.jam.filter((j) => j.level !== "low").sort((a, b) => b.pct - a.pct);
      return chaudes.length === 0
        ? ["GNSS dégradé (NIC/NACp des avions) : aucune cellule chaude."]
        : [
            `GNSS dégradé (NIC/NACp des avions) : ${chaudes.length} cellule(s)`,
            ...retrait(
              chaudes
                .slice(0, 3)
                .map(
                  (j) =>
                    `${j.lat.toFixed(1)}, ${j.lon.toFixed(1)} : ${Math.round(j.pct)} % de ${j.n} avions (${j.level === "high" ? "forte" : "moyenne"})`,
                ),
            ),
          ];
    }
    case "sigmet": {
      if (!recu(pic, "sigmet")) return ["SIGMET : non reçus au dernier relevé."];
      const ao = pic.sigmets.filter((x) => x.inAo);
      return ao.length === 0
        ? ["SIGMET touchant l'AO : aucun."]
        : [
            `SIGMET touchant l'AO : ${ao.length}`,
            ...retrait(
              ao
                .slice(0, 5)
                .map((x) => [x.fir, x.hazard, x.qualifier ?? ""].filter(Boolean).join(" ")),
            ),
          ];
    }
    case "meteo": {
      // Le message reçu, mot pour mot ; son type n'est ajouté devant que s'il n'y figure pas déjà.
      const metar = pic.metar.find((m) => m.icao === "FTTJ");
      const taf = pic.taf.find((t) => t.icao === "FTTJ");
      return [
        !recu(pic, "metar")
          ? "METAR FTTJ : non reçu au dernier relevé."
          : !metar
            ? "METAR FTTJ : absent du relevé (la station est parfois muette)."
            : /^(METAR|SPECI)\b/.test(metar.raw)
              ? metar.raw
              : `METAR FTTJ : ${metar.raw}`,
        ...(!taf ? [] : [/^TAF\b/.test(taf.raw) ? taf.raw : `TAF FTTJ : ${taf.raw}`]),
      ];
    }
    case "espace":
      if (!recu(pic, "swpc")) return ["Météo spatiale (NOAA SWPC) : non reçue au dernier relevé."];
      return [
        `Météo spatiale : Kp ${pic.space.kp} (${pic.space.gScale}), rayons X GOES ${pic.space.xrayClass}.`,
        pic.alerts.length === 0
          ? "Alertes SWPC : aucune."
          : `Alertes SWPC : ${pic.alerts
              .slice(0, 3)
              .map((a) => `${a.kind} ${a.title}`)
              .join(" ; ")}`,
      ];
  }
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/**
 * Les faits du dernier relevé qui répondent à la question, une ligne par valeur ; [] quand les
 * capteurs n'ont rien à y répondre — question d'usage, ou question sans sujet reconnu à laquelle
 * la notice répond (`notice` : nombre de passages qu'elle a trouvés). Sans sujet ni notice : la
 * vue d'ensemble, plutôt que rien. `piste` : la piste ciblée depuis son dossier, rappelée en tête.
 */
export function faitsCapteurs(
  question: string,
  pic: LivePicture | null,
  maintenant: number,
  notice: number,
  piste = "",
): string[] {
  let sujets = sujetsDe(question);
  if (sujets === null) return [];
  if (sujets.length === 0) {
    if (notice > 0) return [];
    sujets = [...ORDRE];
  }
  const tete = piste ? ["Piste ciblée (champs reçus) :", ...retrait(piste.split("\n"))] : [];
  if (!pic) return [...tete, "Pas encore de relevé des capteurs (1090ES / METAR en attente)."];
  // Vue d'ensemble : trois contacts par liste ; un sujet précis : cinq.
  const n = sujets.length >= ORDRE.length ? 3 : 5;
  return [
    ...tete,
    `Dernier relevé des capteurs : ${new Date(pic.at).toISOString().slice(11, 19)} UTC, il y a ${age(maintenant - pic.at)}.`,
    ...sujets.flatMap((s) => lignesDe(s, pic, n)),
  ];
}
