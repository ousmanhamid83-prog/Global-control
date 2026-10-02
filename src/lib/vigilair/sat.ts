export type SatLayer = "vis" | "ir" | "th" | "nv" | "rel";

export const SAT_LAYERS: SatLayer[] = ["vis", "ir", "th", "nv", "rel"];

export const SAT_LAYER_LABEL: Record<SatLayer, string> = {
  vis: "Visible",
  ir: "IR 10.5",
  th: "Thermique",
  nv: "Nuit",
  rel: "Relief",
};

export type SatMeta = {
  visAt: string | null;
  irAt: string | null;
  thAt: string | null;
  nvAt: string | null;
  relAt: string | null;
  visSrc: string;
  irSrc: string;
  thSrc: string;
  nvSrc: string;
  relSrc: string;
};

export function parseSatLayer(v: string | null | undefined): SatLayer {
  if (v === "ir" || v === "th" || v === "vis" || v === "nv" || v === "rel") return v;
  return "vis";
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
