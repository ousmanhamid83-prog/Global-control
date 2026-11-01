/**
 * Itinéraire et relief — CÔTÉ SERVEUR, vers des serveurs SUR LE RÉSEAU DU POSTE, jamais vers un
 * service public. Un itinéraire, un profil de relief ou l'altitude d'une zone, c'est la liste des
 * points où le poste regarde, se rend ou protège : avant, ils partaient chez
 * router.project-osrm.org, api.opentopodata.org et api.open-meteo.com (la grille autour d'une mine
 * ou d'une zone cliquée).
 *
 *   AFRICONTROL_ITINERAIRE=http://127.0.0.1:5000          serveur OSRM (osrm-routed, carte OSM de
 *                                                         la région)
 *   AFRICONTROL_RELIEF=http://127.0.0.1:5100/v1/srtm30m   jeu de données d'un serveur opentopodata
 *
 * Sans serveur, rien ne part : l'itinéraire reste le cap direct, le relief n'est pas mesuré, et
 * l'opérateur le lit. Une adresse hors du réseau du poste est refusée avant tout envoi.
 */
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
 * Altitude de chaque point par le serveur de relief du poste (API opentopodata). Un point sans
 * donnée reste null : jamais une altitude inventée.
 */
export async function altitudes(points: Point[]): Promise<Altitudes> {
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
