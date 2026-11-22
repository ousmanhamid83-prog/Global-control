/**
 * Ce que la carte montre, en GeoJSON : la bibliothèque de cartographie (MapLibre) projette et
 * dessine ; ce module ne fait que dire OÙ sont les choses (longitude, latitude) et COMMENT les
 * nommer. Tout vient des vraies données du poste : pistes reçues, liaison de nos drones, images
 * de leurs sources, zones, mesure du chef. Rien n'est placé en pixels ici.
 */
import type { Affiliation } from "./app6.ts";
import {
  nomCadre,
  nomCap,
  nomCarre,
  nomCroix,
  nomForme,
  nomPoint,
  type FormePiste,
} from "./carte-icones.ts";
import type { Coins, PointGeo } from "./drones-fond.ts";
import { formatAzimut, formatRange, haversineKm, headingBetween, predictPath } from "./geo.ts";
import type { Track } from "./types";

export type Position = [number, number];
type Geometrie =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };
export type Trait<P = Record<string, string | number | boolean>> = {
  type: "Feature";
  geometry: Geometrie;
  properties: P;
};
export type Collection = { type: "FeatureCollection"; features: Trait[] };

export const collection = (features: Trait[]): Collection => ({
  type: "FeatureCollection",
  features,
});
const point = (lat: number, lon: number, p: Trait["properties"]): Trait => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: p,
});
const ligne = (pts: { lat: number; lon: number }[], p: Trait["properties"]): Trait => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: pts.map((q) => [q.lon, q.lat] as Position) },
  properties: p,
});

/** Circonférence équatoriale (m) : la référence des zooms de MapLibre (tuiles de 512 px). */
const CIRCONFERENCE_M = 40_075_016.686;

/**
 * Le zoom auquel `largeurPx` pixels couvrent `km` kilomètres à la latitude `lat`. C'est ainsi que
 * les échelles du poste (« 1,2 m », « Veille », « AES »…) deviennent des zooms de la bibliothèque.
 */
export function zoomPourLargeur(km: number, largeurPx: number, lat: number): number {
  const metresParPixel = (km * 1000) / Math.max(1, largeurPx);
  return Math.log2((CIRCONFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * metresParPixel));
}

const R_TERRE_KM = 6371;

/** Le point à `km` de (lat, lon) au cap `cap` (degrés vrais), sur la sphère. */
export function pointA(
  lat: number,
  lon: number,
  cap: number,
  km: number,
): { lat: number; lon: number } {
  const d = km / R_TERRE_KM;
  const t = (cap * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 =
    l1 +
    Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Un cercle au sol de rayon `km`, en anneau fermé : la bibliothèque le projette comme il faut. */
export function cercle(lat: number, lon: number, km: number, pas = 64): Position[] {
  const anneau: Position[] = [];
  for (let i = 0; i < pas; i++) {
    const q = pointA(lat, lon, (i * 360) / pas, km);
    anneau.push([q.lon, q.lat]);
  }
  anneau.push(anneau[0]!);
  return anneau;
}

/** Comment une piste se dessine : couleur, cadre d'affiliation, forme de plateforme. */
export type Allure = { couleur: string; affil: Affiliation; forme: FormePiste; tourne: boolean };

/** L'étiquette d'une piste, en deux lignes : ce qu'elle est, puis ce que l'on en mesure. */
export function etiquettePiste(
  t: Track,
  plateforme: { name: string; uasClass: string } | undefined,
  detaillee: boolean,
): [string, string] {
  const b6 = t.category?.toUpperCase() === "B6";
  const tete =
    t.feed === "rejeu"
      ? `${t.callsign} REJ`
      : t.feed === "exercice"
        ? `${t.callsign} EXERCICE`
        : `${t.callsign}${t.military ? " MIL" : ""}${b6 ? " UAV" : ""} 1090`;
  const nom = detaillee && plateforme ? ` · ${plateforme.name}` : "";
  if (t.iff) return [tete, `${t.iff.mode} ${t.iff.squawk}${nom}`];
  if (!detaillee) return [tete, `${Math.round(t.altM)} m`];
  const alt =
    plateforme?.uasClass === "chasse"
      ? `FL${Math.round(t.altM / 30.48)}`
      : `${Math.round(t.altM)} m`;
  return [tete, `${alt} ${Math.round(t.speedKmh)} km/h${nom}`];
}

/**
 * Les pistes en points. `large` : échelle continentale (petits cadres, étiquettes réservées à ce
 * qui compte) ; `symboles` : cadres APP-6 ; `detaillee` : étiquette avec vitesse et plateforme.
 */
export function pistesGeo(
  tracks: readonly Track[],
  o: {
    selectedId: string | null;
    large: boolean;
    symboles: boolean;
    detaillee: boolean;
    allure: (t: Track) => Allure;
    ami: (t: Track) => boolean;
    plateforme: (t: Track) => { name: string; uasClass: string } | undefined;
  },
): Collection {
  const features: Trait[] = [];
  for (const t of tracks) {
    const a = o.allure(t);
    const sel = t.id === o.selectedId || t.locked;
    const b6 = t.category?.toUpperCase() === "B6";
    const discrete = o.large && o.ami(t) && !sel && !t.emergency && !b6;
    const [l1, l2] = discrete ? ["", ""] : etiquettePiste(t, o.plateforme(t), o.detaillee);
    features.push(
      point(t.lat, t.lon, {
        id: t.id,
        cadre: o.symboles ? nomCadre(a.affil, a.couleur, t.locked ? 13 : o.large ? 6 : 11) : "",
        // Échelle continentale avec cadres : le cadre suffit, plus un point au centre.
        forme: o.symboles && o.large ? nomPoint(a.couleur, 3) : nomForme(a.forme, a.couleur),
        cap: a.tourne && !(o.symboles && o.large) ? t.heading : 0,
        sel,
        verrou: t.locked,
        urgence: Boolean(t.emergency),
        b6,
        douteux: t.nic != null && t.nic < 5,
        l1,
        l2,
        // L'ordre des étiquettes quand elles se gênent : la sélection, l'urgence, le drone d'abord.
        rang: sel ? 0 : t.emergency ? 1 : b6 ? 2 : 3,
      }),
    );
  }
  return collection(features);
}

/** La trace de chaque piste (ses positions reçues), dans sa couleur. */
export function tracesGeo(tracks: readonly Track[], allure: (t: Track) => Allure): Collection {
  return collection(
    tracks
      .filter((t) => t.trail.length > 1)
      .map((t) => ligne(t.trail, { couleur: allure(t).couleur, verrou: t.locked })),
  );
}

/**
 * Durée du vecteur vitesse selon la largeur de la vue : une piste à 300 km/h trace environ 1/12 de
 * la carte (1 min à 120 km de large, 1 s au zoom 0,3 m). La durée est écrite sous l'échelle.
 */
const PAS_VECTEUR = [1, 2, 5, 10, 15, 30, 60, 120, 300];
export function secondesVecteur(largeurKm: number): number {
  const voulu = largeurKm * 0.5;
  return PAS_VECTEUR.find((s) => s >= voulu) ?? PAS_VECTEUR[PAS_VECTEUR.length - 1]!;
}

/** Vecteur vitesse : où sera la piste dans `secondes`, au cap et à la vitesse mesurés. */
export function vecteursGeo(
  tracks: readonly Track[],
  secondes: number,
  allure: (t: Track) => Allure,
): Collection {
  const features: Trait[] = [];
  for (const t of tracks) {
    if (t.speedKmh <= 5) continue;
    const bout = pointA(t.lat, t.lon, t.heading, (t.speedKmh * secondes) / 3600);
    features.push(ligne([t, bout], { couleur: allure(t).couleur }));
  }
  return collection(features);
}

/**
 * La piste suivie : sa route prédite (cap et vitesse tenus), et le trait jusqu'à son premier relevé
 * — où le poste l'a entendue la première fois, pas un lieu d'envoi.
 */
export function suivieGeo(t: Track | undefined): Collection {
  if (!t) return collection([]);
  const features: Trait[] = [
    ligne([t, ...predictPath(t.lat, t.lon, t.heading, t.speedKmh)], { quoi: "prediction" }),
  ];
  if (t.launchFix) {
    const km = haversineKm(t.launchFix.lat, t.launchFix.lon, t.lat, t.lon);
    features.push(ligne([t.launchFix, t], { quoi: "premier" }));
    features.push(
      point(t.launchFix.lat, t.launchFix.lon, {
        quoi: "premier",
        nom: `1er relevé · ${formatRange(km)}`,
      }),
    );
  }
  return collection(features);
}

/** Les anneaux de distance (km) autour d'un centre, avec leur étiquette au nord. */
export function anneauxGeo(
  centre: { lat: number; lon: number },
  km: readonly number[],
): Collection {
  const features: Trait[] = [];
  for (const r of km) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: cercle(centre.lat, centre.lon, r, 96) },
      properties: { km: r },
    });
    const nord = pointA(centre.lat, centre.lon, 0, r);
    features.push(point(nord.lat, nord.lon, { km: r, nom: `${r} km` }));
  }
  return collection(features);
}

/** Règle A→B du chef : le segment, ses deux bouts, la distance et l'azimut au milieu. */
export function mesureGeo(
  a: PointGeo | null,
  b: PointGeo | null,
  curseur: PointGeo | null,
): Collection {
  if (!a) return collection([]);
  const fin = b ?? curseur;
  const features: Trait[] = [point(a.lat, a.lon, { bout: "A" })];
  if (!fin) return collection(features);
  const km = haversineKm(a.lat, a.lon, fin.lat, fin.lon);
  const az = headingBetween(a.lat, a.lon, fin.lat, fin.lon);
  features.push(ligne([a, fin], { fixe: Boolean(b) }));
  features.push(point(fin.lat, fin.lon, { bout: b ? "B" : "" }));
  const milieu = { lat: (a.lat + fin.lat) / 2, lon: (a.lon + fin.lon) / 2 };
  features.push(
    point(milieu.lat, milieu.lon, { nom: `${formatRange(km)} · az ${formatAzimut(az)}` }),
  );
  return collection(features);
}

/** Les coins d'une image de source, dans l'ordre que veut MapLibre : haut gauche, haut droit, bas droit, bas gauche. */
export function coinsMapLibre(c: Coins): [Position, Position, Position, Position] {
  return [
    [c[0].lon, c[0].lat],
    [c[1].lon, c[1].lat],
    [c[2].lon, c[2].lat],
    [c[3].lon, c[3].lat],
  ];
}

/** Le contour pointillé et le nom de chaque image posée (« Aile-03 · image 09:41:07 Z »). */
export function contoursFondsGeo(
  fonds: readonly { nom: string; a: number; coins: Coins }[],
): Collection {
  const features: Trait[] = [];
  for (const f of fonds) {
    features.push(ligne([...f.coins, f.coins[0]], {}));
    features.push(
      point(f.coins[0].lat, f.coins[0].lon, {
        nom: `${f.nom} · image ${new Date(f.a).toISOString().slice(11, 19)} Z`,
      }),
    );
  }
  return collection(features);
}

/** Un calage à la main en cours : les coins cliqués, numérotés, et le tracé qui les relie. */
export function calageGeo(coins: readonly PointGeo[], noms: readonly string[]): Collection {
  if (coins.length === 0) return collection([]);
  const features: Trait[] = coins.map((c, k) =>
    point(c.lat, c.lon, { nom: `${k + 1} · ${noms[k] ?? ""}` }),
  );
  if (coins.length > 1)
    features.push(ligne(coins.length === 4 ? [...coins, coins[0]!] : [...coins], {}));
  return collection(features);
}

/** Une liaison de drone telle que la carte la lit (sous-ensemble du relevé du poste). */
export type DroneSuivi = {
  id: string;
  vivant: boolean;
  mode: string;
  position: { lat: number; lon: number; hauteurM: number; cap: number | null } | null;
  depart: { lat: number; lon: number } | null;
};

/**
 * NOS drones, tels que leur liaison les donne : symbole ami et cap, départ, circuit de patrouille ;
 * pendant qu'un point est désigné, le rayon permis autour du départ et le point choisi.
 */
export function nosDronesGeo(
  suivis: readonly DroneSuivi[],
  drones: readonly {
    id: string;
    name: string;
    patrouille?: { points: { lat: number; lon: number }[] };
  }[],
  o: {
    couleur: string;
    muet: string;
    designation: boolean;
    rayonKm: number | null;
    designe: PointGeo | null;
  },
): Collection {
  const features: Trait[] = [];
  for (const e of suivis) {
    const d = drones.find((x) => x.id === e.id);
    if (!d) continue;
    const couleur = e.vivant ? o.couleur : o.muet;
    if (e.depart) {
      features.push(
        point(e.depart.lat, e.depart.lon, {
          quoi: "depart",
          icone: nomCarre(couleur),
          nom: "D",
          couleur,
        }),
      );
      if (o.designation && o.rayonKm) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: cercle(e.depart.lat, e.depart.lon, o.rayonKm),
          },
          properties: { quoi: "rayon", couleur },
        });
      }
    }
    if (d.patrouille && d.patrouille.points.length > 0) {
      features.push(ligne(d.patrouille.points, { quoi: "circuit", couleur }));
      d.patrouille.points.forEach((q, i) =>
        features.push(
          point(q.lat, q.lon, {
            quoi: "etape",
            icone: nomPoint(couleur, 4),
            nom: String(i + 1),
            couleur,
          }),
        ),
      );
    }
    if (!e.position) continue;
    features.push(
      point(e.position.lat, e.position.lon, {
        quoi: "drone",
        id: e.id,
        icone: nomCadre("ami", couleur, 10),
        fleche: e.position.cap !== null ? nomCap(couleur) : "",
        cap: e.position.cap ?? 0,
        couleur,
        l1: `${d.name} · NOTRE DRONE${e.vivant ? "" : " · MUET"}`,
        l2: `${Math.round(e.position.hauteurM)} m · ${e.mode}`,
      }),
    );
  }
  if (o.designe) {
    features.push(
      point(o.designe.lat, o.designe.lon, {
        quoi: "designe",
        icone: nomCroix(o.couleur),
        nom: "POINT DÉSIGNÉ",
        couleur: o.couleur,
      }),
    );
  }
  return collection(features);
}
