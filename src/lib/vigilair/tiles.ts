import {
  HOME,
  formatGsdM,
  latToTileY,
  lonToTileX,
  project,
  tileToLat,
  tileToLon,
  unproject,
  visGsdM,
  type GeoOrigin,
} from "./geo";
import { sceneAgeLabel, type SatLayer, type SatMeta } from "./sat";
import { scanFlames } from "./flame";

export const SAT_CREDIT =
  "Vue proche : World Imagery jusqu'à z19, objets au sol, toute région. Vue large : Meteosat ≤ 60 min.";

export function satCredit(z: number, layer: SatLayer = "vis", meta?: SatMeta | null): string {
  if (layer === "s2") {
    const src = meta?.s2Src;
    if (!src || src.includes("requise")) {
      return "Sentinel-2 Copernicus · clé gratuite à configurer (Capteurs > Outils) · 10 m";
    }
    if (src.startsWith("Sentinel-2 ·")) return src; // message d'erreur serveur
    const far = z > 14 ? " · agrandi au-delà de z14" : "";
    return `${src}${far}`;
  }
  if (layer === "ir") {
    const age = meta?.irAt ? sceneAgeLabel(meta.irAt) : "10 min";
    if (z >= 12) {
      return `IR 10.5 µm · ~1 km géostationnaire · ${age} — pas de thermique 50 m public`;
    }
    return `IR 10.5 µm · ${meta?.irSrc || "géostationnaire"} · ${age}`;
  }
  if (layer === "th") {
    const age = meta?.thAt ? sceneAgeLabel(meta.thAt) : "live / quotidien";
    if (z >= 12) {
      return `Thermique · ~1 km IR / SST · ${age} — pas de thermique 50 m public`;
    }
    return `Thermique · ${meta?.thSrc || "SST MUR / LST / IR"} · ${age}`;
  }
  if (layer === "nv") {
    const age = meta?.nvAt ? sceneAgeLabel(meta.nvAt) : meta?.nvSrc || "quotidien / archive";
    if (z >= 9) {
      return `Nuit VIIRS DNB · natif z≤8 (~750 m) · ${age} — parent-walk au-delà`;
    }
    return `Nuit · ${meta?.nvSrc || "VIIRS Black Marble"} · ${age}`;
  }
  if (layer === "rel") {
    if (z > 16) return "Relief ombrage ~24 m · agrandi au-delà de z16";
    return "Relief ombrage ~24 m · crêtes et cuvettes";
  }
  if (z >= 18) {
    return "Esri World Imagery · 0,3–0,6 m · archive en ligne, pas une prise du jour";
  }
  if (z >= 11) {
    return "Esri World Imagery · archive en ligne · sol lisible";
  }
  const age = meta?.visAt ? sceneAgeLabel(meta.visAt) : "pas de scène ≤ 60 min";
  const src = meta?.visSrc || "Meteosat";
  return `Photo ${src} · ${age} · reprise 15 min · max 60 min · ~1 km`;
}

/** GSD honnête par couche — IR/TH ne mentent pas en 10 m. */
export type GsdRead = { m: number; label: string; vis: boolean };

export function layerGsd(layer: SatLayer, z: number, lat: number): GsdRead {
  if (layer === "ir" || layer === "th") {
    return { m: 1000, label: `GSD ${formatGsdM(1000)}`, vis: false };
  }
  if (layer === "nv") {
    return { m: 750, label: `GSD ${formatGsdM(750)}`, vis: false };
  }
  if (layer === "rel") {
    return { m: 24, label: "GSD 24 m", vis: false };
  }
  if (layer === "s2") {
    // Sentinel-2 : 10 m natif. On ne prétend jamais mieux, même agrandi.
    const m = Math.max(10, visGsdM(z, lat));
    return { m, label: `GSD ${formatGsdM(m)}`, vis: true };
  }
  const px = visGsdM(z, lat);
  return { m: px, label: `GSD ${formatGsdM(px)}`, vis: true };
}

/** Photo géostationnaire : 1 km, pas le GSD du zoom. */
export function liveGsd(
  layer: SatLayer,
  z: number,
  lat: number,
  src?: string | null,
): GsdRead {
  // Hors ligne, l'image affichée est la mosaïque locale : on lit son pas réel, pas celui du zoom.
  if (layer === "vis" && localDominant) return layerGsd(layer, Math.min(z, LOCAL_MAX_Z), lat);
  if (layer === "vis" && z >= 11) return layerGsd(layer, z, lat);
  if (layer === "vis") return { m: 1000, label: "GSD 1.0 km", vis: true };
  if (layer === "rel") return { m: 24, label: "GSD 24 m", vis: false };
  return layerGsd(layer, z, lat);
}

/** Gabarits. La détection dit si la couche les sépare — elle ne nomme ni un visage ni une plaque. */
export const PIXEL_TARGETS = [
  { id: "homme", short: "H", label: "Homme", m: 0.5 },
  { id: "voiture", short: "V", label: "Voiture", m: 4.5 },
  { id: "pirogue", short: "P", label: "Pirogue", m: 8 },
  { id: "camion", short: "C", label: "Camion", m: 10 },
] as const;

export type PixelId = (typeof PIXEL_TARGETS)[number]["id"];
export type DetectId = "homme" | "voiture" | "pirogue";
/** Johnson : < 1,5 aucune · ≥ 1,5 détection · ≥ 6 reconnaissance · ≥ 12 identification. */
export type PixelClass = "aucune" | "detection" | "reconnaissance" | "identification";

export type PixelSpan = {
  id: PixelId;
  short: string;
  label: string;
  m: number;
  px: number;
  cls: PixelClass;
  clsLabel: string;
};

const PIXEL_CLASS_LABEL: Record<PixelClass, string> = {
  aucune: "aucune",
  detection: "détection",
  reconnaissance: "reconnaissance",
  identification: "identification",
};

export function pixelClassLabel(cls: PixelClass): string {
  return PIXEL_CLASS_LABEL[cls];
}

/** 1,5 px : il y a quelque chose. 6 px : c'est cette classe. 12 px : modèle ou personne. */
export const TASK_RUNGS = [
  { id: "detection", minPx: 1.5, short: "dét" },
  { id: "reconnaissance", minPx: 6, short: "rec" },
  { id: "identification", minPx: 12, short: "id" },
] as const;

export function pixelClass(px: number): PixelClass {
  if (!(px >= TASK_RUNGS[0].minPx)) return "aucune";
  if (px < TASK_RUNGS[1].minPx) return "detection";
  if (px < TASK_RUNGS[2].minPx) return "reconnaissance";
  return "identification";
}

export type TaskGap = {
  next: Exclude<PixelClass, "aucune"> | null;
  missingPx: number;
  /** GSD au sol qui ouvrirait le cran suivant. null si l'identification est tenue. */
  needGsdM: number | null;
};

/** Ce qui manque pour le cran d'au-dessus. C'est l'écart, pas une promesse. */
export function taskGap(px: number, sizeM: number): TaskGap {
  const p = Number.isFinite(px) ? px : 0;
  const size = sizeM > 0 && Number.isFinite(sizeM) ? sizeM : 0;
  for (const rung of TASK_RUNGS) {
    if (p < rung.minPx) {
      return {
        next: rung.id,
        missingPx: rung.minPx - p,
        needGsdM: size > 0 ? size / rung.minPx : null,
      };
    }
  }
  return { next: null, missingPx: 0, needGsdM: null };
}

export function formatGap(px: number): string {
  if (!(px > 0)) return "tenu";
  if (px < 0.1) return "+<0.1 px";
  if (px < 10) return `+${px.toFixed(1)} px`;
  return `+${Math.round(px)} px`;
}

export function formatNeed(m: number | null): string {
  if (m == null || !Number.isFinite(m) || m <= 0) return "—";
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return formatGsdM(m);
}

export function formatPx(px: number): string {
  if (!Number.isFinite(px) || px <= 0) return "—";
  if (px < 0.01) return "<0.01";
  if (px < 1) return px.toFixed(2);
  if (px < 10) return px.toFixed(1);
  return String(Math.round(px));
}

export function pixelBudget(gsdM: number): PixelSpan[] {
  const g = gsdM > 0 && Number.isFinite(gsdM) ? gsdM : Infinity;
  return PIXEL_TARGETS.map((t) => {
    const px = t.m / g;
    const cls = pixelClass(px);
    return { id: t.id, short: t.short, label: t.label, m: t.m, px, cls, clsLabel: PIXEL_CLASS_LABEL[cls] };
  });
}

export function pixelSpan(gsdM: number, id: PixelId): PixelSpan {
  const hit = pixelBudget(gsdM).find((s) => s.id === id);
  if (hit) return hit;
  return { id, short: id, label: id, m: 0, px: 0, cls: "aucune", clsLabel: PIXEL_CLASS_LABEL.aucune };
}

/** Ligne poste : H 0.43 aucune · V 3.9 détection · P 6.8 reconnaissance */
export function pixelBudgetLine(
  gsdM: number,
  ids: PixelId[] = ["homme", "voiture", "pirogue"],
): string {
  const want = new Set(ids);
  return pixelBudget(gsdM)
    .filter((s) => want.has(s.id))
    .map((s) => `${s.short} ${formatPx(s.px)} ${s.clsLabel}`)
    .join(" · ");
}

export type PixelDetection = PixelSpan & {
  detected: boolean;
  verdict: string;
  det: boolean;
  rec: boolean;
  idn: boolean;
  gap: TaskGap;
};

const DETECT_IDS: DetectId[] = ["homme", "voiture", "pirogue"];

/** Détection réelle du gabarit sur la couche, et l'écart jusqu'au cran suivant. */
export function pixelDetections(gsdM: number, layer: SatLayer): PixelDetection[] {
  return DETECT_IDS.map((id) => {
    const s = pixelSpan(gsdM, id);
    const optical = layer === "vis" && s.cls !== "aucune";
    const cls: PixelClass = optical ? s.cls : "aucune";
    const gap = taskGap(s.px, s.m);
    const rank = cls === "identification" ? 3 : cls === "reconnaissance" ? 2 : cls === "detection" ? 1 : 0;
    const base = {
      ...s,
      cls,
      clsLabel: PIXEL_CLASS_LABEL[cls],
      detected: optical,
      det: rank >= 1,
      rec: rank >= 2,
      idn: rank >= 3,
      gap,
    };
    const lack =
      gap.next == null
        ? "Identification tenue. Pas une plaque, pas un nom."
        : `Manque ${formatGap(gap.missingPx)} pour ${PIXEL_CLASS_LABEL[gap.next]}. Il faudrait ${formatNeed(gap.needGsdM)} au sol — la couche est à ${formatGsdM(gsdM)}.`;
    if (!optical) {
      const why =
        layer === "vis"
          ? `${formatPx(s.px)} px, sous 1,5 px`
          : `${formatGsdM(gsdM)}, ce gabarit tient en ${formatPx(s.px)} px`;
      return {
        ...base,
        verdict: `${s.label} · aucune. ${why}. ${lack}`,
      };
    }
    const kind =
      cls === "detection"
        ? "Il y a quelque chose. La classe n'est pas confirmée."
        : cls === "reconnaissance"
          ? "C'est cette classe. Pas le modèle, pas la personne."
          : "Classe fine. Pas une plaque, pas un nom.";
    return {
      ...base,
      verdict: `${s.label} · ${PIXEL_CLASS_LABEL[cls]}. ${formatPx(s.px)} px. ${kind} ${lack}`,
    };
  });
}

/** Gabarits du poste PC. Le porteur montre le seul cran d'identification que 1,2 m peut tenir. */
export const DECK_SUBJECTS = [
  { id: "homme", short: "H", label: "Homme", m: 0.5, hold: "un corps" },
  { id: "voiture", short: "V", label: "Voiture", m: 4.5, hold: "une voiture" },
  { id: "pirogue", short: "P", label: "Pirogue", m: 8, hold: "une pirogue" },
  { id: "leger", short: "L", label: "Léger au sol", m: 11, hold: "un léger" },
  { id: "porteur", short: "A", label: "Porteur au sol", m: 36, hold: "un porteur" },
] as const;

export type DeckRow = {
  id: (typeof DECK_SUBJECTS)[number]["id"];
  short: string;
  label: string;
  m: number;
  px: number;
  cls: PixelClass;
  clsLabel: string;
  det: boolean;
  rec: boolean;
  idn: boolean;
  gap: TaskGap;
  say: string;
  refuse: string;
};

export function taskDeck(gsdM: number, layer: SatLayer): DeckRow[] {
  const g = gsdM > 0 && Number.isFinite(gsdM) ? gsdM : Infinity;
  return DECK_SUBJECTS.map((s) => {
    const px = s.m / g;
    const raw = pixelClass(px);
    const optical = layer === "vis" && raw !== "aucune";
    const cls: PixelClass = optical ? raw : "aucune";
    const gap = taskGap(px, s.m);
    const rank = cls === "identification" ? 3 : cls === "reconnaissance" ? 2 : cls === "detection" ? 1 : 0;
    const say =
      cls === "aucune"
        ? `Rien. On ne dit pas qu'il y a ${s.hold}.`
        : cls === "detection"
          ? `Contact. Gabarit seulement — pas ${s.hold} confirmé.`
          : cls === "reconnaissance"
            ? `Classe : ${s.hold}. Pas le type.`
            : `Silhouette de ${s.hold}. Pas l'immatriculation.`;
    const refuse =
      cls === "identification"
        ? "Plaque et nom refusés."
        : cls === "reconnaissance"
          ? "Identification refusée."
          : cls === "detection"
            ? "Reconnaissance refusée."
            : "Détection refusée.";
    return {
      id: s.id,
      short: s.short,
      label: s.label,
      m: s.m,
      px,
      cls,
      clsLabel: PIXEL_CLASS_LABEL[cls],
      det: rank >= 1,
      rec: rank >= 2,
      idn: rank >= 3,
      gap,
      say,
      refuse,
    };
  });
}

export type CoverId = "batiment" | "massif" | "dedans";
export type CoverHold = "rien" | "possible" | "indice";

export type CoverRow = {
  id: CoverId;
  label: string;
  image: string;
  px: number;
  cls: PixelClass;
  clsLabel: string;
  hold: CoverHold;
  line: string;
};

/** L'objet réel a une image. L'homme à couvert n'en a pas. L'indice, c'est la voiture au seuil. */
export function coverBoard(gsdM: number, layer: SatLayer, vehicles: number): CoverRow[] {
  const g = gsdM > 0 && Number.isFinite(gsdM) ? gsdM : Infinity;
  const seen = (m: number, image: string, blind: string) => {
    const px = m / g;
    const cls = pixelClass(px);
    return {
      px,
      cls,
      clsLabel: PIXEL_CLASS_LABEL[cls],
      image: cls === "aucune" ? blind : image,
    };
  };
  const roof = seen(25, "image du toit et de l'emprise", "bâtiment non séparé");
  const rock = seen(
    2000,
    layer === "ir" || layer === "th" ? "masse thermique du massif" : "image de la face",
    "massif non séparé",
  );
  const shelterSeen = roof.cls !== "aucune" || rock.cls !== "aucune";
  const hold: CoverHold =
    vehicles > 0 && layer === "vis" ? "indice" : shelterSeen ? "possible" : "rien";
  const inside =
    hold === "indice"
      ? `${vehicles} contraste${vehicles > 1 ? "s" : ""} voiture au seuil. Occupation. Le corps n'est pas dans l'image.`
      : hold === "possible"
        ? "Il peut rester dedans. L'image est celle de l'abri, pas la sienne."
        : layer === "ir" || layer === "th"
          ? "Chaleur de la masse, toit ou roche. Pas un corps."
          : "Abri non séparé. Pas d'image d'homme.";
  return [
    {
      id: "batiment",
      label: "Bâtiment",
      hold: roof.cls === "aucune" ? "rien" : "possible",
      line: roof.image,
      ...roof,
    },
    {
      id: "massif",
      label: "Massif",
      hold: rock.cls === "aucune" ? "rien" : "possible",
      line: rock.image,
      ...rock,
    },
    {
      id: "dedans",
      label: "Homme à couvert",
      image: "pas d'image",
      px: 0.5 / g,
      cls: "aucune",
      clsLabel: PIXEL_CLASS_LABEL.aucune,
      hold,
      line: inside,
    },
  ];
}

export type GabaritHit = {
  id: DetectId;
  lat: number;
  lon: number;
  px: number;
  cls: PixelClass;
};

export type FireKind = "vehicule" | "naturel";

export type FireHit = {
  kind: FireKind;
  lat: number;
  lon: number;
  m: number;
};

export type PixelScan = {
  tile: string;
  ready: boolean;
  homme: number;
  voiture: number;
  pirogue: number;
  feuVehicule: number;
  feuNaturel: number;
  hits: GabaritHit[];
  fires: FireHit[];
};

const scanListeners = new Set<() => void>();
let scanState: PixelScan = {
  tile: "",
  ready: false,
  homme: 0,
  voiture: 0,
  pirogue: 0,
  feuVehicule: 0,
  feuNaturel: 0,
  hits: [],
  fires: [],
};
let scanAt = 0;

const CLS_RANK: Record<PixelClass, number> = {
  aucune: 0,
  detection: 1,
  reconnaissance: 2,
  identification: 3,
};

/** Seulement les gabarits trouvés dans les pixels. Zéro n'est pas une ligne. */
export function realDetects(scan: PixelScan): {
  id: DetectId;
  n: number;
  cls: PixelClass;
  clsLabel: string;
  line: string;
}[] {
  const spec: { id: DetectId; n: number; one: string; many: string }[] = [
    { id: "homme", n: scan.homme, one: "homme", many: "hommes" },
    { id: "voiture", n: scan.voiture, one: "voiture", many: "voitures" },
    { id: "pirogue", n: scan.pirogue, one: "pirogue", many: "pirogues" },
  ];
  const out = [];
  for (const s of spec) {
    if (s.n <= 0) continue;
    let cls: PixelClass = "detection";
    for (const h of scan.hits) {
      if (h.id === s.id && CLS_RANK[h.cls] >= CLS_RANK[cls]) cls = h.cls;
    }
    const clsLabel = PIXEL_CLASS_LABEL[cls];
    out.push({
      id: s.id,
      n: s.n,
      cls,
      clsLabel,
      line: `${s.n} ${s.n > 1 ? s.many : s.one} · ${clsLabel}`,
    });
  }
  return out;
}

export function realDetectLine(scan: PixelScan): string {
  return realDetects(scan)
    .map((d) => d.line)
    .join(" · ");
}

export function lastPixelScan(): PixelScan {
  return scanState;
}

export function subscribePixelScan(listener: () => void): () => void {
  scanListeners.add(listener);
  return () => scanListeners.delete(listener);
}

function publishScan(next: PixelScan) {
  const prev = scanState;
  scanState = next;
  scanAt = Date.now();
  if (
    prev.tile === next.tile &&
    prev.ready === next.ready &&
    prev.homme === next.homme &&
    prev.voiture === next.voiture &&
    prev.pirogue === next.pirogue &&
    prev.feuVehicule === next.feuVehicule &&
    prev.feuNaturel === next.feuNaturel
  ) {
    return;
  }
  for (const listener of scanListeners) listener();
}

type CacheVal = HTMLImageElement | "fail";

const g = globalThis as unknown as {
  __vigilairTiles21?: Map<string, CacheVal>;
  __vigilairInflight21?: Set<string>;
  __vigilairTileAttempts21?: Map<string, number>;
};

const cache = (g.__vigilairTiles21 ??= new Map<string, CacheVal>());
const inflight = (g.__vigilairInflight21 ??= new Set<string>());
const attempts = (g.__vigilairTileAttempts21 ??= new Map<string, number>());

function freshBucket(layer: SatLayer): string {
  if (layer === "vis" || layer === "ir" || layer === "th") {
    return String(Math.floor(Date.now() / (15 * 60 * 1000)));
  }
  return "0";
}

function key(layer: SatLayer, z: number, x: number, y: number) {
  return `${layer}/${z}/${x}/${y}/${freshBucket(layer)}`;
}

function localSrc(z: number, x: number, y: number) {
  return `/sentinel/${z}/${x}/${y}.jpg`;
}

/**
 * Mosaïque Sentinel-2 livrée avec le poste (archives AfriControl-2 et AfriControl-3), centrée sur FTTJ.
 * Rectangles complets, relevés sur les fichiers : on ne demande jamais une tuile absente.
 * Elle s'affiche tout de suite, réseau ou pas ; l'imagerie distante la remplace dès qu'elle arrive.
 */
const LOCAL_COVER: { z: number; x0: number; x1: number; y0: number; y1: number }[] = [
  { z: 12, x0: 2216, x1: 2222, y0: 1905, y1: 1912 },
  { z: 10, x0: 550, x1: 558, y0: 473, y1: 481 },
  { z: 8, x0: 133, x1: 143, y0: 113, y1: 124 },
];

const localCache = ((g as { __vigilairLocal21?: Map<string, CacheVal> }).__vigilairLocal21 ??=
  new Map<string, CacheVal>());

function localCovers(z: number, x: number, y: number): boolean {
  return LOCAL_COVER.some((c) => c.z === z && x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
}

function loadLocal(z: number, x: number, y: number) {
  const k = `${z}/${x}/${y}`;
  if (localCache.has(k) || !localCovers(z, x, y)) return;
  localCache.set(k, "fail");
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    localCache.set(k, img);
  };
  img.src = localSrc(z, x, y);
}

function localImg(z: number, x: number, y: number): HTMLImageElement | null {
  const hit = localCache.get(`${z}/${x}/${y}`);
  return hit && hit !== "fail" ? hit : null;
}

/** Demande les tuiles locales utiles à la vue : parents (agrandis) et enfants (réduits, ≤ 3 niveaux). */
function requestLocal(w: number, h: number, z: number, sizeKm: number, origin: GeoOrigin) {
  for (const c of LOCAL_COVER) {
    if (c.z - z > 3) continue;
    const b = tileBounds(w, h, c.z, sizeKm, 24, origin);
    for (let x = Math.max(b.x0, c.x0); x <= Math.min(b.x1, c.x1); x++) {
      for (let y = Math.max(b.y0, c.y0); y <= Math.min(b.y1, c.y1); y++) loadLocal(c.z, x, y);
    }
  }
}

function proxySrc(layer: SatLayer, z: number, x: number, y: number) {
  const bucket = freshBucket(layer);
  const t = bucket === "0" ? "" : `&t=${bucket}`;
  return `/api/tile?l=${layer}&z=${z}&x=${x}&y=${y}${t}`;
}

function load(layer: SatLayer, z: number, x: number, y: number) {
  const k = key(layer, z, x, y);
  if (cache.has(k) || inflight.has(k)) return;
  inflight.add(k);
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  const preferLocal = false;
  let usedProxy = !preferLocal;
  img.onload = () => {
    cache.set(k, img);
    inflight.delete(k);
    attempts.delete(k);
  };
  img.onerror = () => {
    if (!usedProxy) {
      usedProxy = true;
      img.src = proxySrc(layer, z, x, y);
      return;
    }
    inflight.delete(k);
    const n = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, n);
    if (n >= 3) {
      cache.set(k, "fail");
      return;
    }
    window.setTimeout(() => load(layer, z, x, y), 500 * n);
  };
  img.src = preferLocal ? localSrc(z, x, y) : proxySrc(layer, z, x, y);
}

let scratch: HTMLCanvasElement | null = null;

function readFires(
  src: Uint8ClampedArray,
  S: number,
  z: number,
  tx: number,
  ty: number,
  gsd: number,
): Pick<PixelScan, "feuVehicule" | "feuNaturel" | "fires"> {
  const scan = scanFlames(src, S, gsd);
  return {
    feuVehicule: scan.feuVehicule,
    feuNaturel: scan.feuNaturel,
    fires: scan.blobs.map((b) => ({
      kind: b.kind,
      lat: tileToLat(ty + (b.cy + 0.5) / S, z),
      lon: tileToLon(tx + (b.cx + 0.5) / S, z),
      m: b.m,
    })),
  };
}

function measureTile(
  img: HTMLImageElement,
  z: number,
  tx: number,
  ty: number,
  gsd: number,
  water: boolean,
): Pick<PixelScan, "homme" | "voiture" | "pirogue" | "hits" | "feuVehicule" | "feuNaturel" | "fires"> | null {
  const S = 256;
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = S;
  scratch.height = S;
  const c = scratch.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.drawImage(img, 0, 0, S, S);
  let raw: ImageData;
  try {
    raw = c.getImageData(0, 0, S, S);
  } catch {
    return null;
  }
  const src = raw.data;
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    lum[i] = src[o]! * 0.299 + src[o + 1]! * 0.587 + src[o + 2]! * 0.114;
  }
  const stride = S + 1;
  const integ = new Float64Array(stride * stride);
  for (let y = 0; y < S; y++) {
    let row = 0;
    for (let x = 0; x < S; x++) {
      row += lum[y * S + x]!;
      integ[(y + 1) * stride + (x + 1)] = integ[y * stride + (x + 1)]! + row;
    }
  }
  const hot = new Uint8Array(S * S);
  const R = 2;
  for (let y = R; y < S - R; y++) {
    for (let x = R; x < S - R; x++) {
      const x0 = x - R;
      const x1 = x + R;
      const y0 = y - R;
      const y1 = y + R;
      const sum =
        integ[(y1 + 1) * stride + (x1 + 1)]! -
        integ[y0 * stride + (x1 + 1)]! -
        integ[(y1 + 1) * stride + x0]! +
        integ[y0 * stride + x0]!;
      const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      if (Math.abs(lum[y * S + x]! - mean) > 22) hot[y * S + x] = 1;
    }
  }
  const seen = new Uint8Array(S * S);
  const stack: number[] = [];
  let homme = 0;
  let voiture = 0;
  let pirogue = 0;
  const hits: GabaritHit[] = [];
  const hommeCls = pixelSpan(gsd, "homme").cls;
  const voitureCls = pixelSpan(gsd, "voiture").cls;
  const pirogueCls = pixelSpan(gsd, "pirogue").cls;

  for (let start = 0; start < S * S; start++) {
    if (!hot[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    let n = 0;
    let minX = S;
    let minY = S;
    let maxX = 0;
    let maxY = 0;
    let sx = 0;
    let sy = 0;
    let edge = false;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % S;
      const y = (p / S) | 0;
      n++;
      if (x < 2 || y < 2 || x > S - 3 || y > S - 3) edge = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sx += x;
      sy += y;
      const tryPush = (q: number, qx: number) => {
        if (q < 0 || q >= S * S || seen[q] || !hot[q]) return;
        if (Math.abs(qx - x) > 1) return;
        seen[q] = 1;
        stack.push(q);
      };
      tryPush(p - 1, x - 1);
      tryPush(p + 1, x + 1);
      tryPush(p - S, x);
      tryPush(p + S, x);
    }
    if (edge || n < 3 || n > 48) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const major = Math.max(bw, bh);
    const minor = Math.max(1, Math.min(bw, bh));
    if (major < 2 || major > 18) continue;
    const fill = n / (bw * bh);
    if (fill < 0.35) continue;
    const aspect = major / minor;
    const meters = major * gsd;
    let id: DetectId | null = null;
    const cls = pixelClass(major);
    if (cls === "aucune") continue;
    if (hommeCls !== "aucune" && meters >= 0.35 && meters <= 0.9 && aspect < 2.2) {
      id = "homme";
    } else if (voitureCls !== "aucune" && meters >= 3 && meters <= 6.8 && aspect < 2.6) {
      id = "voiture";
    } else if (
      water &&
      pirogueCls !== "aucune" &&
      meters >= 6 &&
      meters <= 16 &&
      aspect >= 1.8 &&
      aspect <= 5.5
    ) {
      id = "pirogue";
    }
    if (!id) continue;
    if (id === "homme") homme++;
    else if (id === "voiture") voiture++;
    else pirogue++;
    if (hits.filter((h) => h.id === id).length < 4 && hits.length < 8) {
      hits.push({
        id,
        lat: tileToLat(ty + (sy / n + 0.5) / S, z),
        lon: tileToLon(tx + (sx / n + 0.5) / S, z),
        px: major,
        cls,
      });
    }
  }
  return { homme, voiture, pirogue, hits, ...readFires(src, S, z, tx, ty, gsd) };
}

/** Contrastes au gabarit sur les tuiles du centre. Un hit = un objet mesuré. */
export function scanCenterTile(
  layer: SatLayer,
  z: number,
  lat: number,
  lon: number,
  water: boolean,
): PixelScan {
  const tx = Math.floor(lonToTileX(lon, z));
  const ty = Math.floor(latToTileY(Math.max(-85, Math.min(85, lat)), z));
  const span = layer === "vis" && z >= 15 ? 1 : 0;
  const tileKey = `${layer}/${z}/${tx}/${ty}/s${span}/${water ? 1 : 0}`;
  const wait = 1000;
  if (scanState.tile === tileKey && Date.now() - scanAt < wait) return scanState;
  const gsd = layer === "vis" ? visGsdM(z, lat) : layerGsd(layer, z, lat).m;
  const optical = layer === "vis" && pixelDetections(gsd, layer).some((d) => d.detected);
  if (!optical || typeof document === "undefined") {
    publishScan({
      tile: tileKey,
      ready: true,
      homme: 0,
      voiture: 0,
      pirogue: 0,
      feuVehicule: 0,
      feuNaturel: 0,
      hits: [],
      fires: [],
    });
    return scanState;
  }
  let homme = 0;
  let voiture = 0;
  let pirogue = 0;
  let feuVehicule = 0;
  let feuNaturel = 0;
  const hits: GabaritHit[] = [];
  const fires: FireHit[] = [];
  let missing = false;
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      const img = cache.get(key(layer, z, x, y));
      if (!img || img === "fail") {
        load(layer, z, x, y);
        if (img !== "fail") missing = true;
        continue;
      }
      const measured = measureTile(img, z, x, y, gsd, water);
      if (!measured) {
        missing = true;
        continue;
      }
      homme += measured.homme;
      voiture += measured.voiture;
      pirogue += measured.pirogue;
      feuVehicule += measured.feuVehicule;
      feuNaturel += measured.feuNaturel;
      for (const h of measured.hits) {
        if (hits.length < 12) hits.push(h);
      }
      for (const f of measured.fires) {
        if (fires.length < 8) fires.push(f);
      }
    }
  }
  publishScan({
    tile: tileKey,
    ready: !missing,
    homme,
    voiture,
    pirogue,
    feuVehicule,
    feuNaturel,
    hits,
    fires,
  });
  return scanState;
}

const PRELOAD: { z: number; x0: number; x1: number; y0: number; y1: number }[] = [
  { z: 5, x0: 15, x1: 19, y0: 13, y1: 17 },
  { z: 3, x0: 0, x1: 7, y0: 1, y1: 6 },
  { z: 2, x0: 0, x1: 3, y0: 0, y1: 3 },
];

export function preloadAoTiles(layer: SatLayer = "vis", maxZ = 12) {
  if (typeof window === "undefined") return;
  for (const b of PRELOAD) {
    if (b.z > maxZ) continue;
    for (let x = b.x0; x <= b.x1; x++) {
      for (let y = b.y0; y <= b.y1; y++) load(layer, b.z, x, y);
    }
  }
}

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function tileBounds(
  w: number,
  h: number,
  z: number,
  sizeKm: number,
  cap: number,
  origin: GeoOrigin = HOME,
) {
  const corners = [
    unproject(0, 0, w, h, sizeKm, origin),
    unproject(w, 0, w, h, sizeKm, origin),
    unproject(0, h, w, h, sizeKm, origin),
    unproject(w, h, w, h, sizeKm, origin),
  ];
  const xs = corners.map((c) => lonToTileX(c.lon, z));
  const ys = corners.map((c) => latToTileY(clampLat(c.lat), z));
  let x0 = Math.max(0, Math.min(...xs));
  let x1 = Math.min(2 ** z - 1, Math.max(...xs));
  let y0 = Math.max(0, Math.min(...ys));
  let y1 = Math.min(2 ** z - 1, Math.max(...ys));
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
    return { x0: 0, x1: -1, y0: 0, y1: -1 };
  }
  if (x1 - x0 > cap) {
    const mid = Math.round((x0 + x1) / 2);
    x0 = Math.max(0, mid - Math.floor(cap / 2));
    x1 = Math.min(2 ** z - 1, x0 + cap);
  }
  if (y1 - y0 > cap) {
    const mid = Math.round((y0 + y1) / 2);
    y0 = Math.max(0, mid - Math.floor(cap / 2));
    y1 = Math.min(2 ** z - 1, y0 + cap);
  }
  return { x0, x1, y0, y1 };
}

function tileCap(z: number): number {
  if (z >= 18) return 18;
  if (z >= 12) return 16;
  if (z >= 11) return 14;
  if (z <= 4) return 16;
  return 12;
}

function layerNative(layer: SatLayer): number {
  if (layer === "ir" || layer === "th" || layer === "nv") return 8;
  if (layer === "rel") return 16;
  return 19;
}

function loadSpan(
  layer: SatLayer,
  z: number,
  w: number,
  h: number,
  sizeKm: number,
  origin: GeoOrigin,
) {
  const b = tileBounds(w, h, z, sizeKm, tileCap(z), origin);
  for (let x = b.x0; x <= b.x1; x++) {
    for (let y = b.y0; y <= b.y1; y++) load(layer, z, x, y);
  }
}

export function requestTiles(
  w: number,
  h: number,
  z: number,
  sizeKm: number,
  layer: SatLayer = "vis",
  origin: GeoOrigin = HOME,
) {
  if (typeof window === "undefined" || w < 8 || h < 8) return;
  const top = Math.min(z, layerNative(layer));
  loadSpan(layer, top, w, h, sizeKm, origin);
  // Au-delà de z17, on demande aussi chaque niveau intermédiaire : si la tuile 0,3 m manque,
  // la 0,6 m (z18) passe avant la 1,2 m (z17).
  if (layer === "vis" && z > 17) {
    for (let lz = z - 1; lz >= 17; lz--) loadSpan(layer, lz, w, h, sizeKm, origin);
  } else if (top > 2 && top === z) loadSpan(layer, top - 1, w, h, sizeKm, origin);
}

function paintTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  sizeKm: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  origin: GeoOrigin,
): boolean {
  const west = tileToLon(x, z);
  const east = tileToLon(x + 1, z);
  const north = tileToLat(y, z);
  const south = tileToLat(y + 1, z);
  const nw = project(north, west, w, h, sizeKm, origin);
  const se = project(south, east, w, h, sizeKm, origin);
  const dw = se.x - nw.x;
  const dh = se.y - nw.y;
  if (dw < 2 || dh < 2) return false;
  const prev = ctx.filter;
  if (paintLayer === "rel") ctx.filter = "contrast(1.18) brightness(1.04)";
  else if (refineTiles && paintLayer === "vis") ctx.filter = "contrast(1.2) saturate(1.16)";
  else if (paintLayer === "vis" && z < 11) ctx.filter = "contrast(1.08) saturate(1.08)";
  else ctx.filter = "none";
  // Agrandissement réel en pixels d'écran (écran Retina/4K : × devicePixelRatio).
  const dpr = ctx.getTransform().a || 1;
  const stretch = Math.max((dw * dpr) / Math.max(sw, 1), (dh * dpr) / Math.max(sh, 1));
  ctx.imageSmoothingEnabled = stretch > 1.4;
  ctx.imageSmoothingQuality = stretch > 1.4 ? "high" : "low";
  ctx.drawImage(img, sx, sy, sw, sh, nw.x, nw.y, dw, dh);
  ctx.filter = prev;
  return true;
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  layer: SatLayer,
  z: number,
  x: number,
  y: number,
  w: number,
  h: number,
  sizeKm: number,
  origin: GeoOrigin,
): boolean {
  const img = cache.get(key(layer, z, x, y));
  if (img && img !== "fail") {
    return paintTile(ctx, img, x, y, z, w, h, sizeKm, 0, 0, img.width, img.height, origin);
  }
  const vis = layer === "vis";
  const own = vis ? localImg(z, x, y) : null;
  if (own) {
    drawnLocal += 1;
    return paintTile(ctx, own, x, y, z, w, h, sizeKm, 0, 0, own.width, own.height, origin);
  }
  let pz = z;
  let px = x;
  let py = y;
  for (let i = 0; i < 16 && pz > 1; i++) {
    pz -= 1;
    px = Math.floor(px / 2);
    py = Math.floor(py / 2);
    const remote = cache.get(key(layer, pz, px, py));
    // Mosaïque locale : agrandie au plus ×32 (z17 depuis z12), et le GSD affiché suit
    // (liveGsd) — jamais maquillée en imagerie 0,3 m.
    const parent =
      remote && remote !== "fail" ? remote : vis && z - pz <= 5 ? localImg(pz, px, py) : null;
    if (!parent) continue;
    if (parent !== remote) drawnLocal += 1;
    const factor = 2 ** (z - pz);
    const srcW = parent.width / factor;
    const srcH = parent.height / factor;
    if (srcW < 4 || srcH < 4) {
      return paintTile(ctx, parent, px, py, pz, w, h, sizeKm, 0, 0, parent.width, parent.height, origin);
    }
    const srcX = (x % factor) * srcW;
    const srcY = (y % factor) * srcH;
    return paintTile(ctx, parent, x, y, z, w, h, sizeKm, srcX, srcY, srcW, srcH, origin);
  }
  // Vue large sans imagerie distante : la mosaïque locale, plus fine, réduite à l'échelle.
  if (!vis) return false;
  let painted = false;
  for (const c of LOCAL_COVER) {
    if (c.z <= z || c.z - z > 3) continue;
    const f = 2 ** (c.z - z);
    for (let cx = Math.max(x * f, c.x0); cx <= Math.min(x * f + f - 1, c.x1); cx++) {
      for (let cy = Math.max(y * f, c.y0); cy <= Math.min(y * f + f - 1, c.y1); cy++) {
        const child = localImg(c.z, cx, cy);
        if (!child) continue;
        if (paintTile(ctx, child, cx, cy, c.z, w, h, sizeKm, 0, 0, child.width, child.height, origin)) {
          painted = true;
        }
      }
    }
    if (painted) {
      drawnLocal += 1;
      return true;
    }
  }
  return false;
}

export function drawTiles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  z: number,
  sizeKm: number,
  layer: SatLayer = "vis",
  origin: GeoOrigin = HOME,
) {
  paintLayer = layer;
  drawnLocal = 0;
  requestTiles(w, h, z, sizeKm, layer, origin);
  if (layer === "vis") requestLocal(w, h, z, sizeKm, origin);
  let drawZ = z;
  if (layer === "vis" && z > 17) {
    // Le niveau le plus fin réellement reçu au centre de la vue : z19, sinon z18, sinon z17.
    drawZ = 17;
    for (let lz = z; lz > 17; lz--) {
      const hit = cache.get(key(layer, lz, Math.floor(lonToTileX(origin.lon, lz)), Math.floor(latToTileY(origin.lat, lz))));
      if (hit && hit !== "fail") {
        drawZ = lz;
        break;
      }
    }
  }
  const cap = tileCap(drawZ);
  const b = tileBounds(w, h, drawZ, sizeKm, cap, origin);
  if (b.x1 < b.x0) return 0;
  let drawn = 0;
  for (let x = b.x0; x <= b.x1; x++) {
    for (let y = b.y0; y <= b.y1; y++) {
      if (drawOne(ctx, layer, drawZ, x, y, w, h, sizeKm, origin)) drawn += 1;
    }
  }
  lastLocalShare = drawn > 0 ? drawnLocal / drawn : 0;
  const dominant = layer === "vis" && lastLocalShare > 0.5;
  if (dominant !== localDominant) {
    localDominant = dominant;
    for (const l of localListeners) l();
  }
  return drawn;
}

let drawnLocal = 0;
let lastLocalShare = 0;
let localDominant = false;
const localListeners = new Set<() => void>();
const LOCAL_MAX_Z = 12;

/** La carte affiche-t-elle surtout la mosaïque locale ? Pour les bandeaux React (GSD, légende). */
export function subscribeLocalImagery(listener: () => void): () => void {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

export function localImageryDominant(): boolean {
  return localDominant;
}

/** Part de la dernière image venue de la mosaïque locale (0 à 1) : le crédit le dit franchement. */
export function localImageryShare(): number {
  return lastLocalShare;
}

// Tuiles z12 de 256 px : ≈ 37 m/px à la latitude de N'Djamena, même si la source Sentinel-2 est à 10 m.
export const LOCAL_CREDIT =
  "Mosaïque Sentinel-2 locale · 37 m/px au mieux · hors ligne · pas une prise du jour";

export function preloadAt(lat: number, lon: number, z = 17, layer: SatLayer = "vis") {
  if (typeof window === "undefined") return;
  const cx = lonToTileX(lon, z);
  const cy = latToTileY(lat, z);
  const span = z >= 15 ? 2 : 3;
  for (let x = cx - span; x <= cx + span; x++) {
    for (let y = cy - span; y <= cy + span; y++) load(layer, z, x, y);
  }
  if (z > 12) {
    const px = lonToTileX(lon, 12);
    const py = latToTileY(lat, 12);
    for (let x = px - 2; x <= px + 2; x++) {
      for (let y = py - 2; y <= py + 2; y++) load(layer, 12, x, y);
    }
  }
}

export function tileRef(lat: number, lon: number, z = 10): string {
  return `z${z}/${lonToTileX(lon, z)}/${latToTileY(lat, z)}`;
}

let paintLayer: SatLayer = "vis";
let refineTiles = false;

export function setTileRefine(on: boolean): void {
  refineTiles = on;
}

export function clearTileCache(): void {
  cache.clear();
}

export function tilesReady(): number {
  let n = 0;
  for (const v of cache.values()) if (v !== "fail") n += 1;
  return n;
}

if (typeof window !== "undefined") {
  preloadAoTiles("vis", 6);
  window.setTimeout(() => {
    preloadAoTiles("ir", 5);
    preloadAoTiles("th", 5);
  }, 4000);
}
