/**
 * Profil de terrain le long d'une route — élévations réelles ASTER GDEM 30 m (opentopodata.org).
 * Le poste n'a pas de MNT embarqué : il interroge un service public d'élévation, en une requête, pour
 * dire « il y a un massif sur l'axe » ou « ça monte de tant ». ~30 m : un relief se voit, pas un
 * ravin d'un mètre. Nécessite Internet ; hors ligne, le profil est simplement indisponible.
 * Réception / lecture seule.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { distanceKm, routePath, type LatLon } from "./nav";

export type RoadRoute =
  | { ok: true; distanceKm: number; durationMin: number; geometry: { lat: number; lon: number }[] }
  | { ok: false; reason: string };

/**
 * Itinéraire ROUTIER (OSRM / OpenStreetMap) là où des routes existent (axes principaux). En zone
 * sans route (BET, Ennedi) OSM accroche une route lointaine et le trajet devient absurde : on le
 * détecte (bien plus long que le direct) et on renvoie « pas de route OSM » → l'opérateur garde le
 * cap direct. Lecture seule : interrogé côté serveur, l'IP de l'opérateur n'est pas exposée.
 */
export const fetchRoadRoute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { points?: LatLon[] }) => ({ points: Array.isArray(raw?.points) ? raw.points.slice(0, 25) : [] }))
  .handler(async ({ data }): Promise<RoadRoute> => {
    const pts = data.points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 2) return { ok: false, reason: "route incomplète" };
    let direct = 0;
    for (let i = 1; i < pts.length; i++) direct += distanceKm(pts[i - 1]!.lat, pts[i - 1]!.lon, pts[i]!.lat, pts[i]!.lon);
    const coords = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    let res: Response;
    try {
      res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? `réseau : ${e.message}` : "réseau indisponible" };
    }
    if (!res.ok) return { ok: false, reason: `routeur ${res.status}` };
    const j = (await res.json()) as { code?: string; routes?: { distance: number; duration: number; geometry?: { coordinates?: number[][] } }[] };
    const r = j.routes?.[0];
    if (!r || j.code !== "Ok") return { ok: false, reason: "aucune route routière" };
    const roadKm = r.distance / 1000;
    if (roadKm > Math.max(30, direct * 1.6)) {
      return { ok: false, reason: `pas de route OSM fiable (${Math.round(roadKm)} km vs ${Math.round(direct)} km direct) — cap direct` };
    }
    const geometry = (r.geometry?.coordinates ?? []).map((c) => ({ lat: c[1]!, lon: c[0]! }));
    if (geometry.length < 2) return { ok: false, reason: "géométrie vide" };
    return { ok: true, distanceKm: Math.round(roadKm * 10) / 10, durationMin: Math.round(r.duration / 60), geometry };
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

    const locs = path.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join("|");
    let res: Response;
    try {
      res = await fetch(`https://api.opentopodata.org/v1/aster30m?locations=${locs}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? `réseau : ${e.message}` : "réseau indisponible" };
    }
    if (!res.ok) return { ok: false, reason: `service élévation ${res.status}` };
    const j = (await res.json()) as { results?: { elevation: number | null }[]; status?: string };
    const results = j.results ?? [];
    const points: ElevPoint[] = [];
    for (let i = 0; i < path.length; i++) {
      const e = results[i]?.elevation;
      if (typeof e === "number" && Number.isFinite(e)) {
        points.push({ alongKm: path[i]!.alongKm, elevM: e, lat: path[i]!.lat, lon: path[i]!.lon });
      }
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
      source: "ASTER GDEM 30 m · opentopodata",
    };
  });
