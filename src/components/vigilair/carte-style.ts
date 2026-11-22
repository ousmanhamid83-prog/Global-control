/**
 * Le style de la carte du poste pour MapLibre : imagerie servie par le poste, puis le théâtre, les
 * pistes, nos drones, leurs images et la mesure. Les zooms des couches reprennent les échelles du
 * poste (« 1,2 m » et « 0,3 m » de près, « Veille », « Approche », « AES », « Sahel », « Monde »).
 * Aucune ressource n'est demandée hors du poste : pas d'adresse de glyphes (MapLibre trace les
 * lettres lui-même avec la police IBM Plex embarquée), symboles dessinés à la demande.
 */
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { nomCarre } from "@/lib/vigilair/carte-icones";
import { SAT_LAYERS, type SatLayer } from "@/lib/vigilair/sat";

/** Seuils de zoom (tuiles de 512) : de près (≥ 13,5), veille (≥ 9), approche (≥ 7,5), large (< 4,5), monde (< 2). */
export const Z = { proche: 13.5, veille: 9, approche: 7.5, large: 4.5, monde: 2 } as const;

/** Zoom le plus fin que sert chaque couche (au-delà, MapLibre agrandit au lieu de redemander). */
export const ZOOM_MAX_COUCHE: Record<SatLayer, number> = {
  vis: 19,
  s2: 15,
  ir: 9,
  th: 9,
  nv: 8,
  rel: 15,
};

/**
 * Taille d'affichage d'une tuile (px). Le visible en 128 : MapLibre prend un niveau plus fin, et
 * l'échelle « 1,2 m » montre vraiment l'imagerie à 1,2 m (en 256, elle aurait montré 2,4 m).
 */
export const TAILLE_TUILE: Record<SatLayer, number> = {
  vis: 128,
  s2: 256,
  ir: 256,
  th: 256,
  nv: 256,
  rel: 256,
};

/** Le niveau de tuile que MapLibre affiche à ce zoom pour cette couche. */
export function niveauTuile(couche: SatLayer, zoom: number): number {
  const z = Math.round(zoom + Math.log2(512 / TAILLE_TUILE[couche]));
  return Math.min(ZOOM_MAX_COUCHE[couche], Math.max(0, z));
}

/** Les tuiles passent par la file du poste : « tuile:///api/tile?… ». */
export const PROTOCOLE_TUILE = "tuile";
export const viaFile = (chemin: string) => `${PROTOCOLE_TUILE}://${chemin}`;

/** Les polices des textes : la graisse se lit dans le premier nom, la famille embarquée suit. */
export const POLICE = {
  mono: ["IBM Plex Mono Medium", "IBM Plex Mono"],
  monoFin: ["IBM Plex Mono"],
  sans: ["IBM Plex Sans SemiBold", "IBM Plex Sans"],
};

export type Palette = {
  bg: string;
  fg: string;
  muted: string;
  mutedFg: string;
  border: string;
  ice: string;
  ok: string;
  warn: string;
  crit: string;
  neutre: string;
  cn: string;
  tr: string;
  ru: string;
  ir: string;
  xx: string;
};

/** Les couleurs du thème, lues dans la feuille de style (elles sont en hexadécimal, ce que lit MapLibre). */
export function lirePalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const t = (nom: string, defaut: string) => cs.getPropertyValue(nom).trim() || defaut;
  return {
    bg: t("--color-bg", "#05090b"),
    fg: t("--color-fg", "#e3ecef"),
    muted: t("--color-muted", "#80939b"),
    mutedFg: t("--color-muted-foreground", "#94a7af"),
    border: t("--color-border", "#1d2b32"),
    ice: t("--color-primary", "#4fd1c5"),
    ok: t("--color-ok", "#4cc38a"),
    warn: t("--color-warn", "#e8a33d"),
    crit: t("--color-crit", "#f0605a"),
    neutre: t("--color-series-2", "#8d73e8"),
    cn: t("--color-cn", "#e48080"),
    tr: t("--color-tr", "#d9b36a"),
    ru: t("--color-ru", "#82aee0"),
    ir: t("--color-ir", "#d0a274"),
    xx: t("--color-xx", "#80939b"),
  };
}

/** Les sources GeoJSON de la carte, remplies à chaque tour par les vraies données du poste. */
export const SOURCES_DONNEES = [
  "monde",
  "frontieres",
  "eaux",
  "noms",
  "brouillage",
  "meteo",
  "routes-lac",
  "hydro",
  "zones",
  "mines",
  "axes",
  "pics",
  "route-nav",
  "zone-gps",
  "phenomenes",
  "capture",
  "pixels",
  "aeroport",
  "anneaux",
  "fonds-contours",
  "calage",
  "traces",
  "vecteurs",
  "suivie",
  "pistes",
  "drones",
  "mesure",
] as const;
export type SourceDonnees = (typeof SOURCES_DONNEES)[number];

const VIDE = { type: "FeatureCollection", features: [] } as const;

const quoi = (q: string): FilterSpecification => ["==", ["get", "quoi"], q];
const vrai = (p: string): ExpressionSpecification => ["==", ["get", p], true];

/** Texte au style du poste : halo sombre sous la lettre, lisible sur une imagerie claire. */
function texte(
  p: Palette,
  champ: ExpressionSpecification | string,
  o: {
    taille?: number;
    couleur?: string | ExpressionSpecification;
    decalage?: [number, number];
    ancre?: "left" | "center" | "top-left" | "bottom-left";
    police?: string[];
    chevauche?: boolean;
  },
): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  return {
    layout: {
      "text-field": champ,
      "text-font": o.police ?? POLICE.mono,
      "text-size": o.taille ?? 10,
      "text-anchor": o.ancre ?? "left",
      "text-justify": "left",
      "text-offset": o.decalage ?? [0.8, 0],
      "text-allow-overlap": o.chevauche ?? false,
      "text-optional": true,
    },
    paint: {
      "text-color": o.couleur ?? p.mutedFg,
      "text-halo-color": p.bg,
      "text-halo-width": 1.2,
    },
  };
}

/** Le style de départ : imagerie du poste (une source par couche), mosaïque locale, fond sombre. */
export function styleDeBase(
  p: Palette,
  couche: SatLayer,
  modele: (l: SatLayer) => string,
  mosaique: { zMin: number; zMax: number; version: number },
): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {
    mosaique: {
      type: "raster",
      tiles: [`mosaique://{z}/{x}/{y}?v=${mosaique.version}`],
      tileSize: 256,
      minzoom: mosaique.zMin,
      maxzoom: mosaique.zMax,
    },
  };
  for (const l of SAT_LAYERS) {
    sources[`imagerie-${l}`] = {
      type: "raster",
      tiles: [viaFile(modele(l))],
      tileSize: TAILLE_TUILE[l],
      maxzoom: ZOOM_MAX_COUCHE[l],
    };
  }
  for (const s of SOURCES_DONNEES) sources[s] = { type: "geojson", data: VIDE };
  return {
    version: 8,
    sources,
    layers: [
      { id: "fond", type: "background", paint: { "background-color": p.bg } },
      {
        id: "mosaique",
        type: "raster",
        source: "mosaique",
        layout: { visibility: couche === "vis" ? "visible" : "none" },
        paint: { "raster-fade-duration": 0 },
      },
      ...SAT_LAYERS.map((l): LayerSpecification => ({
        id: `imagerie-${l}`,
        type: "raster",
        source: `imagerie-${l}`,
        layout: { visibility: l === couche ? "visible" : "none" },
        paint: { "raster-fade-duration": 0 },
      })),
      ...couchesDonnees(p),
    ],
  };
}

/** Le nom de la première couche au-dessus des images de nos sources : elles se posent dessous. */
export const AVANT_FONDS = "frontieres";

/** Couches des données, du fond vers le haut : théâtre, zones, pistes, nos drones, mesure. */
export function couchesDonnees(p: Palette): LayerSpecification[] {
  const t = (champ: ExpressionSpecification | string, o: Parameters<typeof texte>[2] = {}) =>
    texte(p, champ, o);
  return [
    // ——— Monde et frontières
    {
      id: "frontieres",
      type: "line",
      source: "frontieres",
      maxzoom: Z.approche,
      paint: { "line-color": p.ice, "line-opacity": 0.42, "line-width": 0.7 },
    },
    {
      id: "monde-graticule",
      type: "line",
      source: "monde",
      maxzoom: Z.monde,
      filter: quoi("graticule"),
      paint: { "line-color": p.ice, "line-opacity": 0.14, "line-width": 1 },
    },
    {
      id: "monde-continents",
      type: "symbol",
      source: "monde",
      maxzoom: Z.monde,
      filter: quoi("continent"),
      ...merge(
        t(["get", "nom"], {
          ancre: "center",
          decalage: [0, 0],
          police: POLICE.sans,
          taille: 11,
          couleur: p.muted,
        }),
      ),
    },
    {
      id: "monde-etats",
      type: "symbol",
      source: "monde",
      maxzoom: Z.monde + 0.6,
      filter: quoi("etat"),
      layout: {
        ...t(["get", "nom"], { taille: 9, police: POLICE.sans }).layout,
        "symbol-sort-key": ["get", "rang"],
      },
      paint: { ...t("", {}).paint, "text-color": ["case", vrai("tchad"), p.fg, p.mutedFg] },
    },
    // ——— Eaux, AES, noms du Sahel
    {
      id: "eaux-lac",
      type: "fill",
      source: "eaux",
      maxzoom: Z.proche,
      filter: quoi("lac"),
      paint: { "fill-color": "#8aa0b8", "fill-opacity": 0.14, "fill-outline-color": "#8aa0b8" },
    },
    {
      id: "eaux-fleuves",
      type: "line",
      source: "eaux",
      minzoom: Z.veille,
      filter: quoi("fleuve"),
      paint: {
        "line-color": "#8aa0b8",
        "line-opacity": ["case", vrai("fort"), 0.45, 0.28],
        "line-width": ["case", vrai("fort"), 2.2, 1.4],
      },
    },
    {
      id: "eaux-aes",
      type: "line",
      source: "eaux",
      minzoom: Z.monde,
      maxzoom: Z.approche,
      filter: quoi("aes"),
      paint: {
        "line-color": "#c8ccd4",
        "line-opacity": 0.35,
        "line-width": 1.4,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "noms-etats",
      type: "symbol",
      source: "noms",
      minzoom: Z.monde + 0.5,
      maxzoom: Z.veille,
      filter: quoi("etat"),
      ...merge(
        t(["get", "nom"], {
          ancre: "center",
          decalage: [0, 0],
          police: POLICE.sans,
          taille: 11,
          couleur: ["case", vrai("aes"), p.ice, p.muted],
        }),
      ),
    },
    {
      id: "villes-points",
      type: "circle",
      source: "noms",
      minzoom: Z.monde + 0.5,
      maxzoom: Z.veille,
      filter: ["all", quoi("ville"), ["<=", ["get", "rang"], ["step", ["zoom"], 1, 3.6, 2]]],
      paint: {
        "circle-radius": ["case", vrai("capitale"), 2.6, 1.5],
        "circle-color": p.fg,
        "circle-opacity": 0.85,
      },
    },
    {
      id: "villes-noms",
      type: "symbol",
      source: "noms",
      minzoom: Z.monde + 0.5,
      maxzoom: Z.veille,
      filter: ["all", quoi("ville"), ["<=", ["get", "rang"], ["step", ["zoom"], 1, 3.6, 2]]],
      ...merge(t(["get", "nom"], { police: POLICE.sans })),
    },
    // ——— Météo : SIGMET, brouillage GNSS mesuré, stations METAR
    {
      id: "brouillage",
      type: "fill",
      source: "brouillage",
      minzoom: Z.monde,
      maxzoom: Z.proche,
      paint: {
        "fill-color": ["case", vrai("fort"), p.crit, p.warn],
        "fill-opacity": 0.1,
        "fill-outline-color": ["case", vrai("fort"), p.crit, p.warn],
      },
    },
    {
      id: "sigmet",
      type: "fill",
      source: "meteo",
      minzoom: Z.monde,
      maxzoom: Z.proche,
      filter: quoi("sigmet"),
      paint: { "fill-color": "#c4a574", "fill-opacity": 0.08, "fill-outline-color": "#c4a574" },
    },
    {
      id: "metar",
      type: "symbol",
      source: "meteo",
      minzoom: Z.monde,
      filter: quoi("metar"),
      layout: {
        "icon-image": ["get", "icone"],
        "icon-allow-overlap": true,
        ...t(["get", "nom"], { taille: 8, police: POLICE.monoFin }).layout,
      },
      paint: t("", {}).paint,
    },
    // ——— Lac : routes de pirogue et de jet-ski ; carte marine sur demande
    {
      id: "routes-lac",
      type: "line",
      source: "routes-lac",
      maxzoom: Z.proche,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": ["case", vrai("jetski"), p.ice, "#7d9b86"],
        "line-opacity": ["case", vrai("choisie"), 0.95, 0.75],
        "line-width": ["case", vrai("choisie"), 2.2, 1.25],
      },
    },
    {
      id: "routes-lac-etapes",
      type: "circle",
      source: "routes-lac",
      maxzoom: Z.proche,
      filter: quoi("etape"),
      paint: {
        "circle-radius": ["case", vrai("choisie"), 3, 2],
        "circle-color": ["case", vrai("choisie"), p.ice, p.muted],
      },
    },
    {
      id: "routes-lac-noms",
      type: "symbol",
      source: "routes-lac",
      maxzoom: Z.proche,
      filter: ["all", quoi("nom"), ["any", vrai("choisie"), [">=", ["zoom"], Z.approche]]],
      ...merge(t(["get", "nom"], { couleur: ["case", vrai("choisie"), p.fg, p.muted] })),
    },
    {
      id: "hydro-surfaces",
      type: "fill",
      source: "hydro",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": p.ice,
        "fill-opacity": ["case", vrai("choisie"), 0.28, 0.16],
        "fill-outline-color": p.ice,
      },
    },
    {
      id: "hydro-cours",
      type: "line",
      source: "hydro",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": p.ice,
        "line-width": ["case", vrai("choisie"), 3.2, 2.2],
        "line-opacity": 0.9,
      },
    },
    {
      id: "hydro-reperes",
      type: "circle",
      source: "hydro",
      filter: quoi("repere"),
      paint: { "circle-radius": 2.5, "circle-color": ["case", vrai("choisie"), p.ice, p.muted] },
    },
    {
      id: "hydro-noms",
      type: "symbol",
      source: "hydro",
      minzoom: Z.monde,
      filter: [
        "any",
        quoi("nom"),
        [
          "all",
          quoi("repere"),
          ["any", vrai("choisie"), vrai("tchad"), [">=", ["zoom"], Z.approche]],
        ],
      ],
      ...merge(t(["get", "nom"], { couleur: ["case", vrai("choisie"), p.fg, p.muted] })),
    },
    // ——— Zones du poste, mines, axes, pics, route, zone GPS
    {
      id: "zones",
      type: "line",
      source: "zones",
      minzoom: Z.veille,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": [
          "match",
          ["get", "niveau"],
          "intrusion",
          p.crit,
          "approche",
          p.warn,
          "trafic",
          p.ok,
          p.crit,
        ],
        "line-opacity": [
          "match",
          ["get", "niveau"],
          "intrusion",
          0.75,
          "approche",
          0.6,
          "trafic",
          0.45,
          0.28,
        ],
        "line-width": 1,
        "line-dasharray": ["case", vrai("arme"), ["literal", [4, 4]], ["literal", [2, 6]]],
      },
    },
    {
      id: "zones-noms",
      type: "symbol",
      source: "zones",
      minzoom: Z.veille,
      filter: ["==", ["geometry-type"], "Point"],
      ...merge(t(["get", "nom"], { taille: 9, police: POLICE.monoFin, decalage: [0.6, -0.8] })),
    },
    {
      id: "mines",
      type: "line",
      source: "mines",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": [
          "match",
          ["get", "niveau"],
          "intrusion",
          p.crit,
          "approche",
          p.warn,
          ["case", vrai("suivie"), p.ice, "#c4a574"],
        ],
        "line-width": ["case", vrai("suivie"), 1.6, 1],
        "line-dasharray": [3, 3],
      },
    },
    {
      id: "mines-reperes",
      type: "circle",
      source: "mines",
      filter: quoi("mine"),
      paint: {
        "circle-radius": 2.5,
        "circle-color": [
          "match",
          ["get", "niveau"],
          "intrusion",
          p.crit,
          ["case", vrai("suivie"), p.ice, p.warn],
        ],
      },
    },
    {
      id: "mines-noms",
      type: "symbol",
      source: "mines",
      filter: ["all", quoi("mine"), ["any", vrai("suivie"), [">=", ["zoom"], Z.monde]]],
      ...merge(t(["get", "nom"], { taille: 9, couleur: ["case", vrai("suivie"), p.fg, p.muted] })),
    },
    {
      id: "axes",
      type: "line",
      source: "axes",
      maxzoom: Z.proche,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": ["case", vrai("choisi"), p.ice, "#c8ccd4"],
        "line-opacity": ["case", vrai("choisi"), 0.95, 0.6],
        "line-width": ["case", vrai("choisi"), 1.6, 1],
      },
    },
    {
      id: "axes-bouts",
      type: "circle",
      source: "axes",
      maxzoom: Z.proche,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["case", vrai("choisi"), 3.2, 2],
        "circle-color": ["case", vrai("choisi"), p.ice, p.muted],
      },
    },
    {
      id: "axes-noms",
      type: "symbol",
      source: "axes",
      maxzoom: Z.proche,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["any", vrai("choisi"), [">=", ["zoom"], Z.monde]],
      ],
      ...merge(t(["get", "nom"], { couleur: ["case", vrai("choisi"), p.fg, p.muted] })),
    },
    {
      id: "pics",
      type: "symbol",
      source: "pics",
      filter: ["any", vrai("choisi"), vrai("marque"), [">=", ["zoom"], Z.monde]],
      layout: {
        "icon-image": ["get", "icone"],
        "icon-allow-overlap": true,
        ...t(["get", "nom"], { taille: 9 }).layout,
      },
      paint: { ...t("", {}).paint, "text-color": ["case", vrai("choisi"), p.fg, p.muted] },
    },
    {
      id: "route-nav",
      type: "line",
      source: "route-nav",
      filter: quoi("axe"),
      paint: {
        "line-color": p.ice,
        "line-width": 2,
        "line-opacity": 0.9,
        "line-dasharray": [3.5, 2],
      },
    },
    {
      id: "route-nav-obstacles",
      type: "circle",
      source: "route-nav",
      filter: quoi("obstacle"),
      paint: {
        "circle-radius": 3,
        "circle-color": p.crit,
        "circle-stroke-color": p.crit,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.45,
      },
    },
    {
      id: "route-nav-etapes",
      type: "circle",
      source: "route-nav",
      filter: quoi("etape"),
      paint: { "circle-radius": 4, "circle-color": ["case", vrai("bout"), p.fg, p.ice] },
    },
    {
      id: "route-nav-noms",
      type: "symbol",
      source: "route-nav",
      filter: quoi("etape"),
      ...merge(t(["get", "nom"], { taille: 9, decalage: [0.6, -0.8] })),
    },
    {
      id: "zone-gps",
      type: "line",
      source: "zone-gps",
      paint: {
        "line-color": p.ice,
        "line-opacity": 0.8,
        "line-width": 1.3,
        "line-dasharray": [2.5, 2],
      },
    },
    {
      id: "zone-gps-centre",
      type: "circle",
      source: "zone-gps",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 3, "circle-color": p.ice },
    },
    {
      id: "zone-gps-nom",
      type: "symbol",
      source: "zone-gps",
      filter: ["==", ["geometry-type"], "Point"],
      ...merge(t(["get", "nom"], { taille: 10, couleur: p.fg, chevauche: true })),
    },
    // ——— Phénomènes (feux VIIRS, séismes…), scène ouverte
    {
      id: "feux",
      type: "circle",
      source: "phenomenes",
      filter: vrai("feu"),
      paint: {
        "circle-radius": 8,
        "circle-opacity": 0,
        "circle-stroke-color": p.crit,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "phenomenes",
      type: "symbol",
      source: "phenomenes",
      filter: ["any", vrai("feu"), vrai("fort"), ["!", vrai("monde")], [">=", ["zoom"], Z.monde]],
      layout: {
        "icon-image": ["get", "icone"],
        "icon-allow-overlap": true,
        ...t(["get", "nom"], { taille: 8, police: POLICE.monoFin }).layout,
      },
      paint: { ...t("", {}).paint, "text-color": ["case", vrai("feu"), p.crit, p.muted] },
    },
    {
      id: "capture-cercle",
      type: "circle",
      source: "capture",
      filter: quoi("centre"),
      paint: {
        "circle-radius": 16,
        "circle-opacity": 0,
        "circle-stroke-color": p.ice,
        "circle-stroke-width": 1.2,
      },
    },
    {
      id: "capture-nom",
      type: "symbol",
      source: "capture",
      filter: quoi("centre"),
      ...merge(
        t(["get", "nom"], { taille: 9, couleur: p.fg, decalage: [1.8, -1.6], chevauche: true }),
      ),
    },
    {
      id: "capture-objets",
      type: "circle",
      source: "capture",
      minzoom: Z.proche,
      filter: quoi("objet"),
      paint: {
        "circle-radius": 2,
        "circle-color": ["match", ["get", "genre"], "feu", p.crit, "eau", p.ice, p.fg],
      },
    },
    {
      id: "capture-objets-noms",
      type: "symbol",
      source: "capture",
      minzoom: Z.proche,
      filter: quoi("objet"),
      ...merge(t(["get", "nom"], { taille: 9, police: POLICE.sans, couleur: p.fg })),
    },
    // ——— Ce que l'analyse des pixels a mesuré au centre (de près, imagerie visible)
    {
      id: "pixels",
      type: "symbol",
      source: "pixels",
      minzoom: Z.proche,
      layout: {
        "icon-image": ["case", vrai("feu"), nomCarre(p.crit), nomCarre(p.ice)],
        "icon-allow-overlap": true,
        ...t(["get", "nom"], { taille: 9, decalage: [0.8, -0.6] }).layout,
      },
      paint: { ...t("", {}).paint, "text-color": ["case", vrai("feu"), p.crit, p.fg] },
    },
    // ——— L'aérodrome et les anneaux de distance (pas de radar : ils sont centrés sur FTTJ)
    {
      id: "aeroport-piste",
      type: "line",
      source: "aeroport",
      minzoom: Z.approche,
      filter: quoi("piste"),
      paint: { "line-color": p.ice, "line-opacity": 0.8, "line-width": 3 },
    },
    {
      id: "aeroport-repere",
      type: "circle",
      source: "aeroport",
      maxzoom: Z.approche,
      filter: quoi("repere"),
      paint: { "circle-radius": 2.4, "circle-color": p.ice },
    },
    {
      id: "aeroport-nom",
      type: "symbol",
      source: "aeroport",
      filter: quoi("repere"),
      ...merge(t(["get", "nom"], { couleur: p.muted, decalage: [0.9, -0.7], chevauche: true })),
    },
    {
      id: "anneaux",
      type: "line",
      source: "anneaux",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#c8ccd4", "line-opacity": 0.16, "line-width": 1 },
    },
    {
      id: "anneaux-noms",
      type: "symbol",
      source: "anneaux",
      filter: ["==", ["geometry-type"], "Point"],
      ...merge(
        t(["get", "nom"], {
          taille: 9,
          police: POLICE.monoFin,
          couleur: "#c8ccd4",
          decalage: [0.5, 0.8],
        }),
      ),
    },
    // ——— Images de nos sources (posées dessous) : contour et nom ; calage en cours
    {
      id: "fonds-contours",
      type: "line",
      source: "fonds-contours",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": p.fg, "line-width": 1, "line-dasharray": [4, 3] },
    },
    {
      id: "fonds-noms",
      type: "symbol",
      source: "fonds-contours",
      filter: ["==", ["geometry-type"], "Point"],
      ...merge(
        t(["get", "nom"], {
          couleur: p.fg,
          ancre: "bottom-left",
          decalage: [0.4, -0.4],
          chevauche: true,
        }),
      ),
    },
    {
      id: "calage-trace",
      type: "line",
      source: "calage",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": p.fg, "line-width": 1.5 },
    },
    {
      id: "calage-coins",
      type: "circle",
      source: "calage",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 3, "circle-color": p.fg },
    },
    {
      id: "calage-noms",
      type: "symbol",
      source: "calage",
      filter: ["==", ["geometry-type"], "Point"],
      ...merge(t(["get", "nom"], { couleur: p.fg, decalage: [0.7, 1.1], chevauche: true })),
    },
    // ——— Pistes reçues : traces, vecteurs, route prédite de la suivie, anneaux, symboles, étiquettes
    {
      id: "traces",
      type: "line",
      source: "traces",
      paint: {
        "line-color": ["get", "couleur"],
        "line-opacity": ["case", vrai("verrou"), 0.85, 0.4],
        "line-width": ["case", vrai("verrou"), 2.2, 1.2],
      },
    },
    {
      id: "vecteurs",
      type: "line",
      source: "vecteurs",
      paint: { "line-color": ["get", "couleur"], "line-opacity": 0.8, "line-width": 1 },
    },
    {
      id: "suivie-prediction",
      type: "line",
      source: "suivie",
      filter: quoi("prediction"),
      paint: {
        "line-color": p.ok,
        "line-opacity": 0.7,
        "line-width": 1.4,
        "line-dasharray": [3.5, 3],
      },
    },
    {
      id: "suivie-premier",
      type: "line",
      source: "suivie",
      filter: ["all", quoi("premier"), ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": p.ice, "line-width": 1, "line-dasharray": [4, 4] },
    },
    {
      id: "suivie-premier-nom",
      type: "symbol",
      source: "suivie",
      filter: ["all", quoi("premier"), ["==", ["geometry-type"], "Point"]],
      ...merge(t(["get", "nom"], { taille: 9, police: POLICE.monoFin, chevauche: true })),
    },
    {
      id: "pistes-urgence",
      type: "circle",
      source: "pistes",
      filter: vrai("urgence"),
      paint: {
        "circle-radius": 22,
        "circle-opacity": 0,
        "circle-stroke-color": p.crit,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.9,
      },
    },
    {
      id: "pistes-gnss",
      type: "circle",
      source: "pistes",
      filter: vrai("douteux"),
      paint: {
        "circle-radius": 17,
        "circle-opacity": 0,
        "circle-stroke-color": p.warn,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.75,
      },
    },
    {
      id: "pistes-sel",
      type: "circle",
      source: "pistes",
      filter: vrai("sel"),
      paint: {
        "circle-radius": 14,
        "circle-opacity": 0,
        "circle-stroke-color": ["case", vrai("verrou"), p.ok, p.ice],
        "circle-stroke-width": 1.2,
      },
    },
    {
      id: "pistes-b6",
      type: "circle",
      source: "pistes",
      filter: vrai("b6"),
      paint: {
        "circle-radius": 11,
        "circle-opacity": 0,
        "circle-stroke-color": p.crit,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.9,
      },
    },
    {
      id: "pistes-formes",
      type: "symbol",
      source: "pistes",
      layout: {
        "icon-image": ["get", "forme"],
        "icon-rotate": ["get", "cap"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "pistes-cadres",
      type: "symbol",
      source: "pistes",
      filter: ["!=", ["get", "cadre"], ""],
      layout: {
        "icon-image": ["get", "cadre"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "pistes-noms",
      type: "symbol",
      source: "pistes",
      filter: ["!=", ["get", "l1"], ""],
      layout: {
        ...t(
          [
            "format",
            ["get", "l1"],
            { "text-color": p.fg },
            "\n",
            {},
            ["get", "l2"],
            { "text-color": p.mutedFg, "font-scale": 0.9 },
          ],
          { ancre: "left", decalage: [1.1, 0], taille: 10 },
        ).layout,
        "symbol-sort-key": ["get", "rang"],
      },
      paint: t("", {}).paint,
    },
    // ——— NOS drones (par leur liaison) : circuit, rayon permis, départ, étapes, symbole, cap, nom
    {
      id: "drones-lignes",
      type: "line",
      source: "drones",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": ["get", "couleur"], "line-width": 1, "line-dasharray": [3, 3] },
    },
    {
      id: "drones-reperes",
      type: "symbol",
      source: "drones",
      filter: ["in", ["get", "quoi"], ["literal", ["depart", "etape", "designe"]]],
      layout: {
        "icon-image": ["get", "icone"],
        "icon-allow-overlap": true,
        ...t(["get", "nom"], { taille: 10, decalage: [0.7, -0.7], chevauche: true }).layout,
      },
      paint: { ...t("", {}).paint, "text-color": ["get", "couleur"] },
    },
    {
      id: "drones-cap",
      type: "symbol",
      source: "drones",
      filter: ["all", quoi("drone"), ["!=", ["get", "fleche"], ""]],
      layout: {
        "icon-image": ["get", "fleche"],
        "icon-rotate": ["get", "cap"],
        "icon-rotation-alignment": "map",
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "drones-cadres",
      type: "symbol",
      source: "drones",
      filter: quoi("drone"),
      layout: {
        "icon-image": ["get", "icone"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "drones-noms",
      type: "symbol",
      source: "drones",
      filter: quoi("drone"),
      layout: t(
        [
          "format",
          ["get", "l1"],
          { "text-color": p.fg },
          "\n",
          {},
          ["get", "l2"],
          { "text-color": p.mutedFg, "font-scale": 0.9 },
        ],
        { decalage: [1.4, 0], chevauche: true },
      ).layout,
      paint: t("", {}).paint,
    },
    // ——— Règle de mesure du chef
    {
      id: "mesure-ligne",
      type: "line",
      source: "mesure",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": p.ice,
        "line-width": 1.5,
        "line-dasharray": ["case", vrai("fixe"), ["literal", [1, 0]], ["literal", [3, 2]]],
      },
    },
    {
      id: "mesure-bouts",
      type: "circle",
      source: "mesure",
      filter: ["has", "bout"],
      paint: { "circle-radius": 3.5, "circle-color": p.ice },
    },
    {
      id: "mesure-nom",
      type: "symbol",
      source: "mesure",
      filter: ["has", "nom"],
      ...merge(
        t(["get", "nom"], {
          couleur: p.fg,
          ancre: "center",
          decalage: [0, -1.2],
          taille: 11,
          chevauche: true,
        }),
      ),
    },
  ] as LayerSpecification[];
}

/** Une couche « symbol » faite d'un texte : mise à plat de ce que rend texte(). */
function merge(x: { layout: Record<string, unknown>; paint: Record<string, unknown> }) {
  return { layout: x.layout, paint: x.paint };
}
