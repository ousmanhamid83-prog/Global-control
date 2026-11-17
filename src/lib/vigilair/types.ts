import type { PosSource } from "./integrity.ts";

export type Origin = "CN" | "TR" | "RU" | "IR" | "XX";

/** fatl / asecna : affiliation amie ; civil : trafic 1090ES coopératif hors zone ASECNA (neutre) ; drone : un de NOS drones inscrits. */
export type FriendKind = "fatl" | "asecna" | "civil" | "drone";

/** ADS-B : position émise par l'appareil (DF17) ; S : transpondeur Mode S localisé par le réseau (MLAT). */
export type IffMode = "S" | "ADS-B";

export type ModeSDf =
  | "DF0"
  | "DF4"
  | "DF5"
  | "DF11"
  | "DF16"
  | "DF17"
  | "DF20"
  | "DF21";

/** adsb : position émise (DF17) ; modes : Mode S sans position émise, localisé par le réseau. */
export type ModeSSurveillance = "adsb" | "modes";

export type ModeSReply = {
  id: string;
  df: ModeSDf;
  label: string;
  icao24: string;
  at: number;
  siteId: string;
  siteName: string;
  bds: string | null;
  payload: string;
  solicited: boolean;
};

export type IffFix = {
  mode: IffMode;
  squawk: string;
  icao24: string | null;
  flightId: string;
  /** Couche Mode S entendue : ADS-B (DF17) ou Mode S sans position émise. */
  surveillance: ModeSSurveillance;
  /** Dernières trames réellement entendues pour cette adresse (pas de réponse fabriquée). */
  replies: ModeSReply[];
};


export type UasClass =
  | "multirotor"
  | "fixed-wing"
  | "vtol"
  | "loitering"
  | "male"
  | "ucav"
  | "chasse";

export type Role =
  | "consumer"
  | "enterprise-isr"
  | "agriculture"
  | "logistics"
  | "isr"
  | "strike"
  | "loitering-munition"
  | "mothership"
  | "fighter"
  | "trainer"
  | "rotary"
  | "airliner"
  | "transport";

export type Threat = "faible" | "moderee" | "elevee" | "critique";

export type IdState =
  | "detecte"
  | "classification"
  | "candidat"
  | "confirme"
  | "hors-mandat"
  | "perdu";

/**
 * D'où vient la piste : l'antenne 1090 du poste, le relevé 1090 du réseau, ou la liaison MAVLink
 * d'un de nos drones (piste d'exercice).
 */
export type SensorKind = "antenne" | "reseau" | "liaison";

export type SiteCpa = {
  siteId: string;
  name: string;
  distKm: number;
  etaS: number | null;
  closing: boolean;
};

export type ProtectedSite = {
  id: string;
  name: string;
  kind: "aerodrome" | "palais" | "camp" | "pont" | "ministere";
  lat: number;
  lon: number;
  radiusKm: number;
};

/** Premier relevé d'une piste : où et quand le poste l'a entendue la première fois. */
export type TraceFix = {
  lat: number;
  lon: number;
  at: number;
  method: string;
};

export type DefensePosture = "veille" | "alerte" | "menace";

export type Platform = {
  id: string;
  name: string;
  manufacturer: string;
  origin: Origin;
  originLabel: string;
  uasClass: UasClass;
  role: Role;
  threat: Threat;
  massKg: number;
  enduranceMin: number;
  rangeKm: number;
  ceilingM: number;
  cruiseKmh: number;
  maxKmh: number;
  rfBands: string[];
  protocol: string;
  remoteId: boolean;
  payload: string;
  cues: {
    rf: string;
    visual: string;
    kinematic: string;
    acoustic: string;
  };
  notes: string;
  /** Présent uniquement sur les fiches de la couche amis. */
  friendKind?: FriendKind;
};

export type Hypothesis = {
  platformId: string;
  score: number;
};

export type Track = {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  speedKmh: number;
  climbMs: number;
  trail: { lat: number; lon: number }[];
  truePlatformId: string;
  idState: IdState;
  confidence: number;
  /**
   * Pourquoi cette confiance (pistes réelles) : type déclaré au registre, type inconnu, adresse
   * ICAO douteuse… Le chiffre seul était tapé en dur à 99 % pour tout le trafic réel ; un score
   * qui se justifie se lit, un score muet se croit.
   */
  confidenceNote?: string;
  /**
   * L'indicatif affiché a-t-il été ÉMIS par l'appareil ? À défaut, `callsign` se replie sur
   * l'immatriculation ou l'adresse — pour l'affichage seulement : ce repli n'est pas une preuve.
   */
  callsignTx?: boolean;
  origin: Origin | null;
  classGuess: UasClass | null;
  hypotheses: Hypothesis[];
  sensors: SensorKind[];
  firstSeen: number;
  lastUpdate: number;
  dwellS: number;
  confirmedAt: number | null;
  cpa: SiteCpa | null;
  siteWarned: boolean;
  launchFix: TraceFix | null;
  locked: boolean;
  corridor: string | null;
  /** Piste créée par un inject de formation (AAR). */
  injected?: boolean;
  /** FATL / ASECNA — affiliation amie, distincte de l'origine constructeur. */
  friendKind?: FriendKind;
  /** Nom de NOTRE drone (registre du poste) quand cette piste a été appariée à un drone inscrit. */
  ownDrone?: string;
  /**
   * PISTE MÉMOIRE : la piste n'émet plus, la position affichée est EXTRAPOLÉE à l'estime, pas
   * mesurée. `silentS` = durée du silence, `radiusKm` = incertitude autour du point prédit.
   * Absent tant que la piste émet normalement.
   */
  coast?: { silentS: number; radiusKm: number };
  /**
   * Dernier relevé REFUSÉ parce que physiquement impossible (trame brouillée, décodage faux ou
   * position falsifiée) : contient le motif. Incohérence de signal, jamais une identité.
   */
  suspectJump?: string;
  /**
   * Épisode de relevés incohérents en cours : combien, depuis quand, et quand remonte le dernier.
   * La RÉPÉTITION est ce qui trahit une adresse ICAO tenue par deux émetteurs — un refus isolé est
   * seulement une trame ratée. L'épisode se referme un délai après le dernier incident.
   */
  suspect?: { run: number; since: number; at: number };
  /**
   * Dernière position MESURÉE et son heure RÉELLE d'observation. Un agrégateur réseau livre des
   * positions déjà vieilles de plusieurs dizaines de secondes (champ `seen`) : prendre l'heure de
   * réception pour l'heure d'observation place le symbole des kilomètres à côté, en silence.
   * `lat`/`lon` de la piste sont le meilleur ESTIMÉ pour maintenant ; `fix` est la mesure brute,
   * qui seule permet de comparer deux relevés sur leur vrai intervalle.
   */
  fix?: { lat: number; lon: number; at: number; altM: number };
  /**
   * Positions DISTINCTES acceptées sur la piste. Un agrégateur qui resservait le même rapport
   * comptait comme une observation de plus : des pistes vues une seule fois passaient « confirmées ».
   * Les relevés refusés n'y entrent pas.
   */
  fixes?: number;
  /** Messages reçus de l'adresse par la source au dernier relevé (réseau ou notre décodeur). */
  messages?: number | null;
  iff?: IffFix | null;
  /**
   * Origine de la piste : 1090ES reçu en direct, rejeu de 1090ES réellement reçu, ou EXERCICE — la
   * vraie télémétrie d'un de nos drones, joué comme un intrus.
   */
  feed: "adsb" | "rejeu" | "exercice";
  /** Piste d'EXERCICE : le drone qui vole pour de vrai, et la plateforme du catalogue qu'il joue. */
  exercice?: { drone: string; plateforme: string };
  /** Piste de REJEU RÉEL : heure d'origine de la position et bande d'où elle vient. Jamais live. */
  rejeu?: { posAt: number; kind: "poste" | "archive"; source: string; trailAt: number };
  icaoType?: string | null;
  reg?: string | null;
  emergency?: string | null;
  rssi?: number | null;
  /** Navigation Integrity Category (ADS-B). Bas = GNSS dégradé / jamming. */
  nic?: number | null;
  nacp?: number | null;
  /**
   * Provenance de la POSITION : « adsb » = émise par l'aéronef (et donc porteuse d'un NIC),
   * « mlat » = calculée par multilatération depuis le réseau de récepteurs (aucun NIC à dégrader).
   * Sans cette distinction, l'absence de NIC d'une piste MLAT passait pour un GNSS brouillé.
   */
  posSource?: PosSource;
  /**
   * Rayon de confinement de la position (km) : ce que l'aéronef admet lui-même ignorer de sa
   * position, ou le plancher retenu pour une position calculée. null = non annoncé. Le symbole
   * ponctuel seul laissait croire à une précision métrique sur des pistes à plusieurs kilomètres.
   */
  posRcKm?: number | null;
  /** D'où vient ce rayon (rayon annoncé, table NIC, multilatération) : à afficher, pas à taire. */
  posRcNote?: string;
  military?: boolean;
  category?: string | null;
  /** Nationalité ICAO24 (allocation OACI, pas une simulation). */
  nation?: string | null;
};

export type AlertItem = {
  id: string;
  trackId: string;
  at: number;
  level: Threat;
  title: string;
  body: string;
  acked: boolean;
  /** sigint = écoute passive. Les autres alertes n'ont pas de domaine. */
  domain?: "sigint";
  /** Ne pas relayer Telegram / Signal (inject de formation). */
  injected?: boolean;
  lat?: number;
  lon?: number;
};

export type JournalEntry = {
  id: string;
  at: number;
  trackId: string;
  callsign: string;
  platformId: string;
  origin: Origin;
  confidence: number;
  lat: number;
  lon: number;
  altM: number;
  /** Lu en base : un ancien bulletin peut porter des valeurs d'avant la version réelle. */
  sensors: string[];
  method: string;
  launchLat?: number;
  launchLon?: number;
  filedBy?: string;
  contentSha256?: string;
  prevSha256?: string | null;
  chainSha256?: string;
  pdfSha256?: string;
  injected?: boolean;
  pending?: boolean;
  fileError?: string;
};
