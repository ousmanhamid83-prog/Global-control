import { formatGsdM, latToTileY, lonToTileX, tileToLat, tileToLon, visGsdM } from "./geo";
import { sceneAgeLabel, type SatLayer, type SatMeta } from "./sat";
import { scanFlames } from "./flame";
import { garderTraces } from "./traces-gabarit";
import { creerFile, type FileTuiles } from "./file-tuiles";
import { couvre, type RectTuiles } from "./mosaique-couverture";

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
  _src?: string | null,
): GsdRead {
  // Hors ligne, l'image affichée est la mosaïque locale : on lit son pas réel, pas celui du zoom.
  if (layer === "vis" && localDominant) return layerGsd(layer, Math.min(z, localMaxZ), lat);
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
  /** Contraste moyen de la trace (écart à la moyenne locale, en niveaux de gris) : les plus nettes sont montrées. */
  force: number;
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
  __vigilairFileTuiles?: FileTuiles;
};

const cache = (g.__vigilairTiles21 ??= new Map<string, CacheVal>());
const inflight = (g.__vigilairInflight21 ??= new Set<string>());
const attempts = (g.__vigilairTileAttempts21 ??= new Map<string, number>());
/** Quatre tuiles distantes en vol au plus : deux connexions restent à la console (file-tuiles). */
const fileTuiles = (g.__vigilairFileTuiles ??= creerFile(4));

function freshBucket(layer: SatLayer): string {
  if (layer === "vis" || layer === "ir" || layer === "th") {
    return String(Math.floor(Date.now() / (15 * 60 * 1000)));
  }
  return "0";
}

function key(layer: SatLayer, z: number, x: number, y: number) {
  return `${layer}/${z}/${x}/${y}/${freshBucket(layer)}`;
}

export function urlMosaique(z: number, x: number, y: number): string {
  // Lue sur le disque par le serveur à chaque demande : une mosaïque installée après le build
  // s'affiche aussi (servie en fichier statique, elle renvoyait 404 en production).
  return `/api/mosaique?z=${z}&x=${x}&y=${y}`;
}

/**
 * Mosaïque locale du poste (imagerie hors ligne). Sa couverture n'est plus un carré figé autour de
 * FTTJ : le serveur la relève dans les fichiers présents (mosaique-couverture), si bien que toute
 * zone installée s'affiche hors ligne. Exacte : on ne demande jamais une tuile absente. Elle
 * s'affiche tout de suite, réseau ou pas ; l'imagerie distante la remplace dès qu'elle arrive.
 */
let localCover: RectTuiles[] = [];
/** Zoom le plus fin de la mosaïque locale (12 tant que rien n'est relevé, comme les packs livrés). */
let localMaxZ = 12;
let couvertureDemandeeA = 0;
/** Relevée au premier dessin puis toutes les 5 min : une zone installée en cours de route apparaît. */
const RELEVE_COUVERTURE_MS = 5 * 60_000;

function releverCouverture() {
  if (typeof window === "undefined") return;
  const maintenant = Date.now();
  if (maintenant - couvertureDemandeeA < RELEVE_COUVERTURE_MS) return;
  couvertureDemandeeA = maintenant;
  fetch("/api/mosaique-couverture")
    .then((r) => (r.ok ? r.json() : null))
    .then((c: { rects?: RectTuiles[]; zMax?: number } | null) => {
      if (!c?.rects) return;
      localCover = c.rects;
      if (c.zMax) localMaxZ = c.zMax;
    })
    .catch(() => {
      // Serveur pas encore prêt : nouvel essai dans 30 s plutôt que dans 5 min.
      couvertureDemandeeA = maintenant - RELEVE_COUVERTURE_MS + 30_000;
    });
}

/** La mosaïque locale a-t-elle cette tuile ? La carte ne demande jamais une tuile absente. */
export function mosaiqueCouvre(z: number, x: number, y: number): boolean {
  releverCouverture();
  return couvre(localCover, z, x, y);
}

/** Étendue de la mosaïque locale : zooms et rectangles de tuiles relevés sur le disque du poste. */
export function etendueMosaique(): { zMin: number; zMax: number; rects: readonly RectTuiles[] } {
  releverCouverture();
  const zMin = localCover.length ? Math.min(...localCover.map((r) => r.z)) : localMaxZ;
  return { zMin, zMax: localMaxZ, rects: localCover };
}

/**
 * L'adresse des tuiles d'une couche, à remplir ({z}, {x}, {y}) : la carte la donne à sa source. Le
 * « seau » de fraîcheur change tous les quarts d'heure pour les couches du jour (visible, IR, thermique).
 */
export function modeleTuiles(layer: SatLayer): string {
  const bucket = freshBucket(layer);
  const t = bucket === "0" ? "" : `&t=${bucket}`;
  return `/api/tile?l=${layer}&z={z}&x={x}&y={y}${t}`;
}

/**
 * Une tuile demandée par la carte passe par la même file que les autres (au plus 4 en vol, la plus
 * récente d'abord) : la console garde ses connexions au poste. Abandonnée avant son tour (la vue a
 * bougé), elle ne part pas.
 */
export function tuileEnFile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    fileTuiles.lancer(() => {
      if (signal.aborted) {
        fileTuiles.finie();
        reject(new DOMException("tuile abandonnée", "AbortError"));
        return;
      }
      fetch(url, { signal })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tuile refusée (${r.status})`))))
        .then(resolve, reject)
        .finally(() => fileTuiles.finie());
    });
  });
}

function proxySrc(layer: SatLayer, z: number, x: number, y: number) {
  return modeleTuiles(layer).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function load(layer: SatLayer, z: number, x: number, y: number) {
  const k = key(layer, z, x, y);
  if (cache.has(k) || inflight.has(k)) return;
  inflight.add(k);
  fileTuiles.lancer(() => charger(layer, z, x, y, k));
}

function charger(layer: SatLayer, z: number, x: number, y: number, k: string) {
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    fileTuiles.finie();
    cache.set(k, img);
    inflight.delete(k);
    attempts.delete(k);
  };
  img.onerror = () => {
    fileTuiles.finie();
    inflight.delete(k);
    const n = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, n);
    if (n >= 3) {
      cache.set(k, "fail");
      // Pas de couverture à ce zoom (site isolé : l'imagerie gratuite n'a pas le 0,3 m partout) :
      // on demande le parent, plus grossier mais existant, pour montrer la meilleure imagerie
      // disponible au lieu du vide. Le GSD affiché suivra le zoom réellement obtenu (honnête).
      if (layer === "vis" && z > 12) load(layer, z - 1, Math.floor(x / 2), Math.floor(y / 2));
      return;
    }
    window.setTimeout(() => load(layer, z, x, y), 500 * n);
  };
  img.src = proxySrc(layer, z, x, y);
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
  const contraste = new Float32Array(S * S);
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
      contraste[y * S + x] = Math.abs(lum[y * S + x]! - mean);
      if (contraste[y * S + x]! > 22) hot[y * S + x] = 1;
    }
  }
  const seen = new Uint8Array(S * S);
  const stack: number[] = [];
  let homme = 0;
  let voiture = 0;
  let pirogue = 0;
  const candidates: GabaritHit[] = [];
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
    let somme = 0;
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
      somme += contraste[p]!;
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
    candidates.push({
      id,
      lat: tileToLat(ty + (sy / n + 0.5) / S, z),
      lon: tileToLon(tx + (sx / n + 0.5) / S, z),
      px: major,
      cls,
      force: somme / n,
    });
  }
  // Les comptes ci-dessus sont les totaux ; la carte en montre les plus nettes, pas les premières lues.
  const hits = garderTraces(candidates, { parSorte: 4, total: 8 });
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
      hits.push(...measured.hits);
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
    hits: garderTraces(hits, { total: 12 }),
    fires,
  });
  return scanState;
}

let localDominant = false;
const localListeners = new Set<() => void>();

/** La carte affiche-t-elle surtout la mosaïque locale ? Pour les bandeaux React (GSD, légende). */
export function subscribeLocalImagery(listener: () => void): () => void {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

/** La carte dit si l'image qu'elle montre vient surtout de la mosaïque locale (réseau absent). */
export function signalerImagerieLocale(dominant: boolean): void {
  if (dominant === localDominant) return;
  localDominant = dominant;
  for (const l of localListeners) l();
}

export function localImageryDominant(): boolean {
  return localDominant;
}

// La résolution réelle dépend du zoom installé et de la latitude : le bandeau GSD l'affiche (liveGsd),
// le crédit ne promet donc pas un chiffre qui ne vaudrait qu'à N'Djamena.
export const LOCAL_CREDIT = "Mosaïque Sentinel-2 locale · hors ligne · pas une prise du jour";

export function tileRef(lat: number, lon: number, z = 10): string {
  return `z${z}/${lonToTileX(lon, z)}/${latToTileY(lat, z)}`;
}

let refineTiles = false;

export function setTileRefine(on: boolean): void {
  refineTiles = on;
}

/** L'affinage de l'image (contraste et saturation relevés) est-il demandé ? La carte l'applique. */
export function affinageImagerie(): boolean {
  return refineTiles;
}

export function clearTileCache(): void {
  cache.clear();
}
