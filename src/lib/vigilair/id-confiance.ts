/**
 * STATUT ET CONFIANCE D'IDENTIFICATION DU TRAFIC RÉEL — cœur PUR, testable.
 *
 * Deux défauts, corrigés ensemble parce qu'ils disent la même chose de deux façons :
 *
 *  1) Le STATUT. Toute piste 1090ES réelle naissait « confirmée » dès sa première trame
 *     (`idState: uav ? "candidat" : "confirme"`). Le dossier affichait donc des contradictions comme
 *     « Identification : Confirmé · confiance 60 % (type inconnu) », et les tableaux de bord
 *     comptaient tout le trafic comme confirmé. Un statut qui ne dépend d'aucune preuve.
 *
 *  2) La CONFIANCE. Tapée en dur à 99 % à l'origine, puis ramenée à trois paliers — si bien que
 *     120 pistes affichaient exactement 95 %. Moins faux, mais pas PRÉCIS : deux avions dont l'un
 *     émet son indicatif et a une immatriculation connue, et l'autre rien, recevaient le même score.
 *
 * Un seul calcul produit désormais les deux, depuis les PREUVES D'IDENTITÉ réellement portées :
 *
 *   — le type est-il déclaré par le registre pour cette adresse ICAO ?
 *   — l'immatriculation est-elle connue (fiche registre complète pour cette adresse) ?
 *   — l'appareil émet-il lui-même un indicatif ? (Le libellé affiché se replie sur l'immatriculation
 *     quand rien n'est émis : ce repli n'est PAS un indicatif, et ne rapporte rien.)
 *   — combien de relevés COHÉRENTS et DISTINCTS la piste a-t-elle accumulés ? C'est la confirmation
 *     classique d'un pisteur (M relevés sur N) : un relevé isolé peut être un fantôme de décodage,
 *     deux relevés cohérents font une piste réelle, et la confiance mûrit avec les suivants. Un
 *     rapport que l'agrégateur resert à l'identique n'est pas un relevé de plus ;
 *   — combien de MESSAGES la source a-t-elle déjà reçus de cette adresse ? Un rapport d'agrégateur
 *     résume des milliers de réceptions (médiane mesurée 10 809, minimum 217) ; notre décodeur
 *     compte les siennes. Au-delà du seuil, l'adresse ne peut pas être un fantôme de décodage : la
 *     piste est établie dès le premier relevé, au lieu d'attendre le prochain passage de sa
 *     cellule — 58 s en médiane, mesuré ;
 *   — un épisode de relevés incohérents pèse-t-il sur l'adresse ?
 *
 * Ce qui en est délibérément EXCLU : la qualité de position (MLAT, rayon de confinement, piste
 * muette). Elle a son propre cercle au scope ; une piste mal placée n'est pas mal identifiée.
 *
 * Les poids sont des CATÉGORIES de preuve documentées, pas une probabilité mesurée. Ce qui change
 * tout : chaque point du score a une raison écrite dans le motif, et le score évolue avec la preuve.
 *
 * Cohérence du signal, jamais d'identité nominative : on dit ce que le poste sait de la NATURE de
 * l'appareil et pourquoi, pas qui est à bord.
 */

/** Ce que le poste sait de la nature de l'appareil. */
export type TypeConnu =
  /** Le registre donne le type pour cette adresse ICAO. */
  | "declare"
  /** Aéronef coopératif dont le type est inconnu : on sait QU'il vole, pas CE QU'il est. */
  | "inconnu"
  /** Drone coopératif (catégorie B6 émise par l'appareil) : le genre est déclaré, pas le modèle. */
  | "drone";

export type IdPreuves = {
  type: TypeConnu;
  /** Immatriculation connue du registre pour cette adresse. */
  immatriculation: boolean;
  /** Indicatif ÉMIS par l'appareil lui-même — pas le repli d'affichage sur l'immatriculation. */
  indicatif: boolean;
  /**
   * Relevés COHÉRENTS et DISTINCTS accumulés par la piste : ni les relevés refusés, ni un même
   * rapport resservi (voir `observationNouvelle`).
   */
  observations: number;
  /**
   * Messages reçus de cette adresse par la source : tous les récepteurs de l'agrégateur, ou notre
   * décodeur pour l'antenne. 0 si la source ne le dit pas (rejeu).
   */
  messages: number;
  /** Relevés incohérents de l'épisode en cours sur cette adresse (0 s'il est refermé). */
  incoherences: number;
  /** Au-delà, l'adresse est vraisemblablement tenue par deux émetteurs. */
  seuilDoublon: number;
};

export type IdEtat = "detecte" | "candidat" | "confirme";

export type IdStatut = {
  etat: IdEtat;
  /** Score 0–100, catégoriel et documenté — pas une probabilité mesurée. */
  score: number;
  /** Chaque élément qui a compté, en clair : à afficher, pas à taire. */
  motif: string;
};

/** Paliers de base, par nature de la preuve de type. */
export const BASE_TYPE_DECLARE = 90;
export const BASE_DRONE = 70;
export const BASE_TYPE_INCONNU = 55;
/** Fiche registre complète pour cette adresse : corrobore le rapprochement adresse → type. */
export const BONUS_IMMATRICULATION = 4;
/** L'appareil énonce lui-même son identité. */
export const BONUS_INDICATIF = 3;
/**
 * Confirmation « M sur N » : il faut AU MOINS deux relevés cohérents pour qu'une piste soit réelle.
 * Un relevé isolé peut être un fantôme — une trame mal décodée qui ne reviendra jamais.
 */
export const CONFIRMATION_OBS = 2;
/** Relevés cohérents au-delà desquels la piste est mûre : la pénalité de jeunesse s'éteint. */
export const MATURITE_OBS = 6;
/** Pénalité d'une piste qui n'a qu'un relevé, décroissant jusqu'à 0 à maturité. */
export const PENALITE_JEUNESSE = 12;
/** Un relevé incohérent isolé : probablement une trame ratée — mais il compte. */
export const PENALITE_INCOHERENCE = 15;
/** Adresse vraisemblablement partagée : on ne sait plus QUEL émetteur on regarde. */
export const PLAFOND_DOUBLON = 30;
/**
 * Messages reçus de l'adresse au-delà desquels elle ne peut pas être un fantôme de décodage (une
 * trame corrompue qui passe le contrôle n'en produit qu'une ou deux) : la piste est établie dès son
 * premier relevé. Mesuré sur 364 présences réseau réelles : jamais moins de 217. Une antenne en
 * entend une cinquantaine en quelques secondes d'un avion à portée.
 */
export const MESSAGES_CORROBORATION = 50;

/**
 * Ce relevé apporte-t-il une observation NOUVELLE, c'est-à-dire une nouvelle POSITION ? Un rapport
 * resservi garde exactement la sienne ; son heure, elle, glissait de 2 à 4 s à chaque rafraîchissement
 * réseau (mesuré), assez pour passer pour une observation neuve sous un critère horaire. La position
 * ne glisse pas. Un appareil immobile au sol reste donc UN plot : c'est le nombre de messages qui
 * l'établit (voir `MESSAGES_CORROBORATION`), pas la répétition de la même position.
 */
export function observationNouvelle(
  avant: { lat: number; lon: number } | undefined,
  apres: { lat: number; lon: number },
): boolean {
  return !avant || avant.lat !== apres.lat || avant.lon !== apres.lon;
}

/** Catégorie de type à partir de la plate-forme retenue pour la piste. */
export function typeConnuDe(platformId: string): TypeConnu {
  if (platformId === "adsb-uav") return "drone";
  if (platformId === "asecna-unk") return "inconnu";
  return "declare";
}

/**
 * Statut, score et motif d'identification d'une piste 1090ES réelle. Score borné à [5, 99] :
 * jamais 100 (rien d'un signal reçu n'est certain), jamais 0 (une adresse décodée sous CRC n'est
 * pas rien).
 */
export function idStatut(p: IdPreuves): IdStatut {
  const obs = Math.max(0, Math.floor(p.observations));
  const elements: string[] = [];

  let score =
    p.type === "declare" ? BASE_TYPE_DECLARE : p.type === "drone" ? BASE_DRONE : BASE_TYPE_INCONNU;
  elements.push(
    p.type === "declare"
      ? "type déclaré au registre"
      : p.type === "drone"
        ? "drone coopératif, modèle non déclaré"
        : "type inconnu",
  );
  if (p.immatriculation) {
    score += BONUS_IMMATRICULATION;
    elements.push("immatriculation connue");
  }
  if (p.indicatif) {
    score += BONUS_INDICATIF;
    elements.push("indicatif émis");
  }
  // Maturité : la confiance se gagne relevé après relevé, elle ne se décrète pas — sauf quand la
  // source a déjà entendu l'adresse assez souvent pour qu'elle soit établie.
  const etablie = p.messages >= MESSAGES_CORROBORATION;
  const maturite = etablie ? 1 : Math.min(1, Math.max(0, (obs - 1) / (MATURITE_OBS - 1)));
  score -= Math.round(PENALITE_JEUNESSE * (1 - maturite));
  elements.push(`${obs} relevé${obs > 1 ? "s" : ""} cohérent${obs > 1 ? "s" : ""}`);
  if (etablie) elements.push(`${p.messages.toLocaleString("fr-FR")} messages reçus de l'adresse`);

  // Un doublon d'adresse ruine l'identité tirée de l'adresse, quel que soit le reste.
  if (p.incoherences >= p.seuilDoublon) {
    return {
      etat: "candidat",
      score: Math.min(borne(score), PLAFOND_DOUBLON),
      motif: `adresse ICAO douteuse (${p.incoherences} relevés incohérents) — émetteur incertain`,
    };
  }
  if (p.incoherences > 0) {
    score -= PENALITE_INCOHERENCE * p.incoherences;
    elements.push(
      `${p.incoherences} relevé${p.incoherences > 1 ? "s" : ""} incohérent${p.incoherences > 1 ? "s" : ""}`,
    );
  }

  let etat: IdEtat;
  if (obs < CONFIRMATION_OBS && !etablie) etat = "detecte";
  else if (p.type === "declare" && p.incoherences === 0) etat = "confirme";
  else etat = "candidat";

  return { etat, score: borne(score), motif: elements.join(" · ") };
}

function borne(v: number): number {
  return Math.max(5, Math.min(99, Math.round(v)));
}
