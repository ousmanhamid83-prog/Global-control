/** Ingest capteurs réels — 1090ES, METAR/TAF/SIGMET NOAA, NOAA SWPC. Auth requise. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { AERO_BY_ICAO, METAR_IDS, TAF_IDS } from "./aerodromes";
import {
  mergePhenomena,
  parseEonet,
  parseUsgs,
  parseGdacs,
  parseFirms,
  parseEsriFirms,
  type Phenomenon,
} from "./capture";
import { theaterOf } from "./geo";
import { IA_QUESTION_MAX } from "./ia-limites";
import {
  fusionAntenne,
  health,
  imageDuPoste,
  localN,
  nicHealth,
  sahelCount,
  vieillir,
} from "./image-poste";
import {
  ageLiveAc,
  gpsTime,
  jamFromAircraft,
  parseDump1090,
  solarFttj,
  xrayClassOf,
  type AirportRow,
  type JamCell,
  type LiveAc,
  type LivePicture,
  type MetarRow,
  type SigmetRow,
  type SourceHealth,
  type SpaceWx,
  type SwpcAlert,
  type TafRow,
} from "./live-adsb";

import type { ArchiveMeta } from "./archive.server";
import type { AtcSegment, AtcStatus } from "./atc.server";
import type { RejeuTape } from "./rejeu";
import type { ReceiverFeed } from "./rx1090.server";

import { couvertureVerdict, type CellOutcome } from "./portee";
import { dronesSansPosition, type DroneEntendu } from "./drones-entendus";
import {
  cellulesDuReleve,
  pasEncoreAbsents,
  PLAN_RELEVE,
  reposSource,
  reunirLots,
  vieCellule,
  type EtatCellule,
  type Lot,
  type Rapport,
} from "./releve-reseau";
import { UA_POSTE as UA } from "./agent-http";
import { attendreReleve } from "./bot-signal";

type Cell = { lat: number; lon: number; label: string };

/** adsb.fi répond vide au-delà de 250 NM : même rayon partout. */
const CELL_NM = 250;

/**
 * Théâtre, interrogé à chaque relevé. Mesuré en réel (octobre 2026) : les agrégateurs n'y ont
 * presque aucun récepteur — 0 avion à FTTJ, Niamey, Khartoum, 2 à Douala. Seul un récepteur
 * local (dump1090, « Antenne 1090 ») y donne de vrais avions. On interroge quand même : le jour
 * où un récepteur apparaît, il est pris.
 */
const THEATRE_CELLS: Cell[] = [
  { lat: 12.1348, lon: 15.0557, label: "FTTJ" },
  { lat: 4.006, lon: 9.719, label: "Douala" },
  { lat: 13.481, lon: 2.184, label: "Niamey" },
  { lat: 15.589, lon: 32.553, label: "Khartoum" },
];

/**
 * Afrique et Moyen-Orient. Avec les quatre du théâtre, ces 164 cellules couvrent tout ce que la
 * capture des drones compte comme l'une ou l'autre région, îles et eaux comprises (regions-drones.ts ;
 * vérifié sur une grille de 0,1° : aucun point à plus de CELL_NM d'un centre). Les 21 premières
 * maillaient le continent depuis octobre 2026 ; les 139 suivantes (23 novembre 2026) bouchent ses
 * trous et couvrent le Moyen-Orient, qui n'était vu qu'au bord de la cellule du Caire. Là où un
 * agrégateur a un récepteur, de vrais avions remontent ; ailleurs la cellule est prête pour le jour
 * où un récepteur apparaît. Relevées en rotation : voir PLAN_RELEVE.
 */
const CONTINENT_CELLS: Cell[] = [
  // Maghreb + Égypte
  { lat: 36.7, lon: 3.2, label: "Alger" },
  { lat: 36.8, lon: 10.2, label: "Tunis" },
  { lat: 32.7, lon: 13.2, label: "Tripoli" },
  { lat: 32.1, lon: 20.1, label: "Benghazi" },
  { lat: 30.1, lon: 31.4, label: "Le Caire" },
  { lat: 33.4, lon: -7.6, label: "Casablanca" },
  { lat: 30.4, lon: -9.6, label: "Agadir" },
  // Ouest / Golfe de Guinée
  { lat: 14.7, lon: -17.3, label: "Dakar" },
  { lat: 12.6, lon: -8.0, label: "Bamako" },
  { lat: 5.3, lon: -3.9, label: "Abidjan" },
  { lat: 5.6, lon: -0.17, label: "Accra" },
  { lat: 6.58, lon: 3.32, label: "Lagos" },
  // Centre
  { lat: 3.68, lon: 11.55, label: "Yaoundé" },
  { lat: -4.4, lon: 15.44, label: "Kinshasa" },
  { lat: -8.86, lon: 13.23, label: "Luanda" },
  // Corne / Est
  { lat: 8.98, lon: 38.8, label: "Addis-Abeba" },
  { lat: -1.3, lon: 36.9, label: "Nairobi" },
  { lat: -6.87, lon: 39.2, label: "Dar es Salaam" },
  // Australe
  { lat: -26.1, lon: 28.2, label: "Johannesburg" },
  { lat: -29.9, lon: 31.0, label: "Durban" },
  { lat: -33.9, lon: 18.6, label: "Le Cap" },
  // Moyen-Orient (23 novembre 2026)
  { lat: 24.643, lon: 46.771, label: "Riyad" },
  { lat: 33.341, lon: 44.392, label: "Bagdad" },
  { lat: 35.674, lon: 51.422, label: "Téhéran" },
  { lat: 25.232, lon: 55.278, label: "Dubaï" },
  { lat: 41.107, lon: 29.008, label: "Istanbul" },
  { lat: 37.077, lon: 37.383, label: "Gaziantep" },
  { lat: 15.357, lon: 44.205, label: "Sanaa" },
  { lat: 24.502, lon: 39.578, label: "Médine" },
  { lat: 30.3, lon: 57.08, label: "Kerman" },
  { lat: 16.239, lon: 52.164, label: "Al-Ghayda" },
  { lat: 29.815, lon: 39.866, label: "Dumat al-Jandal" },
  { lat: 20.462, lon: 45.572, label: "As-Sulayyil" },
  { lat: 29.372, lon: 47.976, label: "Koweït" },
  { lat: 36.272, lon: 59.568, label: "Mechhed" },
  { lat: 38.495, lon: 43.4, label: "Van" },
  { lat: 23.225, lon: 56.517, label: "Ibri" },
  { lat: 25.3, lon: 60.63, label: "Chabahar" },
  { lat: 35.167, lon: 33.367, label: "Nicosie" },
  { lat: 21.519, lon: 39.217, label: "Djeddah" },
  { lat: 25.287, lon: 51.533, label: "Doha" },
  { lat: 12.652, lon: 54.024, label: "Hadibo (Socotra)" },
  { lat: 17.025, lon: 54.085, label: "Salalah" },
  { lat: 41.28, lon: 36.344, label: "Samsun" },
  { lat: 38.438, lon: 27.15, label: "Izmir" },
  { lat: 32.702, lon: 51.698, label: "Ispahan" },
  { lat: 14.541, lon: 49.126, label: "Moukalla" },
  { lat: 23.489, lon: 46.756, label: "Al-Hillah (Arabie)" },
  { lat: 22.926, lon: 57.531, label: "Nizwa" },
  { lat: 24.467, lon: 54.367, label: "Abou Dabi" },
  { lat: 20, lon: 50, label: "Rub al-Khali" },
  // Afrique : les trous du maillage d'octobre 2026
  { lat: -17.816, lon: 31.043, label: "Harare" },
  { lat: -3.376, lon: 29.36, label: "Bujumbura" },
  { lat: -10.97, lon: 26.78, label: "Likasi" },
  { lat: 25.28, lon: 3.75, label: "Arak" },
  { lat: 12.06, lon: 24.89, label: "Nyala" },
  { lat: 3.26, lon: 19.77, label: "Gemena" },
  { lat: 4.09, lon: 30.68, label: "Yei" },
  { lat: -17.92, lon: 19.75, label: "Rundu" },
  { lat: 22.73, lon: -12.483, label: "Zouérate" },
  { lat: 24.2, lon: 23.29, label: "Koufra" },
  { lat: 18.9, lon: -3.53, label: "Araouane" },
  { lat: 24.37, lon: 14.471, label: "Tajarhi" },
  { lat: 16.996, lon: 7.983, label: "Agadez" },
  { lat: 17.917, lon: 19.117, label: "Faya-Largeau" },
  { lat: -5.888, lon: 22.398, label: "Kananga" },
  { lat: -11.46, lon: 34.02, label: "Mzuzu" },
  { lat: 3.8, lon: 42.55, label: "Luuq" },
  { lat: -26.574, lon: 18.13, label: "Keetmanshoop" },
  { lat: 21.8, lon: 31.35, label: "Wadi Halfa" },
  { lat: -18.915, lon: 47.515, label: "Antananarivo" },
  { lat: 8.433, lon: 47.317, label: "Las Anod" },
  { lat: 29.237, lon: 0.27, label: "Timimoun" },
  { lat: 9.93, lon: 8.89, label: "Jos" },
  { lat: -11.79, lon: 19.9, label: "Luena" },
  { lat: 9.537, lon: 31.656, label: "Malakal" },
  { lat: -19.99, lon: 23.42, label: "Maun" },
  { lat: 2.74, lon: 23.78, label: "Aketi" },
  { lat: -17.78, lon: 15.77, label: "Ongwediva" },
  { lat: 30.133, lon: 9.5, label: "Ghadamès" },
  { lat: 22.667, lon: -3.983, label: "Taoudeni" },
  { lat: 8.554, lon: -10.151, label: "Guéckédou" },
  { lat: 16.62, lon: -11.4, label: "Kiffa" },
  { lat: -15.176, lon: 37.74, label: "Ligonha" },
  { lat: 9.15, lon: 18.39, label: "Sarh" },
  { lat: -30.65, lon: 24, label: "De Aar" },
  { lat: 15.46, lon: 36.39, label: "Kassala" },
  { lat: 12.372, lon: -1.527, label: "Ouagadougou" },
  { lat: 22.785, lon: 5.523, label: "Tamanrasset" },
  { lat: -1.565, lon: 13.2, label: "Moanda" },
  { lat: -21.05, lon: 31.66, label: "Chiredzi" },
  { lat: 29.2, lon: 25.517, label: "Siwa" },
  { lat: 3.13, lon: 35.57, label: "Lodwar" },
  { lat: -6.36, lon: 31.05, label: "Mpanda" },
  { lat: -23.357, lon: 43.69, label: "Toliara" },
  { lat: 27.674, lon: -8.148, label: "Tindouf" },
  { lat: 13.63, lon: 25.35, label: "El Fasher" },
  { lat: 5.034, lon: 25.133, label: "Zemio" },
  { lat: 19.455, lon: 0.856, label: "Aguelhok" },
  { lat: -0.22, lon: 20.86, label: "Boende" },
  { lat: -14.98, lon: 27.07, label: "Mumbwa" },
  { lat: 29.234, lon: 19.217, label: "Marada" },
  { lat: 26.55, lon: 31.7, label: "Sohag" },
  { lat: -22.57, lon: 17.084, label: "Windhoek" },
  { lat: -12.277, lon: 49.312, label: "Antsiranana" },
  { lat: 33.69, lon: 1.01, label: "El Bayadh" },
  { lat: -14.91, lon: 13.49, label: "Lubango" },
  { lat: 14.253, lon: 13.111, label: "N'Guigmi" },
  { lat: 19.634, lon: 30.417, label: "Kerma" },
  { lat: 4.58, lon: 13.68, label: "Bertoua" },
  { lat: 9.533, lon: -13.682, label: "Conakry" },
  { lat: 11.595, lon: 43.148, label: "Djibouti" },
  { lat: -24.4, lon: 25.51, label: "Molepolole" },
  { lat: 24.965, lon: 10.173, label: "Ghât" },
  { lat: 20.9, lon: -17.056, label: "Nouadhibou" },
  { lat: -1.685, lon: 29.263, label: "Gisenyi" },
  { lat: -11.704, lon: 43.24, label: "Moroni" },
  { lat: -0.357, lon: 42.518, label: "Kismaayo" },
  { lat: -25.04, lon: 33.64, label: "Xai-Xai" },
  { lat: 14.917, lon: -23.517, label: "Praia" },
  { lat: 11.033, lon: 20.283, label: "Am Timan" },
  { lat: -4.617, lon: 55.45, label: "Victoria (Seychelles)" },
  { lat: 18.55, lon: -11.417, label: "Tidjikja" },
  { lat: 0.333, lon: 6.733, label: "São Tomé" },
  { lat: -4.45, lon: 26.66, label: "Kasongo" },
  { lat: -5.03, lon: 18.85, label: "Kikwit" },
  { lat: 6.89, lon: -6.45, label: "Daloa" },
  { lat: 18.82, lon: 7.33, label: "Arlit" },
  { lat: 2.069, lon: 45.365, label: "Mogadiscio" },
  { lat: -8.13, lon: 36.68, label: "Ifakara" },
  { lat: 33.37, lon: 6.86, label: "El Oued" },
  { lat: 27.15, lon: -13.2, label: "Laâyoune" },
  { lat: -15.79, lon: 34.99, label: "Blantyre" },
  { lat: -33.968, lon: 25.598, label: "Gqeberha" },
  { lat: 19.616, lon: 37.216, label: "Port-Soudan" },
  { lat: 11.01, lon: 29.7, label: "Kadugli" },
  { lat: -20.167, lon: 57.5, label: "Port-Louis" },
  { lat: 32.17, lon: 13.02, label: "Gharyan" },
  { lat: 0.319, lon: 32.581, label: "Kampala" },
  { lat: 4.367, lon: 18.558, label: "Bangui" },
  { lat: 11.852, lon: 13.158, label: "Maiduguri" },
  { lat: 13.17, lon: 32.66, label: "Kosti" },
  { lat: -14.519, lon: 40.715, label: "Nacala" },
  { lat: 16.617, lon: -7.25, label: "Néma" },
  { lat: 10.583, lon: 47.333, label: "Erigavo" },
  { lat: -19.85, lon: 47.033, label: "Antsirabe" },
  { lat: -15.28, lon: 23.12, label: "Mongu" },
  { lat: 19.167, lon: 30.483, label: "Dongola" },
  { lat: 14.533, lon: 20.917, label: "Biltine" },
  { lat: 27.87, lon: -0.29, label: "Adrar" },
  { lat: 34.025, lon: -6.836, label: "Rabat" },
  { lat: 21.015, lon: 12.308, label: "Djado" },
  { lat: 17.185, lon: 21.59, label: "Fada" },
  { lat: 20.459, lon: 16.528, label: "Zouar" },
  { lat: 28.55, lon: 17.583, label: "Zella" },
  { lat: 18.5, lon: 26, label: "Désert de Libye (Soudan)" },
  { lat: -47, lon: 37.5, label: "Îles du Prince-Édouard" },
  { lat: -10.5, lon: 56.5, label: "Agaléga" },
  { lat: -19.5, lon: 63.5, label: "Rodrigues" },
  { lat: 21, lon: -8, label: "Majâbat al-Koubrâ" },
];
/**
 * Ancres mondiales (hors Afrique et Moyen-Orient) : les zones où les agrégateurs publics ont une
 * couverture dense. Elles n'entrent dans la rotation qu'en balayage total (chef), pour que le radar
 * « tous continents » montre de VRAIS contacts 1090ES — Europe, Amériques, Asie, Océanie — et pas
 * une carte vide.
 */
const WORLD_CELLS: Cell[] = [
  { lat: 48.9, lon: 2.4, label: "Paris" },
  { lat: 51.5, lon: -0.2, label: "Londres" },
  { lat: 50.0, lon: 8.6, label: "Francfort" },
  { lat: 40.6, lon: -73.8, label: "New York" },
  { lat: 33.9, lon: -118.4, label: "Los Angeles" },
  { lat: -23.4, lon: -46.5, label: "São Paulo" },
  { lat: 1.36, lon: 103.99, label: "Singapour" },
  { lat: 35.55, lon: 139.78, label: "Tokyo" },
  { lat: 19.1, lon: 72.9, label: "Mumbai" },
  { lat: -33.95, lon: 151.18, label: "Sydney" },
];
/** Image réseau gardée 20 s : c'est aussi la cadence nominale d'un relevé. */
const TTL_MS = 20_000;
/**
 * Les cellules partent par lots de 4, le théâtre d'abord, chaque lot 2 s après le départ du
 * précédent : le rythme qu'adsb.fi accepte (40 requêtes sur 40, mesuré le 23 novembre 2026) ; une
 * rafale, il la refuse. Plus aucun lot ne part 8 s après le premier : l'image entière doit tenir en
 * 12 s (voir pullNetwork) ; les cellules restées dues partent au relevé suivant.
 */
const LOT_CELLULES = 4;
const PAS_LOT_MS = 2_000;
const FIN_LOTS_MS = 8_000;
/**
 * Les sources 1090ES, dans l'ordre : adsb.fi, puis adsb.lol en secours. adsb.lol n'accorde que 500
 * requêtes par jour (mesuré le 23 novembre 2026) : elles restent pour les cellules qu'adsb.fi refuse.
 */
const SOURCES_1090 = ["https://opendata.adsb.fi/api/v2", "https://api.adsb.lol/v2"];
/**
 * Un avion absent des relevés frais reste au plus 5 min sans rapport (voir pasEncoreAbsents) :
 * mesuré les 23 et 24 novembre 2026, 77 % de ceux qui revenaient étaient revenus avant 300 s.
 */
const SANS_RAPPORT_MAX_S = 300;
/**
 * La liste militaire d'adsb.fi, lue toutes les 2 min au plus : une requête de plus, partie comme
 * un lot après le dernier (voir lireDronesEntendus). Plus vieille que 10 min, l'image ne la porte
 * plus : des drones entendus il y a si longtemps ne disent plus rien du ciel.
 */
const LISTE_MIL_MS = 120_000;
const LISTE_MIL_VIE_MS = 600_000;

/**
 * État du relevé réseau, PARTAGÉ par toutes les copies de ce module. Le serveur construit en
 * contient plusieurs (les fonctions serveur sont découpées à part) : en variables de module, le
 * relevé remplissait la sienne, et les commandes, l'agent et la relève en lisaient une autre,
 * toujours vide. Mesuré en ligne : METAR FTTJ à la console, « non reçu » à /meteo.
 */
type EtatReleve = {
  /** Dernier relevé utilisable, valable TTL_MS. */
  cache: { at: number; data: LivePicture } | null;
  /** Dernier bon relevé, gardé en secours. */
  lastGood: LivePicture | null;
  /** Relevé Internet en cours (un seul à la fois). */
  netPending: Promise<LivePicture> | null;
  /** Fin du dernier relevé Internet, abouti ou non (ms) ; 0 : aucun encore. */
  tentativeA: number;
  netLast: LivePicture | null;
  /** Balayage total, décidé par le chef : les ancres mondiales entrent aussi dans la rotation. */
  continentSweep: boolean;
  /**
   * Ce que chaque cellule a rendu à son dernier relevé, servi jusqu'à sa fin de vie (vieCellule).
   * Partagé lui aussi : le serveur construit compte trois copies de ce module, et une rotation par
   * copie relèverait trois fois les mêmes cellules.
   */
  cellules: Map<string, { at: number; ac: LiveAc[] }>;
  /** Le dernier rapport de chaque avion de la dernière image 1090ES, par adresse. */
  derniers: Map<string, Rapport>;
  /** Jusqu'à quand chaque source 1090ES est laissée de côté (reposSource), par adresse. */
  repos: Record<string, number>;
  /** Les drones entendus sans position, à la dernière lecture réussie de la liste militaire. */
  entendus: { at: number; rows: DroneEntendu[] } | null;
  /** Départ de la dernière lecture de la liste militaire, aboutie ou non (ms) ; 0 : aucune. */
  entendusTente: number;
  /** Feux FIRMS, gardés le temps de leur TTL. */
  firms: { at: number; rows: Phenomenon[]; error: string | null; ttl: number } | null;
};
const releve: EtatReleve = ((globalThis as { __afriReleve?: EtatReleve }).__afriReleve ??= {
  cache: null,
  lastGood: null,
  netPending: null,
  tentativeA: 0,
  netLast: null,
  continentSweep: false,
  cellules: new Map(),
  derniers: new Map(),
  repos: {},
  entendus: null,
  entendusTente: 0,
  firms: null,
});
export function getContinentSweep(): boolean {
  return releve.continentSweep;
}
export function setContinentSweepFlag(on: boolean): void {
  releve.continentSweep = on;
}


async function fetchText(url: string, ms: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "text/csv,text/plain", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.text();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const ESRI_VIIRS =
  "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query";

function esriFirmsUrl(where: string, limit: number): string {
  return (
    ESRI_VIIRS +
    "?where=" +
    encodeURIComponent(where) +
    "&outFields=latitude,longitude,confidence,frp,satellite,hours_old,bright_ti4,daynight&returnGeometry=false&orderByFields=frp%20DESC&resultRecordCount=" +
    limit +
    "&f=json"
  );
}

const FIRMS_URLS: { sensor: string; url: string }[] = [
  {
    sensor: "VIIRS NOAA-20",
    url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
  },
  {
    sensor: "VIIRS NOAA-21",
    url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
  },
];

const FIRMS_TTL_MS = 15 * 1000;

async function pullFirms(): Promise<{ rows: Phenomenon[]; errors: string[] }> {
  if (releve.firms && Date.now() - releve.firms.at < releve.firms.ttl) {
    return { rows: releve.firms.rows, errors: releve.firms.error ? [releve.firms.error] : [] };
  }
  const errors: string[] = [];
  const take = async (where: string, limit: number): Promise<unknown[]> => {
    try {
      const raw = await fetchJson(esriFirmsUrl(where, limit), 12000);
      const features = (raw as { features?: unknown[] } | null)?.features;
      return Array.isArray(features) ? features : [];
    } catch (e) {
      errors.push(`FIRMS VIIRS: ${e instanceof Error ? e.message : "échec"}`);
      return [];
    }
  };
  const features = [
    ...(await take(
      "hours_old<=2 AND latitude>=7 AND latitude<=24 AND longitude>=-18 AND longitude<=38",
      80,
    )),
    ...(await take("hours_old<=2", 20)),
  ];
  if (features.length > 0) {
    const rows = parseEsriFirms({ features });
    if (rows.length > 0) {
      releve.firms = { at: Date.now(), rows, error: null, ttl: FIRMS_TTL_MS };
      return { rows, errors: [] };
    }
  }
  if (!errors.length) errors.push("FIRMS VIIRS: aucun point");
  for (const src of FIRMS_URLS) {
    try {
      const csv = await fetchText(src.url, 12000);
      const rows = parseFirms(csv, src.sensor);
      if (rows.length === 0) {
        errors.push(`FIRMS ${src.sensor}: aucun point`);
        continue;
      }
      releve.firms = { at: Date.now(), rows, error: null, ttl: FIRMS_TTL_MS };
      return { rows, errors: [] };
    } catch (e) {
      errors.push(`FIRMS ${src.sensor}: ${e instanceof Error ? e.message : "échec"}`);
    }
  }
  releve.firms = { at: Date.now(), rows: [], error: errors[0] ?? "FIRMS échec", ttl: 60_000 };
  return { rows: [], errors };
}

/** `vu` reçoit chaque réponse, refus compris, avant qu'elle soit lue (ses en-têtes de débit). */
async function fetchJson(url: string, ms = 4500, vu?: (res: Response) => void): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    vu?.(res);
    if (res.status === 204) return null;
    if (res.status === 429) throw new Error("429");
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { ac?: unknown; aircraft?: unknown };
    if (Array.isArray(o.ac)) return o.ac;
    if (Array.isArray(o.aircraft)) return o.aircraft;
  }
  return [];
}

/**
 * Une cellule, source après source ; une source au repos (reposSource) n'est pas interrogée.
 * `refused` : aucune réponse, et une source au moins a refusé ou se repose.
 */
async function pullCell(c: Cell): Promise<{ ac: LiveAc[] | null; refused: boolean; err: string }> {
  let refused = false;
  let err = "";
  for (const base of SOURCES_1090) {
    if (Date.now() < (releve.repos[base] ?? 0)) {
      refused = true;
      continue;
    }
    try {
      const value = await fetchJson(`${base}/lat/${c.lat}/lon/${c.lon}/dist/${CELL_NM}`, 8000, (res) => {
        const jusqua = reposSource(res.status, (nom) => res.headers.get(nom), Date.now());
        if (jusqua != null) releve.repos[base] = jusqua;
      });
      if (value == null) continue;
      return { ac: parseDump1090(asList(value)), refused: false, err: "" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "429") refused = true;
      else if (msg) err = msg;
    }
  }
  return { ac: null, refused, err };
}

/**
 * Les drones entendus SANS position (drones-entendus.ts), d'après la liste militaire d'adsb.fi : les
 * cellules ne les rendent jamais. adsb.lol n'est pas sollicité : ses 500 requêtes par jour restent
 * aux cellules. Liste muette ou refusée : la précédente reste, avec son heure.
 */
async function lireDronesEntendus(): Promise<void> {
  const base = SOURCES_1090[0]!;
  if (Date.now() < (releve.repos[base] ?? 0)) return;
  try {
    const value = await fetchJson(`${base}/mil`, 8000, (res) => {
      const jusqua = reposSource(res.status, (nom) => res.headers.get(nom), Date.now());
      if (jusqua != null) releve.repos[base] = jusqua;
    });
    if (value != null) releve.entendus = { at: Date.now(), rows: dronesSansPosition(asList(value)) };
  } catch {
    /* la liste précédente reste, son heure le dit */
  }
}

async function pullAdsb(): Promise<{
  ac: LiveAc[];
  /** Heure à laquelle les âges `seenS` de `ac` sont exacts. */
  refAt: number;
  errors: string[];
  source: string;
  ok: boolean;
}> {
  const t0 = Date.now();
  const errors: string[] = [];
  const lots: Lot[] = [];
  let ok = 0;
  let refused = 0;
  let lastErr = "";
  const cellules = releve.cellules;
  // Le chef a retiré le monde : ses cellules quittent l'image dès ce relevé.
  if (!releve.continentSweep) for (const c of WORLD_CELLS) cellules.delete(c.label);
  // Une cellule expirée est une cellule MANQUANTE : elle repasse en tête de la rotation.
  const etats = new Map<string, EtatCellule>();
  for (const [label, hit] of cellules) {
    const etat = { at: hit.at, avions: hit.ac.length };
    if (t0 - hit.at > vieCellule(etat, PLAN_RELEVE.rythme)) cellules.delete(label);
    else etats.set(label, etat);
  }
  // Toute l'Afrique et tout le Moyen-Orient, toujours ; en balayage total (chef), les ancres
  // mondiales aussi, pour un radar « tous continents » avec de vrais contacts.
  const balayees = releve.continentSweep ? [...CONTINENT_CELLS, ...WORLD_CELLS] : CONTINENT_CELLS;
  const rotation = cellulesDuReleve(
    balayees,
    etats,
    t0,
    PLAN_RELEVE,
  );
  // Théâtre d'abord, à chaque relevé : le premier lot, le cœur de la veille.
  // On retient le SORT de chaque cellule, pas seulement son contenu : « on m'a refusé la requête »
  // et « j'ai regardé, il n'y a personne » produisent le même scope vide, et les confondre déguise
  // une panne de capteur en calme plat.
  const theatre: CellOutcome[] = [];
  const auTheatre = await Promise.all(THEATRE_CELLS.map((c) => pullCell(c)));
  auTheatre.forEach((got, j) => {
    if (got.refused) refused += 1;
    if (got.err) lastErr = got.err;
    if (got.ac) {
      ok += 1;
      lots.push({ ac: got.ac, at: Date.now() });
    }
    theatre.push({
      label: THEATRE_CELLS[j]!.label,
      repondu: got.ac != null,
      refusee: got.refused,
      avions: got.ac?.length ?? 0,
    });
  });
  // Puis les cellules dues, lot après lot, au rythme qu'adsb.fi accepte (voir LOT_CELLULES).
  for (let k = 0; k * LOT_CELLULES < rotation.length; k++) {
    const depart = Math.max(Date.now(), t0 + (k + 1) * PAS_LOT_MS);
    if (depart - t0 > FIN_LOTS_MS) break;
    await new Promise((r) => setTimeout(r, depart - Date.now()));
    const lot = rotation.slice(k * LOT_CELLULES, (k + 1) * LOT_CELLULES);
    const got = await Promise.all(lot.map((c) => pullCell(c)));
    got.forEach((g, j) => {
      if (g.refused) refused += 1;
      if (g.err) lastErr = g.err;
      if (g.ac) {
        ok += 1;
        cellules.set(lot[j]!.label, { at: Date.now(), ac: g.ac });
      }
    });
  }
  // La liste militaire part comme un lot de plus, 2 s après le dernier : jamais en rafale avec lui.
  if (t0 - releve.entendusTente >= LISTE_MIL_MS) {
    releve.entendusTente = t0;
    setTimeout(() => void lireDronesEntendus(), PAS_LOT_MS);
  }
  for (const hit of cellules.values()) lots.push(hit);
  if (refused > 0 && ok === 0) errors.push("1090ES refusé (429)");
  // Aucune cellule jointe : c'est une coupure de liaison, pas un ciel vide.
  else if (ok === 0 && lastErr) errors.push(`1090ES: ${lastErr}`);
  // UNE heure de référence pour tout le relevé : chaque lot est vieilli depuis son propre relevé
  // jusqu'à elle. Rien ne paraît plus frais qu'il n'est, et un rapport resservi garde son heure.
  const refAt = Date.now();
  const frais = reunirLots(lots, refAt);
  // Absent des relevés frais ne veut pas dire disparu : un avion qui vole encore dans la zone
  // couverte est gardé avec son dernier rapport, en piste mémoire (voir pasEncoreAbsents).
  const gardes = pasEncoreAbsents(
    releve.derniers.values(),
    new Set(frais.map((a) => a.hex)),
    [...THEATRE_CELLS, ...balayees],
    refAt,
    SANS_RAPPORT_MAX_S,
  );
  const ac = [...frais, ...reunirLots(gardes.map((g) => ({ ac: [g.ac], at: g.at })), refAt)];
  releve.derniers = new Map(ac.map((a) => [a.hex, { ac: a, at: refAt }]));
  // Mesuré en réel : les agrégateurs répondent HTTP 200 avec ZÉRO avion dans un rayon de 463 km
  // autour de N'Djamena, alors qu'ils en rendent 62 à Tunis et 960 à Paris. Le théâtre n'est pas un
  // trou de logiciel, c'est un trou de RÉCEPTEURS — et le poste doit le DIRE, sinon l'opérateur
  // cherche une panne chez lui là où il n'y en a pas.
  const couv = couvertureVerdict(theatre);
  const servies = (liste: Cell[]) => liste.filter((c) => cellules.has(c.label)).length;
  const monde = releve.continentSweep
    ? ` · monde ${servies(WORLD_CELLS)}/${WORLD_CELLS.length} · balayage total`
    : "";
  const entreDeux = gardes.length > 0 ? ` (dont ${gardes.length} entre deux cellules)` : "";
  return {
    ac,
    refAt,
    errors: [...new Set(errors)].slice(0, 4),
    source:
      ok > 0
        ? `1090ES adsb.fi / adsb.lol · théâtre : ${couv.texte} · Afrique et Moyen-Orient ${servies(CONTINENT_CELLS)}/${CONTINENT_CELLS.length}${monde} · ${ac.length} squitters${entreDeux}`
        : `1090ES indisponible — ${couv.texte}`,
    ok: ok > 0,
  };
}

function visToM(v: unknown): number | null {
  if (typeof v === "number") return v > 50 ? v : v * 1609.34;
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (s === "CAVOK" || s === "9999") return 10000;
  if (s.endsWith("SM")) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n * 1609.34 : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (n > 50 ? n : n * 1609.34) : null;
}

function windDirOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

async function pullMetar(): Promise<{ metar: MetarRow[]; taf: TafRow[]; errors: string[] }> {
  const errors: string[] = [];
  const metar: MetarRow[] = [];
  const taf: TafRow[] = [];
  const [metarRes, tafRes] = await Promise.allSettled([
    fetchJson(
      `https://aviationweather.gov/api/data/metar?ids=${METAR_IDS}&format=json`,
      7000,
    ),
    fetchJson(
      `https://aviationweather.gov/api/data/taf?ids=${TAF_IDS}&format=json`,
      6000,
    ),
  ]);
  if (metarRes.status === "fulfilled") {
    for (const row of asList(metarRes.value)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const icao = String(r.icaoId ?? r.icao ?? "").toUpperCase();
      if (!icao) continue;
      const aero = AERO_BY_ICAO[icao];
      metar.push({
        icao,
        name: aero?.city ?? String(r.name ?? icao),
        raw: String(r.rawOb ?? r.raw ?? ""),
        tempC: typeof r.temp === "number" ? r.temp : null,
        dewC: typeof r.dewp === "number" ? r.dewp : null,
        windDir: windDirOf(r.wdir),
        windKt: typeof r.wspd === "number" ? r.wspd : null,
        visM: visToM(r.visib),
        qnh: typeof r.altim === "number" ? Math.round(r.altim) : null,
        wx: typeof r.wxString === "string" && r.wxString ? r.wxString : null,
        cat: typeof r.fltCat === "string" ? r.fltCat : null,
        lat: typeof r.lat === "number" ? r.lat : aero?.lat ?? null,
        lon: typeof r.lon === "number" ? r.lon : aero?.lon ?? null,
        obsAt:
          typeof r.obsTime === "number"
            ? new Date(r.obsTime * 1000).toISOString()
            : typeof r.reportTime === "string"
              ? r.reportTime
              : null,
      });
    }
  } else {
    const e = metarRes.reason;
    errors.push(`METAR: ${e instanceof Error ? e.message : "échec"}`);
  }
  if (tafRes.status === "fulfilled") {
    for (const row of asList(tafRes.value)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const icao = String(r.icaoId ?? "").toUpperCase();
      const text = String(r.rawTAF ?? r.raw ?? "");
      if (icao && text) taf.push({ icao, raw: text });
    }
  } else {
    const e = tafRes.reason;
    errors.push(`TAF: ${e instanceof Error ? e.message : "échec"}`);
  }
  return { metar, taf, errors };
}

function inAoPoint(lat: number, lon: number): boolean {
  return lat >= 0 && lat <= 28 && lon >= -18 && lon <= 38;
}

function coordsOf(raw: unknown): { lat: number; lon: number }[] {
  if (!Array.isArray(raw)) return [];
  const pts: { lat: number; lon: number }[] = [];
  for (const c of raw) {
    if (c && typeof c === "object" && "lat" in c && "lon" in c) {
      const lat = Number((c as { lat: unknown }).lat);
      const lon = Number((c as { lon: unknown }).lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    }
  }
  return pts;
}

async function pullSigmet(): Promise<{ rows: SigmetRow[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const raw = await fetchJson("https://aviationweather.gov/api/data/isigmet?format=json", 6000);
    const rows: SigmetRow[] = [];
    for (const row of asList(raw)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const coords = coordsOf(r.coords);
      const fir = String(r.firId ?? "");
      const firName = String(r.firName ?? fir);
      const inAo =
        coords.some((p) => inAoPoint(p.lat, p.lon)) ||
        /^(FT|DR|DF|DN|FC|FE|GO|GM|GA|HS|HL|HC|HT|HU|DA|DT|HE)/.test(fir);
      rows.push({
        fir,
        firName,
        hazard: String(r.hazard ?? "SIGMET"),
        qualifier: typeof r.qualifier === "string" && r.qualifier ? r.qualifier : null,
        raw: String(r.rawSigmet ?? ""),
        coords,
        validFrom:
          typeof r.validTimeFrom === "number"
            ? new Date(r.validTimeFrom * 1000).toISOString()
            : null,
        validTo:
          typeof r.validTimeTo === "number"
            ? new Date(r.validTimeTo * 1000).toISOString()
            : null,
        inAo,
      });
    }
    rows.sort((a, b) => Number(b.inAo) - Number(a.inAo));
    return { rows: rows.slice(0, 40), errors };
  } catch (e) {
    errors.push(`SIGMET: ${e instanceof Error ? e.message : "échec"}`);
    return { rows: [], errors };
  }
}

async function pullSpace(): Promise<SpaceWx> {
  const { week, towS } = gpsTime();
  let kp = 0;
  let kpTime: string | null = null;
  let gScale = "G0";
  let xrayFlux: number | null = null;
  let xrayAt: string | null = null;
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
      4000,
    );
    const list = asList(raw);
    const last = list[list.length - 1] as Record<string, unknown> | undefined;
    if (last) {
      kp = typeof last.kp_index === "number" ? last.kp_index : Number(last.kp) || 0;
      kpTime = typeof last.time_tag === "string" ? last.time_tag : null;
    }
  } catch {
    /* NOAA timeout — GPS week remains real */
  }
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/products/noaa-scales.json",
      4000,
    );
    if (raw && typeof raw === "object") {
      const now = (raw as Record<string, { G?: { Scale?: string } }>)["0"];
      // La NOAA donne le seul chiffre (« 0 ») : sans le G, l'écran affichait « Kp 0 0 ».
      if (now?.G?.Scale) gScale = `G${String(now.G.Scale).replace(/^G/i, "")}`;
    }
  } catch {
    gScale = kp >= 8 ? "G4" : kp >= 7 ? "G3" : kp >= 6 ? "G2" : kp >= 5 ? "G1" : "G0";
  }
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
      4000,
    );
    const list = asList(raw);
    const last = list[list.length - 1] as Record<string, unknown> | undefined;
    if (last) {
      xrayFlux = typeof last.flux === "number" ? last.flux : null;
      xrayAt = typeof last.time_tag === "string" ? last.time_tag : null;
    }
  } catch {
    /* GOES optional */
  }
  const xrayClass = xrayClassOf(xrayFlux);
  const note =
    kp >= 5
      ? "Orage géomagnétique — GNSS dégradé possible (scintillation ionosphérique)."
      : xrayClass.startsWith("M") || xrayClass.startsWith("X")
        ? `Éruption solaire ${xrayClass} — surveiller L1 / scintillation.`
        : "Indice Kp calme — intégrité GNSS nominale.";
  return {
    kp,
    kpTime,
    gScale,
    note,
    gpsWeek: week,
    gpsTowS: towS,
    xrayClass,
    xrayFlux,
    xrayAt,
  };
}

function emptyPicture(err: string): LivePicture {
  const g = gpsTime();
  return {
    at: Date.now(),
    source: "ingest partiel",
    aircraft: [],
    localN: 0,
    sahelN: 0,
    emergencies: [],
    metar: [],
    taf: [],
    space: {
      kp: 0,
      kpTime: null,
      gScale: "G?",
      note: "NOAA / 1090 encore en cours.",
      gpsWeek: g.week,
      gpsTowS: g.towS,
      xrayClass: "—",
      xrayFlux: null,
      xrayAt: null,
    },
    sigmets: [],
    jam: [],
    airport: null,
    alerts: [],
    solar: solarFttj(),
    sources: [],
    errors: [err],
    phenomena: [],
    continentSweep: releve.continentSweep,
  };
}

async function pullAirport(): Promise<{ airport: AirportRow | null; errors: string[] }> {
  try {
    const raw = await fetchJson(
      "https://aviationweather.gov/api/data/airport?ids=FTTJ&format=json",
      5000,
    );
    const row = asList(raw)[0];
    if (!row || typeof row !== "object") return { airport: null, errors: [] };
    const r = row as Record<string, unknown>;
    const runways = Array.isArray(r.runways) ? r.runways : [];
    const rwy0 = runways[0] as Record<string, unknown> | undefined;
    const dim = typeof rwy0?.dimension === "string" ? rwy0.dimension : "";
    const ft = parseInt(dim, 10);
    return {
      airport: {
        icao: String(r.icaoId ?? "FTTJ"),
        name: String(r.name ?? "N'Djamena"),
        lat: typeof r.lat === "number" ? r.lat : 12.1331,
        lon: typeof r.lon === "number" ? r.lon : 15.0339,
        elevM: typeof r.elev === "number" ? r.elev : 295,
        rwy: typeof rwy0?.id === "string" ? rwy0.id : null,
        rwyM: Number.isFinite(ft) ? Math.round(ft * 0.3048) : null,
        freqs: typeof r.freqs === "string" && r.freqs ? r.freqs : null,
        country: typeof r.country === "string" ? r.country : "TD",
      },
      errors: [],
    };
  } catch (e) {
    return {
      airport: null,
      errors: [`FTTJ: ${e instanceof Error ? e.message : "échec"}`],
    };
  }
}

async function pullAlerts(): Promise<{ alerts: SwpcAlert[]; errors: string[] }> {
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/products/alerts.json",
      4000,
    );
    const out: SwpcAlert[] = [];
    const seen = new Set<string>();
    for (const row of asList(raw).slice().reverse()) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const msg = String(r.message ?? "");
      const kindLine = msg
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^(ALERT|WATCH|WARNING|SUMMARY):/i.test(l));
      if (!kindLine) continue;
      const kind = kindLine.split(":")[0]!.toUpperCase();
      const title = kindLine.replace(/^[A-Z]+:\s*/i, "").trim();
      const impact =
        msg.match(/Potential Impacts:\s*([^\r\n]+)/i)?.[1]?.trim().slice(0, 180) ??
        null;
      const key = `${kind}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code: String(r.product_id ?? ""),
        at: typeof r.issue_datetime === "string" ? r.issue_datetime : null,
        kind,
        title,
        impact,
      });
      if (out.length >= 6) break;
    }
    return { alerts: out, errors: [] };
  } catch (e) {
    return {
      alerts: [],
      errors: [`SWPC: ${e instanceof Error ? e.message : "échec"}`],
    };
  }
}

/** Le relevé RÉSEAU seul (sans l'antenne du poste) : pour le diagnostic des sources Internet. */
export function peekLiveCache(): LivePicture | null {
  return releve.cache?.data ?? releve.lastGood;
}

/**
 * Relevé Internet allumé par le chef : le poste relève, console ouverte ou non (la veille du serveur
 * l'appelle à chaque ronde). Un seul relevé à la fois, et pas plus d'un toutes les 20 s, comme
 * pour la console. Coupé : rien ne sort.
 */
export async function releverSiActif(): Promise<void> {
  const { releveInternetActif } = await import("./releve-internet.server");
  if (!(await releveInternetActif())) return;
  if (releve.cache && Date.now() - releve.cache.at < TTL_MS) return;
  await refreshNetwork().catch(() => undefined);
}

/**
 * L'image que voit la console — relevé réseau vieilli plus antenne du poste (voir image-poste) —
 * sans déclencher de relevé Internet : pour l'assistant, le briefing, la relève, les commandes du
 * poste et le bot. null tant que ni le réseau ni l'antenne n'ont rien donné.
 */
export async function imagePoste(): Promise<LivePicture | null> {
  const rx = await import("./rx1090.server");
  const now = Date.now();
  return imageDuPoste(
    peekLiveCache(),
    rx.receiverStatus(now),
    rx.receiverAircraft(now),
    now,
    () => emptyPicture("relevé Internet absent"),
  );
}

async function pullPhenomena(): Promise<{ rows: Phenomenon[]; errors: string[] }> {
  const errors: string[] = [];
  const chunks: Phenomenon[][] = [];
  try {
    const raw = await fetchJson(
      "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=120",
      7000,
    );
    chunks.push(parseEonet(raw));
  } catch (e) {
    errors.push(`EONET: ${e instanceof Error ? e.message : "échec"}`);
  }
  try {
    const raw = await fetchJson(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
      6000,
    );
    chunks.push(parseUsgs(raw));
  } catch (e) {
    errors.push(`USGS: ${e instanceof Error ? e.message : "échec"}`);
  }
  try {
    const raw = await fetchJson(
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF",
      7000,
    );
    chunks.push(parseGdacs(raw));
  } catch (e) {
    errors.push(`GDACS: ${e instanceof Error ? e.message : "échec"}`);
  }
  const firms = await pullFirms();
  chunks.push(firms.rows);
  errors.push(...firms.errors);
  return { rows: mergePhenomena(chunks).slice(0, 120), errors };
}

function sigmetsAsPhenomena(rows: { fir: string; hazard: string; raw: string; coords: { lat: number; lon: number }[]; inAo: boolean }[]): Phenomenon[] {
  const out: Phenomenon[] = [];
  for (const s of rows) {
    if (s.coords.length === 0) continue;
    const lat = s.coords.reduce((a, p) => a + p.lat, 0) / s.coords.length;
    const lon = s.coords.reduce((a, p) => a + p.lon, 0) / s.coords.length;
    const theater = theaterOf(lat, lon);
    const haz = s.hazard.toUpperCase();
    const kind =
      /TS|STORM|TURB/.test(haz) ? "tempete" as const :
      /VA|VOLCAN/.test(haz) ? "volcan" as const :
      /DS|SS|DUST/.test(haz) ? "poussiere" as const :
      "sigmet" as const;
    out.push({
      id: `sig-${s.fir}-${haz}-${Math.round(lat * 10)}-${Math.round(lon * 10)}`,
      kind,
      title: `SIGMET ${s.fir} · ${s.hazard}`,
      body: (s.raw || s.hazard).slice(0, 160),
      lat,
      lon,
      at: Date.now(),
      theater,
      level: s.inAo ? "elevee" : "moderee",
      source: "SIGMET OACI",
    });
  }
  return out;
}

/** Image des sources Internet (agrégateurs 1090ES, NOAA, NASA…), mise en cache 20 s. */
async function pullNetwork(): Promise<LivePicture> {
  const now = Date.now();
  if (releve.cache && now - releve.cache.at < TTL_MS) return releve.cache.data;
  try {
    const data = await Promise.race([
      (async () => {
        const [adsb, wx, space, sig, apt, swpc, nat] = await Promise.all([
          pullAdsb(),
          pullMetar(),
          pullSpace(),
          pullSigmet(),
          pullAirport(),
          pullAlerts(),
          pullPhenomena(),
        ]);
        // L'image est tamponnée quand le DERNIER flux a répondu ; les âges des avions valaient au
        // relevé 1090, quelques secondes plus tôt. On les ramène à l'heure de l'image : sans cela,
        // l'heure d'observation glissait de 2 à 4 s à chaque rafraîchissement (mesuré).
        const at = Date.now();
        const aircraft = ageLiveAc(adsb.ac, (at - adsb.refAt) / 1000);
        const { antennePoste } = await import("./rx1090.server");
        const jam: JamCell[] = jamFromAircraft(aircraft);
        const emergencies = aircraft.filter((a) => Boolean(a.emergency));
        const solar = solarFttj();
        const sources: SourceHealth[] = [
          health(
            "1090",
            "1090ES adsb.fi / adsb.lol",
            adsb.ok,
            adsb.ok
              ? `${aircraft.length} squitters · ${adsb.source}`
              : adsb.errors[0] ?? "silence",
          ),
          health(
            "metar",
            "METAR NOAA",
            wx.metar.length > 0,
            wx.metar.length
              ? `${wx.metar.length} aérodromes ASECNA/Sahel`
              : wx.errors[0] ?? "aucun METAR",
          ),
          health(
            "taf",
            "TAF NOAA",
            wx.taf.length > 0,
            wx.taf.length
              ? `${wx.taf.length} TAF`
              : (wx.errors.find((e) => e.startsWith("TAF:")) ?? "aucun TAF"),
          ),
          health(
            "sigmet",
            "SIGMET OACI",
            sig.rows.length > 0,
            sig.rows.length
              ? `${sig.rows.filter((s) => s.inAo).length} Afrique · ${sig.rows.length} monde`
              : sig.errors[0] ?? "aucun SIGMET",
          ),
          health(
            "swpc",
            "NOAA SWPC",
            space.kpTime != null || space.xrayFlux != null,
            `Kp ${space.kp} · GOES ${space.xrayClass}`,
          ),
          nicHealth(aircraft, jam),
          health(
            "fttj",
            "FTTJ AWC",
            apt.airport != null,
            apt.airport
              ? `RWY ${apt.airport.rwy ?? "—"} · ${apt.airport.rwyM ?? "—"} m · ${apt.airport.freqs ?? "TWR"}`
              : apt.errors[0] ?? "aéroport indisponible",
          ),
          health(
            "alert",
            "Alertes SWPC",
            swpc.alerts.length > 0,
            swpc.alerts.length
              ? `${swpc.alerts[0]!.kind} · ${swpc.alerts[0]!.title}`
              : "aucune alerte en cours",
          ),
          health(
            "sol",
            "Soleil FTTJ",
            true,
            solar.nightOps
              ? `Nuit · lev ${solar.sunrise} WAT`
              : `Jour · couch ${solar.sunset} WAT`,
          ),
          health(
            "nat",
            "Phénomènes NASA/USGS/GDACS/FIRMS",
            nat.rows.length > 0,
            nat.rows.length
              ? `${nat.rows.length} événements · ${
                  nat.rows.filter((p) => p.source === "NASA FIRMS").length
                } FIRMS · ${nat.rows.filter((p) => p.theater !== "monde").length} théâtre${
                  nat.errors.find((e) => e.startsWith("FIRMS"))
                    ? ` · ${nat.errors.find((e) => e.startsWith("FIRMS"))}`
                    : ""
                }`
              : nat.errors[0] ?? "aucun événement",
          ),
        ];
        const phenomena = mergePhenomena([
          nat.rows,
          sigmetsAsPhenomena(sig.rows),
        ]).slice(0, 120);
        return {
          at,
          source: adsb.source,
          aircraft,
          localN: localN(aircraft, antennePoste()),
          sahelN: sahelCount(aircraft),
          emergencies,
          metar: wx.metar,
          taf: wx.taf,
          space,
          sigmets: sig.rows,
          jam,
          airport: apt.airport,
          alerts: swpc.alerts,
          solar,
          sources,
          errors: [...adsb.errors, ...wx.errors, ...sig.errors, ...apt.errors, ...swpc.errors, ...nat.errors],
          phenomena,
          continentSweep: releve.continentSweep,
          ...(releve.entendus && at - releve.entendus.at <= LISTE_MIL_VIE_MS
            ? { dronesEntendus: releve.entendus }
            : {}),
        } satisfies LivePicture;
      })(),
      new Promise<LivePicture>((resolve) => {
        setTimeout(() => resolve(emptyPicture("timeout 12s")), 12000);
      }),
    ]);
    const usable =
      data.aircraft.length > 0 ||
      data.metar.length > 0 ||
      data.taf.length > 0 ||
      data.sigmets.length > 0 ||
      data.airport != null ||
      data.alerts.length > 0;
    const rateLimited = data.errors.some((e) => e.includes("429"));
    let next = data;
    if (
      data.aircraft.length === 0 &&
      releve.lastGood &&
      releve.lastGood.aircraft.length > 0 &&
      Date.now() - releve.lastGood.at < 180_000 &&
      rateLimited
    ) {
      // Les avions du dernier bon relevé, sous l'heure de la NOUVELLE image : il faut les vieillir
      // d'autant, sinon ils paraissent jusqu'à 3 min plus frais qu'ils ne sont.
      const aircraft = ageLiveAc(releve.lastGood.aircraft, (data.at - releve.lastGood.at) / 1000);
      next = {
        ...data,
        aircraft,
        localN: releve.lastGood.localN,
        sahelN: releve.lastGood.sahelN,
        emergencies: aircraft.filter((a) => Boolean(a.emergency)),
        jam: releve.lastGood.jam,
        source: `${releve.lastGood.source} · cache 1090`,
      };
    }
    if (usable || next.aircraft.length > 0) {
      releve.cache = { at: Date.now(), data: next };
      releve.lastGood = next;
      // Ce que ce relevé a reçu (météo, SIGMET…), gardé s'il a changé ; ses aéronefs le sont
      // avec le trafic reçu.
      void import("./releve-garde.server")
        .then(({ garderReleve }) => garderReleve(data))
        .catch(() => undefined);
      return next;
    }
    if (releve.lastGood && Date.now() - releve.lastGood.at < 120_000) {
      return {
        ...releve.lastGood,
        errors: [...data.errors, "cache conservé"].slice(0, 6),
      };
    }
    return data;
  } catch (e) {
    if (releve.lastGood) return releve.lastGood;
    return emptyPicture(e instanceof Error ? e.message : "ingest échoué");
  }
}


/** Un seul relevé Internet à la fois, même quand le poste interroge souvent. */
function refreshNetwork(): Promise<LivePicture> {
  releve.netPending ??= pullNetwork()
    .then((p) => {
      releve.netLast = p;
      return p;
    })
    .finally(() => {
      releve.netPending = null;
      releve.tentativeA = Date.now();
    });
  return releve.netPending;
}

/**
 * Pour le bot Signal, qui répond sans console ouverte (c'est la console qui relève Internet
 * d'habitude) : l'âge du relevé Internet que lira la commande, et s'il a plus de 20 s, un nouveau
 * relevé lancé. Absent ou vieux de plus de 2 min (voir attendreReleve), la commande l'attend,
 * `maxMs` au plus : 7,4 à 9,4 s mesurés à froid à travers le proxy du poste d'essai. Sinon rien
 * n'attend : la commande répond avec ce que le poste a, et dit son âge.
 */
export async function releveInternetPourBot(
  maxMs: number,
): Promise<{ ageMs: number | null; frais: boolean; attenduMs: number; coupe: boolean }> {
  const age = () => {
    const lu = peekLiveCache();
    return lu ? Date.now() - lu.at : null;
  };
  let ageMs = age();
  // Coupé par le chef : rien ne part ; la commande lit ce que le poste a, et le dit.
  if (!(await (await import("./releve-internet.server")).releveInternetActif())) {
    return { ageMs, frais: ageMs != null && ageMs < TTL_MS, attenduMs: 0, coupe: true };
  }
  let attenduMs = 0;
  if (ageMs == null || ageMs >= TTL_MS) {
    const enCours = refreshNetwork();
    if (maxMs > 0 && attendreReleve(ageMs, Date.now() - releve.tentativeA)) {
      const t0 = Date.now();
      await Promise.race([
        enCours.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((ok) => setTimeout(ok, maxMs).unref()),
      ]);
      attenduMs = Date.now() - t0;
      ageMs = age();
    }
  }
  return { ageMs, frais: ageMs != null && ageMs < TTL_MS, attenduMs, coupe: false };
}

/** Dit dans l'image quand le relevé Internet est coupé (à la livraison, ou par le chef). */
export const RELEVE_COUPE =
  "Relevé Internet coupé : antenne du poste et dernier relevé seulement ; le chef de division l'active dans Capteurs › Outils.";

/** Le dernier relevé Internet, pour l'écran du chef : son heure et ses sources reçues. */
export type ResumeReleve = { at: number; recues: number; sources: number; erreurs: string[] };

function resumeReleve(): ResumeReleve | null {
  const lu = peekLiveCache();
  if (!lu) return null;
  // « rx » est l'antenne du poste : pas une source Internet.
  const net = lu.sources.filter((s) => s.id !== "rx");
  return { at: lu.at, recues: net.filter((s) => s.ok).length, sources: net.length, erreurs: lu.errors.slice(0, 4) };
}

export type EtatReleveEcran = import("./releve-internet.server").EtatReleveInternet & {
  dernier: ResumeReleve | null;
};

/** État du relevé Internet : tout agent connecté le lit. */
export const lireReleveInternet = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<EtatReleveEcran> => {
    const srv = await import("./releve-internet.server");
    return { ...(await srv.lireReleve()), dernier: resumeReleve() };
  });

/** Le chef active ou coupe le relevé Internet ; chaque bascule va au journal. */
export const basculerReleveInternet = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { actif?: boolean }) => {
    if (typeof raw?.actif !== "boolean") throw new Error("Bascule invalide");
    return { actif: raw.actif };
  })
  .handler(async ({ data, context }): Promise<EtatReleveEcran> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./releve-internet.server");
    const e = await srv.basculerReleve(data.actif);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "releve",
      title: `Relevé Internet ${data.actif ? "activé" : "coupé"} par le chef`,
      detail: [
        data.actif
          ? "Le poste relève de nouveau ses sources Internet, toutes les 20 s au plus."
          : "Plus rien ne sort du poste pour le relevé : antenne du poste et dernier relevé seulement ; « relever maintenant » reste au chef.",
        e.enregistrement === "fichier"
          ? "Enregistré sur le poste (data/releve-internet.json)."
          : "Disque en lecture seule : valable jusqu'au redémarrage du serveur.",
      ].join(" "),
      // Coupé, l'image perd ce qui ne vient que d'Internet : à voir au journal.
      severity: data.actif ? "info" : "warn",
    });
    return { ...e, dernier: resumeReleve() };
  });

/**
 * « Relever maintenant » : un relevé Internet à l'ordre du chef, même relevé coupé — un seul, et
 * journalisé. Un relevé de moins de 20 s est rendu tel quel, sans nouvelle requête.
 */
export const releverMaintenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<EtatReleveEcran & { ms: number }> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./releve-internet.server");
    const avant = peekLiveCache()?.at ?? null;
    const t0 = performance.now();
    await refreshNetwork();
    const ms = Math.round(performance.now() - t0);
    const d = resumeReleve();
    // Un relevé de moins de 20 s est rendu tel quel : rien n'est sorti, et le journal le dit.
    const neuf = d != null && d.at !== avant;
    if (neuf) await srv.noterOrdre(d.at);
    const e = await srv.lireReleve();
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "releve",
      title: "Relevé Internet sur ordre du chef",
      detail: !neuf
        ? `Relevé de moins de 20 s rendu tel quel${d ? ` (${d.recues}/${d.sources} sources)` : ""} : rien n'est sorti du poste.`
        : `${d.recues}/${d.sources} sources Internet reçues en ${ms.toLocaleString("fr-FR")} ms${e.actif ? "." : " — relevé coupé : ce seul relevé est sorti du poste."}`,
      severity: neuf && !e.actif ? "warn" : "info",
    });
    return { ...e, dernier: d, ms };
  });

export const fetchLivePicture = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<LivePicture> => {
    const rx = await import("./rx1090.server");
    await rx.receiverReady();
    const status = rx.receiverStatus();
    const coupe = !(await (await import("./releve-internet.server")).releveInternetActif());
    let net: LivePicture;
    if (coupe) {
      // Coupé par le chef : aucune requête ; le dernier relevé vieillit à vue, et l'image le dit.
      net = releve.lastGood
        ? { ...releve.lastGood, errors: [RELEVE_COUPE, ...releve.lastGood.errors].slice(0, 6) }
        : emptyPicture(RELEVE_COUPE);
    } else if (releve.cache && Date.now() - releve.cache.at < TTL_MS) {
      net = releve.cache.data;
    } else if (!status.connected) {
      net = await refreshNetwork();
    } else {
      // Antenne branchée : les pistes locales n'attendent jamais un Internet lent ou coupé.
      const pending = refreshNetwork();
      net =
        releve.netLast ??
        (await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 1500))])) ??
        emptyPicture("relevé Internet en cours");
    }
    // L'image réseau peut venir du cache (20 s) ou du dernier relevé gardé en secours quand
    // l'antenne est branchée — donc être VIEILLE. La resservir telle quelle annonçait des positions
    // plus fraîches qu'elles ne sont, et le recalage d'âge, qui lit précisément ce champ,
    // sous-corrigeait d'autant : jusqu'à 4,4 km à 800 km/h. On vieillit ICI, au seul endroit où
    // toutes les provenances de `net` se rejoignent, donc exactement une fois.
    const now = Date.now();
    const pic = fusionAntenne(vieillir(net, now), status, rx.receiverAircraft(now), now);
    // Bande du poste pour l'inject REJEU RÉEL : seulement ce qui a vraiment été reçu. L'âge du
    // cache est déjà porté par `pic` ci-dessus — le rajouter ici le compterait deux fois.
    const rec = await import("./rejeu.server");
    rec.recordFrame(now, pic.aircraft);
    // Archivage automatique périodique de la bande réelle (si activé, bande ≥ 3 min).
    const arch = await import("./archive.server");
    void arch.maybeAutoArchive(rec.currentPosteTape());
    return pic;
  });

/** Bande de l'inject REJEU RÉEL : ce que ce poste a entendu (30 min), sinon l'archive réelle livrée. */
export const fetchRejeuTape = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<RejeuTape | null> => {
    const rec = await import("./rejeu.server");
    return rec.rejeuTape();
  });

/** Liste des enregistrements archivés (bandes réelles 1090ES). */
export const fetchArchives = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ archives: ArchiveMeta[]; auto: boolean }> => {
    const arch = await import("./archive.server");
    return { archives: await arch.listArchives(), auto: arch.autoArchiveOn() };
  });

/** Archive la bande réelle en cours (manuel). Rejette une veille de moins de 3 minutes. */
export const archiveNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ ok: boolean; meta?: ArchiveMeta; error?: string }> => {
    const rec = await import("./rejeu.server");
    const arch = await import("./archive.server");
    try {
      const meta = await arch.saveBand(rec.currentPosteTape(), "manuel");
      return { ok: true, meta };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "archivage impossible" };
    }
  });

/** Active / désactive l'archivage automatique (superadmin). */
export const setAutoArchive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { on?: boolean }) => ({ on: Boolean(raw?.on) }))
  .handler(async ({ data, context }): Promise<{ auto: boolean }> => {
    const { requireSuperadmin } = await import("./staff");
    await requireSuperadmin(context.userId);
    const arch = await import("./archive.server");
    arch.setAutoArchive(data.on);
    return { auto: arch.autoArchiveOn() };
  });

/** Contenu JSON d'une archive, pour téléchargement (base64 pour franchir le transport). */
export const downloadArchive = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ id: string; json: string } | null> => {
    const arch = await import("./archive.server");
    const json = await arch.getArchiveJson(data.id);
    return json ? { id: data.id, json } : null;
  });

/** Imagerie Sentinel-2 Copernicus : la clé gratuite de l'opérateur est-elle configurée et valide ? */
export const sentinelCheck = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ configured: boolean; ok: boolean; error: string | null }> => {
    const sh = await import("./sentinelhub.server");
    return sh.sentinelCheck();
  });

/**
 * Comparateur avant/après d'un site minier : deux composites Sentinel-2 datés du même périmètre.
 * Réception seule. Renvoie la clé manquante honnêtement plutôt qu'une fausse image.
 */
export const fetchChangePair = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { lat?: number; lon?: number; radiusKm?: number }) => ({
    lat: Number(raw?.lat),
    lon: Number(raw?.lon),
    radiusKm: Number(raw?.radiusKm),
  }))
  .handler(async ({ data }): Promise<import("./sentinelhub.server").ChangePair> => {
    const sh = await import("./sentinelhub.server");
    const okCoords =
      Number.isFinite(data.lat) &&
      data.lat >= -90 &&
      data.lat <= 90 &&
      Number.isFinite(data.lon) &&
      data.lon >= -180 &&
      data.lon <= 180 &&
      Number.isFinite(data.radiusKm) &&
      data.radiusKm > 0;
    if (!okCoords) return { ok: false, configured: sh.sentinelConfigured(), reason: "coordonnées invalides" };
    return sh.sentinelChangePair(data.lat, data.lon, data.radiusKm);
  });

/** Phonie ATC — état de l'enregistrement du flux public (réception seule). */
export const atcStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ status: AtcStatus; segments: AtcSegment[]; total: number }> => {
    const atc = await import("./atc.server");
    return {
      status: atc.atcStatus(),
      segments: await atc.atcSegments(),
      total: await atc.atcNombreSegments(),
    };
  });

/** Active / coupe l'enregistrement de la phonie ATC publique (réception seule, sans limite). */
export const atcToggle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { on?: boolean }) => ({ on: Boolean(raw?.on) }))
  .handler(async ({ data }): Promise<{ status: AtcStatus }> => {
    const atc = await import("./atc.server");
    return { status: data.on ? atc.atcStart() : atc.atcStop() };
  });

/** Un segment de phonie ATC (audio, base64) pour téléchargement. */
export const downloadAtcSegment = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ id: string; b64: string } | null> => {
    const atc = await import("./atc.server");
    return atc.atcSegmentData(data.id);
  });

/**
 * Balayage total : le chef de division fait entrer les ancres mondiales dans la rotation, qui couvre
 * toujours l'Afrique et le Moyen-Orient. Lecture passive — seul le nombre de cellules change.
 * Réservé au superadmin ; le relevé suivant reflète le changement.
 */
export const setContinentSweep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { on?: boolean }) => ({ on: Boolean(raw?.on) }))
  .handler(async ({ data, context }): Promise<{ on: boolean }> => {
    const { requireSuperadmin } = await import("./staff");
    await requireSuperadmin(context.userId);
    setContinentSweepFlag(data.on);
    // Le cache réseau est invalidé pour que le balayage parte au prochain relevé, pas dans 20 s.
    releve.cache = null;
    return { on: getContinentSweep() };
  });

/** Écoute brute de l'antenne : les trames telles qu'elles arrivent, décodées, sans filtre. */
export const fetchReceiverFeed = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw: { after?: number }) => ({
    after: typeof raw?.after === "number" && Number.isFinite(raw.after) ? raw.after : 0,
  }))
  .handler(async ({ data }): Promise<ReceiverFeed> => {
    const rx = await import("./rx1090.server");
    return rx.receiverFeed(data.after);
  });

export type AircraftLookup = {
  ok: boolean;
  hex: string;
  type: string | null;
  icaoType: string | null;
  manufacturer: string | null;
  registration: string | null;
  operator: string | null;
  country: string | null;
  /** Le marquage militaire et sa source, ou « inconnu » (voir registre-poste.marquage). */
  militaire: string;
  error?: string;
};

/**
 * Registre ICAO24 de la console : le même code que /registre (adsbdb, marquage adsb.lol), réservé
 * au chef de division et journalisé — la requête nomme l'avion et sort du poste.
 */
export const lookupAircraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { hex: string }) => ({
    hex: String(raw.hex ?? "")
      .replace(/[^0-9a-f]/gi, "")
      .toLowerCase()
      .slice(0, 6),
  }))
  .handler(async ({ data, context }): Promise<AircraftLookup> => {
    const vide: AircraftLookup = {
      ok: false,
      hex: data.hex,
      type: null,
      icaoType: null,
      manufacturer: null,
      registration: null,
      operator: null,
      country: null,
      militaire: "inconnu",
    };
    if (!/^[0-9a-f]{6}$/.test(data.hex)) return { ...vide, error: "ICAO24 — 6 hex" };
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const reg = await import("./registre-poste");
    const cible = reg.cibleRegistre(data.hex, await imagePoste());
    if ("erreur" in cible) return { ...vide, error: cible.erreur };
    const r = await (await import("./registre-poste.server")).consulterRegistre(cible);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "registre",
      title: `Registre en ligne : ${data.hex.toUpperCase()}`,
      detail: reg.resumeRegistre(r),
      severity: "warn",
    });
    const db = r.adsbdb;
    const militaire = reg.marquage(r);
    if (db == null) return { ...vide, militaire, error: "Inconnu du registre adsbdb" };
    if ("erreur" in db) return { ...vide, militaire, error: `adsbdb ${db.erreur}` };
    return {
      ok: true,
      hex: data.hex,
      type: db.type,
      icaoType: db.icaoType,
      manufacturer: db.constructeur,
      registration: db.immat,
      operator: db.proprietaire,
      country: db.pays,
      militaire,
    };
  });

/** Briefing de la situation par l'IA du poste, à partir des commandes activées pour la console. */
export const briefLivePicture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(
    async (): Promise<
      { ok: true; text: string; competences: string[] } | { ok: false; error: string }
    > => (await import("./agent-poste.server")).briefing("console"),
  );

/**
 * État de l'IA du poste (bouton « Tester le serveur » dans Capteurs > Outils) : réglée, sur le
 * réseau du poste, répond, avec quel modèle.
 */
export const iaStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async (): Promise<{
      configured: boolean;
      ok: boolean;
      error: string | null;
      modele: string | null;
    }> => {
      const ia = await import("./ia-poste.server");
      return ia.iaCheck();
    },
  );

import type { ReponseAssistant } from "./agent-poste.server";
export type { ReponseAssistant };

/**
 * Assistant IA du poste — question libre de l'opérateur, depuis la console. L'agent consulte les
 * commandes du poste utiles à la question (activées pour la console), puis l'IA du poste rédige ;
 * sans IA, la console montre leurs lignes et la notice, sans rédaction (voir agent-poste.server).
 */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { question?: string; track?: string }) => ({
    question: String(raw?.question ?? "").trim().slice(0, IA_QUESTION_MAX),
    // Résumé factuel d'une piste précise (construit par le client à partir de champs typés).
    track: String(raw?.track ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data, context }): Promise<ReponseAssistant> => {
    const { journalDe } = await import("./journal-poste.server");
    return (await import("./agent-poste.server")).repondre(
      data.question,
      "console",
      journalDe(context.userId),
      data.track,
    );
  });

/** Une ligne du diagnostic du poste. */
export type DiagRow = {
  id: string;
  label: string;
  /** ok = répond ; warn = réglé mais rien reçu / vieux ; crit = réglé mais en échec ; off = non réglé (optionnel). */
  state: "ok" | "warn" | "crit" | "off";
  detail: string;
};

/**
 * Diagnostic du poste : état réel et honnête de chaque source. N'INTERROGE PAS les API publiques
 * (pas de martèlement) — il lit le dernier relevé en cache, l'état mémoire de l'antenne / de la
 * phonie, et la présence des clés (variables d'environnement). Instantané, gratuit, sans effet de bord.
 */
export const posteDiagnostic = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ at: number; rows: DiagRow[] }> => {
    const now = Date.now();
    const rows: DiagRow[] = [];
    const pic = peekLiveCache();

    if (!pic) {
      rows.push({ id: "ingest", label: "Ingest capteurs", state: "warn", detail: "Pas encore de relevé — le premier cycle 1090 / météo arrive." });
    } else {
      const ageS = Math.round((now - pic.at) / 1000);
      rows.push({ id: "ingest", label: "Ingest capteurs", state: ageS < 120 ? "ok" : "warn", detail: `Dernier relevé il y a ${ageS} s.` });

      const n = pic.aircraft.length;
      rows.push({
        id: "adsb",
        label: "1090ES réseau (passif)",
        state: n > 0 ? "ok" : "warn",
        detail: n > 0 ? `${n} contacts Afrique, ${pic.localN} à moins de 120 km de l'antenne du poste.` : "Aucun squitter au dernier relevé — réel là où le réseau public n'a pas de récepteur.",
      });

      const fttj = pic.metar.find((m) => m.icao === "FTTJ");
      rows.push({
        id: "metar",
        label: "METAR / météo aéro",
        state: fttj ? "ok" : "warn",
        detail: fttj ? `FTTJ reçu · ${pic.metar.length} stations.` : `FTTJ muet (station parfois silencieuse) · ${pic.metar.length} stations au total.`,
      });

      const sig = pic.sigmets.filter((s) => s.inAo).length;
      rows.push({ id: "sigmet", label: "SIGMET Afrique (OACI)", state: "ok", detail: sig > 0 ? `${sig} actifs dans la zone.` : "Source OK, aucun actif dans la zone." });

      rows.push({ id: "swpc", label: "Météo spatiale (NOAA SWPC)", state: "ok", detail: `Kp ${pic.space.kp} ${pic.space.gScale} · GOES ${pic.space.xrayClass}.` });
    }

    const rx = await import("./rx1090.server");
    const rs = rx.receiverStatus(now);
    if (!rs.enabled) {
      rows.push({ id: "antenne", label: "Antenne 1090 locale", state: "off", detail: "Désactivée (AFRICONTROL_1090 non réglée ou =off). Réseau passif seul." });
    } else if (rs.connected) {
      rows.push({ id: "antenne", label: "Antenne 1090 locale", state: "ok", detail: `${rs.endpoint} connectée · ${rs.msgPerS}/s · ${rs.positioned} positionnés.` });
    } else {
      rows.push({ id: "antenne", label: "Antenne 1090 locale", state: "crit", detail: `${rs.endpoint} injoignable${rs.lastError ? ` : ${rs.lastError}` : ""}. Vérifier dump1090 (port 30002).` });
    }

    const atc = await import("./atc.server");
    const as = atc.atcStatus();
    if (!as.configured) {
      rows.push({ id: "atc", label: "Phonie ATC (réception)", state: "off", detail: "Flux non réglé (AFRICONTROL_ATC). Optionnel, réception seule." });
    } else if (as.recording && as.connected) {
      rows.push({ id: "atc", label: "Phonie ATC (réception)", state: "ok", detail: `Enregistre ${as.endpoint} · ${await atc.atcNombreSegments()} segments gardés.` });
    } else if (as.recording && !as.connected) {
      rows.push({ id: "atc", label: "Phonie ATC (réception)", state: "crit", detail: `${as.endpoint} injoignable${as.lastError ? ` : ${as.lastError}` : ""}.` });
    } else {
      rows.push({ id: "atc", label: "Phonie ATC (réception)", state: "warn", detail: "Réglée mais à l'arrêt (activer dans Phonie ATC)." });
    }

    const gps = await import("./gps.server");
    const gs = gps.gpsStatus();
    if (!gs.configured) {
      rows.push({ id: "gps", label: "GPS du poste (position/heure)", state: "off", detail: "Non réglé (AFRICONTROL_GPS). Optionnel : récepteur GPS → position + UTC auto." });
    } else if (gs.hasFix) {
      rows.push({ id: "gps", label: "GPS du poste (position/heure)", state: "ok", detail: `${gs.lat!.toFixed(4)}, ${gs.lon!.toFixed(4)} · ${gs.sats ?? "?"} sats · HDOP ${gs.hdop ?? "?"} · ${gs.source}` });
    } else if (gs.connected) {
      rows.push({ id: "gps", label: "GPS du poste (position/heure)", state: "warn", detail: `${gs.source} connecté, pas encore de fix (ciel dégagé ?).` });
    } else {
      rows.push({ id: "gps", label: "GPS du poste (position/heure)", state: "crit", detail: `${gs.source} injoignable${gs.error ? ` : ${gs.error}` : ""}.` });
    }

    const ia = await import("./ia-poste.server");
    const iaKo = ia.iaIndisponible();
    rows.push({
      id: "ia",
      label: "IA du poste (serveur sur place)",
      state: !iaKo ? "ok" : iaKo.reglee ? "crit" : "off",
      detail: !iaKo
        ? "Serveur réglé sur le réseau du poste. « Tester le serveur » dans Outils pour un essai live."
        : iaKo.reglee
          ? iaKo.erreur
          : // Une ancienne clé de service public posée au lancement n'est plus lue : le dire, pour que
            // personne ne croie l'assistant branché.
            `Non réglée (AFRICONTROL_IA) — assistant, briefing et compte rendu indisponibles.${process.env.AFRICONTROL_DEEPSEEK || process.env.XAI_API_KEY ? " AFRICONTROL_DEEPSEEK et XAI_API_KEY ne sont plus lues : l'IA ne sort plus du poste." : ""}`,
    });

    const sh = await import("./sentinelhub.server");
    rows.push({
      id: "sentinel",
      label: "Imagerie Sentinel-2 (Copernicus)",
      state: sh.sentinelConfigured() ? "ok" : "off",
      detail: sh.sentinelConfigured() ? "Clé posée. « Tester la clé » dans Outils pour un essai live." : "Clé non posée (gratuite, optionnelle).",
    });

    return { at: now, rows };
  });

/**
 * Compte rendu de quart (AAR) rédigé par l'IA du poste à partir des VRAIS événements du journal de
 * preuve. Le client fournit des lignes factuelles (champs typés des bulletins, coordonnées
 * comprises), le serveur les met en forme et demande une synthèse structurée au serveur d'IA du
 * réseau du poste : les bulletins ne sortent pas. Les bulletins d'exercice ou de rejeu sont fournis
 * marqués « EXERCICE » et ne doivent jamais être présentés comme du trafic réel.
 */
export const shiftReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { events?: unknown; meta?: string }) => ({
    events: Array.isArray(raw?.events)
      ? raw.events.map((e) => String(e)).filter(Boolean).slice(0, 60)
      : [],
    meta: String(raw?.meta ?? "").trim().slice(0, 300),
  }))
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const ia = await import("./ia-poste.server");
    const indispo = ia.iaIndisponible();
    if (indispo) return { ok: false, error: `Compte rendu indisponible : ${indispo.erreur}` };
    if (data.events.length === 0) {
      return { ok: false, error: "Aucun bulletin au journal — rien à résumer." };
    }
    const system =
      "Tu es l'officier de quart du poste COP AfriControl (N'Djamena/FTTJ, Tchad), sûreté de sites. " +
      "Rédige un COMPTE RENDU DE QUART en français, factuel, sans markdown, à partir des SEULS bulletins " +
      "fournis — n'invente rien, ne complète pas. Structure : 1) Période et volume (nombre de bulletins). " +
      "2) Faits marquants (pistes, origines, confiance). 3) Points d'attention. 4) Une recommandation pour " +
      "la relève. Un bulletin marqué EXERCICE est un exercice ou un rejeu : ne le compte jamais comme trafic " +
      "réel, signale-le comme exercice. Si les données sont minces, dis-le au lieu de broder.";
    const user = `${data.meta ? data.meta + "\n" : ""}Bulletins du journal (les plus récents en tête) :\n${data.events.join("\n")}`;
    try {
      const text = await ia.iaChatVerifie(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: 700 },
      );
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "compte rendu échoué" };
    }
  });

/** État du GPS du poste (position + heure réelles d'un récepteur branché). Lecture seule. */
export const gpsStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const gps = await import("./gps.server");
    return gps.gpsStatus();
  });

/** Liaison Internet en direct : le poste atteint-il ses sources (imagerie, 1090, météo) ? */
export const linkStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const net = await import("./connectivity.server");
    return net.linkStatus();
  });
