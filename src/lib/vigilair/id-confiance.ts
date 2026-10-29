/**
 * CONFIANCE D'IDENTIFICATION DU TRAFIC RÉEL — cœur PUR, testable.
 *
 * La « confiance » d'une piste dit à quel point le poste sait CE QU'ELLE EST. Pour la simulation,
 * elle monte avec le temps et le nombre de capteurs qui corroborent. Pour le trafic 1090ES réel,
 * elle était TAPÉE EN DUR : `confidence: uav ? 72 : 99`. Mesuré sur l'écran d'accueil : 131 pistes
 * réelles, toutes à 99 %, identiques d'une minute à l'autre — y compris des pistes dont le type est
 * inconnu et des adresses ICAO soupçonnées d'être tenues par deux émetteurs. Un chiffre inventé,
 * présenté comme une mesure, et recopié tel quel dans le journal de preuve chaîné.
 *
 * Ce module la dérive des PREUVES D'IDENTITÉ réellement portées par la piste, et de rien d'autre :
 *
 *   — le type est-il DÉCLARÉ par le registre pour cette adresse ICAO, ou inconnu ?
 *   — l'adresse est-elle saine, ou un épisode de relevés incohérents la met-il en doute ?
 *
 * Ce qu'il refuse délibérément de mélanger : la QUALITÉ DE POSITION (rayon de confinement, MLAT,
 * piste muette). Elle a déjà son cercle d'incertitude au scope. Une piste MLAT à ±2 km n'est pas
 * moins bien IDENTIFIÉE — son adresse est décodée sous CRC comme les autres — elle est moins bien
 * PLACÉE. Confondre les deux, c'est le défaut même qu'on vient de corriger sur le brouillage.
 *
 * Les paliers sont des CATÉGORIES de preuve documentées, pas une probabilité mesurée : on le dit.
 * Ce qui change, c'est qu'ils BOUGENT avec la preuve — un doublon d'adresse fait chuter la
 * confiance, sa disparition la rétablit, un type complété par le registre la relève.
 *
 * Analyse de cohérence du signal, jamais d'identité nominative : on ne dit pas QUI est à bord, on
 * dit ce que le poste sait de la nature de l'appareil, et pourquoi.
 */

/** Ce que le poste sait de la nature de l'appareil. */
export type TypeConnu =
  /** Le registre donne le type pour cette adresse ICAO : l'appareil est identifié. */
  | "declare"
  /** Aéronef coopératif dont le type est inconnu : on sait QU'il vole, pas CE QU'il est. */
  | "inconnu"
  /** Drone coopératif (catégorie B6 émise par l'appareil) : la nature est déclarée, pas le modèle. */
  | "drone";

export type IdPreuves = {
  type: TypeConnu;
  /** Un épisode de relevés incohérents est-il ouvert sur cette adresse ? Combien de refus ? */
  incoherences: number;
  /** Au-delà de ce nombre, l'adresse est vraisemblablement tenue par deux émetteurs. */
  seuilDoublon: number;
};

export type IdConfiance = {
  /** Score 0–100, catégoriel et documenté — pas une probabilité mesurée. */
  score: number;
  /** Pourquoi ce score : à afficher, pas à taire. */
  motif: string;
};

/** Paliers de base, par nature de la preuve. */
export const CONFIANCE_TYPE_DECLARE = 95;
export const CONFIANCE_TYPE_INCONNU = 60;
export const CONFIANCE_DRONE = 72;
/** Un relevé incohérent isolé : une trame ratée, probablement — mais on le compte. */
export const PENALITE_INCOHERENCE = 15;
/**
 * Adresse ICAO vraisemblablement partagée : on ne sait plus QUEL émetteur on regarde. L'identité
 * tirée de l'adresse ne vaut plus grand-chose, quel que soit le type déclaré.
 */
export const PLAFOND_DOUBLON = 30;

/** Catégorie de type à partir de la plate-forme retenue pour la piste. */
export function typeConnuDe(platformId: string): TypeConnu {
  if (platformId === "adsb-uav") return "drone";
  if (platformId === "asecna-unk") return "inconnu";
  return "declare";
}

/**
 * Confiance d'identification d'une piste 1090ES réelle, avec son motif. Bornée à [5, 99] : jamais
 * 100 (rien d'un signal reçu n'est certain), jamais 0 (une adresse décodée sous CRC n'est pas rien).
 */
export function idConfiance(p: IdPreuves): IdConfiance {
  const base =
    p.type === "declare"
      ? CONFIANCE_TYPE_DECLARE
      : p.type === "drone"
        ? CONFIANCE_DRONE
        : CONFIANCE_TYPE_INCONNU;
  const motifBase =
    p.type === "declare"
      ? "type déclaré au registre"
      : p.type === "drone"
        ? "drone coopératif, modèle non déclaré"
        : "type inconnu";

  if (p.incoherences >= p.seuilDoublon) {
    return {
      score: Math.min(base, PLAFOND_DOUBLON),
      motif: `adresse ICAO douteuse (${p.incoherences} relevés incohérents) — émetteur incertain`,
    };
  }
  if (p.incoherences > 0) {
    return {
      score: borne(base - PENALITE_INCOHERENCE * p.incoherences),
      motif: `${motifBase} · ${p.incoherences} relevé${p.incoherences > 1 ? "s" : ""} incohérent${p.incoherences > 1 ? "s" : ""}`,
    };
  }
  return { score: borne(base), motif: motifBase };
}

function borne(v: number): number {
  return Math.max(5, Math.min(99, Math.round(v)));
}
