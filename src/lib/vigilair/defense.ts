import { PLATFORM_BY_ID, threatRank } from "./catalog";
import { isFriend } from "./friends";
import { detectRaids } from "./raid";
import type { DefensePosture, Threat, Track } from "./types";

function threatOf(track: Track): Threat {
  const id = track.hypotheses[0]?.platformId ?? track.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

export function postureLabel(p: DefensePosture): string {
  switch (p) {
    case "veille":
      return "Veille";
    case "alerte":
      return "Alerte";
    case "menace":
      return "Menace";
  }
}

export function computePosture(tracks: Track[]): {
  posture: DefensePosture;
  reason: string;
  recs: string[];
} {
  const live = tracks.filter((t) => t.idState !== "perdu" && !isFriend(t));
  let worst: Track | null = null;
  for (const t of live) {
    const th = threatOf(t);
    const close = t.cpa && t.cpa.distKm < 5 && t.cpa.closing;
    const rank = threatRank(th) + (close ? 2 : 0) + (t.idState === "confirme" ? 0.4 : 0);
    const wr = worst
      ? threatRank(threatOf(worst)) +
        (worst.cpa && worst.cpa.distKm < 5 && worst.cpa.closing ? 2 : 0)
      : 0;
    if (!worst || rank > wr) worst = t;
  }

  if (!worst) {
    return {
      posture: "veille",
      reason: "Aucune piste active dans l'AO.",
      recs: ["Maintenir l'écoute 1090 du poste.", "Journaler les contacts hors mandat."],
    };
  }

  const plat = PLATFORM_BY_ID[worst.hypotheses[0]?.platformId ?? worst.truePlatformId];
  const th = threatOf(worst);
  const cpa = worst.cpa;
  const imminent =
    Boolean(cpa && cpa.closing && cpa.distKm < 4) &&
    (th === "elevee" || th === "critique");
  const raids = detectRaids(tracks);

  if (raids[0] && raids[0].count >= 3) {
    const r = raids[0];
    return {
      posture: "menace",
      reason: `Raid · ${r.count} pistes ensemble · cap ${Math.round(r.cap)}° · ${r.lieu}`,
      recs: [
        "Traiter comme une salve coordonnée, pas des contacts isolés.",
        "Verrouiller la piste de tête et alerter le chef de division.",
        "Verser un bulletin de preuve par piste confirmée.",
        "Le poste n'émet pas : aucune rétroaction vers les appareils.",
      ],
    };
  }

  if (imminent) {
    return {
      posture: "menace",
      reason: `${worst.callsign} se rapproche de ${cpa?.name} · ${cpa?.distKm.toFixed(1)} km`,
      recs: [
        "Alerter l'unité C-UAS et le poste de commandement.",
        `Mettre à couvert le personnel exposé · ${cpa?.name}.`,
        "Lever le doute avec un de nos drones, sur ordre scellé du chef de division.",
        "Verser un bulletin de preuve dès la confirmation.",
      ],
    };
  }

  if (
    th === "elevee" ||
    th === "critique" ||
    plat?.role === "loitering-munition" ||
    plat?.role === "strike"
  ) {
    return {
      posture: "alerte",
      reason: `${worst.callsign} · ${plat ? `${plat.manufacturer} ${plat.name}` : "non identifié"}`,
      recs: [
        "Maintenir le verrou sur la piste.",
        "Le poste n'émet pas : aucune rétroaction vers l'appareil.",
        "Verser un bulletin de preuve si confirmation.",
      ],
    };
  }

  return {
    posture: "veille",
    reason: "Contacts de routine — identification en cours.",
    recs: ["Surveiller l'approche des zones protégées.", "Classer hors mandat sans dossier."],
  };
}
