import { kmPerDegLon } from "./geo";
import {
  classifyPass,
  zoneCorners,
  zoneOnWater,
  type GpsZone,
  type ZoneRegion,
} from "./passability";

type Sample = { lat: number; lon: number; i: number; j: number; elev: number | null };

function grid(lat: number, lon: number, radiusKm: number): Sample[] {
  const step = Math.max(0.9, radiusKm / 5);
  const out: Sample[] = [];
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const plat = lat + (i * step) / 110.574;
      const plon = lon + (j * step) / kmPerDegLon(lat);
      const dLat = (plat - lat) * 110.574;
      const dLon = (plon - lon) * kmPerDegLon(lat);
      if (Math.hypot(dLat, dLon) > radiusKm + 0.05) continue;
      out.push({ lat: plat, lon: plon, i, j, elev: null });
    }
  }
  return out;
}

async function elevations(pts: Sample[]): Promise<number[] | null> {
  const lat = pts.map((p) => p.lat.toFixed(5)).join(",");
  const lon = pts.map((p) => p.lon.toFixed(5)).join(",");
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "VIGILAIR-COP/1" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { elevation?: unknown };
    if (!Array.isArray(body.elevation) || body.elevation.length !== pts.length) return null;
    return body.elevation.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : Number.NaN));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function measureZone(opts: {
  id: string;
  name: string;
  region: ZoneRegion;
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<GpsZone> {
  const corners = zoneCorners(opts.lat, opts.lon, opts.radiusKm);
  const base: GpsZone = {
    ...opts,
    ...corners,
    status: "degrade",
    elevMinM: null,
    elevMaxM: null,
    slopeMaxPct: null,
    slopeMeanPct: null,
    mode: "inconnu",
    source: "",
    note: "",
  };
  const water = zoneOnWater(opts.lat, opts.lon);
  const pts = grid(opts.lat, opts.lon, opts.radiusKm);
  const elevs = await elevations(pts);
  if (!elevs) {
    const c = classifyPass({ water, slopeMax: null, slopeMean: null });
    return { ...base, mode: c.mode, note: c.note, source: "WGS84 · MNT non joint" };
  }
  pts.forEach((p, k) => {
    const e = elevs[k]!;
    p.elev = Number.isFinite(e) ? e : null;
  });
  const known = pts.filter((p) => p.elev != null).map((p) => p.elev as number);
  if (known.length < 4) {
    const c = classifyPass({ water, slopeMax: null, slopeMean: null });
    return { ...base, mode: c.mode, note: c.note, source: "WGS84 · MNT incomplet" };
  }
  const byKey = new Map(pts.map((p) => [`${p.i},${p.j}`, p]));
  const stepKm = Math.max(0.9, opts.radiusKm / 5);
  const slopes: number[] = [];
  for (const p of pts) {
    if (p.elev == null) continue;
    for (const [di, dj] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const q = byKey.get(`${p.i + di},${p.j + dj}`);
      if (!q || q.elev == null) continue;
      const pct = (Math.abs(p.elev - q.elev) / (stepKm * 1000)) * 100;
      if (Number.isFinite(pct)) slopes.push(pct);
    }
  }
  const ocean = Math.max(...known) <= 1;
  const slopeMax = slopes.length ? Math.max(...slopes) : null;
  const slopeMean = slopes.length ? slopes.reduce((s, n) => s + n, 0) / slopes.length : null;
  const c = classifyPass({ water: water || ocean, slopeMax, slopeMean });
  return {
    ...base,
    status: "ok",
    elevMinM: Math.min(...known),
    elevMaxM: Math.max(...known),
    slopeMaxPct: slopeMax,
    slopeMeanPct: slopeMean,
    mode: c.mode,
    source: "WGS84 · Copernicus DEM ~90 m",
    note: c.note,
  };
}
