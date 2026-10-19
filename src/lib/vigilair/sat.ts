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

export type AutoLayerOpts = {
  /** Vue large (géostationnaire) → bascule sur IR pour une couverture monde continue (jour+nuit). */
  autoWideIr: boolean;
  /** Vue large de nuit sans auto-IR → bascule sur Nuit (VIIRS) pour ne pas rester noir. */
  autoNight: boolean;
  /** Fait-il nuit à FTTJ (null = inconnu). */
  night: boolean | null;
  /** « Visible » vient-il du géostationnaire (vue large) ? false = archive Esri nette (détail). */
  visIsLive: boolean;
};

/**
 * Bascule automatique de la couche imagerie, PURE et testable. Principe :
 *  - En DÉTAIL (visIsLive = false, z ≥ 11) : « Visible » est l'archive Esri nette, valable jour comme
 *    nuit — on garde Visible.
 *  - En vue LARGE (géostationnaire) : « Visible » ne couvre que le disque Meteosat de jour. Pour une
 *    couverture monde continue on préfère IR (auto-IR), ou à défaut Nuit la nuit (auto jour/nuit).
 * On ne touche JAMAIS un choix opérateur non-Visible (il a posé IR/Nuit/… lui-même, satAutoFrom null).
 * On ne bouge que « Visible » ou une couche qu'on a nous-mêmes posée (satAutoFrom = « vis »).
 *
 * @returns le nouvel état { satLayer, satAutoFrom }, ou null si rien ne change.
 */
export function autoLayerSwitch(
  cur: SatLayer,
  autoFrom: SatLayer | null,
  opts: AutoLayerOpts,
): { satLayer: SatLayer; satAutoFrom: SatLayer | null } | null {
  const { autoWideIr, autoNight, night, visIsLive } = opts;
  // Couche voulue par l'auto quand la base de l'opérateur est « Visible ».
  let want: SatLayer;
  if (!visIsLive) want = "vis";
  else if (autoWideIr) want = "ir";
  else if (autoNight && night === true) want = "nv";
  else want = "vis";

  const autoSet = autoFrom === "vis"; // la couche actuelle a-t-elle été posée par l'auto ?
  if (cur !== "vis" && !autoSet) return null; // choix opérateur non-Visible : intouchable
  if (cur === want) return null;
  if (want === "vis") return { satLayer: "vis", satAutoFrom: null };
  return { satLayer: want, satAutoFrom: "vis" };
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
