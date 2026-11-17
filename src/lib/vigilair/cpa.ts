/**
 * Le point d'approche le plus proche (CPA) d'une piste réelle vers les sites protégés : distance au
 * sol, rapprochement, temps estimé. Géométrie et cinématique seulement, jamais d'identité.
 */
import { haversineKm, headingBetween } from "./geo";
import { getLiveZones } from "./zones";
import type { SiteCpa, Track } from "./types";

export function cpaSite(track: Track): SiteCpa | null {
  let best: SiteCpa | null = null;
  const sites = getLiveZones();
  for (const site of sites) {
    const distKm = haversineKm(track.lat, track.lon, site.lat, site.lon);
    const bear = headingBetween(track.lat, track.lon, site.lat, site.lon);
    let err = bear - track.heading;
    if (err < -180) err += 360;
    if (err > 180) err -= 360;
    const closing = Math.abs(err) < 55 && track.speedKmh > 12;
    const along = (track.speedKmh / 3600) * Math.cos((err * Math.PI) / 180);
    const etaS = closing && along > 0.002 ? Math.round((distKm / along) * 1) : null;
    const row: SiteCpa = {
      siteId: site.id,
      name: site.name,
      distKm,
      etaS,
      closing,
    };
    if (!best || distKm < best.distKm) best = row;
  }
  return best;
}
