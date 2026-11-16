/**
 * Pilotage de NOS drones — la règle, sans réseau : quels ordres existent, quels drones savent les
 * recevoir, et ce que le poste vérifie AVANT d'envoyer.
 *
 * Essayé sur le vrai programme de vol ArduCopter : un drone posé, moteurs coupés, ACCEPTE « aller à
 * un point », « stationnaire » ou une mission, et ne fait rien. Son accusé ne prouve donc rien ;
 * c'est ici que le poste s'assure que l'ordre a un sens (drone en vol, point dans le rayon permis,
 * hauteur dans les bornes). Aucun ordre de charge utile n'existe, et les moteurs ne sont armés que
 * par « décoller ».
 */
import type { OwnDrone, Patrouille } from "./drones-core.ts";
import { haversineKm } from "./geo.ts";
import { ORDRE, type Cible, type MessageMav, type PointMission } from "./mavlink.ts";
import { hoteSurPlace, RESEAU_POSTE_EXEMPLES } from "./reseau-poste.ts";

export type OrdreDrone =
  "retour" | "stationnaire" | "atterrir" | "aller" | "decoller" | "patrouille";

/**
 * Les ordres du poste. `sceau` : l'ordre met ou garde le drone en vol vers un but, et demande le
 * sceau du chef (mot de passe retapé) ; les trois autres le ramènent ou l'arrêtent, sans attendre.
 */
export const ORDRES_DRONE: readonly {
  id: OrdreDrone;
  nom: string;
  quoi: string;
  sceau: boolean;
}[] = [
  {
    id: "retour",
    nom: "Retour à la base",
    quoi: "Le drone rentre seul à son point de départ et s'y pose.",
    sceau: false,
  },
  {
    id: "stationnaire",
    nom: "Stationnaire",
    quoi: "Le drone s'arrête, tient sa place et sa hauteur.",
    sceau: false,
  },
  {
    id: "atterrir",
    nom: "Atterrir sur place",
    quoi: "Le drone se pose là où il est.",
    sceau: false,
  },
  {
    id: "aller",
    nom: "Aller à un point",
    quoi: "Le drone rejoint le point donné, à la hauteur donnée, et y reste.",
    sceau: true,
  },
  {
    id: "decoller",
    nom: "Décoller",
    quoi: "Les MOTEURS démarrent et le drone monte à la hauteur donnée, au-dessus de son départ.",
    sceau: true,
  },
  {
    id: "patrouille",
    nom: "Patrouille",
    quoi: "Le drone suit son circuit, le nombre de tours réglé, puis rentre à la base.",
    sceau: true,
  },
];

export type ReglagesPilotage = {
  /** Ordres que le chef garde permis ; un ordre coupé ici n'est plus envoyé par personne. */
  ordres: Record<OrdreDrone, boolean>;
  /** Distance la plus grande, du point de départ du drone, d'un point où le poste l'envoie (km). */
  rayonKm: number;
  /** Bornes des hauteurs données par le poste, au-dessus du point de départ (m). */
  hauteurMinM: number;
  hauteurMaxM: number;
};

export const REGLAGES_DEFAUT: ReglagesPilotage = {
  ordres: {
    retour: true,
    stationnaire: true,
    atterrir: true,
    aller: true,
    decoller: true,
    patrouille: true,
  },
  rayonKm: 3,
  hauteurMinM: 15,
  hauteurMaxM: 120,
};

const borne = (v: unknown, min: number, max: number, defaut: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut;

/** Réglages lus du disque ou reçus de la console : bornés, un ordre absent gardé permis. */
export function reglagesValides(brut: unknown): ReglagesPilotage {
  const r = (brut && typeof brut === "object" ? brut : {}) as Partial<ReglagesPilotage>;
  const ordres = { ...REGLAGES_DEFAUT.ordres };
  for (const o of ORDRES_DRONE) {
    if (typeof r.ordres?.[o.id] === "boolean") ordres[o.id] = r.ordres[o.id];
  }
  const hauteurMinM = borne(r.hauteurMinM, 5, 400, REGLAGES_DEFAUT.hauteurMinM);
  return {
    ordres,
    rayonKm: borne(r.rayonKm, 0.1, 50, REGLAGES_DEFAUT.rayonKm),
    hauteurMinM,
    hauteurMaxM: borne(r.hauteurMaxM, hauteurMinM + 5, 500, REGLAGES_DEFAUT.hauteurMaxM),
  };
}

export type AdresseLiaison = { proto: "tcp" | "udp"; hote: string; port: number };

/**
 * L'adresse de liaison d'un drone : « tcp://hôte:port » (le poste s'y connecte : pont de
 * télémétrie, routeur MAVLink) ou « udp://hôte:port » (le poste écoute ce port et n'entend que cet
 * hôte : la station sol qui lui renvoie sa télémétrie). MAVLink n'est ni chiffré ni signé ici :
 * une adresse hors du réseau du poste est refusée.
 */
export function lireLiaison(adresse: string): AdresseLiaison | { erreur: string } {
  let u: URL;
  try {
    u = new URL(adresse.trim());
  } catch {
    return { erreur: "adresse illisible : tcp://hôte:port ou udp://hôte:port attendu" };
  }
  const proto = u.protocol === "tcp:" ? "tcp" : u.protocol === "udp:" ? "udp" : null;
  if (!proto) return { erreur: "tcp://hôte:port ou udp://hôte:port attendu" };
  const port = Number(u.port);
  if (!(port >= 1 && port <= 65535)) return { erreur: "port manquant ou hors bornes (1 à 65535)" };
  if (!hoteSurPlace(adresse.trim())) {
    return {
      erreur: `MAVLink n'est ni chiffré ni signé : la liaison reste sur le réseau du poste (${RESEAU_POSTE_EXEMPLES})`,
    };
  }
  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (proto === "udp" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hote)) {
    return {
      erreur: "en UDP, l'adresse IPv4 de la station sol est attendue : le poste n'entend qu'elle",
    };
  }
  return { proto, hote, port };
}

/** Ce que le poste sait d'un drone par sa liaison, à l'instant. */
export type EtatDrone = {
  id: string;
  /** Liaison ouverte (connectée, ou un datagramme reçu). */
  lie: boolean;
  erreur: string | null;
  /** Dernier battement de l'autopilote (ms) : la liaison vit tant qu'il est récent. */
  battementA: number | null;
  /** L'autopilote entendu : c'est à lui, et à lui seul, que partent les ordres. */
  cible: Cible | null;
  autopilote: "ardupilot" | "px4" | "autre" | null;
  engin: "multirotor" | "avion" | "autre" | null;
  mode: number | null;
  /** Moteurs armés. */
  arme: boolean;
  position: {
    lat: number;
    lon: number;
    altM: number;
    hauteurM: number;
    vitesseMs: number;
    cap: number | null;
    a: number;
  } | null;
  /** Point de départ (« home ») : là où il rentre, et d'où se mesurent rayon et hauteurs. */
  depart: { lat: number; lon: number; altM: number } | null;
  batteriePct: number | null;
  tensionV: number | null;
  gps: { fix: number; satellites: number | null } | null;
  /** Derniers textes du drone (refus d'armement, étapes de mission…), le plus récent d'abord. */
  textes: { a: number; gravite: number; texte: string }[];
  /** Point de mission en cours. */
  pointMission: number | null;
  /** Le drone parle MAVLink 1 ; il signe ses trames (le poste, lui, ne signe pas). */
  v1: boolean;
  signe: boolean;
};

export function etatVide(id: string): EtatDrone {
  return {
    id,
    lie: false,
    erreur: null,
    battementA: null,
    cible: null,
    autopilote: null,
    engin: null,
    mode: null,
    arme: false,
    position: null,
    depart: null,
    batteriePct: null,
    tensionV: null,
    gps: null,
    textes: [],
    pointMission: null,
    v1: false,
    signe: false,
  };
}

/** MAV_TYPE des multirotors : quadri, coaxial, hélicoptère, hexa, octo, tri, dodéca. */
const MULTIROTORS = new Set([2, 3, 4, 13, 14, 15, 29]);
const TEXTES_GARDES = 6;

/**
 * Un message du drone entre dans l'état. Seul un autopilote fait foi : le battement d'une station
 * sol (type 6) ou d'une nacelle (autopilote 8) est ignoré, et une fois l'autopilote entendu, les
 * messages d'un autre système ou composant de la liaison le sont aussi.
 */
export function appliquer(e: EtatDrone, m: MessageMav, maintenant: number): void {
  if (m.nom === "HEARTBEAT") {
    if (m.autopilote === 8 || m.type === 6) return;
    e.cible ??= { sys: m.sys, comp: m.comp };
    if (m.sys !== e.cible.sys || m.comp !== e.cible.comp) return;
    e.battementA = maintenant;
    e.autopilote = m.autopilote === 3 ? "ardupilot" : m.autopilote === 12 ? "px4" : "autre";
    e.engin = MULTIROTORS.has(m.type) ? "multirotor" : m.type === 1 ? "avion" : "autre";
    e.mode = m.mode;
    e.arme = (m.modeBase & 128) !== 0;
    e.v1 = m.v1;
    return;
  }
  if (!e.cible || m.sys !== e.cible.sys || m.comp !== e.cible.comp) return;
  switch (m.nom) {
    case "GLOBAL_POSITION_INT":
      // Tant qu'il n'a pas estimé sa position, l'autopilote envoie 0, 0 : ce n'en est pas une.
      e.position =
        m.lat === 0 && m.lon === 0
          ? null
          : {
              lat: m.lat,
              lon: m.lon,
              altM: m.altM,
              hauteurM: m.hauteurM,
              vitesseMs: m.vitesseMs,
              cap: m.cap,
              a: maintenant,
            };
      break;
    case "HOME_POSITION":
      e.depart = { lat: m.lat, lon: m.lon, altM: m.altM };
      break;
    case "SYS_STATUS":
      e.batteriePct = m.batteriePct;
      e.tensionV = m.tensionV;
      break;
    case "GPS_RAW_INT":
      e.gps = { fix: m.fix, satellites: m.satellites };
      break;
    case "STATUSTEXT":
      e.textes = [{ a: maintenant, gravite: m.gravite, texte: m.texte }, ...e.textes].slice(
        0,
        TEXTES_GARDES,
      );
      break;
    case "MISSION_CURRENT":
      e.pointMission = m.seq;
      break;
  }
}

/** Sans battement depuis plus longtemps, la liaison est dite muette et aucun ordre ne part. */
export const BATTEMENT_MAX_MS = 5000;

export function liaisonVivante(e: EtatDrone, maintenant: number): boolean {
  return e.lie && e.battementA !== null && maintenant - e.battementA <= BATTEMENT_MAX_MS;
}

const MODES_MULTIROTOR: Record<number, string> = {
  0: "STABILIZE",
  1: "ACRO",
  2: "ALT_HOLD",
  3: "AUTO",
  4: "GUIDED",
  5: "LOITER",
  6: "RTL",
  7: "CIRCLE",
  9: "LAND",
  11: "DRIFT",
  13: "SPORT",
  16: "POSHOLD",
  17: "BRAKE",
  18: "THROW",
  19: "AVOID_ADSB",
  20: "GUIDED_NOGPS",
  21: "SMART_RTL",
  22: "FLOWHOLD",
  23: "FOLLOW",
  24: "ZIGZAG",
  27: "AUTO_RTL",
};
const MODES_AVION: Record<number, string> = {
  0: "MANUAL",
  1: "CIRCLE",
  2: "STABILIZE",
  3: "TRAINING",
  4: "ACRO",
  5: "FBWA",
  6: "FBWB",
  7: "CRUISE",
  8: "AUTOTUNE",
  10: "AUTO",
  11: "RTL",
  12: "LOITER",
  13: "TAKEOFF",
  14: "AVOID_ADSB",
  15: "GUIDED",
  17: "QSTABILIZE",
  18: "QHOVER",
  19: "QLOITER",
  20: "QLAND",
  21: "QRTL",
};

/** Le mode de vol par son nom ArduPilot ; ailleurs (PX4, autre engin), son numéro. */
export function nomMode(e: EtatDrone): string {
  if (e.mode === null) return "—";
  const table =
    e.autopilote !== "ardupilot"
      ? null
      : e.engin === "multirotor"
        ? MODES_MULTIROTOR
        : e.engin === "avion"
          ? MODES_AVION
          : null;
  return table?.[e.mode] ?? `mode ${e.mode}`;
}

/**
 * Les ordres ne partent que vers ce qui a été essayé : un multirotor ArduPilot. Tout autre drone
 * (PX4, avion) est suivi par sa télémétrie, pas piloté d'ici.
 */
export function pilotable(e: EtatDrone): boolean {
  return e.autopilote === "ardupilot" && e.engin === "multirotor";
}

export type ParametresOrdre = { lat?: number; lon?: number; hauteurM?: number };

/** Sous ce niveau de batterie connu, le poste ne fait pas décoller. */
const BATTERIE_MIN_DECOLLAGE = 30;
/** Au-dessus de cette hauteur, le drone est dit en vol. */
const HAUTEUR_EN_VOL_M = 2;

/**
 * Ce que le poste vérifie avant d'envoyer `ordre`. Rend la raison du refus, ou null si l'ordre
 * peut partir.
 */
export function refus(
  ordre: OrdreDrone,
  p: ParametresOrdre,
  e: EtatDrone,
  patrouille: Patrouille | undefined,
  r: ReglagesPilotage,
  maintenant: number,
): string | null {
  if (!r.ordres[ordre]) return "ordre coupé par le chef (réglages du pilotage)";
  if (!liaisonVivante(e, maintenant)) return "liaison muette : aucun battement du drone depuis 5 s";
  if (!pilotable(e)) {
    return "ce drone est suivi, pas piloté : les ordres ne partent que vers un multirotor ArduPilot, seul essayé";
  }
  const hauteur = (h: number | undefined): string | null =>
    typeof h !== "number" || !Number.isFinite(h) || h < r.hauteurMinM || h > r.hauteurMaxM
      ? `hauteur hors des bornes permises (${r.hauteurMinM} à ${r.hauteurMaxM} m au-dessus du départ)`
      : null;
  if (ordre === "decoller") {
    if (e.arme) return "moteurs déjà armés : le drone est en vol ou prêt à l'être";
    if (!e.gps || e.gps.fix < 3)
      return "pas de position GPS 3D : le drone ne saurait pas où il est";
    if (e.batteriePct !== null && e.batteriePct < BATTERIE_MIN_DECOLLAGE) {
      return `batterie à ${e.batteriePct} % : pas de décollage sous ${BATTERIE_MIN_DECOLLAGE} %`;
    }
    return hauteur(p.hauteurM);
  }
  if (!e.arme) return "le drone est posé, moteurs coupés : rien à faire";
  if (ordre === "retour" || ordre === "stationnaire" || ordre === "atterrir") return null;
  const frais = e.position !== null && maintenant - e.position.a <= BATTEMENT_MAX_MS;
  if (!frais || e.position!.hauteurM < HAUTEUR_EN_VOL_M) {
    return "le drone n'est pas en vol (hauteur de moins de 2 m, ou position trop vieille) : décoller d'abord";
  }
  const depart = e.depart;
  if (!depart)
    return "point de départ du drone pas encore reçu : le rayon permis ne peut pas être vérifié";
  const loin = (lat: number | undefined, lon: number | undefined): string | null => {
    if (typeof lat !== "number" || typeof lon !== "number") return "point illisible";
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return "point illisible";
    }
    const km = haversineKm(depart.lat, depart.lon, lat, lon);
    return km > r.rayonKm
      ? `point à ${km.toFixed(2)} km du départ du drone : au-delà du rayon permis (${r.rayonKm} km)`
      : null;
  };
  if (ordre === "aller") return loin(p.lat, p.lon) ?? hauteur(p.hauteurM);
  if (!patrouille || patrouille.points.length < 2)
    return "pas de circuit de patrouille (2 points au moins)";
  if (!Number.isInteger(patrouille.tours) || patrouille.tours < 1 || patrouille.tours > 20) {
    return "nombre de tours hors bornes (1 à 20)";
  }
  for (const pt of patrouille.points) {
    const trop = loin(pt.lat, pt.lon);
    if (trop) return trop;
  }
  return hauteur(patrouille.hauteurM);
}

/** Modes ArduCopter que le poste demande : guidé (attend des ordres), arrêt sur place. */
const MODE_GUIDE = 4;
const MODE_ARRET = 17;

export type Etape =
  | { quoi: "ordre"; nom: string; ordre: number; p: number[] }
  | { quoi: "aller"; nom: string; lat: number; lon: number; hauteurM: number }
  | { quoi: "mission"; nom: string; points: PointMission[] };

/**
 * La mission d'une patrouille : le départ (point 0, que l'autopilote tient pour sien), les points
 * du circuit, la reprise pour chaque tour de plus, puis le retour à la base.
 */
export function missionPatrouille(
  depart: { lat: number; lon: number },
  p: Patrouille,
): PointMission[] {
  const passage = (pt: { lat: number; lon: number }, hauteurM: number): PointMission => ({
    quoi: "passage",
    lat: pt.lat,
    lon: pt.lon,
    hauteurM,
  });
  return [
    passage(depart, 0),
    ...p.points.map((pt) => passage(pt, p.hauteurM)),
    ...(p.tours > 1 ? [{ quoi: "reprendre", aSeq: 1, fois: p.tours - 1 } as const] : []),
    { quoi: "retour" },
  ];
}

/** Ce que le poste envoie pour `ordre`, dans l'ordre ; il s'arrête à la première étape refusée. */
export function etapes(
  ordre: OrdreDrone,
  p: ParametresOrdre,
  e: EtatDrone,
  patrouille: Patrouille | undefined,
): Etape[] {
  switch (ordre) {
    case "retour":
      return [{ quoi: "ordre", nom: "retour à la base", ordre: ORDRE.RTL, p: [] }];
    case "stationnaire":
      return [{ quoi: "ordre", nom: "arrêt sur place", ordre: ORDRE.MODE, p: [1, MODE_ARRET] }];
    case "atterrir":
      return [{ quoi: "ordre", nom: "atterrissage", ordre: ORDRE.ATTERRIR, p: [] }];
    case "aller":
      return [
        { quoi: "aller", nom: "aller au point", lat: p.lat!, lon: p.lon!, hauteurM: p.hauteurM! },
      ];
    case "decoller":
      // Le décollage suit l'armement aussitôt : resté au sol 10 s, le drone recoupe ses moteurs.
      return [
        { quoi: "ordre", nom: "mode guidé", ordre: ORDRE.MODE, p: [1, MODE_GUIDE] },
        { quoi: "ordre", nom: "armement des moteurs", ordre: ORDRE.ARMER_MOTEURS, p: [1] },
        {
          quoi: "ordre",
          nom: "décollage",
          ordre: ORDRE.DECOLLER,
          p: [0, 0, 0, 0, 0, 0, p.hauteurM!],
        },
      ];
    case "patrouille":
      return [
        {
          quoi: "mission",
          nom: "circuit chargé",
          points: missionPatrouille(e.depart!, patrouille!),
        },
        { quoi: "ordre", nom: "départ en patrouille", ordre: ORDRE.MISSION, p: [] },
      ];
  }
}

/** Ce que répond le drone à un ordre (MAV_RESULT), en clair. */
export function resultatEnClair(code: number): string {
  return (
    [
      "accepté",
      "refusé pour l'instant",
      "refusé",
      "non géré par ce drone",
      "échoué",
      "en cours",
      "annulé",
    ][code] ?? `résultat ${code}`
  );
}

/** Une confirmation du chef vaut le temps d'un vol. */
export const CONFIRMATION_1090_MS = 2 * 3600_000;
/** Au-delà de cet écart entre la piste 1090ES et la télémétrie du drone, ce n'est pas lui. */
const ECART_MAX_KM = 2;

/**
 * Une piste 1090ES porte l'adresse d'un de NOS drones. Une adresse se copie : la piste compte
 * comme une INTRUSION tant que le chef ne l'a pas confirmée, et il en est averti. Le poste la
 * recoupe avec la télémétrie du drone quand il l'a : si elle le situe ailleurs, la piste n'est pas
 * lui — même confirmée.
 */
export function constat1090(
  drone: OwnDrone,
  piste: { lat: number; lon: number },
  telemetrie: { lat: number; lon: number } | null,
  maintenant: number,
): { ami: boolean; niveau: "faible" | "elevee" | "critique"; titre: string; corps: string } {
  const ecartKm = telemetrie
    ? haversineKm(piste.lat, piste.lon, telemetrie.lat, telemetrie.lon)
    : null;
  if (ecartKm !== null && ecartKm > ECART_MAX_KM) {
    return {
      ami: false,
      niveau: "critique",
      titre: `${drone.name} · piste 1090ES à ${ecartKm.toFixed(1)} km de notre drone`,
      corps: `Une piste porte l'adresse de notre drone, mais sa télémétrie le situe à ${ecartKm.toFixed(1)} km de là : adresse copiée ? Traitée comme une intrusion.`,
    };
  }
  const recoupe =
    ecartKm === null
      ? "Pas de télémétrie du drone pour la recouper."
      : `Sa télémétrie concorde (écart ${Math.round(ecartKm * 1000)} m).`;
  if ((drone.ami1090Jusqua ?? 0) > maintenant) {
    return {
      ami: true,
      niveau: "faible",
      titre: `${drone.name} · notre drone en vol`,
      corps: `Piste 1090ES confirmée par le chef jusqu'à ${new Date(drone.ami1090Jusqua!).toISOString().slice(11, 16)} Z : suivie comme amie. ${recoupe}`,
    };
  }
  return {
    ami: false,
    niveau: "elevee",
    titre: `${drone.name} · piste 1090ES à confirmer`,
    corps: `Une piste porte l'adresse de notre drone. Une adresse se copie : elle compte comme une intrusion tant que le chef ne l'a pas confirmée (Capteurs > Nos drones). ${recoupe}`,
  };
}
