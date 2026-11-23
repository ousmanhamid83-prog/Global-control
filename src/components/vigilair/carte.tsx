import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  GeoJSONSource,
  Map as CarteGL,
  MapGeoJSONFeature,
  MapMouseEvent,
  RasterTileSource,
} from "maplibre-gl";
import { copHud, releaseLiveCop, setLiveCop } from "@/components/vigilair/cop-hud";
import {
  AVANT_FONDS,
  lirePalette,
  niveauTuile,
  PROTOCOLE_TUILE,
  styleDeBase,
  viaFile,
  Z,
  type Palette,
  type SourceDonnees,
} from "@/components/vigilair/carte-style";
import { affiliationOf } from "@/lib/vigilair/app6";
import { dessinerIcone, type FormePiste } from "@/lib/vigilair/carte-icones";
import {
  anneauxGeo,
  calageGeo,
  coinsMapLibre,
  collection,
  contoursFondsGeo,
  mesureGeo,
  nosDronesGeo,
  pistesGeo,
  secondesVecteur,
  suivieGeo,
  tracesGeo,
  vecteursGeo,
  zoomPourLargeur,
  type Allure,
  type Collection,
} from "@/lib/vigilair/carte-donnees";
import {
  aeroportGeo,
  axesGeo,
  brouillageGeo,
  captureGeo,
  eauxGeo,
  frontieresGeo,
  hydroGeo,
  meteoGeo,
  minesGeo,
  mondeGeo,
  nomsGeo,
  phenomenesGeo,
  picsGeo,
  pixelsGeo,
  routeNavGeo,
  routesLacGeo,
  zoneGpsGeo,
  zonesGeo,
} from "@/lib/vigilair/carte-theatre";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { COUNTRIES } from "@/lib/vigilair/countries";
import { fondsAPoser, NOMS_COINS, type FondAPoser } from "@/lib/vigilair/drones-dessin";
import type { Coins } from "@/lib/vigilair/drones-fond";
import { dronesPeek } from "@/lib/vigilair/drones";
import { liaisonVivante, nomMode } from "@/lib/vigilair/drones-pilotage";
import { designerPoint, poserCoin, suiviSnapshot } from "@/lib/vigilair/drones-suivi";
import { fireAgeMs, formatFireAge, lockFire } from "@/lib/vigilair/fire-clock";
import { isFriend } from "@/lib/vigilair/friends";
import {
  AES_HULL,
  AO,
  destPoint,
  formatAzimut,
  formatCoord,
  formatGsdM,
  formatRange,
  HOME,
  haversineKm,
  headingBetween,
  isHiResScale,
  isHomeOrigin,
  LAKE_CHAD,
  latToTileY,
  lonToTileX,
  mgrsCompact,
  SAHEL_CITIES,
  SAHEL_STATES,
  SCALE,
  type MapScale,
} from "@/lib/vigilair/geo";
import { HYDRO, hydroKm, waterAt } from "@/lib/vigilair/hydro";
import { positionAntenne } from "@/lib/vigilair/image-poste";
import { LAKE_ROUTES, routeKm } from "@/lib/vigilair/lake-routes";
import { MINES } from "@/lib/vigilair/mines";
import { CONTINENTS, EXTRA_STATES, rankOf, SKIP_LABEL } from "@/lib/vigilair/monde";
import { PASS_LABEL } from "@/lib/vigilair/passability";
import { focusMine, focusWater, placeGpsZone } from "@/lib/vigilair/place-zone";
import { redresser, redressement } from "@/lib/vigilair/redresser";
import { SAT_LAYERS, type SatLayer } from "@/lib/vigilair/sat";
import { peekTracks, threatOf, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { axisLeg, PEAKS, RANGE_AXES } from "@/lib/vigilair/terrain";
import {
  affinageImagerie,
  etendueMosaique,
  LOCAL_CREDIT,
  lastPixelScan,
  liveGsd,
  modeleTuiles,
  mosaiqueCouvre,
  pixelClassLabel,
  satCredit,
  scanCenterTile,
  signalerImagerieLocale,
  tuileEnFile,
  urlMosaique,
} from "@/lib/vigilair/tiles";
import type { Track } from "@/lib/vigilair/types";
import { getLiveZones } from "@/lib/vigilair/zones";
import { cn } from "@/lib/utils";

/** Sans image du poste encore : l'antenne par défaut (FTTJ). */
const ANTENNE_INCONNUE = positionAntenne(null, undefined);

/** Une tuile vide (PNG 1×1 transparent) : ce que rend la mosaïque là où elle n'a rien, sans requête. */
const PNG_VIDE = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
).buffer;

/**
 * Deux protocoles de la carte, posés une fois : « tuile:// » fait passer l'imagerie par la file du
 * poste ; « mosaique:// » ne demande jamais une tuile que la mosaïque locale n'a pas.
 */
let protocoles = false;

async function chargerPolices(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(
    ["500 24px 'IBM Plex Mono'", "400 24px 'IBM Plex Mono'", "600 24px 'IBM Plex Sans'"].map((f) =>
      document.fonts.load(f).catch(() => undefined),
    ),
  );
}

const WINGISH = new Set(["chasse", "fixed-wing", "male", "ucav", "vtol", "loitering"]);

/** L'allure d'une piste : couleur (affiliation APP-6, ou origine), cadre, forme de plateforme. */
function allureDe(t: Track, symboles: boolean, p: Palette): Allure {
  const affil = affiliationOf(t, threatOf(t)).affiliation;
  const ami = isFriend(t);
  const couleurAffil = {
    ami: p.ok,
    hostile: p.crit,
    suspect: p.warn,
    neutre: p.neutre,
    inconnu: p.mutedFg,
  }[affil];
  const origine = t.origin
    ? { CN: p.cn, TR: p.tr, RU: p.ru, IR: p.ir, XX: p.xx }[t.origin]
    : undefined;
  const couleur = symboles ? couleurAffil : ami ? p.ok : (origine ?? p.ice);
  const classe = PLATFORM_BY_ID[t.truePlatformId]?.uasClass;
  const forme: FormePiste =
    t.feed === "adsb"
      ? "adsb"
      : ami
        ? "ami"
        : classe === "chasse"
          ? "chasse"
          : classe && WINGISH.has(classe)
            ? "aile"
            : "tri";
  return { couleur, affil, forme, tourne: !ami || t.feed === "adsb" };
}

type Etat = "attente" | "prete" | "sans-webgl";

type Pointeur = { coord: string; mgrs: string; gsd: string; note: string; poste: string };

/**
 * Ce que l'on lit sous le pointeur : coordonnées, carré MGRS, finesse de l'image ici, distance et
 * azimut depuis FTTJ, et ce qui est proche (pic, mine) avec ce que l'image n'en dit pas.
 */
function lirePointeur(c: CarteGL, x: number, y: number): Pointeur {
  const st = useVigilair.getState();
  const poste = st.livePicture?.antenne ?? ANTENNE_INCONNUE;
  const geo = c.unproject([x, y]);
  const pres = <T extends { lat: number; lon: number }>(
    liste: readonly T[],
    rayon: number,
  ): T | null => {
    let meilleur: { v: T; d: number } | null = null;
    for (const v of liste) {
      const q = c.project([v.lon, v.lat]);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < rayon && (!meilleur || d < meilleur.d)) meilleur = { v, d };
    }
    return meilleur?.v ?? null;
  };
  const zoom = c.getZoom();
  const pics =
    zoom < Z.proche &&
    (st.showPeaks || st.satLayer === "ir" || st.satLayer === "th" || st.satLayer === "rel");
  const pic = pics ? pres(PEAKS, 22) : null;
  const mine = pres(MINES, 18);
  return {
    coord: formatCoord(geo.lat, geo.lng),
    mgrs: mgrsCompact(geo.lat, geo.lng, zoom >= Z.proche ? 5 : 4),
    gsd: liveGsd(st.satLayer, niveauTuile(st.satLayer, zoom), geo.lat, st.satMeta?.visSrc).label,
    note: mine
      ? `${mine.short} · périmètre · pas un homme`
      : pic
        ? `${pic.name} ${pic.elevM} m · pas d'intérieur`
        : "",
    poste: `depuis le poste ${formatRange(haversineKm(poste.lat, poste.lon, geo.lat, geo.lng))}  az ${formatAzimut(headingBetween(poste.lat, poste.lon, geo.lat, geo.lng))}`,
  };
}

/** Un clic : l'outil du chef d'abord, puis ce qui est sous le pointeur (eau, mine, pic, phénomène, piste). */
function cliquer(c: CarteGL, e: MapMouseEvent, choisir: (id: string | null) => void) {
  const geo = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  copHud.cursor = { x: e.point.x, y: e.point.y, ...geo };
  const st = useVigilair.getState();
  if (st.copTool === "mesure") {
    if (!copHud.a || copHud.b) {
      copHud.a = geo;
      copHud.b = null;
    } else copHud.b = geo;
    return;
  }
  if (st.copTool === "zone") return placeGpsZone(geo.lat, geo.lon);
  if (st.copTool === "drone") return designerPoint(geo);
  if (st.copTool === "coins") return poserCoin(geo);
  const pres = (couches: string[], rayon: number): MapGeoJSONFeature | null => {
    const presentes = couches.filter((id) => c.getLayer(id));
    if (presentes.length === 0) return null;
    const trouves = c.queryRenderedFeatures(
      [
        [e.point.x - rayon, e.point.y - rayon],
        [e.point.x + rayon, e.point.y + rayon],
      ],
      { layers: presentes },
    );
    let meilleur: { f: MapGeoJSONFeature; d: number } | null = null;
    for (const f of trouves) {
      if (f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const q = c.project([lon, lat]);
      const d = Math.hypot(q.x - e.point.x, q.y - e.point.y);
      if (d <= rayon && (!meilleur || d < meilleur.d)) meilleur = { f, d };
    }
    return meilleur?.f ?? null;
  };
  if (st.marine) {
    const eau = pres(["hydro-reperes", "hydro-noms"], 16);
    if (eau) return focusWater(String(eau.properties.id));
  }
  const mine = pres(["mines-reperes"], 14);
  if (mine) return focusMine(String(mine.properties.id));
  const pic = pres(["pics"], 14);
  if (pic) return st.setPeakId(String(pic.properties.id));
  const ph = pres(["phenomenes", "feux"], 16);
  if (ph) {
    const phen = st.phenomena.find((x) => x.id === ph.properties.id);
    if (phen) {
      st.openCapture({
        lat: phen.lat,
        lon: phen.lon,
        kind: phen.kind,
        title: phen.title,
        body: phen.body,
        source: phen.source,
        id: `cap-${phen.id}`,
      });
    }
    return;
  }
  const piste = pres(["pistes-formes", "pistes-cadres"], 22);
  choisir(piste ? String(piste.properties.id) : null);
}

/** Un tour : les vraies données du poste, remises à la carte (elle redessine ce qui a changé). */
function mettreAJour(
  c: CarteGL,
  p: Palette,
  fonds: Map<string, string>,
  imagerie: { ok: number; ko: number },
  poserLegende: (l: { echelle: string; credit: string }) => void,
  vue: { selectedId: string | null; fr24: boolean; scale: MapScale | undefined },
) {
  const st = useVigilair.getState();
  const { selectedId: sel, fr24: detail, scale: forcee } = vue;
  const sc = forcee ?? st.mapScale;
  const zoom = c.getZoom();
  const centre = c.getCenter();
  const largeurKm = haversineKm(
    centre.lat,
    c.getBounds().getWest(),
    centre.lat,
    c.getBounds().getEast(),
  );
  const donner = (id: SourceDonnees, d: Collection) =>
    (c.getSource(id) as GeoJSONSource | undefined)?.setData(d as never);
  const niveauZone = (id: string) =>
    st.zonePicture.find((z) => z.zone.id === id)?.level ?? "veille";

  // Imagerie : seau de fraîcheur, affinage, part de la mosaïque locale.
  const couche: SatLayer = st.satLayer;
  const src = c.getSource(`imagerie-${couche}`) as RasterTileSource | undefined;
  const voulu = viaFile(modeleTuiles(couche));
  if (src && src.tiles?.[0] !== voulu) src.setTiles([voulu]);
  const affine = affinageImagerie() && couche === "vis";
  c.setPaintProperty(
    `imagerie-${couche}`,
    "raster-contrast",
    couche === "rel" ? 0.18 : affine ? 0.2 : 0,
  );
  c.setPaintProperty(`imagerie-${couche}`, "raster-saturation", affine ? 0.16 : 0);
  const zTuile = niveauTuile(couche, zoom);
  const zLocal = Math.min(zTuile, etendueMosaique().zMax);
  const mosaiqueAuCentre =
    couche === "vis" &&
    mosaiqueCouvre(
      zLocal,
      Math.floor(lonToTileX(centre.lng, zLocal)),
      Math.floor(latToTileY(centre.lat, zLocal)),
    );
  const locale = mosaiqueAuCentre && imagerie.ko > imagerie.ok;
  signalerImagerieLocale(locale);
  if (imagerie.ok + imagerie.ko > 200) {
    imagerie.ok = Math.round(imagerie.ok / 2);
    imagerie.ko = Math.round(imagerie.ko / 2);
  }

  // Pistes reçues (le rejeu et l'exercice y sont, marqués).
  const symboles = st.ppi.symbols;
  const visibles = peekTracks().filter((t) => trackVisible(t, sel));
  const allure = (t: Track) => allureDe(t, symboles, p);
  const large = zoom < Z.large;
  donner("traces", tracesGeo(visibles, allure));
  donner("vecteurs", vecteursGeo(visibles, secondesVecteur(largeurKm), allure));
  donner(
    "pistes",
    pistesGeo(visibles, {
      selectedId: sel,
      large,
      symboles,
      detaillee: detail || zoom >= Z.proche,
      allure,
      ami: isFriend,
      plateforme: (t) => PLATFORM_BY_ID[t.truePlatformId],
    }),
  );
  const suivie = visibles.find((t) => t.id === sel) ?? visibles.find((t) => t.locked);
  donner("suivie", suivieGeo(suivie && (suivie.locked || suivie.id === sel) ? suivie : undefined));

  // Nos drones, par leur liaison ; l'image de leurs sources entre ses quatre coins.
  const suivi = suiviSnapshot();
  const drones = dronesPeek();
  donner(
    "drones",
    nosDronesGeo(
      suivi.etats.map((e) => ({
        id: e.id,
        vivant: liaisonVivante(e, suivi.a),
        mode: nomMode(e),
        position: e.position,
        depart: e.depart,
      })),
      drones,
      {
        couleur: p.ok,
        muet: p.mutedFg,
        designation: st.copTool === "drone",
        rayonKm: suivi.reglages?.rayonKm ?? null,
        designe: suivi.designe,
      },
    ),
  );
  const aPoser = fondsAPoser(drones, suivi.calage);
  poserFonds(c, aPoser, fonds);
  donner("fonds-contours", contoursFondsGeo(aPoser));
  donner("calage", calageGeo(suivi.calage?.coins ?? [], NOMS_COINS));

  // Le théâtre.
  donner("frontieres", frontieresGeo(COUNTRIES));
  donner(
    "monde",
    mondeGeo(COUNTRIES, EXTRA_STATES, CONTINENTS, { sauf: SKIP_LABEL, rang: rankOf }),
  );
  donner("eaux", eauxGeo({ chari: AO.river, logone: AO.logone, lac: LAKE_CHAD, aes: AES_HULL }));
  donner("noms", nomsGeo(SAHEL_STATES, SAHEL_CITIES));
  const pic = st.livePicture;
  donner("brouillage", brouillageGeo(pic?.jam ?? []));
  donner(
    "meteo",
    meteoGeo(
      (pic?.metar ?? []).filter((m) => !(zoom >= Z.proche && m.icao === "FTTJ")),
      pic?.sigmets ?? [],
      { ok: p.ok, warn: p.warn, crit: p.crit },
    ),
  );
  donner(
    "routes-lac",
    routesLacGeo(LAKE_ROUTES, {
      routeId: st.lakeRouteId,
      km: (id) => routeKm(LAKE_ROUTES.find((r) => r.id === id)!),
    }),
  );
  donner(
    "hydro",
    st.marine
      ? hydroGeo(HYDRO, {
          waterId: st.waterId,
          km: (id) => hydroKm(HYDRO.find((h) => h.id === id)!),
        })
      : collection([]),
  );
  donner("zones", zonesGeo(getLiveZones(), niveauZone));
  donner("mines", minesGeo(MINES, { mineId: st.mineId, niveau: niveauZone }));
  donner(
    "axes",
    axesGeo(AO.airport, RANGE_AXES, {
      axisId: st.axisId,
      km: (a) => axisLeg(RANGE_AXES.find((x) => x.id === a.id)!).km,
    }),
  );
  const pics =
    zoom < Z.proche &&
    (st.showPeaks || st.satLayer === "ir" || st.satLayer === "th" || st.satLayer === "rel");
  donner(
    "pics",
    pics
      ? picsGeo(PEAKS, {
          peakId: st.peakId,
          couleur: st.satLayer === "ir" || st.satLayer === "th" ? p.warn : p.ice,
        })
      : collection([]),
  );
  donner("route-nav", routeNavGeo(st.navRoute));
  const gz = st.gpsZone;
  donner(
    "zone-gps",
    zoneGpsGeo(
      gz
        ? {
            lat: gz.lat,
            lon: gz.lon,
            radiusKm: gz.radiusKm,
            nom: `${gz.name} · ${PASS_LABEL[gz.mode]}`,
            coord: formatCoord(gz.lat, gz.lon),
          }
        : null,
    ),
  );
  for (const ph of st.phenomena)
    if (ph.kind === "feu" && ph.source === "NASA FIRMS") lockFire(ph.id);
  donner(
    "phenomenes",
    phenomenesGeo(st.phenomena, {
      ageFeu: (id) => formatFireAge(fireAgeMs(id, Date.now()) ?? 0),
      couleurs: { crit: p.crit, warn: p.warn, ice: p.ice },
    }),
  );
  donner(
    "capture",
    captureGeo(st.capture ? { ...st.capture, gsd: formatGsdM(st.capture.gsdM) } : null),
  );
  const fttj = pic?.metar?.find((m) => m.icao === "FTTJ");
  donner(
    "aeroport",
    aeroportGeo(AO.airport, fttj?.cat ?? null, (cap) =>
      destPoint(AO.airport.lat, AO.airport.lon, cap, 1.4),
    ),
  );
  // Anneaux : autour de l'antenne du poste (son radar), ou du point regardé quand on a quitté la vue
  // du poste.
  const autour =
    st.capture || !isHomeOrigin(st.viewOrigin)
      ? isHiResScale(sc)
        ? st.viewOrigin
        : HOME
      : (pic?.antenne ?? ANTENNE_INCONNUE);
  donner("anneaux", sc === "monde" ? collection([]) : anneauxGeo(autour, SCALE[sc].rings));
  donner("mesure", mesureGeo(copHud.a, copHud.b, st.copTool === "mesure" ? copHud.cursor : null));

  // Analyse des pixels de l'image au centre (bandeau « poste de tâche ») et légende sous la carte.
  const surEau =
    st.marine || !!st.lakeRouteId || !!st.waterId || waterAt(centre.lat, centre.lng) != null;
  scanCenterTile(couche, zTuile, centre.lat, centre.lng, surEau);
  if (zoom >= Z.proche && couche === "vis") {
    const scan = lastPixelScan();
    for (const f of scan.fires) lockFire(`px-${f.lat.toFixed(3)}-${f.lon.toFixed(3)}`);
    donner(
      "pixels",
      pixelsGeo(scan, {
        classe: (cls) => pixelClassLabel(cls as Parameters<typeof pixelClassLabel>[0]),
        ageFeu: (id) => formatFireAge(fireAgeMs(id, Date.now()) ?? 0),
      }),
    );
  } else donner("pixels", collection([]));
  const gsd = liveGsd(couche, zTuile, centre.lat, st.satMeta?.visSrc);
  const vec = secondesVecteur(largeurKm);
  const echelle = `${SCALE[sc].label} · ${gsd.label} · vecteur ${vec < 60 ? `${vec} s` : `${vec / 60} min`}`;
  const credit = locale ? LOCAL_CREDIT : satCredit(zTuile, couche, st.satMeta);
  poserLegende({ echelle, credit });
  const div = c.getContainer();
  div.dataset.pistes = String(visibles.length);
  div.dataset.drones = String(suivi.etats.filter((e) => e.position).length);
  div.dataset.fonds = String(aPoser.length);
  div.dataset.zoom = zoom.toFixed(4);
  div.dataset.centre = `${centre.lat.toFixed(7)},${centre.lng.toFixed(7)}`;
}

/**
 * L'image d'une source prête pour MapLibre, et les coins où la poser : telle quelle si ses deux
 * triangles la posent juste, sinon redressée en perspective dans le rectangle qui l'englobe.
 */
function canevasFond(f: FondAPoser): { canevas: HTMLCanvasElement; coins: Coins } | null {
  const { image } = f;
  const plan = redressement(f.coins, image.width, image.height);
  const canevas = document.createElement("canvas");
  const g = canevas.getContext("2d", { willReadFrequently: Boolean(plan) });
  if (!g) return null;
  canevas.width = image.width;
  canevas.height = image.height;
  g.drawImage(image, 0, 0);
  if (!plan) return { canevas, coins: f.coins };
  const lu = g.getImageData(0, 0, image.width, image.height);
  const r = redresser({ largeur: lu.width, hauteur: lu.height, data: lu.data }, plan);
  canevas.width = r.largeur;
  canevas.height = r.hauteur;
  g.putImageData(new ImageData(r.data, r.largeur, r.hauteur), 0, 0);
  return { canevas, coins: plan.coins };
}

function retirerFond(c: CarteGL, id: string) {
  if (c.getLayer(`fond-${id}`)) c.removeLayer(`fond-${id}`);
  if (c.getSource(`fond-${id}`)) c.removeSource(`fond-${id}`);
}

/**
 * Pose, refait ou retire l'image de chaque source. Une image neuve ou un autre calage refait sa
 * source : un canevas déjà dessiné, que MapLibre lit d'un coup, sans attente ni trou à l'écran.
 */
function poserFonds(c: CarteGL, aPoser: FondAPoser[], poses: Map<string, string>) {
  for (const [id] of poses) {
    if (aPoser.some((f) => f.id === id)) continue;
    retirerFond(c, id);
    poses.delete(id);
  }
  for (const f of aPoser) {
    const cle = `${f.a}|${JSON.stringify(f.coins)}`;
    if (poses.get(f.id) === cle) continue;
    const pret = canevasFond(f);
    if (!pret) continue;
    retirerFond(c, f.id);
    c.addSource(`fond-${f.id}`, {
      type: "canvas",
      canvas: pret.canevas,
      coordinates: coinsMapLibre(pret.coins),
      animate: false,
    });
    c.addLayer(
      {
        id: `fond-${f.id}`,
        type: "raster",
        source: `fond-${f.id}`,
        paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 },
      },
      AVANT_FONDS,
    );
    poses.set(f.id, cle);
  }
}

/**
 * La carte du poste, sur MapLibre : la bibliothèque projette (Web Mercator) et dessine l'imagerie
 * servie par le poste, les pistes reçues en direct, nos drones par leur liaison et l'image de leurs
 * sources posée entre ses quatre coins. Le chef y mesure, pose une zone, désigne un point, cale une
 * image. Rien n'y est simulé ; rien n'y est demandé hors du poste.
 */
export function Carte({
  selectedId,
  onSelect,
  className,
  scale: scaleProp,
  fr24 = false,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  scale?: MapScale;
  fr24?: boolean;
}) {
  const storeScale = useVigilair((s) => s.mapScale);
  const scale = scaleProp ?? storeScale;
  const viewOrigin = useVigilair((s) => s.viewOrigin);
  const satLayer = useVigilair((s) => s.satLayer);
  const setSatMeta = useVigilair((s) => s.setSatMeta);
  const boite = useRef<HTMLDivElement>(null);
  const carteRef = useRef<CarteGL | null>(null);
  const [etat, setEtat] = useState<Etat>("attente");
  const [legende, setLegende] = useState({ echelle: "", credit: "" });
  const [pointeur, setPointeur] = useState<Pointeur | null>(null);
  // Ce que lisent les rappels de la carte : toujours la dernière valeur, sans recréer la carte.
  const courant = useRef({ selectedId, onSelect, fr24, scale, forcee: scaleProp });
  courant.current = { selectedId, onSelect, fr24, scale, forcee: scaleProp };

  useEffect(() => {
    let fini = false;
    let carte: CarteGL | null = null;
    let tic = 0;
    void (async () => {
      const [maplibre] = await Promise.all([import("maplibre-gl"), chargerPolices()]);
      const div = boite.current;
      if (fini || !div) return;
      if (!protocoles) {
        protocoles = true;
        maplibre.addProtocol(PROTOCOLE_TUILE, async (params, abandon) => ({
          data: await tuileEnFile(params.url.slice(PROTOCOLE_TUILE.length + 3), abandon.signal),
        }));
        maplibre.addProtocol("mosaique", async (params) => {
          const m = /^mosaique:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
          if (!m) return { data: PNG_VIDE };
          const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
          if (!mosaiqueCouvre(z, x, y)) return { data: PNG_VIDE };
          const r = await fetch(urlMosaique(z, x, y)).catch(() => null);
          return { data: r?.ok ? await r.arrayBuffer() : PNG_VIDE };
        });
      }
      const p = lirePalette();
      const st = useVigilair.getState();
      const sc = courant.current.scale;
      const centre = isHiResScale(sc) ? st.viewOrigin : HOME;
      const etendue = etendueMosaique();
      let versionMosaique = etendue.rects.length;
      try {
        carte = new maplibre.Map({
          container: div,
          style: styleDeBase(p, st.satLayer, modeleTuiles, {
            zMin: etendue.zMin,
            zMax: etendue.zMax,
            version: versionMosaique,
          }),
          center: [centre.lon, centre.lat],
          zoom: zoomPourLargeur(SCALE[sc].sizeKm, div.clientWidth || 1000, centre.lat),
          minZoom: 0.3,
          maxZoom: 20,
          attributionControl: false,
          renderWorldCopies: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          doubleClickZoom: false,
          fadeDuration: 0,
          // La capture PNG du COP relit le canevas : il doit garder sa dernière image.
          canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        });
      } catch {
        setEtat("sans-webgl");
        return;
      }
      carteRef.current = carte;
      const c = carte;
      c.addControl(new maplibre.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
      // Le nord reste en haut : ni pincement, ni clavier ne font tourner la carte.
      c.touchZoomRotate.disableRotation();
      c.keyboard.disableRotation();
      // Les symboles se dessinent à la demande, sous le nom qui dit tout d'eux.
      c.on("styleimagemissing", (e) => {
        if (c.hasImage(e.id)) return;
        const img = dessinerIcone(e.id, 2);
        if (img) c.addImage(e.id, img, { pixelRatio: 2 });
      });
      // Imagerie : on compte ce qui arrive et ce qui échoue (réseau absent → mosaïque locale).
      const imagerie = { ok: 0, ko: 0 };
      c.on("error", (e) => {
        const id = (e as { sourceId?: string }).sourceId;
        if (id === `imagerie-${useVigilair.getState().satLayer}`) imagerie.ko += 1;
      });
      c.on("sourcedata", (e) => {
        if (e.sourceId === `imagerie-${useVigilair.getState().satLayer}` && e.tile)
          imagerie.ok += 1;
      });
      let lecture = 0;
      c.on("mousemove", (e) => {
        copHud.cursor = { x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: e.lngLat.lng };
        // Une lecture par image affichée au plus : le pointeur ne fait pas ramer la carte.
        if (lecture) return;
        lecture = requestAnimationFrame(() => {
          lecture = 0;
          if (!fini) setPointeur(lirePointeur(c, e.point.x, e.point.y));
        });
      });
      c.on("mouseout", () => setPointeur(null));
      c.on("click", (e) => cliquer(c, e, (id) => courant.current.onSelect(id)));
      c.on("dblclick", (e) => {
        useVigilair.getState().openCapture({
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          kind: "scene",
          title: "Scène ident",
          body: "Ident visible au double-clic — centre = le point cliqué, FTTJ = distance depuis N'Djamena",
          source: "COP",
        });
      });
      c.on("load", () => {
        if (fini) return;
        setLiveCop(c.getCanvas());
        setEtat("prete");
        const fonds = new Map<string, string>();
        const tour = () => {
          if (fini) return;
          const e = etendueMosaique();
          if (e.rects.length !== versionMosaique) {
            // Couverture relevée : la mosaïque est redemandée, cette fois tuile par tuile où elle existe.
            versionMosaique = e.rects.length;
            (c.getSource("mosaique") as RasterTileSource | undefined)?.setTiles([
              `mosaique://{z}/{x}/{y}?v=${versionMosaique}`,
            ]);
          }
          mettreAJour(c, p, fonds, imagerie, setLegende, {
            ...courant.current,
            scale: courant.current.forcee,
          });
        };
        tour();
        tic = window.setInterval(tour, 500);
      });
    })();
    return () => {
      fini = true;
      window.clearInterval(tic);
      if (carte) releaseLiveCop(carte.getCanvas());
      carteRef.current = null;
      carte?.remove();
    };
  }, []);

  // Une échelle choisie (bouton, raccourci, foyer d'une mine) : la carte s'y place ; la molette reste libre.
  useEffect(() => {
    const c = carteRef.current;
    if (!c || etat !== "prete") return;
    const centre = isHiResScale(scale) ? viewOrigin : HOME;
    c.jumpTo({
      center: [centre.lon, centre.lat],
      zoom: zoomPourLargeur(SCALE[scale].sizeKm, c.getContainer().clientWidth || 1000, centre.lat),
    });
  }, [scale, viewOrigin, etat]);

  // La couche d'imagerie choisie, seule visible (la mosaïque locale ne sert que le visible).
  useEffect(() => {
    const c = carteRef.current;
    if (!c || etat !== "prete") return;
    for (const l of SAT_LAYERS)
      c.setLayoutProperty(`imagerie-${l}`, "visibility", l === satLayer ? "visible" : "none");
    c.setLayoutProperty("mosaique", "visibility", satLayer === "vis" ? "visible" : "none");
  }, [satLayer, etat]);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      fetch("/api/sat")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!stop && j && typeof j === "object") setSatMeta(j);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 45000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [setSatMeta]);

  return (
    // Posée sur toute sa section (qui est « relative ») : une hauteur en % ne s'y résout pas.
    <div className={cn("absolute inset-0", className)}>
      <div
        ref={boite}
        // MapLibre met son conteneur en « position: relative » : il prend la taille de son parent.
        className="size-full cursor-crosshair"
        data-carte="maplibre"
        data-carte-etat={etat}
        data-map-scale={scale}
        role="img"
        aria-label="Carte du poste : imagerie, pistes reçues, nos drones et leurs images"
      />
      {etat === "sans-webgl" ? (
        <div
          className="absolute inset-0 grid place-items-center bg-bg p-6 text-center text-sm text-muted-foreground"
          data-carte-sans-webgl
        >
          La carte ne peut pas s'afficher : ce navigateur n'offre pas WebGL. Activer l'accélération
          matérielle du navigateur (ou en prendre un récent), puis recharger.
        </div>
      ) : null}
      {etat === "prete" ? (
        <div className="pointer-events-none absolute bottom-2 left-[150px] right-2 z-[1] flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
          <span data-carte-echelle className="w-fit rounded-sm bg-bg/80 px-1.5 py-0.5">
            {legende.echelle}
          </span>
          <span
            data-carte-credit
            className="w-fit max-w-full truncate rounded-sm bg-bg/80 px-1.5 py-0.5"
          >
            {legende.credit}
          </span>
        </div>
      ) : null}
      {etat === "prete" && pointeur ? (
        <div
          data-carte-pointeur
          className="pointer-events-none absolute bottom-14 right-3 z-[1] flex flex-col items-end gap-0.5 rounded-sm bg-bg/80 px-2 py-1 font-mono text-[10px]"
        >
          {pointeur.note ? <span className="text-muted-foreground">{pointeur.note}</span> : null}
          <span className="text-fg">{pointeur.coord}</span>
          <span className="text-muted-foreground">{pointeur.mgrs}</span>
          <span className="text-fg">{pointeur.gsd}</span>
          <span className="text-muted-foreground">{pointeur.poste}</span>
        </div>
      ) : null}
    </div>
  );
}
