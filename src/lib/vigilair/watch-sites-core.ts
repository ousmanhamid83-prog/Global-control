/**
 * Logique pure des sites surveillés — validation d'une saisie opérateur et recherche du site le plus
 * proche. Module autonome (aucune dépendance relative) pour rester testable sous node --test.
 */

export type WatchSite = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Intrusion aérienne (drone/avion) armée sur ce périmètre. Défaut : vrai. */
  armed?: boolean;
  /** Rayon d'alerte phénomènes (crue/feu/séisme) propre au site, km. Sinon défaut par nature. */
  alertKm?: number;
};

export type NearWatch = {
  id: string;
  name: string;
  short: string;
  custom: boolean;
  lat: number;
  lon: number;
  alertKm?: number;
};

export type SiteInput = { name: string; lat: number; lon: number; radiusKm: number; armed?: boolean; alertKm?: number };

/** Distance grand-cercle en km (Haversine). Inlinée ici pour garder le module autonome. */
export function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Valide une saisie opérateur. Pur : ne touche pas au stockage. */
export function validateSite(input: SiteInput): { ok: true; site: WatchSite } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "nom requis" };
  if (name.length > 40) return { ok: false, error: "nom trop long (40 max)" };
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90)
    return { ok: false, error: "latitude hors plage (-90 à 90)" };
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180)
    return { ok: false, error: "longitude hors plage (-180 à 180)" };
  if (!Number.isFinite(input.radiusKm) || input.radiusKm < 0.5 || input.radiusKm > 100)
    return { ok: false, error: "rayon hors plage (0,5 à 100 km)" };
  const id = `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const armed = input.armed !== false;
  const alertKm =
    Number.isFinite(Number(input.alertKm)) && Number(input.alertKm) >= 1 && Number(input.alertKm) <= 500
      ? Number(input.alertKm)
      : undefined;
  return { ok: true, site: { id, name, lat: input.lat, lon: input.lon, radiusKm: input.radiusKm, armed, alertKm } };
}

/** Site le plus proche parmi une liste déjà résolue. Pur. */
export function nearestFrom(sites: NearWatch[], lat: number, lon: number): { site: NearWatch; distKm: number } | null {
  let best: { site: NearWatch; distKm: number } | null = null;
  for (const s of sites) {
    const d = distKm(lat, lon, s.lat, s.lon);
    if (!best || d < best.distKm) best = { site: s, distKm: d };
  }
  return best;
}
