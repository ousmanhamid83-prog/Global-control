/**
 * Les drones ENTENDUS SANS POSITION : leur transpondeur répond en Mode S (adresse, indicatif,
 * altitude) sans dire où il est, ou plus depuis longtemps. Les relevés par cellule ne les rendent
 * jamais : on y interroge un cercle, et un appareil sans position n'est dans aucun. La liste
 * militaire d'adsb.fi (/v2/mil) les donne, avec le type que le registre de l'agrégateur connaît
 * pour leur adresse et, faute de position, une estimation d'après les récepteurs qui les entendent
 * (`rr_lat`, `rr_lon` : à quelques centaines de km près), ou leur dernière position connue.
 *
 * Mesuré le 23 novembre 2026 : 381 appareils dans la liste, 83 sans position, dont OVRLD01, un
 * RQ-4 Global Hawk (type Q4, sans catégorie B6) entendu au-dessus du Moyen-Orient.
 */
import { droneDeclare, type DroneDeclare } from "./drones-oaci.ts";
import { lieuDrone } from "./regions-drones.ts";

/** Où est un drone entendu, au mieux, et d'où on le sait. */
export type OuEntendu = {
  lat: number;
  lon: number;
  /** « position » : la sienne, dernière connue ; « recepteurs » : l'estimation des récepteurs. */
  par: "position" | "recepteurs";
  /** Âge de la dernière position, en secondes ; null pour l'estimation, qui est du moment. */
  ageS: number | null;
};

export type DroneEntendu = {
  hex: string;
  indicatif: string | null;
  drone: DroneDeclare;
  /** Le modèle au registre de l'agrégateur, tel quel (« NORTHROP GRUMMAN RQ-4 Global Hawk »). */
  registre: string | null;
  /** Secondes entre son dernier message et la liste. */
  vuIlYaS: number;
  ou: OuEntendu | null;
  /** Afrique ou Moyen-Orient d'après `ou` (voir regions-drones.ts) ; null ailleurs ou sans `ou`. */
  region: ReturnType<typeof lieuDrone>;
};

/** Une dernière position de moins de 10 min vaut mieux que l'estimation des récepteurs. */
const POSITION_FRAICHE_S = 600;

/** La règle de parseDump1090 : ce que les cellules prennent pour une position, et rien d'autre. */
const nombre = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function ouEntendu(a: Record<string, unknown>): OuEntendu | null {
  const derniere = (a.lastPosition ?? {}) as Record<string, unknown>;
  const lat = nombre(derniere.lat);
  const lon = nombre(derniere.lon);
  const ageS = nombre(derniere.seen_pos);
  const position = lat != null && lon != null ? { lat, lon, par: "position" as const, ageS } : null;
  if (position && ageS != null && ageS <= POSITION_FRAICHE_S) return position;
  const rrLat = nombre(a.rr_lat);
  const rrLon = nombre(a.rr_lon);
  if (rrLat != null && rrLon != null) {
    return { lat: rrLat, lon: rrLon, par: "recepteurs", ageS: null };
  }
  return position;
}

/**
 * Les drones de la liste qui n'ont pas de position : la catégorie B6, ou un type OACI de drone
 * (drones-oaci.ts). Ceux qui ont une position n'y sont pas : les cellules du relevé les rendent.
 */
export function dronesSansPosition(liste: readonly unknown[]): DroneEntendu[] {
  const out: DroneEntendu[] = [];
  for (const brut of liste) {
    if (!brut || typeof brut !== "object") continue;
    const a = brut as Record<string, unknown>;
    if (nombre(a.lat) != null && nombre(a.lon) != null) continue;
    const drone = droneDeclare({ category: texte(a.category), icaoType: texte(a.t) });
    const hex = texte(a.hex)?.toLowerCase();
    if (!drone || !hex) continue;
    const ou = ouEntendu(a);
    out.push({
      hex,
      indicatif: texte(a.flight),
      drone,
      registre: texte(a.desc),
      vuIlYaS: nombre(a.seen) ?? 0,
      ou,
      region: ou ? lieuDrone(ou.lat, ou.lon) : null,
    });
  }
  return out;
}

/** Où il est, en mots, pour l'alerte et la liste du 1090 : ce qu'on en sait, et d'où. */
export function ouLibelle(d: DroneEntendu): string {
  if (!d.ou) return "position inconnue";
  const lieu = d.region ? d.region.pays : "hors Afrique et Moyen-Orient";
  if (d.ou.par === "recepteurs") {
    return `estimé : ${lieu}, d'après les récepteurs qui l'entendent (à quelques centaines de km près)`;
  }
  const age = d.ou.ageS ?? 0;
  return `dernière position : ${lieu}, il y a ${age < 120 ? `${Math.round(age)} s` : `${Math.round(age / 60)} min`}`;
}
