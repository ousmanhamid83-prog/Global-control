import { PLATFORM_BY_ID, threatRank } from "./catalog";
import { canRequestEw } from "./ew";
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
      recs: ["Maintenir la couverture capteurs.", "Journaler les contacts hors mandat."],
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
      reason: `Raid ${r.corridor} · ${r.count} pistes · ${r.originLabels.join(" / ")}`,
      recs: [
        "Traiter comme une salve coordonnée, pas des contacts isolés.",
        "Verrouiller la piste de tête et corréler SIGINT / Sentinel du couloir.",
        "Rester silencieux — le télépilote ne doit pas savoir qu'il est découvert.",
        "Armer l'effecteur RF seulement sur ordre du chef de division (CN / TR / RU).",
      ],
    };
  }

  if (imminent) {
    const ew = canRequestEw(worst);
    return {
      posture: "menace",
      reason: `${worst.callsign} se rapproche de ${cpa?.name} · ${cpa?.distKm.toFixed(1)} km`,
      recs: [
        "Alerter l'unité C-UAS et le poste de commandement.",
        `Verrouiller le personnel en toiture / ${cpa?.name}.`,
        "Corréler EO/IR, gonio RF et scène Sentinel de la source C2.",
        ew.ok
          ? "Armer l'effecteur RF si autorisé — le télépilote ne saura pas qu'il est intercepté."
          : "Pas d'effet autonome — rester silencieux. Écoute SIGINT seulement.",
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
        "Maintenir le lock multi-capteurs et l'écoute SIGINT.",
        "Rester silencieux — aucune rétroaction vers le contrôleur.",
        "Verser un bulletin de preuve Sentinel si confirmation.",
        "Pas d'effet autonome — armer l'effecteur seulement sur ordre.",
      ],
    };
  }

  return {
    posture: "veille",
    reason: "Contacts de routine — identification en cours.",
    recs: [
      "Surveiller les BPF acoustiques des quads urbains.",
      "Classer hors mandat sans dossier d'effet.",
    ],
  };
}

export function sopForTrack(track: Track): string[] {
  const global = computePosture([track]);
  const ew = canRequestEw(track);
  const extra = ew.ok
    ? ["Demander un effet RF à l'autorité pour CN / TR / RU — AfriControl n'émet pas."]
    : [ew.reason];
  return [...global.recs, ...extra];
}
