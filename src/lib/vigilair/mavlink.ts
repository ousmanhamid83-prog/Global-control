/**
 * MAVLink — le strict nécessaire pour SUIVRE un de nos drones (sa télémétrie) et lui envoyer les
 * quelques ordres de vol permis au chef. Cœur PUR : des octets, ni réseau ni disque.
 *
 * Lu : MAVLink 1 et 2 (un vieux lien radio parle encore le 1). Écrit : MAVLink 2 seulement, que
 * ArduPilot et PX4 lisent toujours. Aucun ordre de charge utile (servo, relais, pince, parachute,
 * largage) ni de désarmement n'a de codeur ici, et l'armement forcé est refusé : ce que ce fichier
 * ne sait pas écrire ne peut pas partir.
 */

/** CRC-16/MCRF4XX (X.25), celui de MAVLink ; `crc` permet de le poursuivre. */
export function crcX25(octets: Uint8Array, debut: number, fin: number, crc = 0xffff): number {
  for (let i = debut; i < fin; i++) {
    let t = octets[i]! ^ (crc & 0xff);
    t ^= (t << 4) & 0xff;
    crc = ((crc >> 8) ^ (t << 8) ^ (t << 3) ^ (t >> 4)) & 0xffff;
  }
  return crc;
}

/** Par message : son octet de CRC (la « graine » de sa définition) et sa taille sans extensions. */
const MESSAGES: Record<number, { extra: number; taille: number }> = {
  0: { extra: 50, taille: 9 }, // HEARTBEAT
  1: { extra: 124, taille: 31 }, // SYS_STATUS
  24: { extra: 24, taille: 30 }, // GPS_RAW_INT
  33: { extra: 104, taille: 28 }, // GLOBAL_POSITION_INT
  40: { extra: 230, taille: 4 }, // MISSION_REQUEST
  42: { extra: 28, taille: 2 }, // MISSION_CURRENT
  44: { extra: 221, taille: 4 }, // MISSION_COUNT
  47: { extra: 153, taille: 3 }, // MISSION_ACK
  51: { extra: 196, taille: 4 }, // MISSION_REQUEST_INT
  73: { extra: 38, taille: 37 }, // MISSION_ITEM_INT
  75: { extra: 158, taille: 35 }, // COMMAND_INT
  76: { extra: 152, taille: 33 }, // COMMAND_LONG
  77: { extra: 143, taille: 3 }, // COMMAND_ACK
  242: { extra: 104, taille: 52 }, // HOME_POSITION
  253: { extra: 83, taille: 51 }, // STATUSTEXT
};

type Entete = { sys: number; comp: number; v1: boolean };

export type MessageMav = Entete &
  (
    | {
        nom: "HEARTBEAT";
        /** MAV_TYPE : 1 voilure fixe, 2 quadrirotor, 6 station sol, 13 hexarotor, 14 octorotor… */
        type: number;
        /** MAV_AUTOPILOT : 3 ArduPilot, 12 PX4, 8 aucun (station, nacelle). */
        autopilote: number;
        /** Bit 7 (128) : moteurs armés. */
        modeBase: number;
        /** Mode de vol propre à l'autopilote (ArduCopter : 4 GUIDED, 6 RTL, 9 LAND…). */
        mode: number;
      }
    | { nom: "SYS_STATUS"; tensionV: number | null; batteriePct: number | null }
    | { nom: "GPS_RAW_INT"; fix: number; satellites: number | null }
    | {
        nom: "GLOBAL_POSITION_INT";
        lat: number;
        lon: number;
        /** Altitude au-dessus du niveau de la mer (m). */
        altM: number;
        /** Hauteur au-dessus du point de départ (m). */
        hauteurM: number;
        /** Vitesse sol (m/s), des composantes nord et est. */
        vitesseMs: number;
        /** Cap (degrés) ; null : inconnu. */
        cap: number | null;
      }
    | { nom: "HOME_POSITION"; lat: number; lon: number; altM: number }
    | { nom: "COMMAND_ACK"; ordre: number; resultat: number }
    | { nom: "STATUSTEXT"; gravite: number; texte: string }
    | { nom: "MISSION_REQUEST"; seq: number }
    | { nom: "MISSION_CURRENT"; seq: number }
    | { nom: "MISSION_ACK"; resultat: number }
  );

function decoder(id: number, charge: Uint8Array, e: Entete): MessageMav {
  // MAVLink 2 retire les zéros de fin de charge : on les remet avant de lire.
  const plein = new Uint8Array(Math.max(MESSAGES[id]!.taille, charge.length));
  plein.set(charge);
  const v = new DataView(plein.buffer);
  switch (id) {
    case 0:
      return {
        ...e,
        nom: "HEARTBEAT",
        mode: v.getUint32(0, true),
        type: v.getUint8(4),
        autopilote: v.getUint8(5),
        modeBase: v.getUint8(6),
      };
    case 1: {
      const mV = v.getUint16(14, true);
      const pct = v.getInt8(30);
      return {
        ...e,
        nom: "SYS_STATUS",
        tensionV: mV === 0xffff ? null : mV / 1000,
        batteriePct: pct < 0 ? null : pct,
      };
    }
    case 24: {
      const sats = v.getUint8(29);
      return {
        ...e,
        nom: "GPS_RAW_INT",
        fix: v.getUint8(28),
        satellites: sats === 255 ? null : sats,
      };
    }
    case 33: {
      const cap = v.getUint16(26, true);
      return {
        ...e,
        nom: "GLOBAL_POSITION_INT",
        lat: v.getInt32(4, true) / 1e7,
        lon: v.getInt32(8, true) / 1e7,
        altM: v.getInt32(12, true) / 1000,
        hauteurM: v.getInt32(16, true) / 1000,
        vitesseMs: Math.hypot(v.getInt16(20, true), v.getInt16(22, true)) / 100,
        cap: cap === 0xffff ? null : cap / 100,
      };
    }
    case 242:
      return {
        ...e,
        nom: "HOME_POSITION",
        lat: v.getInt32(0, true) / 1e7,
        lon: v.getInt32(4, true) / 1e7,
        altM: v.getInt32(8, true) / 1000,
      };
    case 77:
      return { ...e, nom: "COMMAND_ACK", ordre: v.getUint16(0, true), resultat: v.getUint8(2) };
    case 253: {
      const brut = plein.subarray(1, 51);
      const fin = brut.indexOf(0);
      return {
        ...e,
        nom: "STATUSTEXT",
        gravite: v.getUint8(0),
        texte: new TextDecoder("latin1").decode(fin < 0 ? brut : brut.subarray(0, fin)),
      };
    }
    case 42:
      return { ...e, nom: "MISSION_CURRENT", seq: v.getUint16(0, true) };
    case 47:
      return { ...e, nom: "MISSION_ACK", resultat: v.getUint8(2) };
    // 40 et 51 : le drone demande le point `seq` de la mission, sous l'une ou l'autre forme.
    default:
      return { ...e, nom: "MISSION_REQUEST", seq: v.getUint16(0, true) };
  }
}

/** Messages que le drone envoie et que le poste lit ; les autres sont sautés sans être décodés. */
const LUS = new Set([0, 1, 24, 33, 40, 42, 47, 51, 77, 242, 253]);

/**
 * Lecteur de flux : reçoit les octets comme ils arrivent (TCP les coupe où il veut, un datagramme
 * UDP porte plusieurs trames), rend les messages entiers au CRC juste. Une trame au CRC faux est
 * refusée et la lecture reprend un octet plus loin. Pris en route ou après un octet abîmé, le flux
 * peut perdre une trame ou deux avant que la lecture se recale : la télémétrie se répète, et un
 * ordre sans accusé est redit.
 */
export class LecteurMavlink {
  private reste: Uint8Array = new Uint8Array(0);
  /** Trames MAVLink 1 lues (vieux lien). */
  v1 = 0;
  /** Trames signées lues : le drone exige peut-être la signature, que le poste n'écrit pas. */
  signees = 0;
  /** Trames refusées pour CRC faux. */
  refusees = 0;

  lire(morceau: Uint8Array): MessageMav[] {
    const b = new Uint8Array(this.reste.length + morceau.length);
    b.set(this.reste);
    b.set(morceau, this.reste.length);
    const messages: MessageMav[] = [];
    let i = 0;
    while (i < b.length) {
      const v2 = b[i] === 0xfd;
      if (!v2 && b[i] !== 0xfe) {
        i += 1;
        continue;
      }
      const entete = v2 ? 10 : 6;
      if (b.length - i < entete) break;
      // Drapeaux d'incompatibilité : seule la signature (1) est connue ; tout autre bit, ce n'est
      // pas une trame (le protocole l'exige), et un faux début dans du bruit tombe presque toujours ici.
      if (v2 && (b[i + 2]! & 0xfe) !== 0) {
        i += 1;
        continue;
      }
      const taille = b[i + 1]!;
      const signee = v2 && b[i + 2] === 1;
      const total = entete + taille + 2 + (signee ? 13 : 0);
      if (b.length - i < total) break;
      const id = v2 ? b[i + 7]! | (b[i + 8]! << 8) | (b[i + 9]! << 16) : b[i + 5]!;
      const def = MESSAGES[id];
      if (!def) {
        i += total; // message que le poste ne lit pas : sauté d'un bloc
        continue;
      }
      const fin = i + entete + taille;
      const crc = crcX25(Uint8Array.of(def.extra), 0, 1, crcX25(b, i + 1, fin));
      if (crc !== (b[fin]! | (b[fin + 1]! << 8))) {
        this.refusees += 1;
        i += 1;
        continue;
      }
      if (!v2) this.v1 += 1;
      if (signee) this.signees += 1;
      if (LUS.has(id)) {
        const e = { sys: b[i + (v2 ? 5 : 3)]!, comp: b[i + (v2 ? 6 : 4)]!, v1: !v2 };
        messages.push(decoder(id, b.subarray(i + entete, fin), e));
      }
      i += total;
    }
    this.reste = b.slice(i);
    return messages;
  }

  /** Datagramme UDP lu : une trame ne passe jamais d'un datagramme au suivant, rien n'est à garder. */
  oublier(): void {
    this.reste = new Uint8Array(0);
  }
}

/** Trame MAVLink 2 : zéros de fin retirés (un octet au moins), CRC posé. */
export function trame(
  seq: number,
  sys: number,
  comp: number,
  id: number,
  charge: Uint8Array,
): Uint8Array {
  let taille = charge.length;
  while (taille > 1 && charge[taille - 1] === 0) taille -= 1;
  const t = new Uint8Array(12 + taille);
  t.set([0xfd, taille, 0, 0, seq & 0xff, sys, comp, id & 0xff, (id >> 8) & 0xff, id >> 16]);
  t.set(charge.subarray(0, taille), 10);
  const crc = crcX25(Uint8Array.of(MESSAGES[id]!.extra), 0, 1, crcX25(t, 1, 10 + taille));
  t[10 + taille] = crc & 0xff;
  t[11 + taille] = crc >> 8;
  return t;
}

export type Cible = { sys: number; comp: number };

/** Battement d'une station sol (type 6), sans autopilote (8), active (4), MAVLink 2 (version 3). */
export function battement(): { id: number; charge: Uint8Array } {
  return { id: 0, charge: Uint8Array.of(0, 0, 0, 0, 6, 8, 0, 4, 3) };
}

/** Les seuls ordres directs que le poste sait écrire. */
export const ORDRE = {
  /** Retour au point de départ. */
  RTL: 20,
  /** Atterrir sur place. */
  ATTERRIR: 21,
  /** Décoller jusqu'à la hauteur donnée (paramètre 7). */
  DECOLLER: 22,
  /** Changer de mode de vol (paramètre 1 : 1, paramètre 2 : le mode). */
  MODE: 176,
  /** Aller à un point, en changeant de mode au besoin. */
  ALLER: 192,
  /** Lancer la mission chargée. */
  MISSION: 300,
  /** Armer les MOTEURS (paramètre 1 : 1) — jamais forcé, jamais désarmé d'ici. */
  ARMER_MOTEURS: 400,
  /** Demander un message de télémétrie à un rythme donné. */
  RYTHME: 511,
} as const;

const ORDRES_LONGS: ReadonlySet<number> = new Set([
  ORDRE.RTL,
  ORDRE.ATTERRIR,
  ORDRE.DECOLLER,
  ORDRE.MODE,
  ORDRE.MISSION,
  ORDRE.ARMER_MOTEURS,
  ORDRE.RYTHME,
]);

/** COMMAND_LONG : un ordre de la liste, à sept paramètres. Tout autre ordre est refusé. */
export function ordreLong(
  cible: Cible,
  ordre: number,
  p: readonly number[],
  confirmation = 0,
): { id: number; charge: Uint8Array } {
  if (!ORDRES_LONGS.has(ordre)) throw new Error(`ordre MAVLink ${ordre} non permis`);
  if (ordre === ORDRE.ARMER_MOTEURS && (p[0] !== 1 || (p[1] ?? 0) !== 0)) {
    throw new Error("armement des moteurs : ni forcé, ni désarmement");
  }
  const charge = new Uint8Array(33);
  const v = new DataView(charge.buffer);
  for (let i = 0; i < 7; i++) v.setFloat32(4 * i, p[i] ?? 0, true);
  v.setUint16(28, ordre, true);
  charge.set([cible.sys, cible.comp, confirmation], 30);
  return { id: 76, charge };
}

/** Repère des hauteurs : au-dessus du point de départ (MAV_FRAME_GLOBAL_RELATIVE_ALT_INT). */
const REPERE_HAUTEUR = 6;

/** Sept champs d'un point (ordre direct ou point de mission) : paramètres 1 à 4, lat, lon, hauteur. */
function point(
  v: DataView,
  p: readonly number[],
  lat: number,
  lon: number,
  hauteurM: number,
): void {
  for (let i = 0; i < 4; i++) v.setFloat32(4 * i, p[i] ?? 0, true);
  v.setInt32(16, Math.round(lat * 1e7), true);
  v.setInt32(20, Math.round(lon * 1e7), true);
  v.setFloat32(24, hauteurM, true);
}

/**
 * COMMAND_INT « aller à ce point » (DO_REPOSITION) : vitesse par défaut, passage en mode guidé
 * permis, cap inchangé, hauteur au-dessus du point de départ. Le seul ordre à coordonnées.
 */
export function ordreAller(
  cible: Cible,
  lat: number,
  lon: number,
  hauteurM: number,
): { id: number; charge: Uint8Array } {
  const charge = new Uint8Array(35);
  const v = new DataView(charge.buffer);
  point(v, [-1, 1, 0, Number.NaN], lat, lon, hauteurM);
  v.setUint16(28, ORDRE.ALLER, true);
  charge.set([cible.sys, cible.comp, REPERE_HAUTEUR], 30);
  return { id: 75, charge };
}

/** MISSION_COUNT : annonce une mission de `n` points. */
export function missionNombre(cible: Cible, n: number): { id: number; charge: Uint8Array } {
  const charge = new Uint8Array(4);
  new DataView(charge.buffer).setUint16(0, n, true);
  charge.set([cible.sys, cible.comp], 2);
  return { id: 44, charge };
}

/** Ce qu'une mission du poste peut contenir : des points de passage, un retour au départ, un tour de plus. */
export type PointMission =
  | { quoi: "passage"; lat: number; lon: number; hauteurM: number }
  | { quoi: "retour" }
  | { quoi: "reprendre"; aSeq: number; fois: number };

/** MISSION_ITEM_INT : le point `seq` de la mission (16 passage, 20 retour au départ, 177 reprise). */
export function missionPoint(
  cible: Cible,
  seq: number,
  pt: PointMission,
): { id: number; charge: Uint8Array } {
  const charge = new Uint8Array(37);
  const v = new DataView(charge.buffer);
  if (pt.quoi === "passage") point(v, [], pt.lat, pt.lon, pt.hauteurM);
  if (pt.quoi === "reprendre") point(v, [pt.aSeq, pt.fois], 0, 0, 0);
  v.setUint16(28, seq, true);
  v.setUint16(30, pt.quoi === "passage" ? 16 : pt.quoi === "retour" ? 20 : 177, true);
  // Repère, puis « pas le point courant » (0) et « enchaîner sur le suivant » (1).
  charge.set([cible.sys, cible.comp, pt.quoi === "passage" ? REPERE_HAUTEUR : 2, 0, 1], 32);
  return { id: 73, charge };
}
