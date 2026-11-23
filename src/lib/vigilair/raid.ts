import { PLATFORM_BY_ID, threatRank } from "./catalog.ts";
import { haversineKm } from "./geo.ts";
import type { Threat, Track } from "./types";

/**
 * Un RAID : au moins RAID_MIN pistes non amies qui volent ENSEMBLE — de proche en proche, chacune à
 * moins de RAID_LIEN_KM d'une autre du groupe, au même cap (RAID_CAP_DEG près) et à la même allure
 * (la plus rapide à RAID_ALLURE fois la plus lente au plus), en mouvement. Tout se mesure sur les
 * pistes reçues : position, cap, vitesse. Rien n'est attribué — l'ADS-B ne dit pas d'où vient un
 * aéronef. Non amie : sans affiliation amie (un drone en catégorie UAV, une piste d'exercice), ou
 * marquée militaire ; nos drones n'en sont jamais, une piste perdue ou hors mandat non plus.
 */
export type Raid = {
  /** Clé stable tant que le groupe dure : sa plus petite id de piste. */
  cle: string;
  /** Centre du groupe. */
  lat: number;
  lon: number;
  /** Où, en clair : « 12,13° N 15,03° E ». */
  lieu: string;
  /** Cap moyen du groupe (°, nord vrai). */
  cap: number;
  /** Vitesse moyenne du groupe (km/h). */
  vitesseKmh: number;
  count: number;
  trackIds: string[];
  worst: Threat;
  leadCallsign: string;
};

export const RAID_MIN = 3;
export const RAID_LIEN_KM = 20;
export const RAID_CAP_DEG = 30;
export const RAID_ALLURE = 1.35;
/**
 * En dessous, une piste ne se déplace pas (au sol, ou en vol stationnaire) : elle ne fait pas un
 * raid. Bas exprès : un essaim de petits drones avance à 20 ou 30 km/h.
 */
export const RAID_VITESSE_MIN_KMH = 10;

function threatOf(track: Track): Threat {
  const id = track.hypotheses[0]?.platformId ?? track.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

/** Peut faire partie d'un raid : en vol, ni perdue ni hors mandat, non amie (voir en tête). */
function candidate(t: Track): boolean {
  if (t.idState === "perdu" || t.idState === "hors-mandat") return false;
  if (t.friendKind === "drone") return false;
  if (t.speedKmh < RAID_VITESSE_MIN_KMH) return false;
  return t.friendKind == null || t.military === true;
}

/** L'écart entre deux caps (0 à 180°). */
function ecartCap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Deux pistes volent ensemble : proches, même cap, même allure. */
function ensemble(a: Track, b: Track): boolean {
  if (haversineKm(a.lat, a.lon, b.lat, b.lon) > RAID_LIEN_KM) return false;
  if (ecartCap(a.heading, b.heading) > RAID_CAP_DEG) return false;
  const lent = Math.min(a.speedKmh, b.speedKmh);
  const vite = Math.max(a.speedKmh, b.speedKmh);
  return vite <= lent * RAID_ALLURE;
}

const coord = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(2).replace(".", ",")}° ${v >= 0 ? pos : neg}`;

/** Les raids des pistes : les plus nombreux d'abord, puis les plus menaçants. */
export function detectRaids(tracks: Track[]): Raid[] {
  const pistes = tracks.filter(candidate);
  // Groupes de proche en proche (union-find).
  const parent = pistes.map((_, i) => i);
  const racine = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < pistes.length; i++) {
    for (let j = i + 1; j < pistes.length; j++) {
      if (ensemble(pistes[i]!, pistes[j]!)) parent[racine(i)] = racine(j);
    }
  }
  const groupes = new Map<number, Track[]>();
  for (let i = 0; i < pistes.length; i++) {
    const r = racine(i);
    const g = groupes.get(r);
    if (g) g.push(pistes[i]!);
    else groupes.set(r, [pistes[i]!]);
  }
  const raids: Raid[] = [];
  for (const groupe of groupes.values()) {
    if (groupe.length < RAID_MIN) continue;
    let worst: Threat = "faible";
    let lead = groupe[0]!;
    for (const t of groupe) {
      const th = threatOf(t);
      if (threatRank(th) > threatRank(worst)) {
        worst = th;
        lead = t;
      }
    }
    const n = groupe.length;
    const lat = groupe.reduce((s, t) => s + t.lat, 0) / n;
    const lon = groupe.reduce((s, t) => s + t.lon, 0) / n;
    // Le cap moyen se moyenne sur le cercle : 350° et 10° font 0°, pas 180°.
    const x = groupe.reduce((s, t) => s + Math.cos((t.heading * Math.PI) / 180), 0);
    const y = groupe.reduce((s, t) => s + Math.sin((t.heading * Math.PI) / 180), 0);
    const cap = ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
    const trackIds = groupe.map((t) => t.id).sort();
    raids.push({
      cle: trackIds[0]!,
      lat,
      lon,
      lieu: `${coord(lat, "N", "S")} ${coord(lon, "E", "O")}`,
      cap,
      vitesseKmh: groupe.reduce((s, t) => s + t.speedKmh, 0) / n,
      count: n,
      trackIds,
      worst,
      leadCallsign: lead.callsign,
    });
  }
  raids.sort((a, b) => b.count - a.count || threatRank(b.worst) - threatRank(a.worst));
  return raids;
}

export function raidTrackIds(raids: Raid[]): Set<string> {
  const s = new Set<string>();
  for (const r of raids) for (const id of r.trackIds) s.add(id);
  return s;
}
