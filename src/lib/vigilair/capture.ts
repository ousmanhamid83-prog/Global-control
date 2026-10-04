/** Capture ident — scène Sentinel-2 / World Imagery, détections de gabarit. AfriControl n'émet pas. */

import { AERODROMES } from "./aerodromes";
import {
  CORRIDORS,
  HOME,
  LAKE_CHAD,
  SAHEL_CITIES,
  SCALE,
  formatAzimut,
  formatGsdM,
  formatRange,
  haversineKm,
  headingBetween,
  inRing,
  mgrsCompact,
  theaterOf,
  theaterRank,
  visGsdM,
  type TheaterId,
} from "./geo";
import type { Threat, Track } from "./types";
import { formatPx, pixelDetections, pixelSpan } from "./tiles";
import { parseEsriFirms, parseFirms } from "./firms";

export { parseFirms, parseEsriFirms };

export type CaptureKind =
  | "menace"
  | "uav"
  | "feu"
  | "tempete"
  | "seisme"
  | "volcan"
  | "inondation"
  | "cyclone"
  | "poussiere"
  | "sigmet"
  | "scene";

export type CaptureObject = {
  id: string;
  label: string;
  kind: "piste" | "ville" | "aeronef" | "feu" | "eau" | "limite" | "terrain";
  note: string;
  resolvable: boolean;
  distKm?: number;
  lat?: number;
  lon?: number;
};

export type CaptureShot = {
  id: string;
  at: number;
  lat: number;
  lon: number;
  kind: CaptureKind;
  title: string;
  body: string;
  theater: TheaterId;
  gsdM: number;
  source: string;
  objects: CaptureObject[];
};

export type Phenomenon = {
  id: string;
  kind: CaptureKind;
  title: string;
  body: string;
  lat: number;
  lon: number;
  at: number;
  theater: TheaterId;
  level: Threat;
  source: string;
};

export const KIND_LABEL: Record<CaptureKind, string> = {
  menace: "Menace",
  uav: "UAV",
  feu: "Feu",
  tempete: "Tempête",
  seisme: "Séisme",
  volcan: "Volcan",
  inondation: "Inondation",
  cyclone: "Cyclone",
  poussiere: "Poussière",
  sigmet: "SIGMET",
  scene: "Scène ident",
};

const THEATER_HINT: Record<TheaterId, string> = {
  tchad: "Tchad",
  darfour: "Darfour",
  aes: "AES",
  sahel: "Sahel",
  monde: "hors théâtre",
};

/** Postes ident — ICAO du terrain, pas le code de N'Djamena. */
export const THEATER_POSTS: {
  id: string;
  lat: number;
  lon: number;
  title: string;
  body: string;
  theater: TheaterId;
}[] = [
	{
		id: "post-fttj",
		lat: 12.1337,
		lon: 15.034,
		title: "FTTJ N'Djamena",
		body: "ICAO FTTJ · Hassan Djamous · Tchad. Ce n'est pas El Fasher.",
		theater: "tchad"
	},
	{
		id: "post-abe",
		lat: 13.847,
		lon: 20.8443,
		title: "FTTC Abéché",
		body: "ICAO FTTC · est Tchad",
		theater: "tchad"
	},
	{
		id: "post-faya",
		lat: 17.917,
		lon: 19.111,
		title: "FTTF Faya",
		body: "ICAO FTTF · BET",
		theater: "tchad"
	},
	{
		id: "post-adre",
		lat: 13.47,
		lon: 22.2,
		title: "Adré",
		body: "Frontière Tchad / Darfour · pas un code FTTJ",
		theater: "tchad"
	},
	{
		id: "post-hsfs",
		lat: 13.6149,
		lon: 25.3246,
		title: "HSFS El Fasher",
		body: "ICAO HSFS · IATA ELF · aéroport d'El Fasher, Darfour Nord, Soudan. Scène centrée ici — pas FTTJ, à 1 140 km.",
		theater: "darfour"
	},
	{
		id: "post-hsgn",
		lat: 13.4817,
		lon: 22.4653,
		title: "HSGN Geneina",
		body: "ICAO HSGN · IATA EGN · Darfour Ouest, Soudan",
		theater: "darfour"
	},
	{
		id: "post-hsnl",
		lat: 12.0535,
		lon: 24.9562,
		title: "HSNL Nyala",
		body: "ICAO HSNL · IATA UYL · Darfour Sud, Soudan",
		theater: "darfour"
	},
	{
		id: "post-nim",
		lat: 13.4815,
		lon: 2.1836,
		title: "DRRN Niamey",
		body: "ICAO DRRN · AES Niger",
		theater: "aes"
	},
	{
		id: "post-oua",
		lat: 12.3532,
		lon: -1.5124,
		title: "DFFD Ouaga",
		body: "ICAO DFFD · AES Burkina",
		theater: "aes"
	},
	{
		id: "post-bko",
		lat: 12.5335,
		lon: -7.9499,
		title: "GABS Bamako",
		body: "ICAO GABS · AES Mali",
		theater: "aes"
	},
	{
		id: "post-gao",
		lat: 16.266,
		lon: -.04,
		title: "GAGO Gao",
		body: "ICAO GAGO · AES nord Mali",
		theater: "aes"
	}
];

type SiteKind = "ville" | "eau" | "terrain" | "piste";

/** Villes / sites publics — densité Tchad · Darfour · AES, puis globe. */
const WORLD_SITES: { name: string; lat: number; lon: number; kind: SiteKind; note: string }[] = [
	{
		name: "Adré",
		lat: 13.47,
		lon: 22.2,
		kind: "ville",
		note: "Frontière Tchad / Darfour · toits, axe est"
	},
	{
		name: "Am Timan",
		lat: 11.043,
		lon: 20.283,
		kind: "ville",
		note: "Salamat · trame urbaine 10 m"
	},
	{
		name: "Goz Beida",
		lat: 12.224,
		lon: 21.41,
		kind: "ville",
		note: "Sila · toits, pistes"
	},
	{
		name: "Biltine",
		lat: 14.527,
		lon: 20.928,
		kind: "ville",
		note: "Wadi Fira"
	},
	{
		name: "Iriba",
		lat: 15.117,
		lon: 22.25,
		kind: "ville",
		note: "Est Tchad · wadi"
	},
	{
		name: "Tiné",
		lat: 15.32,
		lon: 21.9,
		kind: "ville",
		note: "Frontière nord-est"
	},
	{
		name: "Moussoro",
		lat: 13.641,
		lon: 16.49,
		kind: "ville",
		note: "Barh El Gazel"
	},
	{
		name: "Massakory",
		lat: 12.996,
		lon: 15.729,
		kind: "ville",
		note: "Hadjer-Lamis"
	},
	{
		name: "Massaguet",
		lat: 12.475,
		lon: 15.436,
		kind: "ville",
		note: "Axe N'Djamena nord"
	},
	{
		name: "Bongor",
		lat: 10.281,
		lon: 15.372,
		kind: "ville",
		note: "Mayo-Kebbi · Logone"
	},
	{
		name: "Pala",
		lat: 9.364,
		lon: 14.908,
		kind: "ville",
		note: "Mayo-Kebbi Ouest"
	},
	{
		name: "Kélo",
		lat: 9.309,
		lon: 15.807,
		kind: "ville",
		note: "Tandjilé"
	},
	{
		name: "Doba",
		lat: 8.65,
		lon: 16.85,
		kind: "ville",
		note: "Logone Oriental"
	},
	{
		name: "Amdjarass",
		lat: 16.066,
		lon: 22.843,
		kind: "ville",
		note: "Ennedi-Est"
	},
	{
		name: "Kalait",
		lat: 15.74,
		lon: 20.986,
		kind: "ville",
		note: "Ennedi-Ouest"
	},
	{
		name: "Ounianga Kébir",
		lat: 19.056,
		lon: 20.506,
		kind: "eau",
		note: "Lacs d'Ounianga · nappe lisible 10 m"
	},
	{
		name: "Zalingei",
		lat: 12.909,
		lon: 23.474,
		kind: "ville",
		note: "Darfour Centre"
	},
	{
		name: "Kutum",
		lat: 14.201,
		lon: 24.666,
		kind: "ville",
		note: "Darfour Nord"
	},
	{
		name: "Kebkabiya",
		lat: 13.65,
		lon: 24.07,
		kind: "ville",
		note: "Darfour Nord-ouest"
	},
	{
		name: "Kass",
		lat: 12.496,
		lon: 24.283,
		kind: "ville",
		note: "Darfour Sud"
	},
	{
		name: "Ed Daein",
		lat: 11.461,
		lon: 26.132,
		kind: "ville",
		note: "Darfour Est"
	},
	{
		name: "Mopti",
		lat: 14.494,
		lon: -4.197,
		kind: "ville",
		note: "AES Mali · Niger intérieur"
	},
	{
		name: "Sikasso",
		lat: 11.317,
		lon: -5.666,
		kind: "ville",
		note: "AES Mali sud"
	},
	{
		name: "Bobo-Dioulasso",
		lat: 11.178,
		lon: -4.298,
		kind: "ville",
		note: "AES Burkina"
	},
	{
		name: "Koudougou",
		lat: 12.253,
		lon: -2.362,
		kind: "ville",
		note: "AES Burkina"
	},
	{
		name: "Dosso",
		lat: 13.049,
		lon: 3.194,
		kind: "ville",
		note: "AES Niger"
	},
	{
		name: "Birni N'Konni",
		lat: 13.796,
		lon: 5.25,
		kind: "ville",
		note: "AES Niger"
	},
	{
		name: "Arlit",
		lat: 18.737,
		lon: 7.385,
		kind: "ville",
		note: "AES Aïr · mines"
	},
	{
		name: "Dirkou",
		lat: 18.995,
		lon: 12.889,
		kind: "ville",
		note: "AES Kawar"
	},
	{
		name: "Le Caire",
		lat: 30.044,
		lon: 31.236,
		kind: "ville",
		note: "Trame urbaine dense 10 m"
	},
	{
		name: "Lagos",
		lat: 6.524,
		lon: 3.379,
		kind: "ville",
		note: "Toits, lagune, port"
	},
	{
		name: "Kinshasa",
		lat: -4.325,
		lon: 15.322,
		kind: "ville",
		note: "Fleuve, toits"
	},
	{
		name: "Johannesburg",
		lat: -26.204,
		lon: 28.047,
		kind: "ville",
		note: "Axe minier, toits"
	},
	{
		name: "Nairobi",
		lat: -1.286,
		lon: 36.817,
		kind: "ville",
		note: "Trame urbaine 10 m"
	},
	{
		name: "Addis-Abeba",
		lat: 9.03,
		lon: 38.74,
		kind: "ville",
		note: "Plateau, toits"
	},
	{
		name: "Paris",
		lat: 48.857,
		lon: 2.352,
		kind: "ville",
		note: "Toits, Seine, pistes"
	},
	{
		name: "Londres",
		lat: 51.507,
		lon: -.128,
		kind: "ville",
		note: "Tamise, trame"
	},
	{
		name: "Istanbul",
		lat: 41.009,
		lon: 28.978,
		kind: "ville",
		note: "Détroit, toits"
	},
	{
		name: "Dubaï",
		lat: 25.205,
		lon: 55.271,
		kind: "ville",
		note: "Port, pistes, toits"
	},
	{
		name: "Delhi",
		lat: 28.614,
		lon: 77.209,
		kind: "ville",
		note: "Trame urbaine dense"
	},
	{
		name: "Pékin",
		lat: 39.904,
		lon: 116.407,
		kind: "ville",
		note: "Trame urbaine 10 m"
	},
	{
		name: "Tokyo",
		lat: 35.676,
		lon: 139.65,
		kind: "ville",
		note: "Toits, baie, pistes"
	},
	{
		name: "Singapour",
		lat: 1.352,
		lon: 103.82,
		kind: "ville",
		note: "Port, pistes"
	},
	{
		name: "Jakarta",
		lat: -6.208,
		lon: 106.846,
		kind: "ville",
		note: "Toits, eau"
	},
	{
		name: "Sydney",
		lat: -33.869,
		lon: 151.209,
		kind: "ville",
		note: "Baie, toits"
	},
	{
		name: "São Paulo",
		lat: -23.55,
		lon: -46.633,
		kind: "ville",
		note: "Trame urbaine 10 m"
	},
	{
		name: "Mexico",
		lat: 19.433,
		lon: -99.133,
		kind: "ville",
		note: "Toits, axes"
	},
	{
		name: "New York",
		lat: 40.713,
		lon: -74.006,
		kind: "ville",
		note: "Île, toits, port"
	},
	{
		name: "Los Angeles",
		lat: 34.052,
		lon: -118.244,
		kind: "ville",
		note: "Grille, pistes"
	},
	{
		name: "Moscou",
		lat: 55.756,
		lon: 37.617,
		kind: "ville",
		note: "Trame, rivière"
	},
	{
		name: "Téhéran",
		lat: 35.689,
		lon: 51.389,
		kind: "ville",
		note: "Toits, piémont"
	},
	{
		name: "Riyad",
		lat: 24.714,
		lon: 46.675,
		kind: "ville",
		note: "Désert urbain 10 m"
	},
	{
		name: "Karachi",
		lat: 24.86,
		lon: 67.001,
		kind: "ville",
		note: "Port, toits"
	},
	{
		name: "Manille",
		lat: 14.599,
		lon: 120.984,
		kind: "ville",
		note: "Baie, toits"
	},
	{
		name: "Séoul",
		lat: 37.567,
		lon: 126.978,
		kind: "ville",
		note: "Fleuve, toits"
	},
	{
		name: "Bangkok",
		lat: 13.756,
		lon: 100.502,
		kind: "ville",
		note: "Fleuve, toits"
	},
	{
		name: "Buenos Aires",
		lat: -34.604,
		lon: -58.382,
		kind: "ville",
		note: "Río, toits"
	},
	{
		name: "Anchorage",
		lat: 61.218,
		lon: -149.9,
		kind: "ville",
		note: "Golfe, pistes"
	},
	{
		name: "Reykjavik",
		lat: 64.147,
		lon: -21.943,
		kind: "ville",
		note: "Côte, toits"
	},
	{
		name: "Antananarivo",
		lat: -18.879,
		lon: 47.508,
		kind: "ville",
		note: "Hauts plateaux"
	},
	{
		name: "Perth",
		lat: -31.952,
		lon: 115.861,
		kind: "ville",
		note: "Côte, toits"
	}
];

export const CAPTURE_GSD_M = visGsdM(SCALE.ident.tileZ, HOME.lat);

function lonLatOf(coords: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const lon = coords[0];
    const lat = coords[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }
  return lonLatOf(coords[Math.floor(coords.length / 2)] ?? coords[0]);
}

function landHint(lat: number, lon: number): CaptureObject {
  const th = theaterOf(lat, lon);
  if (inRing(lat, lon, LAKE_CHAD)) {
    return {
      id: "land",
      label: "Lac Tchad",
      kind: "eau",
      note: "Nappe, roselières, rives — lisibles à 10 m",
      resolvable: true,
      lat,
      lon,
    };
  }
  let label = "Terrain 10 m";
  let note = "Toits, routes, eau, végétation, véhicules > 10 m";
  if (th === "tchad" && lat >= 16) {
    label = "Sahara / BET";
    note = "Dunes, oueds, pistes — silhouettes > 10 m";
  } else if (th === "darfour") {
    label = "Darfour";
    note = "Savane sèche, wadis, toits, pistes laterite";
  } else if (th === "aes") {
    label = "AES";
    note = "Sahel, brousse, routes, toits de concession";
  } else if (th === "tchad") {
    label = "Tchad";
    note = "Savane / urbain · Logone-Chari si N'Djamena";
  } else if (th === "sahel") {
    label = "Sahel";
    note = "Savane, axes, toits";
  } else if (Math.abs(lat) > 66) {
    label = "Polaire";
    note = "Glace / toundra · GSD encore ≤ 10 m";
  } else if (Math.abs(lat) < 10) {
    label = "Équatorial";
    note = "Canopée, toits, eau — silhouettes > 10 m";
  }
  return { id: "land", label, kind: "terrain", note, resolvable: true, lat, lon };
}

export function analyzeScene(opts: {
  lat: number;
  lon: number;
  tracks: Track[];
  phenomena: Phenomenon[];
}): CaptureObject[] {
  const { lat, lon } = opts;
  const rKm = SCALE.ident.sizeKm / 2;
  const gsd = visGsdM(SCALE.ident.tileZ, lat);
  const dets = pixelDetections(gsd, "vis");
  const homme = dets[0]!;
  const voiture = dets[1]!;
  const pirogue = dets[2]!;
  const camion = pixelSpan(gsd, "camion");
  const distHome = haversineKm(lat, lon, HOME.lat, HOME.lon);
  const azHome = headingBetween(HOME.lat, HOME.lon, lat, lon);
  const out: CaptureObject[] = [
    {
      id: "gsd",
      label: `Visible GSD ${formatGsdM(gsd)}`,
      kind: "terrain",
      note: `Sentinel-2 / World Imagery · GSD ${formatGsdM(gsd)} · H ${formatPx(homme.px)} · V ${formatPx(voiture.px)} · P ${formatPx(pirogue.px)} px · mosaïque · pas < 1 h`,
      resolvable: gsd <= 10,
      lat,
      lon,
    },
    {
      id: "mgrs",
      label: mgrsCompact(lat, lon, 4),
      kind: "terrain",
      note: "MGRS 10 m · réticule de capture",
      resolvable: true,
      lat,
      lon,
    },
    {
      id: "fttj",
      label: `depuis FTTJ ${formatRange(distHome)}`,
      kind: "terrain",
      note: `Azimut ${formatAzimut(azHome)} depuis FTTJ. Distance seulement — le centre de l'image est le point capturé, pas N'Djamena, sauf si la scène est FTTJ.`,
      resolvable: true,
    },
    landHint(lat, lon),
  ];

  for (const a of AERODROMES) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (d > rKm) continue;
    out.push({
      id: `icao-${a.icao}`,
      label: `${a.icao} ${a.name}`,
      kind: "piste",
      note:
        a.icao === "HSFS"
          ? "Centre image = HSFS / ELF, El Fasher, Darfour, Soudan. Pas FTTJ (1 140 km). Mosaïque sol jusqu'à z19 là où la tuile existe."
          : a.icao === "FTTJ"
            ? "Centre image = FTTJ Hassan Djamous, N'Djamena. Ce n'est pas El Fasher."
            : `Piste / taxiway / aires · ${a.city} · ${formatRange(d)}`,
      resolvable: true,
      distKm: d,
      lat: a.lat,
      lon: a.lon,
    });
  }

  for (const c of SAHEL_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d > rKm) continue;
    out.push({
      id: `city-${c.name}`,
      label: c.name,
      kind: "ville",
      note: "Trame urbaine, toits, axes — pas les occupants",
      resolvable: true,
      distKm: d,
      lat: c.lat,
      lon: c.lon,
    });
  }

  for (const s of WORLD_SITES) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d > rKm) continue;
    out.push({
      id: `site-${s.name}`,
      label: s.name,
      kind: s.kind,
      note: s.note,
      resolvable: true,
      distKm: d,
      lat: s.lat,
      lon: s.lon,
    });
  }

  for (const c of CORRIDORS) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d > rKm) continue;
    out.push({
      id: `cor-${c.id}`,
      label: c.name,
      kind: "terrain",
      note: c.aes ? "Corridor AES · axes, brousse" : "Corridor · axes, wadis",
      resolvable: true,
      distKm: d,
      lat: c.lat,
      lon: c.lon,
    });
  }

  let nearestCity: { name: string; d: number } | null = null;
  for (const c of [...SAHEL_CITIES, ...WORLD_SITES]) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (!nearestCity || d < nearestCity.d) nearestCity = { name: c.name, d };
  }
  if (nearestCity && nearestCity.d > rKm) {
    out.push({
      id: "near-city",
      label: `${nearestCity.name} ${formatRange(nearestCity.d)}`,
      kind: "ville",
      note: "Hors fenêtre ident · contexte, pas le terrain cadré",
      resolvable: false,
      distKm: nearestCity.d,
    });
  }

  for (const t of opts.tracks) {
    if (t.idState === "perdu") continue;
    const d = haversineKm(lat, lon, t.lat, t.lon);
    if (d > rKm) continue;
    const uav = (t.category ?? "").toUpperCase() === "B6" || t.feed !== "adsb";
    out.push({
      id: `trk-${t.id}`,
      label: t.callsign,
      kind: "aeronef",
      note: uav
        ? "UAS en vol < GSD : piste capteur, pas la silhouette image"
        : t.altM < 30
          ? "Au sol : silhouette aile / fuselage. Pas l'immatriculation."
          : "En vol = piste 1090 · ombre seulement si très bas",
      resolvable: !uav && t.altM < 30,
      distKm: d,
      lat: t.lat,
      lon: t.lon,
    });
  }

  for (const p of opts.phenomena) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d > rKm) continue;
    const vis =
      p.kind === "feu" || p.kind === "inondation" || p.kind === "volcan" || p.kind === "cyclone";
    out.push({
      id: `ph-${p.id}`,
      label: p.title,
      kind: p.kind === "feu" ? "feu" : p.kind === "inondation" ? "eau" : "terrain",
      note: vis ? `${p.body} · empreinte au sol dans la scène ident` : p.body,
      resolvable: vis,
      distKm: d,
      lat: p.lat,
      lon: p.lon,
    });
  }

  const fine = gsd <= 1.5;
  out.push(
    {
      id: "obj-toit",
      label: "Bâti / toits",
      kind: "ville",
      note: fine ? "Hangars, concessions, empreinte de dégât" : "Emprise > GSD",
      resolvable: true,
    },
    {
      id: "obj-piste",
      label: "Piste / taxiway",
      kind: "piste",
      note: fine ? "Axe, seuil, apron — le terrain ICAO cadré" : "Tracé général",
      resolvable: true,
    },
    {
      id: "obj-veh",
      label: `Voiture · ${voiture.clsLabel} · ${formatPx(voiture.px)} px`,
      kind: "terrain",
      note: `${voiture.verdict} Camion ${formatPx(camion.px)} px ${camion.clsLabel}.`,
      resolvable: voiture.detected,
    },
    {
      id: "obj-pirogue",
      label: `Pirogue · ${pirogue.clsLabel} · ${formatPx(pirogue.px)} px`,
      kind: pirogue.detected ? "eau" : "limite",
      note: pirogue.verdict,
      resolvable: pirogue.detected,
    },
    {
      id: "obj-sol",
      label: "Aéronef au sol",
      kind: "aeronef",
      note: fine
        ? "Silhouette aile / fuselage. Pas l'immatriculation ni le type fin."
        : "Seulement un gros porteur posé",
      resolvable: fine,
    },
    {
      id: "lim-humain",
      label: `Homme · ${homme.clsLabel} · ${formatPx(homme.px)} px`,
      kind: "limite",
      note: `${homme.verdict} À couvert : on image le toit ou la face, pas le corps. L'indice est une voiture au seuil.`,
      resolvable: homme.detected,
    },
    {
      id: "lim-uav",
      label: "Multirotor en vol",
      kind: "limite",
      note: "Envergure < GSD · corréler 1090 / RF / acoustique",
      resolvable: false,
    },
    {
      id: "lim-thr",
      label: "THR 30 cm",
      kind: "limite",
      note: "Pas de 30–50 cm public ici · au-delà de z17 la tuile est vide",
      resolvable: false,
    },
  );

  const seen = new Set<string>();
  return out.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
}

export function buildCapture(opts: {
  id: string;
  lat: number;
  lon: number;
  kind: CaptureKind;
  title: string;
  body: string;
  source: string;
  tracks: Track[];
  phenomena: Phenomenon[];
}): CaptureShot {
  const theater = theaterOf(opts.lat, opts.lon);
  return {
    id: opts.id,
    at: Date.now(),
    lat: opts.lat,
    lon: opts.lon,
    kind: opts.kind,
    title: opts.title,
    body: opts.body,
    theater,
    gsdM: visGsdM(SCALE.ident.tileZ, opts.lat),
    source: opts.source,
    objects: analyzeScene({
      lat: opts.lat,
      lon: opts.lon,
      tracks: opts.tracks,
      phenomena: opts.phenomena,
    }),
  };
}

function kindFromEonet(category: string): CaptureKind {
  const c = category.toLowerCase();
  if (c.includes("wildfire") || c.includes("fire")) return "feu";
  if (c.includes("volcano")) return "volcan";
  if (c.includes("flood")) return "inondation";
  if (c.includes("storm") || c.includes("severe")) return "tempete";
  if (c.includes("cyclone") || c.includes("typhoon") || c.includes("hurricane")) return "cyclone";
  if (c.includes("dust") || c.includes("haze")) return "poussiere";
  if (c.includes("earthquake") || c.includes("quake")) return "seisme";
  if (c.includes("drought")) return "scene";
  return "scene";
}

function levelFor(kind: CaptureKind, theater: TheaterId, mag?: number): Threat {
  const hot = theaterRank(theater) >= 3;
  if (kind === "seisme" && mag != null && mag >= 6) return "critique";
  if (kind === "volcan" || kind === "cyclone") return hot ? "critique" : "elevee";
  if (kind === "feu" || kind === "seisme") return hot ? "elevee" : "moderee";
  if (kind === "inondation" || kind === "tempete") return hot ? "elevee" : "moderee";
  if (kind === "menace" || kind === "uav") return "elevee";
  return hot ? "moderee" : "faible";
}

export function parseEonet(raw: unknown): Phenomenon[] {
  if (!raw || typeof raw !== "object") return [];
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const out: Phenomenon[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as {
      categories?: { id?: string; title?: string }[];
      geometry?: { coordinates?: unknown; date?: string }[];
      id?: string;
      title?: string;
      description?: string;
    };
    const cat0 = (Array.isArray(e.categories) ? e.categories : [])[0];
    const kind = kindFromEonet(String(cat0?.id ?? cat0?.title ?? "event"));
    const geos = Array.isArray(e.geometry) ? e.geometry : [];
    const g = geos[geos.length - 1];
    const ll = lonLatOf(g?.coordinates);
    if (!ll) continue;
    const id = String(e.id ?? `${kind}-${ll.lat}-${ll.lon}`);
    const title = String(e.title ?? KIND_LABEL[kind]);
    const desc = String(e.description ?? "").trim();
    const theater = theaterOf(ll.lat, ll.lon);
    const at = g?.date ? Date.parse(g.date) : Date.now();
    const where = theaterRank(theater) >= 3 ? THEATER_HINT[theater] : "globe";
    out.push({
      id: `eonet-${id}`,
      kind,
      title,
      body: [KIND_LABEL[kind], where, desc.slice(0, 90), "EONET NASA"].filter(Boolean).join(" · "),
      lat: ll.lat,
      lon: ll.lon,
      at: Number.isFinite(at) ? at : Date.now(),
      theater,
      level: levelFor(kind, theater),
      source: "NASA EONET",
    });
  }
  return out;
}

export function parseUsgs(raw: unknown): Phenomenon[] {
  if (!raw || typeof raw !== "object") return [];
  const feats = (raw as { features?: unknown }).features;
  if (!Array.isArray(feats)) return [];
  const out: Phenomenon[] = [];
  for (const f of feats) {
    if (!f || typeof f !== "object") continue;
    const feat = f as {
      id?: string;
      geometry?: { coordinates?: number[] };
      properties?: { mag?: number; place?: string; time?: number };
    };
    const c = feat.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const lon = c[0]!;
    const lat = c[1]!;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const mag = feat.properties?.mag ?? 0;
    if (mag < 4.5) continue;
    const theater = theaterOf(lat, lon);
    const place = feat.properties?.place ?? "séisme";
    out.push({
      id: `usgs-${feat.id ?? `${lat}-${lon}`}`,
      kind: "seisme",
      title: `M${mag.toFixed(1)} · ${place}`,
      body: `USGS · ${THEATER_HINT[theater]} · M${mag.toFixed(1)}`,
      lat,
      lon,
      at: feat.properties?.time ?? Date.now(),
      theater,
      level: levelFor("seisme", theater, mag),
      source: "USGS",
    });
  }
  return out;
}

function kindFromGdacs(eventtype: string): CaptureKind {
  const t = eventtype.toUpperCase();
  if (t === "WF") return "feu";
  if (t === "FL") return "inondation";
  if (t === "EQ") return "seisme";
  if (t === "VO") return "volcan";
  if (t === "TC") return "cyclone";
  if (t === "DR") return "scene";
  return "scene";
}

function gdacsLevel(icon: string, theater: TheaterId, kind: CaptureKind): Threat {
  const u = icon.toLowerCase();
  if (u.includes("/red/")) return "critique";
  if (u.includes("/orange/")) return theaterRank(theater) >= 3 ? "critique" : "elevee";
  if (u.includes("/green/")) return theaterRank(theater) >= 3 ? "moderee" : "faible";
  return levelFor(kind, theater);
}

export function parseGdacs(raw: unknown): Phenomenon[] {
  if (!raw || typeof raw !== "object") return [];
  const feats = (raw as { features?: unknown }).features;
  if (!Array.isArray(feats)) return [];
  const out: Phenomenon[] = [];
  for (const f of feats) {
    if (!f || typeof f !== "object") continue;
    const feat = f as {
      geometry?: { coordinates?: unknown };
      properties?: {
        eventtype?: string;
        eventid?: string | number;
        name?: string;
        description?: string;
        iconoverall?: string;
        icon?: string;
      };
    };
    const ll = lonLatOf(feat.geometry?.coordinates);
    if (!ll) continue;
    const p = feat.properties ?? {};
    const kind = kindFromGdacs(String(p.eventtype ?? ""));
    const theater = theaterOf(ll.lat, ll.lon);
    const title = String(p.name ?? p.description ?? KIND_LABEL[kind]);
    const icon = String(p.iconoverall ?? p.icon ?? "");
    out.push({
      id: `gdacs-${p.eventtype ?? "x"}-${p.eventid ?? `${ll.lat}-${ll.lon}`}`,
      kind,
      title,
      body: `${KIND_LABEL[kind]} · ${THEATER_HINT[theater]} · GDACS`,
      lat: ll.lat,
      lon: ll.lon,
      at: Date.now(),
      theater,
      level: gdacsLevel(icon, theater, kind),
      source: "GDACS",
    });
  }
  return out;
}

export function mergePhenomena(lists: Phenomenon[][]): Phenomenon[] {
  const map = new Map<string, Phenomenon>();
  for (const list of lists) for (const p of list) if (!map.has(p.id)) map.set(p.id, p);
  const rank = (level: Threat) =>
    level === "critique" ? 4 : level === "elevee" ? 3 : level === "moderee" ? 2 : 1;
  return [...map.values()].sort((a, b) => {
    const r = theaterRank(b.theater) - theaterRank(a.theater);
    if (r !== 0) return r;
    const lv = rank(b.level) - rank(a.level);
    if (lv !== 0) return lv;
    return b.at - a.at;
  });
}
