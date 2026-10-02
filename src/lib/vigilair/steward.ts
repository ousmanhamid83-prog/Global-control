import type { SatLayer } from "./sat.ts";

export const STEWARD_PARAMS = [
  {
    id: "photo",
    group: "Image",
    label: "Photo ≤ 60 min",
    detail: "Passe en IR si la scène dépasse 60 min, puis revient au visible.",
  },
  {
    id: "affinage",
    group: "Image",
    label: "Affinage",
    detail: "Contraste et lissage de la photo Meteosat.",
  },
  {
    id: "relief",
    group: "Image",
    label: "Massifs",
    detail: "Crêtes et relief sur la carte.",
  },
  {
    id: "marine",
    group: "Image",
    label: "Hydro",
    detail: "Carte marine, lacs, Chari et Logone.",
  },
  {
    id: "vis",
    group: "Image",
    label: "Visible",
    detail: "Couche photo Meteosat.",
  },
  {
    id: "ir",
    group: "Image",
    label: "IR 10.5",
    detail: "Couche infrarouge.",
  },
  {
    id: "th",
    group: "Image",
    label: "Thermique",
    detail: "Couche thermique.",
  },
  {
    id: "nv",
    group: "Image",
    label: "Nuit",
    detail: "Couche nuit.",
  },
  {
    id: "rel",
    group: "Image",
    label: "Relief",
    detail: "Couche relief.",
  },
  {
    id: "veille",
    group: "Détection",
    label: "Veille",
    detail: "Le poste passe en veille.",
  },
  {
    id: "live",
    group: "Détection",
    label: "1090",
    detail: "Pistes ADS-B en lecture.",
  },
  {
    id: "amis",
    group: "Détection",
    label: "Amis",
    detail: "Couche FATL et ASECNA.",
  },
  {
    id: "feu",
    group: "Détection",
    label: "Feu VIIRS",
    detail: "Signale si le thermique se tait.",
  },
  {
    id: "ecoute",
    group: "Détection",
    label: "SIGINT",
    detail: "Écoute passive du poste.",
  },
  {
    id: "large",
    group: "Détection",
    label: "Écoute large",
    detail: "Bande élargie, sans émission.",
  },
  {
    id: "remanence",
    group: "Radar",
    label: "Rémanence",
    detail: "Le PPI garde la trace du balayage.",
  },
  {
    id: "etiquettes",
    group: "Radar",
    label: "Étiquettes",
    detail: "Indicatifs sur le PPI.",
  },
  {
    id: "traces",
    group: "Radar",
    label: "Traînées",
    detail: "Trajectoires sur le PPI.",
  },
  {
    id: "iffppi",
    group: "Radar",
    label: "IFF PPI",
    detail: "Marques IFF sur le PPI.",
  },
  {
    id: "mesure",
    group: "Poste",
    label: "Mesure",
    detail: "Outil de mesure sur la carte.",
  },
  {
    id: "bulles",
    group: "Poste",
    label: "Bulles",
    detail: "Outil de pose d'une bulle GPS.",
  },
  {
    id: "auto",
    group: "Poste",
    label: "Veille auto",
    detail: "La veille choisit la couche toute seule.",
  },
  {
    id: "horloge",
    group: "Poste",
    label: "Horloge",
    detail: "Le flux du poste tourne.",
  },
  {
    id: "hebdo",
    group: "Poste",
    label: "Hebdo",
    detail: "Vide le cache image au jour et à l'heure UTC.",
  },
  {
    id: "instruction",
    group: "Poste",
    label: "Exercice",
    detail: "Pistes d'instruction. Ce ne sont pas des contacts.",
  },
] as const;

export type StewardParamId = (typeof STEWARD_PARAMS)[number]["id"];
export type StewardFlags = Record<StewardParamId, boolean>;

export function emptyFlags(): StewardFlags {
  return {
    photo: false,
    affinage: false,
    relief: false,
    marine: false,
    vis: false,
    ir: false,
    th: false,
    nv: false,
    rel: false,
    veille: false,
    live: false,
    amis: false,
    feu: false,
    ecoute: false,
    large: false,
    remanence: false,
    etiquettes: false,
    traces: false,
    iffppi: false,
    mesure: false,
    bulles: false,
    auto: false,
    horloge: false,
    hebdo: false,
    instruction: false,
  };
}

export type StewardAct =
  | { id: "vis-ir"; text: string }
  | { id: "ir-vis"; text: string }
  | { id: "weekly"; text: string }
  | { id: "note"; text: string };

const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

function ageMin(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

export function weeklyDue(opts: {
  now: number;
  weeklyDay: number;
  weeklyHour: number;
  lastWeeklyAt: number;
}): boolean {
  if (opts.lastWeeklyAt > 0 && opts.now - opts.lastWeeklyAt < WEEK_MS) return false;
  const d = new Date(opts.now);
  return d.getUTCDay() === opts.weeklyDay && d.getUTCHours() === opts.weeklyHour;
}

/** Décisions sûres. Aucune émission, aucun acquittement, aucun personnel. */
export function planSteward(opts: {
  now: number;
  visAt: string | null;
  satLayer: SatLayer;
  heldIr: boolean;
  firms: number;
  firmsSilent: boolean;
  flags: StewardFlags;
  weeklyDay: number;
  weeklyHour: number;
  lastWeeklyAt: number;
}): StewardAct[] {
  const acts: StewardAct[] = [];
  const age = ageMin(opts.visAt, opts.now);
  if (opts.flags.photo && opts.satLayer === "vis" && (age == null || age > 60)) {
    acts.push({
      id: "vis-ir",
      text: "Photo absente ou plus vieille que 60 min. Passage en IR 10.5.",
    });
  } else if (
    opts.flags.photo &&
    opts.heldIr &&
    opts.satLayer === "ir" &&
    age != null &&
    age <= 45
  ) {
    acts.push({
      id: "ir-vis",
      text: `Photo revenue, ${age} min. Retour au visible.`,
    });
  }
  if (opts.flags.feu && opts.firmsSilent && opts.firms === 0) {
    acts.push({ id: "note", text: "VIIRS silencieux. Le passage suivant relit les points." });
  }
  if (
    opts.flags.hebdo &&
    weeklyDue({
      now: opts.now,
      weeklyDay: opts.weeklyDay,
      weeklyHour: opts.weeklyHour,
      lastWeeklyAt: opts.lastWeeklyAt,
    })
  ) {
    acts.push({
      id: "weekly",
      text: "Maintenance hebdomadaire : cache image vidé, scènes relues.",
    });
  }
  return acts;
}
