/**
 * Identification radio des pistes RÉELLES : ce que leur transpondeur émet (ADS-B, Mode S, code
 * 3/A), entendu sur 1090 MHz. AfriControl n'interroge pas et n'émet pas : pas de Mode 4 (il
 * faudrait un interrogateur et la clé du jour), pas d'usurpation supposée.
 */
import { isFriend } from "./friends.ts";
import { PLATFORM_BY_ID, threatRank } from "./catalog.ts";
import { haversineKm } from "./geo.ts";
import { positionAntenne } from "./image-poste.ts";
import type { IffFix, Origin, Threat, Track } from "./types";

export type ThreatFloor = "ALL" | "moderee" | "elevee" | "critique";

export type IffModeRow = {
  id: string;
  label: string;
  value: string;
  tone: "ok" | "warn" | "crit" | "default";
};

/** Ce que le transpondeur a dit : ADS-B, code 3/A, adresse Mode S. */
export function iffModeRows(iff: IffFix): IffModeRow[] {
  const rows: IffModeRow[] = [];
  if (iff.mode === "ADS-B") {
    rows.push({ id: "adsb", label: "ADS-B", value: iff.flightId || iff.squawk, tone: "ok" });
  }
  rows.push({
    id: "3a",
    label: "3/A",
    value: iff.squawk && iff.squawk !== "0000" ? iff.squawk : "—",
    tone: "default",
  });
  if (iff.icao24 || iff.mode === "S") {
    rows.push({ id: "s", label: "Mode S", value: iff.icao24 ?? iff.flightId, tone: "default" });
  }
  return rows;
}

export function iffModesLine(iff: IffFix): string {
  return iffModeRows(iff)
    .map((r) => `${r.label} ${r.value}`)
    .join(" · ");
}

function trackThreat(t: Track): Threat {
  const id = t.hypotheses[0]?.platformId ?? t.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

export type PaintFilter = {
  showFriends: boolean;
  showLive?: boolean;
  threatFloor: ThreatFloor;
  selectedId: string | null;
  /** Débruitage : ne garder que ce qui compte pour la sûreté du site (voir siteRelevant). */
  declutter?: boolean;
  /** L'antenne du poste, centre du débruitage ; sans image du poste encore, FTTJ par défaut. */
  poste?: { lat: number; lon: number };
};

const POSTE_PAR_DEFAUT = positionAntenne(null, undefined);

/** Rayon de focalisation du débruitage : au-delà, le transit est du bruit pour la sûreté d'un site. */
export const DECLUTTER_FOCUS_KM = 300;

/**
 * Pertinent pour la sûreté d'un site : tout ce qui est signalé — urgence, militaire, GNSS dégradé
 * (NIC < 5, brouillage possible) — où qu'il soit, PLUS tout contact à moins de DECLUTTER_FOCUS_KM
 * du poste (son antenne). Un vrai drone menace le site de près : il tombe dans le rayon. Le
 * transit civil lointain est du bruit sur le scope quand le débruitage est actif (classGuess n'est
 * pas retenu : le flux 1090ES l'affecte à presque toute piste). Une piste verrouillée/sélectionnée
 * reste toujours affichée (vérifié en amont).
 */
export function siteRelevant(t: Track, poste: { lat: number; lon: number }): boolean {
  if (t.emergency != null || t.military === true) return true;
  if (t.nic != null && t.nic < 5) return true;
  return haversineKm(poste.lat, poste.lon, t.lat, t.lon) <= DECLUTTER_FOCUS_KM;
}

export function passesPaintFilter(t: Track, f: PaintFilter): boolean {
  if (t.idState === "perdu") return false;
  if (t.id === f.selectedId || t.locked) return true;
  if (t.feed === "adsb") {
    if (f.showLive === false) return false;
  } else if (isFriend(t) && !f.showFriends) return false;
  if (f.declutter && !siteRelevant(t, f.poste ?? POSTE_PAR_DEFAUT)) return false;
  if (f.threatFloor !== "ALL") {
    if (threatRank(trackThreat(t)) < threatRank(f.threatFloor)) return false;
  }
  return true;
}

export function passesRailOrigin(
  t: Track,
  originFilter: Origin | "ALL" | "AMI" | "LIVE",
  showFriends: boolean,
): boolean {
  const ami = isFriend(t);
  if (originFilter === "LIVE") return t.feed === "adsb";
  if (originFilter === "AMI") return ami && t.feed !== "adsb";
  if (t.feed === "adsb") {
    return originFilter === "ALL";
  }
  if (ami) {
    if (originFilter !== "ALL") return false;
    if (!showFriends) return false;
    return true;
  }
  if (originFilter === "ALL") return true;
  if (originFilter === "XX") return t.origin === "XX" || t.origin === null;
  return t.origin === originFilter || t.origin === null;
}

export const THREAT_FLOOR_ORDER: ThreatFloor[] = ["ALL", "moderee", "elevee", "critique"];

export function nextThreatFloor(cur: ThreatFloor): ThreatFloor {
  const i = THREAT_FLOOR_ORDER.indexOf(cur);
  return THREAT_FLOOR_ORDER[(i + 1) % THREAT_FLOOR_ORDER.length]!;
}

export function threatFloorLabel(f: ThreatFloor): string {
  switch (f) {
    case "moderee":
      return "≥ modérée";
    case "elevee":
      return "≥ élevée";
    case "critique":
      return "Critique";
    default:
      return "Toutes";
  }
}
