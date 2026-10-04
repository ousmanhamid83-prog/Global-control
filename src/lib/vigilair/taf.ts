/**
 * Validité d'un TAF lue dans son texte (« TAF FTTJ 030500Z 0306/0412 … » = valable du 3 à 06 Z
 * au 4 à 12 Z). Une station qui n'émet plus laisse un TAF périmé en ligne : on le dit.
 */

export type TafValidity = { endsAt: number; expired: boolean; label: string };

/** Recale un couple jour/heure UTC sur le mois le plus proche de `now`. */
function nearestUtc(day: number, hour: number, now: number): number {
  const d = new Date(now);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day, 0) + hour * 60 * 60 * 1000;
  const prev = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, day, 0) + hour * 60 * 60 * 1000;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day, 0) + hour * 60 * 60 * 1000;
  return [prev, base, next].reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

export function tafValidity(raw: string, now = Date.now()): TafValidity | null {
  const m = raw.match(/\b\d{6}Z\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  if (!m) return null;
  const endDay = Number(m[3]);
  const endHour = Number(m[4]);
  if (endDay < 1 || endDay > 31 || endHour > 24) return null;
  const endsAt = nearestUtc(endDay, endHour, now);
  const expired = now > endsAt;
  const hours = Math.round(Math.abs(now - endsAt) / (60 * 60 * 1000));
  const label = expired
    ? `périmé depuis ${hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} j`}`
    : `valide jusqu'au ${String(endDay).padStart(2, "0")} à ${String(endHour).padStart(2, "0")} Z`;
  return { endsAt, expired, label };
}

/** Un METAR se renouvelle toutes les 30–60 min : au-delà de 2 h, la station est muette. */
export const METAR_STALE_MS = 2 * 60 * 60 * 1000;

export function obsAge(iso: string | null, now = Date.now()): { stale: boolean; label: string } | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60000));
  const stale = now - t > METAR_STALE_MS;
  const span = min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${Math.round(min / 1440)} j`;
  return { stale, label: stale ? `périmé · ${span}` : `il y a ${span}` };
}
