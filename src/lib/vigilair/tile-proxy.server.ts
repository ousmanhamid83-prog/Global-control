/** Proxy tuiles same-origin : NASA / EUMETSAT voient l'IP serveur, jamais celle du poste. */

import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tileToLat, tileToLon } from "./geo";
import {
  estTuileGrise,
  missFromStatus,
  verdictTuile,
  zoomFinServable,
  type TileMiss,
} from "./tile-verdict";
import type { SatLayer, SatMeta } from "./sat";

const UA = "AfriControl-COP/21 (C-UAS tiles; no operator identity)";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const EUM = "https://view.eumetsat.int/geoserver/wms";
const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const CLARITY =
  "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile";
const HILL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile";

/**
 * Tuile transparente 1×1 : servie quand l'imagerie géostationnaire n'existe PAS à cette tuile
 * (zoom monde/continent, latitudes polaires). Au lieu d'un 404 qui pollue la console du poste par
 * dizaines à chaque rafraîchissement, le navigateur reçoit une tuile vide propre. Cache court pour
 * qu'un trou passager se rétablisse au relevé suivant. C'est honnête : pas d'imagerie ici = vide.
 */
const EMPTY_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64",
);
function emptyTile(): Response {
  return new Response(EMPTY_TILE, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-AfriControl-Tile": "EMPTY",
    },
  });
}

const ORIGIN_3857 = 20037508.342789244;
const MIN_BYTES = 1500;
const GEO_TTL = 15 * 60 * 1000;
const DAILY_TTL = 3 * 60 * 60 * 1000;

type CacheVal = { bytes: Uint8Array; at: number; via: string; mime: string; scene: string };

const g = globalThis as unknown as {
  __vigilairTileProxy21?: Map<string, CacheVal>;
  __vigilairTileHits?: { t: number; n: number };
  __vigilairGibsDate?: { date: string; at: number };
  __vigilairSatMeta?: SatMeta;
  __vigilairGeoSlot?: { goes: string; hima: string; mtg: string; at: number };
  __vigilairEumQ?: { n: number; wait: Array<() => void> };
};

const cache = (g.__vigilairTileProxy21 ??= new Map());
const hits = (g.__vigilairTileHits ??= { t: Date.now(), n: 0 });
const eumQ = (g.__vigilairEumQ ??= { n: 0, wait: [] });
const meta = (g.__vigilairSatMeta ??= {
  visAt: null,
  s2At: null,
  irAt: null,
  thAt: null,
  nvAt: null,
  relAt: null,
  visSrc: "",
  s2Src: "",
  irSrc: "",
  thSrc: "",
  nvSrc: "",
  relSrc: "",
});

function inWorld(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  // z19 = vue « 0,3 m » : Esri la sert sur les villes ; la refuser ici bridait la vue la plus nette.
  if (z < 1 || z > 19) return false;
  const max = 2 ** z;
  if (x < 0 || y < 0 || x >= max || y >= max) return false;
  const lat = (tileToLat(y, z) + tileToLat(y + 1, z)) / 2;
  return Number.isFinite(lat) && lat >= -85 && lat <= 85;
}

function rateOk(): boolean {
  const now = Date.now();
  if (now - hits.t > 1000) {
    hits.t = now;
    hits.n = 0;
  }
  hits.n += 1;
  return hits.n <= 240;
}

function tileLon(z: number, x: number): number {
  return (tileToLon(x, z) + tileToLon(x + 1, z)) / 2;
}

function tileLat(z: number, y: number): number {
  return (tileToLat(y, z) + tileToLat(y + 1, z)) / 2;
}

type Bird = "goesw" | "goese" | "mtg" | "hima";

function birdOf(lon: number): Bird {
  if (lon < -105) return "goesw";
  if (lon < -25) return "goese";
  if (lon < 75) return "mtg";
  return "hima";
}

function tenMinSlots(): string[] {
  const now = Date.now();
  const step = 10 * 60 * 1000;
  const start = now - (now % step) - 20 * 60 * 1000;
  const out: string[] = [];
  for (let t = start; now - t <= 60 * 60 * 1000 && out.length < 5; t -= step) {
    out.push(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return out;
}

function eumTime(isoZ: string): string {
  return isoZ.replace("Z", ".000Z");
}

function dailyDates(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (const back of [1, 2, 0, 3]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function bbox3857(z: number, x: number, y: number): string {
  const n = 2 ** z;
  const size = (ORIGIN_3857 * 2) / n;
  const minx = -ORIGIN_3857 + x * size;
  const maxx = minx + size;
  const maxy = ORIGIN_3857 - y * size;
  const miny = maxy - size;
  return `${minx},${miny},${maxx},${maxy}`;
}

function sniff(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  return "image/jpeg";
}

function usable(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_BYTES) return false;
  if (bytes[0] === 0x3c) return false;
  return true;
}

/**
 * Pourquoi la tuile demandée n'a rien donné. Un `null` seul écrasait « il a répondu qu'il n'a
 * rien » et « je n'ai pas pu le joindre » — or peindre la seconde en terrain vide rend la carte
 * aveugle sans le dire.
 *
 * Le motif vit dans un CONTEXTE ASYNCHRONE propre à chaque requête, pas dans une variable de
 * module : `serveTile` attend plusieurs fournisseurs, donc deux tuiles demandées en même temps
 * s'entrelacent et se voleraient leur motif. Au passage, aucune signature n'a besoin de changer
 * dans les huit fonctions qui descendent jusqu'à `fetchImg`.
 */
const motifTuile = new AsyncLocalStorage<{ why: TileMiss }>();

/**
 * Note un motif d'échec. « injoignable » ne redescend JAMAIS à « absente » : il suffit qu'un seul
 * fournisseur ait été hors d'atteinte pour qu'on refuse d'affirmer qu'il n'y a rien ici.
 */
function noteMiss(why: TileMiss): void {
  const box = motifTuile.getStore();
  // La règle « un seul injoignable suffit » vit dans une seule fonction pure, testée à part.
  if (box) box.why = verdictTuile([box.why, why]);
}

/** Verdict de la requête en cours. */
function motifCourant(): TileMiss {
  return motifTuile.getStore()?.why ?? "absente";
}

/**
 * Réponse quand aucun fournisseur n'a rendu d'imagerie : tuile vide si tous ont répondu « rien
 * ici » (fait de terrain, et pas de 404 par dizaines dans la console du poste), erreur visible si
 * l'un d'eux était injoignable (fait sur NOUS, que l'opérateur doit voir).
 */
function sansImagerie(): Response {
  if (motifCourant() === "injoignable") {
    return new Response(null, { status: 502, headers: { "X-AfriControl-Tile": "INJOIGNABLE" } });
  }
  return emptyTile();
}

async function fetchImg(
  url: string,
  ms = 9000,
): Promise<{ bytes: Uint8Array; scene: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "image/jpeg,image/png,image/*", "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) {
      noteMiss(missFromStatus(res.status));
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!usable(buf)) {
      // Réponse reçue mais inexploitable (page d'erreur, corps vide) : le fournisseur a parlé,
      // il n'a simplement pas d'image ici.
      noteMiss("absente");
      return null;
    }
    const warning = res.headers.get("warning") ?? "";
    const fromWarn = warning.match(/time=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    const scene =
      res.headers.get("layer-time-actual") ||
      (fromWarn ? `${fromWarn[1]}Z` : "");
    return { bytes: buf, scene };
  } catch {
    // Réseau coupé, délai dépassé, TLS refusé : nous n'avons PAS pu regarder.
    noteMiss("injoignable");
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function withEum<T>(fn: () => Promise<T>): Promise<T> {
  if (eumQ.n >= 6) {
    await new Promise<void>((resolve) => eumQ.wait.push(resolve));
  }
  eumQ.n += 1;
  try {
    return await fn();
  } finally {
    eumQ.n -= 1;
    const next = eumQ.wait.shift();
    if (next) next();
  }
}

function newer(a: string | null, b: string): boolean {
  if (!a) return true;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(db)) return false;
  if (!Number.isFinite(da)) return true;
  return db >= da;
}

function note(layer: SatLayer, scene: string, src: string) {
  if (!scene) return;
  const iso = scene.endsWith("Z") ? scene : `${scene}Z`;
  if (layer === "vis") {
    if (newer(meta.visAt, iso)) {
      meta.visAt = iso;
      meta.visSrc = src;
    }
  } else if (layer === "s2") {
    if (newer(meta.s2At, iso)) {
      meta.s2At = iso;
      meta.s2Src = src;
    }
  } else if (layer === "ir") {
    if (newer(meta.irAt, iso)) {
      meta.irAt = iso;
      meta.irSrc = src;
    }
  } else if (layer === "th") {
    if (newer(meta.thAt, iso)) {
      meta.thAt = iso;
      meta.thSrc = src;
    }
  } else if (layer === "nv") {
    if (newer(meta.nvAt, iso)) {
      meta.nvAt = iso;
      meta.nvSrc = src;
    }
  } else if (newer(meta.relAt, iso)) {
    meta.relAt = iso;
    meta.relSrc = src;
  }
}

async function localTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const file = path.join(process.cwd(), "public", "sentinel", String(z), String(x), `${y}.jpg`);
  try {
    const buf = await readFile(file);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function eumTile(layer: string, z: number, x: number, y: number, slots: string[]) {
  return withEum(async () => {
    for (const slot of slots) {
      const url =
        `${EUM}?service=WMS&version=1.3.0&request=GetMap&layers=${layer}` +
        `&crs=EPSG:3857&bbox=${bbox3857(z, x, y)}&width=256&height=256` +
        `&format=image/jpeg&styles=&time=${eumTime(slot)}`;
      const got = await fetchImg(url, 10000);
      if (got) return { ...got, slot };
    }
    return null;
  });
}

async function gibsGeo(
  layer: string,
  matrix: string,
  z: number,
  x: number,
  y: number,
  slots: string[],
) {
  if (z < 1 || z > Number(matrix.replace(/\D/g, "") || 7)) return null;
  for (const slot of slots) {
    const url = `${GIBS}/${layer}/default/${slot}/${matrix}/${z}/${y}/${x}.png`;
    const got = await fetchImg(url);
    if (got) return { ...got, slot };
  }
  return null;
}

async function gibsDaily(layer: string, matrix: string, z: number, x: number, y: number) {
  const maxZ = Number(matrix.replace(/\D/g, "") || 7);
  if (z < 1 || z > maxZ) return null;
  const remembered = g.__vigilairGibsDate;
  const dates = dailyDates();
  const ordered =
    remembered && Date.now() - remembered.at < 6 * 60 * 60 * 1000
      ? [remembered.date, ...dates.filter((d) => d !== remembered.date)]
      : dates;
  for (const date of ordered) {
    const url = `${GIBS}/${layer}/default/${date}/${matrix}/${z}/${y}/${x}.jpg`;
    let got = await fetchImg(url);
    if (!got) {
      got = await fetchImg(url.replace(/\.jpg$/, ".png"));
    }
    if (got) {
      g.__vigilairGibsDate = { date, at: Date.now() };
      return { ...got, slot: `${date}T00:00:00Z` };
    }
  }
  return null;
}

/**
 * Tuile d'imagerie fine, avec le MOTIF de l'échec. Les fournisseurs annoncent « je n'ai rien ici »
 * de deux façons — un 404, ou une tuile grise « Map data not yet available » de quelques kilo-
 * octets — et il ne faut peindre ni l'une ni l'autre comme du 30 cm. Mesuré sur N'Djamena :
 * 2 521 octets au zoom 19 et 5 153 au zoom 18 pour le gris, contre 15 237 pour de la vraie imagerie
 * au même zoom sur le centre-ville.
 */
async function esriTile(z: number, x: number, y: number) {
  if (!zoomFinServable(z)) {
    noteMiss("absente");
    return null;
  }
  const got = await fetchImg(`${ESRI}/${z}/${y}/${x}`, 12000);
  if (!got) return null;
  if (estTuileGrise(got.bytes.byteLength)) {
    noteMiss("absente");
    return null;
  }
  return got;
}

async function clarityTile(z: number, x: number, y: number) {
  if (!zoomFinServable(z)) {
    noteMiss("absente");
    return null;
  }
  const got = await fetchImg(`${CLARITY}/${z}/${y}/${x}`, 10000);
  if (!got) return null;
  if (estTuileGrise(got.bytes.byteLength)) {
    noteMiss("absente");
    return null;
  }
  return got;
}

async function gibsOnce(
  layer: string,
  matrix: string,
  z: number,
  x: number,
  y: number,
  date: string,
  ext: "jpg" | "png",
) {
  const maxZ = Number(matrix.replace(/\D/g, "") || 7);
  if (z < 1 || z > maxZ) return null;
  const url = `${GIBS}/${layer}/default/${date}/${matrix}/${z}/${y}/${x}.${ext}`;
  const got = await fetchImg(url);
  if (!got) return null;
  return { ...got, slot: `${date}T00:00:00Z` };
}

async function nightTile(z: number, x: number, y: number) {
  if (z < 1 || z > 8) return null;
  const n20 = await gibsDaily(
    "VIIRS_NOAA20_DayNightBand_AtSensor_M15",
    "GoogleMapsCompatible_Level8",
    z, x, y,
  );
  if (n20) return { ...n20, src: "VIIRS NOAA-20 Black Marble", archive: false };
  const snpp = await gibsDaily(
    "VIIRS_SNPP_DayNightBand_AtSensor_M15",
    "GoogleMapsCompatible_Level8",
    z, x, y,
  );
  if (snpp) return { ...snpp, src: "VIIRS SNPP Black Marble", archive: false };
  if (z <= 7) {
    const raw = await gibsDaily(
      "VIIRS_NOAA20_DayNightBand",
      "GoogleMapsCompatible_Level7",
      z, x, y,
    );
    if (raw) return { ...raw, src: "VIIRS NOAA-20 DNB", archive: false };
  }
  const bm = await gibsOnce(
    "VIIRS_Black_Marble",
    "GoogleMapsCompatible_Level8",
    z, x, y,
    "2016-01-01",
    "png",
  );
  if (bm) return { ...bm, src: "Black Marble 2016 (archive)", archive: true };
  const city = await fetchImg(
    `${GIBS}/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpg`,
  );
  if (city) {
    return {
      bytes: city.bytes,
      scene: city.scene,
      slot: "2012-01-01T00:00:00Z",
      src: "Earth at Night 2012 (archive)",
      archive: true,
    };
  }
  return null;
}

async function hillshadeTile(z: number, x: number, y: number) {
  if (z < 1 || z > 16) return null;
  const got = await fetchImg(`${HILL}/${z}/${y}/${x}`, 10000);
  if (!got || got.bytes.byteLength < 800) return null;
  return got;
}

async function reliefTile(z: number, x: number, y: number) {
  const hill = await hillshadeTile(z, x, y);
  if (hill) {
    return {
      bytes: hill.bytes,
      scene: hill.scene,
      slot: "mosaic",
      src: "Ombrage Esri ~24 m",
    };
  }
  if (z < 1 || z > 12) return null;
  const nodate = await fetchImg(
    `${GIBS}/ASTER_GDEM_Color_Shaded_Relief/default/GoogleMapsCompatible_Level12/${z}/${y}/${x}.jpg`,
  );
  if (nodate) {
    return {
      bytes: nodate.bytes,
      scene: nodate.scene,
      slot: "2000-01-01T00:00:00Z",
      src: "ASTER GDEM ombrage ~30 m",
    };
  }
  return gibsOnce(
    "ASTER_GDEM_Color_Shaded_Relief",
    "GoogleMapsCompatible_Level12",
    z, x, y,
    "2000-01-01",
    "jpg",
  ).then((got) => (got ? { ...got, src: "ASTER GDEM ombrage ~30 m" } : null));
}

async function geoVisible(z: number, x: number, y: number, slots: string[]) {
  const lat = tileLat(z, y);
  if (Math.abs(lat) > 65) return null;
  const bird = birdOf(tileLon(z, x));
  if (bird === "mtg" && z <= 18) {
    const mtg = await eumTile("mtg_fd:rgb_geocolour", z, x, y, slots);
    if (mtg) return { ...mtg, src: "Meteosat MTG GeoColour" };
    const msg = await eumTile("msg_fes:rgb_natural", z, x, y, slots);
    if (msg) return { ...msg, src: "Meteosat MSG naturel" };
  }
  if (bird === "goese" && z <= 7) {
    const g16 = await gibsGeo(
      "GOES-East_ABI_GeoColor",
      "GoogleMapsCompatible_Level7",
      z, x, y, slots,
    );
    if (g16) return { ...g16, src: "GOES-Est GeoColor" };
  }
  if (bird === "goesw" && z <= 7) {
    const g18 = await gibsGeo(
      "GOES-West_ABI_GeoColor",
      "GoogleMapsCompatible_Level7",
      z, x, y, slots,
    );
    if (g18) return { ...g18, src: "GOES-Ouest GeoColor" };
  }
  if (bird === "hima" && z <= 7) {
    const hi = await gibsGeo(
      "Himawari_AHI_Band3_Red_Visible_1km",
      "GoogleMapsCompatible_Level7",
      z, x, y, slots,
    );
    if (hi) return { ...hi, src: "Himawari visible" };
  }
  return null;
}

async function geoInfrared(z: number, x: number, y: number, slots: string[]) {
  const lat = tileLat(z, y);
  if (Math.abs(lat) > 65) return null;
  const bird = birdOf(tileLon(z, x));
  if (bird === "mtg" && z <= 10) {
    const mtg = await eumTile("mtg_fd:ir105_hrfi", z, x, y, slots);
    if (mtg) return { ...mtg, src: "Meteosat MTG IR 10.5 µm" };
    const msg = await eumTile("msg_fes:ir108", z, x, y, slots);
    if (msg) return { ...msg, src: "Meteosat MSG IR 10.8 µm" };
  }
  if (bird === "goese" && z <= 6) {
    const ir = await gibsGeo(
      "GOES-East_ABI_Band13_Clean_Infrared",
      "GoogleMapsCompatible_Level6",
      z, x, y, slots,
    );
    if (ir) return { ...ir, src: "GOES-Est IR 10.3 µm" };
  }
  if (bird === "goesw" && z <= 6) {
    const ir = await gibsGeo(
      "GOES-West_ABI_Band13_Clean_Infrared",
      "GoogleMapsCompatible_Level6",
      z, x, y, slots,
    );
    if (ir) return { ...ir, src: "GOES-Ouest IR 10.3 µm" };
  }
  if (bird === "hima" && z <= 6) {
    const ir = await gibsGeo(
      "Himawari_AHI_Band13_Clean_Infrared",
      "GoogleMapsCompatible_Level6",
      z, x, y, slots,
    );
    if (ir) return { ...ir, src: "Himawari IR 10.4 µm" };
  }
  return null;
}

function remember(key: string, bytes: Uint8Array, via: string, scene: string): void {
  if (cache.size > 900) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { bytes, at: Date.now(), via, mime: sniff(bytes), scene });
}

function ttlOf(via: string): number {
  if (via.startsWith("GEO") || via.startsWith("EUM") || via === "IR") return GEO_TTL;
  if (via === "LOCAL") return 12 * 60 * 60 * 1000;
  if (via === "S2" || via === "ESRI" || via === "CLARITY") return 6 * 60 * 60 * 1000;
  if (via === "S2LIVE") return 3 * 60 * 60 * 1000;
  if (via === "GDEM" || via === "BMARBLE" || via === "CITY") return 12 * 60 * 60 * 1000;
  return DAILY_TTL;
}

export function satStatus(): SatMeta {
  return { ...meta };
}

/**
 * Chaque requête de tuile reçoit SON contexte de motif. Sans cette enveloppe, deux tuiles
 * demandées en même temps — ce qui est la règle sur une carte — s'entrelaceraient sur un état
 * partagé et se voleraient la raison de leur échec, au point de déguiser une panne en terrain vide.
 */
export function serveTile(
  z: number,
  x: number,
  y: number,
  layer: SatLayer = "vis",
): Promise<Response> {
  return motifTuile.run({ why: "absente" }, () => serveTileInner(z, x, y, layer));
}

async function serveTileInner(
  z: number,
  x: number,
  y: number,
  layer: SatLayer,
): Promise<Response> {
  // Tuile hors du monde : la requête elle-même est fausse, ce n'est pas une absence d'imagerie.
  if (!inWorld(z, x, y)) return new Response(null, { status: 404 });
  const key = `${layer}/${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlOf(hit.via)) {
    return img(hit.bytes, `HIT:${hit.via}`, hit.scene, hit.mime);
  }
  if (!rateOk()) return new Response(null, { status: 429 });

  const slots = tenMinSlots();

  if (layer === "vis") {
    if (z >= 11) {
      // World Imagery d'abord : comparé en réel sur N'Djamena au zoom 19, il est nettement plus
      // précis que Clarity (désormais redirigé vers Wayback, une version plus ancienne et voilée).
      // Clarity ne sert qu'en secours, si World Imagery ne répond pas ou n'a pas la tuile.
      const order: [string, typeof esriTile][] = [
        ["ESRI", esriTile],
        ["CLARITY", clarityTile],
      ];
      for (const [via, fetchTile] of order) {
        const sharp = await fetchTile(z, x, y);
        if (sharp) {
          remember(key, sharp.bytes, via, "mosaic");
          return img(sharp.bytes, via, "mosaic");
        }
      }
      // Aucun fournisseur n'a rendu d'imagerie. Deux cas, qui ne doivent PAS se ressembler :
      //  — tous ont répondu « rien ici » (404, ou leur tuile grise de remplissage) : c'est un fait
      //    de terrain, la tuile vide le dit sans polluer la console de dizaines de 404 à chaque
      //    rafraîchissement — c'est la convention déjà retenue plus bas pour le géostationnaire ;
      //  — l'un d'eux était INJOIGNABLE : on ne peut pas affirmer qu'il n'y a rien à un endroit
      //    qu'on n'a pas pu regarder, donc on laisse une erreur visible plutôt qu'une carte
      //    proprement aveugle.
      return sansImagerie();
    }
    const geo = await geoVisible(z, x, y, slots);
    if (geo) {
      const stamp = geo.slot || geo.scene;
      const t = Date.parse(stamp);
      if (!Number.isFinite(t) || Date.now() - t <= 60 * 60 * 1000) {
        note("vis", stamp, geo.src);
        remember(key, geo.bytes, "GEO", stamp);
        return img(geo.bytes, "GEO", stamp);
      }
    }
    // Pas d'imagerie géostationnaire ici (monde/continent, pôles) : tuile vide, pas un 404 bruyant.
    return emptyTile();
  }

  if (layer === "s2") {
    // Sentinel-2 10 m via le compte Copernicus gratuit de l'opérateur. Natif ~z13 ; au-delà on
    // laisse jusqu'à z15 (suréchantillonné, honnête dans le crédit).
    // REPLI HORS LIGNE : la mosaïque embarquée (public/sentinel) sert quand il n'y a pas de clé, pas
    // de réseau, ou que Copernicus refuse — c'est le cas du poste isolé au bout de l'antenne. Elle est
    // créditée comme telle (« mosaïque embarquée »), jamais présentée comme une image fraîche.
    const offline = async () => {
      const loc = await localTile(z, x, y);
      if (!loc) return null;
      const src = "mosaïque embarquée (hors ligne)";
      meta.s2Src = src;
      remember(key, loc, "S2LOCAL", src);
      return img(loc, "S2LOCAL", src);
    };
    const { sentinelConfigured, sentinelTile } = await import("./sentinelhub.server");
    if (!sentinelConfigured()) {
      const off = await offline();
      if (off) return off;
      meta.s2Src = "clé Copernicus requise (Capteurs > Outils)";
      return new Response(null, { status: 404 });
    }
    // Zoom hors de ce que Sentinel-2 sert : il n'y a pas d'imagerie ici, ce n'est pas une panne.
    if (z < 6 || z > 15) return emptyTile();
    try {
      const s2 = await sentinelTile(z, x, y);
      if (s2) {
        // Pas d'horodatage « maintenant » : un composite n'est pas une prise de l'instant. Le crédit
        // porte la fenêtre réelle (≤ 20 j), pas un faux « < 1 min ».
        meta.s2Src = s2.src;
        remember(key, s2.bytes, "S2LIVE", s2.src);
        return img(s2.bytes, "S2LIVE", s2.src);
      }
    } catch (e) {
      const off = await offline();
      if (off) return off;
      meta.s2Src = `Sentinel-2 · ${e instanceof Error ? e.message : "échec"}`;
      return new Response(null, { status: e instanceof Error && e.message === "429" ? 429 : 502 });
    }
    return (await offline()) ?? sansImagerie();
  }

  if (layer === "ir") {
    const geo = await geoInfrared(z, x, y, slots);
    if (geo) {
      note("ir", geo.slot || geo.scene, geo.src);
      remember(key, geo.bytes, "IR", geo.slot || geo.scene);
      return img(geo.bytes, "IR", geo.slot || geo.scene);
    }
    const b31 = await gibsDaily(
      "MODIS_Terra_Brightness_Temp_Band31_Day",
      "GoogleMapsCompatible_Level7",
      z, x, y,
    );
    if (b31) {
      note("ir", b31.slot, "MODIS B31 (repli)");
      remember(key, b31.bytes, "B31", b31.slot);
      return img(b31.bytes, "B31", b31.slot);
    }
    // Aucun fournisseur thermique n'a rendu cette tuile : vide si tous ont répondu « rien ici »,
    // erreur visible si l'un d'eux était injoignable.
    return sansImagerie();
  }

  if (layer === "nv") {
    const night = await nightTile(z, x, y);
    if (night) {
      if (night.archive) {
        if (!meta.nvSrc) meta.nvSrc = night.src;
      } else {
        note("nv", night.slot || night.scene, night.src);
      }
      const via = night.archive
        ? night.src.startsWith("Earth")
          ? "CITY"
          : "BMARBLE"
        : "DNB";
      remember(key, night.bytes, via, night.slot || night.scene);
      return img(night.bytes, via, night.slot || night.scene);
    }
    return sansImagerie();
  }

  if (layer === "rel") {
    const rel = await reliefTile(z, x, y);
    if (rel) {
      if (!meta.relSrc) meta.relSrc = rel.src;
      remember(key, rel.bytes, "GDEM", rel.slot || rel.scene);
      return img(rel.bytes, "GDEM", rel.slot || rel.scene);
    }
    return sansImagerie();
  }

  const geoTh = await geoInfrared(z, x, y, slots);
  if (z <= 7) {
    const sst = await gibsDaily(
      "GHRSST_L4_MUR_Sea_Surface_Temperature",
      "GoogleMapsCompatible_Level7",
      z, x, y,
    );
    if (sst && sst.bytes.byteLength > 10000) {
      note("th", sst.slot, "GHRSST MUR SST");
      remember(key, sst.bytes, "SST", sst.slot);
      return img(sst.bytes, "SST", sst.slot);
    }
  }
  if (geoTh) {
    note("th", geoTh.slot || geoTh.scene, `${geoTh.src} · thermique`);
    remember(key, geoTh.bytes, "IR", geoTh.slot || geoTh.scene);
    return img(geoTh.bytes, "IR", geoTh.slot || geoTh.scene);
  }
  const lst = await gibsDaily(
    "VIIRS_NOAA20_Land_Surface_Temp_Day",
    "GoogleMapsCompatible_Level7",
    z, x, y,
  );
  if (lst && lst.bytes.byteLength > 4000) {
    note("th", lst.slot, "VIIRS LST");
    remember(key, lst.bytes, "LST", lst.slot);
    return img(lst.bytes, "LST", lst.slot);
  }
  // Couche thermique : mesuré en réel, /api/tile?l=th&z=2 n'existe tout simplement pas chez les
  // fournisseurs — ce n'est pas une panne, et ça n'a rien à faire en 404 dans la console du poste.
  return sansImagerie();
}

function img(bytes: Uint8Array, via: string, scene: string, mime?: string): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime || sniff(bytes),
      "Cache-Control": via.startsWith("GEO") || via === "IR" ? "public, max-age=900" : "public, max-age=1800",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-AfriControl-Tile": via,
      ...(scene ? { "X-AfriControl-Sat": scene } : {}),
    },
  });
}
