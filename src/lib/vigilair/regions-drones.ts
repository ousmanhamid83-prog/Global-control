/**
 * Où vole un drone, pour la capture automatique : au-dessus de l'Afrique ou du Moyen-Orient — le
 * Tchad compris —, ou ailleurs.
 *
 * Au-dessus d'une terre : son pays (une enclave, le Lesotho dans l'Afrique du Sud, l'emporte sur le
 * pays qui l'entoure). Au large : le pays dont la côte est la plus proche — la ligne d'équidistance
 * entre deux côtes —, à moins de MARGE_KM. Au-dessus d'un voisin (Espagne, Grèce, Caucase,
 * Afghanistan, Pakistan, Turkménistan) ou en haute mer : nulle part.
 */
import { droneDeclare, type DroneDeclare } from "./drones-oaci.ts";
import { theaterOf, theaterRank, type TheaterId } from "./geo.ts";
import { PAYS_CONTOURS, type PaysContour } from "./regions-drones-donnees.ts";
import type { Track } from "./types";

type RegionDrone = "afrique" | "moyen-orient";

type LieuDrone = {
  region: RegionDrone;
  pays: string;
  /** 0 au-dessus des terres ; au large, la distance à la côte la plus proche. */
  km: number;
};

/**
 * Les 12 milles marins des eaux territoriales (22,2 km), dont l'espace aérien est celui de l'État,
 * et l'écart mesuré entre ces contours simplifiés et leur source 1:10 M (5,9 km au plus).
 */
const MARGE_KM = 29;

const KM_PAR_DEGRE = 111.195;

type Anneau = {
  pays: PaysContour;
  pts: readonly (readonly [number, number])[];
  /** En degrés carrés : ne sert qu'à départager deux anneaux emboîtés. */
  aire: number;
  sud: number;
  nord: number;
  ouest: number;
  est: number;
};

function anneau(pays: PaysContour, pts: readonly (readonly [number, number])[]): Anneau {
  let aire = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    aire += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1];
  }
  const lats = pts.map((p) => p[1]);
  const lons = pts.map((p) => p[0]);
  return {
    pays,
    pts,
    aire: Math.abs(aire) / 2,
    sud: Math.min(...lats),
    nord: Math.max(...lats),
    ouest: Math.min(...lons),
    est: Math.max(...lons),
  };
}

const ANNEAUX: readonly Anneau[] = PAYS_CONTOURS.flatMap((c) => c.p.map((pts) => anneau(c, pts)));

/** Le point est-il dans la boîte de l'anneau, élargie de `km` ? */
function dansBoite(a: Anneau, lat: number, lon: number, km: number): boolean {
  const dLat = km / KM_PAR_DEGRE;
  const dLon = km / (KM_PAR_DEGRE * Math.cos((lat * Math.PI) / 180));
  return (
    lat >= a.sud - dLat && lat <= a.nord + dLat && lon >= a.ouest - dLon && lon <= a.est + dLon
  );
}

/** Pair-impair : le point est dans l'anneau. */
function dedans(a: Anneau, lat: number, lon: number): boolean {
  let n = 0;
  for (let i = 0, j = a.pts.length - 1; i < a.pts.length; j = i++) {
    const [x1, y1] = a.pts[i]!;
    const [x2, y2] = a.pts[j]!;
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) n += 1;
  }
  return n % 2 === 1;
}

/** Distance du point au contour, en km (plan tangent au point : juste à cette échelle). */
function distanceKm(a: Anneau, lat: number, lon: number): number {
  const kx = KM_PAR_DEGRE * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < a.pts.length; i++) {
    const ax = (a.pts[i - 1]![0] - lon) * kx;
    const ay = (a.pts[i - 1]![1] - lat) * KM_PAR_DEGRE;
    const dx = (a.pts[i]![0] - lon) * kx - ax;
    const dy = (a.pts[i]![1] - lat) * KM_PAR_DEGRE - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Une coordonnée qui n'est pas un nombre fini ne tombe dans aucune boîte : nulle part. */
export function lieuDrone(lat: number, lon: number): LieuDrone | null {
  let terre: Anneau | null = null;
  for (const a of ANNEAUX) {
    if (dansBoite(a, lat, lon, 0) && dedans(a, lat, lon) && (!terre || a.aire < terre.aire)) {
      terre = a;
    }
  }
  if (terre) return terre.pays.r ? { region: terre.pays.r, pays: terre.pays.n, km: 0 } : null;
  let cote: Anneau | null = null;
  let km = MARGE_KM;
  for (const a of ANNEAUX) {
    if (!dansBoite(a, lat, lon, MARGE_KM)) continue;
    const d = distanceKm(a, lat, lon);
    if (d <= km) {
      km = d;
      cote = a;
    }
  }
  return cote?.pays.r ? { region: cote.pays.r, pays: cote.pays.n, km } : null;
}

/** Les captures que la règle des drones ouvre seule portent cet identifiant. */
export const PREFIXE_CAPTURE_DRONE = "cap-uav-";

/**
 * Le drone né qui part seul en capture : il se déclare (catégorie B6 ou type OACI de drone) et vole
 * au-dessus de la région ; d'abord le théâtre le plus proche du poste (Tchad, Darfour, AES, Sahel,
 * puis le reste), le premier né à théâtre égal. `ecarte` dit ceux qui n'y partent pas (un des
 * nôtres confirmé, un drone déjà capturé).
 */
export function droneACapturer(
  nes: readonly Track[],
  ecarte: (id: string) => boolean,
): { piste: Track; drone: DroneDeclare; lieu: LieuDrone; rang: number } | null {
  let choisi: { piste: Track; drone: DroneDeclare; lieu: LieuDrone; rang: number } | null = null;
  for (const piste of nes) {
    if (ecarte(piste.id)) continue;
    const drone = droneDeclare(piste);
    if (!drone) continue;
    const lieu = lieuDrone(piste.lat, piste.lon);
    if (!lieu) continue;
    const rang = theaterRank(theaterOf(piste.lat, piste.lon));
    if (!choisi || rang > choisi.rang) choisi = { piste, drone, lieu, rang };
  }
  return choisi;
}

/**
 * La caméra est-elle libre pour un drone de ce rang de théâtre ? Oui si aucune scène n'est ouverte,
 * ou si la scène ouverte est la capture automatique d'un drone d'un théâtre plus lointain : un drone
 * au-dessus du Tchad la reprend à un drone au-dessus d'Israël. Une scène ouverte à la main, ou pour
 * un autre événement, reste à l'opérateur.
 */
export function cameraLibre(
  ouverte: { id: string; theater: TheaterId } | null,
  rang: number,
): boolean {
  if (!ouverte) return true;
  return ouverte.id.startsWith(PREFIXE_CAPTURE_DRONE) && theaterRank(ouverte.theater) < rang;
}
