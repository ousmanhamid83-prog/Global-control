import { PLATFORM_BY_ID } from "./catalog";
import { isFriend } from "./friends";
import type { EwState, Origin, Track } from "./types";

/** Effecteur RF simulé — CN / TR / RU uniquement. AfriControl n'émet pas. */
export const EW_ORIGINS: Origin[] = ["CN", "TR", "RU"];

export const STEALTH_NOTE =
  "Poste silencieux : aucune rétroaction vers le contrôleur. Le télépilote ne sait pas qu'il est découvert.";

export function canRequestEw(
  track: Track,
  armed = true,
): { ok: boolean; reason: string } {
  if (isFriend(track)) {
    return {
      ok: false,
      reason:
        "Piste amie FATL / ASECNA — effecteur interdit. L'affiliation IFF prime sur l'origine constructeur.",
    };
  }
  if (!armed) {
    return {
      ok: false,
      reason:
        "Brouillage désarmé. Activer l'effecteur pour un effet RF lointain. La détection reste silencieuse.",
    };
  }
  const plat =
    PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  if (!plat) {
    return { ok: false, reason: "Non identifié — pas d'effet sans fiche." };
  }
  if (track.idState === "hors-mandat" || plat.origin === "XX") {
    return { ok: false, reason: "Hors mandat — pas d'effet RF." };
  }
  if (plat.origin === "IR") {
    return {
      ok: false,
      reason:
        "Mandat IR : détection, traçabilité et SIGINT. Effecteur RF réservé aux modèles CN / TR / RU.",
    };
  }
  if (!EW_ORIGINS.includes(plat.origin)) {
    return { ok: false, reason: "Origine hors périmètre d'effet RF." };
  }
  if (plat.uasClass === "chasse") {
    return {
      ok: false,
      reason: "Chasse habitée — hors effecteur C-UAS. Écoute IFF seulement.",
    };
  }
  if (track.idState !== "confirme" && track.idState !== "candidat") {
    return {
      ok: false,
      reason: "Identification insuffisante pour une demande d'effet.",
    };
  }
  if (track.ew?.state === "effet") {
    return { ok: false, reason: "Effet RF déjà simulé sur cette piste." };
  }
  if (track.ew?.state === "demande") {
    return { ok: false, reason: "Demande déjà transmise à l'autorité." };
  }
  const gnss = plat.protocol.toLowerCase().includes("gnss");
  return {
    ok: true,
    reason: gnss
      ? "Demande d'effet RF/GNSS. AfriControl n'émet pas. Le télépilote verra une perte de liaison, sans savoir qu'il est intercepté."
      : "Demande d'effet RF (C2). AfriControl n'émet pas. Le contrôleur adverse n'est pas informé de la détection.",
  };
}

export function ewLabel(state: EwState): string {
  switch (state) {
    case "demande":
      return "Demande";
    case "effet":
      return "Effet RF";
    case "refuse":
      return "Refus";
    default:
      return "Veille";
  }
}
