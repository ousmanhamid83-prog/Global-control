/**
 * Itinéraire et relief — CÔTÉ SERVEUR, vers des serveurs SUR LE RÉSEAU DU POSTE, jamais vers un
 * service public. Un itinéraire, un profil de relief ou l'altitude d'une zone, c'est la liste des
 * points où le poste regarde, se rend ou protège : avant, ils partaient chez
 * router.project-osrm.org, api.opentopodata.org et api.open-meteo.com (la grille autour d'une mine
 * ou d'une zone cliquée).
 *
 *   AFRICONTROL_ITINERAIRE=http://127.0.0.1:5810          serveur OSRM (osrm-routed, carte OSM de
 *                                                         la région ; scripts/poste/preparer-poste)
 *   data/relief/Copernicus_DSM_COG_*_DEM.tif              tuiles de relief lues par le poste
 *                                                         lui-même (AFRICONTROL_RELIEF_TUILES pour
 *                                                         un autre dossier) : aucun serveur
 *   AFRICONTROL_RELIEF=http://127.0.0.1:5100/v1/srtm30m   ou un serveur opentopodata (prioritaire)
 *
 * Sans eux, rien ne part : l'itinéraire reste le cap direct, le relief n'est pas mesuré, et
 * l'opérateur le lit. Une adresse hors du réseau du poste est refusée avant tout envoi.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromFile, type GeoTIFFImage } from "geotiff";
import { env } from "../env.server.ts";
import { RESEAU_POSTE_EXEMPLES, serveurPoste } from "./reseau-poste.ts";

type Point = { lat: number; lon: number };

const DELAI_MS = 20_000;

function serveur(
  variable: "AFRICONTROL_ITINERAIRE" | "AFRICONTROL_RELIEF",
  quoi: string,
  suite: string,
): { base: string } | { raison: string } {
  const s = serveurPoste(env(variable));
  if ("base" in s) return s;
  return {
    raison:
      s.refus === "absente"
        ? `pas de serveur ${quoi} sur le poste (${variable})${suite}`
        : `${variable} refusée : le serveur ${quoi} doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}) — rien n'a été envoyé${suite}`,
  };
}

function injoignable(quoi: string, e: unknown): string {
  return `serveur ${quoi} injoignable${e instanceof Error ? ` : ${e.message}` : ""}`;
}

export type RouteOsrm =
  | { ok: true; distanceM: number; durationS: number; geometry: Point[] }
  | { ok: false; raison: string };

/** Itinéraire routier par le serveur OSRM du poste (même API que le serveur public). */
export async function routeOsrm(points: Point[]): Promise<RouteOsrm> {
  const s = serveur("AFRICONTROL_ITINERAIRE", "d'itinéraire", " — cap direct");
  if (!("base" in s)) return { ok: false, raison: s.raison };
  const coords = points.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  let res: Response;
  try {
    res = await fetch(
      `${s.base}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(DELAI_MS),
      },
    );
  } catch (e) {
    return { ok: false, raison: injoignable("d'itinéraire", e) };
  }
  if (!res.ok) return { ok: false, raison: `serveur d'itinéraire ${res.status}` };
  const j = (await res.json()) as {
    code?: string;
    routes?: { distance: number; duration: number; geometry?: { coordinates?: number[][] } }[];
  };
  const r = j.routes?.[0];
  if (!r || j.code !== "Ok") return { ok: false, raison: "aucune route routière" };
  return {
    ok: true,
    distanceM: r.distance,
    durationS: r.duration,
    geometry: (r.geometry?.coordinates ?? []).map((c) => ({ lat: c[1]!, lon: c[0]! })),
  };
}

export type Altitudes =
  { ok: true; elev: (number | null)[]; jeu: string } | { ok: false; raison: string };

/**
 * Altitude de chaque point : par le serveur de relief du poste s'il est réglé, sinon par les
 * tuiles de relief du poste. Un point sans donnée reste null : jamais une altitude inventée.
 */
export async function altitudes(points: Point[]): Promise<Altitudes> {
  if (env("AFRICONTROL_RELIEF")) return altitudesServeur(points);
  const dossier = env("AFRICONTROL_RELIEF_TUILES") ?? join("data", "relief");
  const present = existsSync(dossier) && readdirSync(dossier).some((f) => NOM_TUILE.test(f));
  if (present) return altitudesTuiles(points, dossier);
  return {
    ok: false,
    raison: `aucun relief sur le poste (ni tuiles dans ${dossier}, ni AFRICONTROL_RELIEF)`,
  };
}

/** Tuile Copernicus DEM d'un degré carré : COG_10 = GLO-30 (30 m), COG_30 = GLO-90 (90 m). */
const NOM_TUILE = /^Copernicus_DSM_COG_(10|30)_[NS]\d{2}_00_[EW]\d{3}_00_DEM\.tif$/;

type Tuile = {
  image: GeoTIFFImage;
  ox: number;
  oy: number;
  rx: number;
  ry: number;
  w: number;
  h: number;
  jeu: string;
};

const tuilesOuvertes = new Map<string, Promise<Tuile | null>>();

/** La tuile la plus fine présente pour ce degré carré : GLO-30 avant GLO-90. */
function tuile(dossier: string, lat0: number, lon0: number): Promise<Tuile | null> {
  const ns = `${lat0 >= 0 ? "N" : "S"}${String(Math.abs(lat0)).padStart(2, "0")}`;
  const ew = `${lon0 >= 0 ? "E" : "W"}${String(Math.abs(lon0)).padStart(3, "0")}`;
  for (const [pas, jeu] of [
    ["10", "Copernicus GLO-30"],
    ["30", "Copernicus GLO-90"],
  ] as const) {
    const chemin = join(dossier, `Copernicus_DSM_COG_${pas}_${ns}_00_${ew}_00_DEM.tif`);
    if (!existsSync(chemin)) continue;
    let ouverte = tuilesOuvertes.get(chemin);
    if (!ouverte) {
      ouverte = (async () => {
        const image = await (await fromFile(chemin)).getImage();
        const [ox, oy] = image.getOrigin();
        const [rx, ry] = image.getResolution();
        return {
          image,
          ox: ox!,
          oy: oy!,
          rx: rx!,
          ry: ry!,
          w: image.getWidth(),
          h: image.getHeight(),
          jeu,
        };
      })().catch(() => null);
      tuilesOuvertes.set(chemin, ouverte);
    }
    return ouverte;
  }
  return Promise.resolve(null);
}

async function altitudesTuiles(points: Point[], dossier: string): Promise<Altitudes> {
  const elev: (number | null)[] = points.map(() => null);
  const parDegre = new Map<string, number[]>();
  points.forEach((p, i) => {
    const cle = `${Math.floor(p.lat)},${Math.floor(p.lon)}`;
    parDegre.set(cle, [...(parDegre.get(cle) ?? []), i]);
  });
  const jeux = new Set<string>();
  for (const [cle, indices] of parDegre) {
    const [lat0, lon0] = cle.split(",").map(Number);
    const t = await tuile(dossier, lat0!, lon0!);
    if (!t) continue;
    const xs = indices.map((i) =>
      Math.min(t.w - 1, Math.max(0, Math.floor((points[i]!.lon - t.ox) / t.rx))),
    );
    const ys = indices.map((i) =>
      Math.min(t.h - 1, Math.max(0, Math.floor((points[i]!.lat - t.oy) / t.ry))),
    );
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const largeur = Math.max(...xs) - x0 + 1;
    // Une seule lecture par tuile : la fenêtre qui couvre tous les points de ce degré carré.
    const rasters = await t.image.readRasters({
      window: [x0, y0, x0 + largeur, Math.max(...ys) + 1],
    });
    const bande = rasters[0] as ArrayLike<number>;
    indices.forEach((i, k) => {
      const v = Number(bande[(ys[k]! - y0) * largeur + (xs[k]! - x0)]);
      // Copernicus marque l'absence de donnée par une valeur très négative.
      elev[i] = Number.isFinite(v) && v > -1000 ? v : null;
    });
    jeux.add(t.jeu);
  }
  if (jeux.size === 0) {
    return { ok: false, raison: `aucune tuile de relief ne couvre ces points (${dossier})` };
  }
  return { ok: true, elev, jeu: `${[...jeux].join(" + ")}, tuiles locales` };
}

async function altitudesServeur(points: Point[]): Promise<Altitudes> {
  const s = serveur("AFRICONTROL_RELIEF", "de relief", "");
  if (!("base" in s)) return { ok: false, raison: s.raison };
  const locs = points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join("|");
  let res: Response;
  try {
    res = await fetch(`${s.base}?locations=${locs}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (e) {
    return { ok: false, raison: injoignable("de relief", e) };
  }
  if (!res.ok) return { ok: false, raison: `serveur de relief ${res.status}` };
  const j = (await res.json()) as { results?: { elevation?: unknown }[] };
  const results = j.results ?? [];
  if (results.length !== points.length) {
    return { ok: false, raison: "réponse du serveur de relief incomplète" };
  }
  return {
    ok: true,
    elev: results.map((r) =>
      typeof r?.elevation === "number" && Number.isFinite(r.elevation) ? r.elevation : null,
    ),
    // Le jeu de données est le dernier segment de l'adresse (…/v1/srtm30m → srtm30m).
    jeu: s.base.split("/").pop() || "MNT",
  };
}
