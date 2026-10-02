const seen = new Map<string, number>();

/** Première seconde où le poste voit ce feu. Ne se réinitialise pas. */
export function lockFire(id: string, now = Date.now()): number {
  const prev = seen.get(id);
  if (prev != null) return prev;
  seen.set(id, now);
  return now;
}

export function fireAgeMs(id: string, now = Date.now()): number | null {
  const t = seen.get(id);
  if (t == null) return null;
  return Math.max(0, now - t);
}

export function formatFireAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}
