/**
 * Itinéraire routier et profil de terrain le long d'une route. Les points de la route ne partent
 * qu'aux serveurs d'itinéraire et de relief DU RÉSEAU DU POSTE (voir geo-poste.server), jamais à un
 * service public. Sans serveur de relief, le profil est indisponible ; sans serveur d'itinéraire,
 * l'opérateur garde le cap direct. Réception / lecture seule.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { distanceKm, routePath, type LatLon } from "./nav";

export type RoadRoute =
  | { ok: true; distanceKm: number; durationMin: number; geometry: { lat: number; lon: number }[] }
  | { ok: false; reason: string };

/**
 * Itinéraire ROUTIER (serveur OSRM du poste, carte OpenStreetMap) là où des routes existent (axes
 * principaux). En zone sans route (BET, Ennedi) OSM accroche une route lointaine et le trajet
 * devient absurde : on le détecte (bien plus long que le direct) et on renvoie « pas de route OSM »
 * → l'opérateur garde le cap direct.
 */
export const fetchRoadRoute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { points?: LatLon[] }) => ({ points: Array.isArray(raw?.points) ? raw.points.slice(0, 25) : [] }))
  .handler(async ({ data }): Promise<RoadRoute> => {
    const pts = data.points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 2) return { ok: false, reason: "route incomplète" };
    let direct = 0;
    for (let i = 1; i < pts.length; i++) direct += distanceKm(pts[i - 1]!.lat, pts[i - 1]!.lon, pts[i]!.lat, pts[i]!.lon);
    const geo = await import("./geo-poste.server");
    const r = await geo.routeOsrm(pts);
    if (!r.ok) return { ok: false, reason: r.raison };
    const roadKm = r.distanceM / 1000;
    if (roadKm > Math.max(30, direct * 1.6)) {
      return { ok: false, reason: `pas de route OSM fiable (${Math.round(roadKm)} km vs ${Math.round(direct)} km direct) — cap direct` };
    }
    if (r.geometry.length < 2) return { ok: false, reason: "géométrie vide" };
    return { ok: true, distanceKm: Math.round(roadKm * 10) / 10, durationMin: Math.round(r.durationS / 60), geometry: r.geometry };
  });

export type ElevPoint = { alongKm: number; elevM: number; lat: number; lon: number };
export type ElevationProfile =
  | { ok: true; points: ElevPoint[]; minM: number; maxM: number; gainM: number; source: string }
  | { ok: false; reason: string };

export const fetchElevationProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { points?: LatLon[]; stepKm?: number }) => ({
    points: Array.isArray(raw?.points) ? raw.points.slice(0, 30) : [],
    stepKm: Number.isFinite(Number(raw?.stepKm)) && Number(raw?.stepKm) > 0 ? Number(raw?.stepKm) : null,
  }))
  .handler(async ({ data }): Promise<ElevationProfile> => {
    const pts = data.points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 2) return { ok: false, reason: "route incomplète" };

    let total = 0;
    for (let i = 1; i < pts.length; i++) total += distanceKm(pts[i - 1]!.lat, pts[i - 1]!.lon, pts[i]!.lat, pts[i]!.lon);
    // stepKm forcé (zoom relief fin) ou calculé pour ~80 points sur toute la route.
    const step = data.stepKm != null ? Math.max(0.1, data.stepKm) : Math.max(3, Math.ceil(total / 80));
    let path = routePath(pts, step);
    if (path.length > 90) {
      const keep = Math.ceil(path.length / 90);
      path = path.filter((_, i) => i % keep === 0 || i === path.length - 1);
    }
    if (path.length < 2) return { ok: false, reason: "route trop courte" };

    const geo = await import("./geo-poste.server");
    const alt = await geo.altitudes(path);
    if (!alt.ok) return { ok: false, reason: alt.raison };
    const points: ElevPoint[] = [];
    for (let i = 0; i < path.length; i++) {
      const e = alt.elev[i];
      if (e != null) points.push({ alongKm: path[i]!.alongKm, elevM: e, lat: path[i]!.lat, lon: path[i]!.lon });
    }
    if (points.length < 2) return { ok: false, reason: "pas de données d'élévation" };

    let minM = Infinity;
    let maxM = -Infinity;
    let gainM = 0;
    for (let i = 0; i < points.length; i++) {
      minM = Math.min(minM, points[i]!.elevM);
      maxM = Math.max(maxM, points[i]!.elevM);
      if (i > 0) {
        const d = points[i]!.elevM - points[i - 1]!.elevM;
        if (d > 0) gainM += d;
      }
    }
    return {
      ok: true,
      points,
      minM: Math.round(minM),
      maxM: Math.round(maxM),
      gainM: Math.round(gainM),
      source: `MNT du poste · ${alt.jeu}`,
    };
  });
