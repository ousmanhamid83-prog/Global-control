import { kmPerDegLon } from "./geo";
import { altitudes } from "./geo-poste.server";
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

/**
 * Mesure d'une zone (clic sur une mine, une zone libre) : pente et altitude sur une grille autour
 * du centre, par le serveur de relief DU RÉSEAU DU POSTE (voir geo-poste.server). Avant, la grille
 * partait chez api.open-meteo.com. Sans serveur de relief, le cercle GPS reste exact et la pente
 * n'est pas mesurée — jamais inventée.
 */
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
  const alt = await altitudes(pts);
  if (!alt.ok) {
    const c = classifyPass({ water, slopeMax: null, slopeMean: null });
    return {
      ...base,
      mode: c.mode,
      note: c.note,
      source: `WGS84 · relief non mesuré : ${alt.raison}`,
    };
  }
  pts.forEach((p, k) => {
    p.elev = alt.elev[k] ?? null;
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
    source: `WGS84 · MNT du poste (${alt.jeu})`,
    note: c.note,
  };
}
