/**
 * /registre — le registre en ligne d'un avion, sur ordre du chef de division : adsbdb dit son type,
 * son immatriculation et son propriétaire ; adsb.lol dit s'il est marqué militaire, quand il suit
 * l'avion en ce moment. La requête nomme l'avion et sort du poste : réservée au chef, journalisée.
 * Ce qu'elle rapporte est dit pour ce qu'il est : « reçu (registre en ligne) », Internet, non
 * vérifié, pas des données capteurs ; un marquage que rien n'a donné est « inconnu », jamais
 * « non » — l'absence de marque n'est pas une preuve.
 *
 * Module pur, testable sous node : le choix de l'avion, la lecture des réponses, les lignes.
 */
import { icaoNation, type LiveAc, type LivePicture } from "./live-adsb.ts";

/** L'avion visé, et sa piste dans l'image du poste si elle y est. */
export type Cible = { hex: string; ac: LiveAc | null };

/**
 * « /registre 0900B5 », « /registre D2EEB », « /registre D2-EEB » : l'adresse ICAO, l'indicatif ou
 * l'immatriculation d'un avion de l'image du poste ; ou une adresse de six chiffres hexadécimaux,
 * même absente de l'image.
 */
export function cibleRegistre(argument: string, pic: LivePicture | null): Cible | { erreur: string } {
  const a = argument.trim().toUpperCase();
  if (!a) {
    return {
      erreur: "/registre attend un avion : son adresse ICAO (/registre 0900B5), son indicatif ou son immatriculation.",
    };
  }
  const ac =
    pic?.aircraft.find(
      (x) => x.hex.toUpperCase() === a || x.flight.trim().toUpperCase() === a || x.reg?.toUpperCase() === a,
    ) ?? null;
  if (ac) return { hex: ac.hex.toLowerCase(), ac };
  if (/^[0-9A-F]{6}$/.test(a)) return { hex: a.toLowerCase(), ac: null };
  return {
    erreur: `${argument.trim().slice(0, 24)} : ni un avion de l'image du poste, ni une adresse ICAO (six chiffres hexadécimaux).`,
  };
}

export type FicheAdsbdb = {
  type: string | null;
  icaoType: string | null;
  constructeur: string | null;
  immat: string | null;
  proprietaire: string | null;
  pays: string | null;
};

const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** La réponse d'api.adsbdb.com/v0/aircraft/{hex} ; null : l'avion est inconnu du registre. */
export function lireAdsbdb(brut: unknown): FicheAdsbdb | null {
  const ac = (brut as { response?: { aircraft?: Record<string, unknown> } } | null)?.response?.aircraft;
  if (!ac || typeof ac !== "object") return null;
  return {
    type: texte(ac.type),
    icaoType: texte(ac.icao_type),
    constructeur: texte(ac.manufacturer),
    immat: texte(ac.registration),
    proprietaire: texte(ac.registered_owner),
    pays: texte(ac.registered_owner_country_name),
  };
}

/**
 * La réponse d'api.adsb.lol/v2/hex/{hex} : `suivi` s'il suit l'avion en ce moment. Alors son
 * marquage militaire est reçu : le bit 1 de dbFlags (base de readsb), absent quand il n'est pas
 * marqué. Non suivi, adsb.lol ne dit rien : marquage inconnu.
 */
export function lireAdsbLol(brut: unknown, hex: string): { suivi: boolean; militaire: boolean | null } {
  const liste = (brut as { ac?: unknown } | null)?.ac;
  const ac = Array.isArray(liste)
    ? (liste.find((x) => String((x as { hex?: unknown } | null)?.hex ?? "").toLowerCase() === hex) as
        | { dbFlags?: unknown }
        | undefined)
    : undefined;
  if (!ac) return { suivi: false, militaire: null };
  return { suivi: true, militaire: (Number(ac.dbFlags) & 1) === 1 };
}

export type Registre = {
  cible: Cible;
  adsbdb: FicheAdsbdb | null | { erreur: string };
  adsblol: { suivi: boolean; militaire: boolean | null } | { erreur: string };
};

function provenance(ac: LiveAc | null): string {
  if (!ac) return "absent de l'image du poste";
  return ac.via === "antenne" ? "entendu par l'antenne du poste" : "vu au relevé Internet du poste";
}

/** Le marquage militaire, et d'où il vient ; « inconnu » quand rien ne l'a donné. */
export function marquage(r: Registre): string {
  const lol = r.adsblol;
  if (!("erreur" in lol) && lol.suivi) {
    return lol.militaire ? "militaire — reçu (adsb.lol)" : "non marqué militaire — reçu (adsb.lol)";
  }
  // Une piste du relevé Internet porte déjà le marquage de l'agrégateur ; pas une de l'antenne.
  const ac = r.cible.ac;
  if (ac && ac.via !== "antenne") {
    return ac.military
      ? "militaire — reçu (relevé Internet du poste)"
      : "non marqué militaire — reçu (relevé Internet du poste)";
  }
  return "erreur" in lol
    ? `inconnu : adsb.lol ${lol.erreur}`
    : "inconnu : adsb.lol ne suit pas cet avion en ce moment";
}

/** Les lignes de /registre : ce qui a été reçu, marqué comme tel, et ce qui ne l'a pas été. */
export function lignesRegistre(r: Registre): string[] {
  const hex = r.cible.hex.toUpperCase();
  const indicatif = r.cible.ac?.flightTx ? ` (${r.cible.ac.flight.trim()})` : "";
  const db = r.adsbdb;
  const fiche =
    db == null
      ? ["  adsbdb : inconnu du registre."]
      : "erreur" in db
        ? [`  adsbdb : ${db.erreur}.`]
        : [
            `  Type : ${db.type ?? "—"}${db.icaoType ? ` (${db.icaoType})` : ""}${db.constructeur ? `, ${db.constructeur}` : ""}`,
            `  Immatriculation : ${db.immat ?? "—"}`,
            `  Propriétaire : ${db.proprietaire ?? "—"}${db.pays ? ` (${db.pays})` : ""}`,
          ];
  return [
    `Registre en ligne de ${hex}${indicatif}, ${provenance(r.cible.ac)}.`,
    "Reçu (registre en ligne) : Internet, non vérifié, pas des données capteurs.",
    ...fiche,
    `  Marquage militaire : ${marquage(r)}`,
    `  Allocation OACI de l'adresse : ${icaoNation(r.cible.hex) ?? "inconnue"}`,
  ];
}

/** Le résumé pour le journal : l'avion et ce que chaque source a rendu, sans plus. */
export function resumeRegistre(r: Registre): string {
  const db = r.adsbdb;
  const lol = r.adsblol;
  return [
    `${r.cible.hex.toUpperCase()}, ${provenance(r.cible.ac)}`,
    `adsbdb : ${db == null ? "inconnu" : "erreur" in db ? db.erreur : (db.immat ?? "trouvé")}`,
    `adsb.lol : ${"erreur" in lol ? lol.erreur : !lol.suivi ? "non suivi" : lol.militaire ? "militaire" : "non marqué"}`,
  ].join(" · ");
}
