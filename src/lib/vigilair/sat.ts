export type SatLayer = "vis" | "s2" | "ir" | "th" | "nv" | "rel";

export const SAT_LAYERS: SatLayer[] = ["vis", "s2", "ir", "th", "nv", "rel"];

export const SAT_LAYER_LABEL: Record<SatLayer, string> = {
  vis: "Visible",
  s2: "Sentinel-2",
  ir: "IR 10.5",
  th: "Thermique",
  nv: "Nuit",
  rel: "Relief",
};

export type SatMeta = {
  visAt: string | null;
  s2At: string | null;
  irAt: string | null;
  thAt: string | null;
  nvAt: string | null;
  relAt: string | null;
  visSrc: string;
  s2Src: string;
  irSrc: string;
  thSrc: string;
  nvSrc: string;
  relSrc: string;
};

export function parseSatLayer(v: string | null | undefined): SatLayer {
  if (v === "ir" || v === "th" || v === "vis" || v === "s2" || v === "nv" || v === "rel") return v;
  return "vis";
}

/**
 * Bascule auto jour/nuit de l'imagerie. « Visible » n'est noir la nuit QUE sur les vues larges, où
 * il vient du géostationnaire (lumière solaire réfléchie). Sur les vues de détail (≈ z ≥ 11), «
 * Visible » est l'ARCHIVE Esri World Imagery : une mosaïque nette, valable jour comme nuit — on n'y
 * touche donc jamais. On ne bascule en « Nuit » (VIIRS DNB) que quand la vue est large ET qu'il fait
 * nuit ; on rend « Visible » dès qu'on repasse en détail ou au lever du jour. Pure et testable.
 *
 * @param cur       couche active
 * @param autoFrom  couche d'origine mémorisée lors d'une bascule auto (sinon null)
 * @param autoNight l'auto est-il activé
 * @param night     fait-il nuit à FTTJ (null = inconnu, on ne touche à rien)
 * @param visIsLive « Visible » vient-il du géostationnaire (vue large, noir la nuit) ? false = archive nette
 * @returns le nouvel état { satLayer, satAutoFrom }, ou null si rien ne change
 */
export function nightLayerSwitch(
  cur: SatLayer,
  autoFrom: SatLayer | null,
  autoNight: boolean,
  night: boolean | null,
  visIsLive: boolean,
): { satLayer: SatLayer; satAutoFrom: SatLayer | null } | null {
  if (!autoNight || night == null) return null;
  const wantNight = night && visIsLive;
  if (wantNight && cur === "vis") return { satLayer: "nv", satAutoFrom: "vis" };
  if (!wantNight && autoFrom === "vis" && cur === "nv") return { satLayer: "vis", satAutoFrom: null };
  return null;
}

export function sceneAgeMin(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

export function sceneAgeLabel(iso: string | null): string {
  const m = sceneAgeMin(iso);
  if (m == null) return "scène…";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
