/**
 * Rejeu réel : relecture de VRAI trafic 1090ES enregistré, pas un scénario. Chaque position vient
 * d'un squitter reçu (antenne du poste ou agrégateur réseau) ; entre deux images, la position est
 * interpolée, jamais inventée. Une piste de rejeu porte son heure d'origine et le bandeau
 * « REJEU RÉEL » : elle n'est jamais présentée comme live, ne compte pas dans la veille et ne
 * prend jamais le verrou auto.
 *
 * Deux bandes possibles :
 *  - « poste » : ce que CE poste a entendu pendant sa veille (les 30 dernières minutes) ;
 *  - « archive » : un enregistrement réel livré avec le logiciel (scripts/rejeu-enregistrer.mjs),
 *    pour un poste qui vient de démarrer.
 */

import type { LiveAc } from "./live-adsb";

/** hex, lat, lon, altM, gsKmh, cap, vario m/s, squawk, urgence, NIC, NACp, au sol, retard (s). */
export type TapeRow = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  string | null,
  string | null,
  number | null,
  number | null,
  0 | 1,
  number,
];

/** indicatif, type OACI, immatriculation, catégorie émetteur, militaire. */
export type TapeMeta = [string, string | null, string | null, string | null, 0 | 1];

export type RejeuTape = {
  kind: "poste" | "archive";
  source: string;
  from: number;
  to: number;
  ac: Record<string, TapeMeta>;
  frames: { at: number; rows: TapeRow[] }[];
};

export type RejeuPoint = { ac: LiveAc; /** Heure d'origine de la position (ms). */ posAt: number };

/** Une bande ne vaut rejeu qu'à partir de 3 minutes et 6 images. */
export const REJEU_MIN_SPAN_MS = 3 * 60_000;
export const REJEU_MIN_FRAMES = 6;
/** Sans image suivante, la piste file à cap et vitesse constants au plus 45 s, puis s'efface. */
const COAST_MS = 45_000;
/** Deux relevés plus espacés ne sont pas reliés : on ne devine pas une route de 3 minutes. */
const MAX_GAP_MS = 3 * 60_000;

export function tapeUsable(t: RejeuTape | null | undefined): t is RejeuTape {
  return Boolean(t && t.frames.length >= REJEU_MIN_FRAMES && t.to - t.from >= REJEU_MIN_SPAN_MS);
}

export function tapeRow(a: LiveAc): TapeRow {
  return [
    a.hex,
    Math.round(a.lat * 1e4) / 1e4,
    Math.round(a.lon * 1e4) / 1e4,
    Math.round(a.altM),
    Math.round(a.gsKmh),
    Math.round(a.track) % 360,
    Math.round(a.climbMs * 10) / 10,
    a.squawk,
    a.emergency,
    a.nic,
    a.nacp,
    a.onGround ? 1 : 0,
    Math.max(0, Math.round(a.seenS)),
  ];
}

export function tapeMeta(a: LiveAc): TapeMeta {
  return [a.flight, a.icaoType, a.reg, a.category, a.military ? 1 : 0];
}

function lerpAngle(a: number, b: number, f: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (!Number.isFinite(d)) d = 0;
  return (a + d * f + 360) % 360;
}

function coast(lat: number, lon: number, trackDeg: number, gsKmh: number, dtMs: number) {
  const km = (gsKmh * dtMs) / 3_600_000;
  const r = (trackDeg * Math.PI) / 180;
  const dLat = (km * Math.cos(r)) / 111.32;
  const dLon = (km * Math.sin(r)) / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function toAc(meta: TapeMeta | undefined, row: TapeRow, lat: number, lon: number, seenS: number): LiveAc {
  const hex = row[0];
  return {
    hex,
    flight: meta?.[0] ?? hex.toUpperCase(),
    lat,
    lon,
    altM: row[3],
    gsKmh: row[4],
    track: row[5],
    climbMs: row[6],
    squawk: row[7],
    icaoType: meta?.[1] ?? null,
    reg: meta?.[2] ?? null,
    rssi: null,
    emergency: row[8],
    seenS,
    onGround: row[11] === 1,
    category: meta?.[3] ?? null,
    nic: row[9],
    nacp: row[10],
    sil: null,
    military: meta?.[4] === 1,
    via: "reseau",
  };
}

type Report = { posAt: number; row: TapeRow };

/** Relevés par avion, triés et dédoublonnés (une position en cache revue deux fois compte une fois). */
export type TapeIndex = Map<string, Report[]>;

export function indexTape(tape: RejeuTape): TapeIndex {
  const idx: TapeIndex = new Map();
  for (const f of tape.frames) {
    for (const row of f.rows) {
      const posAt = f.at - row[12] * 1000;
      let list = idx.get(row[0]);
      if (!list) idx.set(row[0], (list = []));
      list.push({ posAt, row });
    }
  }
  for (const [hex, list] of idx) {
    list.sort((a, b) => a.posAt - b.posAt);
    const uniq: Report[] = [];
    for (const r of list) {
      const last = uniq.at(-1);
      if (last && Math.abs(r.posAt - last.posAt) < 1000) continue;
      uniq.push(r);
    }
    idx.set(hex, uniq);
  }
  return idx;
}

function bracket(list: Report[], t: number): number {
  // Dernier relevé à t ou avant ; -1 si l'avion n'est pas encore entendu.
  let lo = 0;
  let hi = list.length - 1;
  if (t < list[0]!.posAt) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid]!.posAt <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Les avions de la bande à l'instant `t` (heure d'origine). Entre deux relevés réels d'un même
 * avion (écart ≤ 3 min), interpolation linéaire ; au-delà de son dernier relevé, il file au plus
 * 45 s puis disparaît, comme une vraie piste perdue. Avant son premier relevé, il n'existe pas.
 */
export function tapeAt(tape: RejeuTape, t: number, index: TapeIndex = indexTape(tape)): RejeuPoint[] {
  const out: RejeuPoint[] = [];
  for (const [hex, list] of index) {
    const k = bracket(list, t);
    if (k < 0) continue;
    const a = list[k]!;
    const b = list[k + 1];
    const meta = tape.ac[hex];
    if (b && b.posAt - a.posAt <= MAX_GAP_MS) {
      const f = Math.min(1, Math.max(0, (t - a.posAt) / (b.posAt - a.posAt)));
      const r = a.row;
      const n = b.row;
      const mixed: TapeRow = [...r];
      mixed[3] = Math.round(r[3] + (n[3] - r[3]) * f);
      mixed[4] = Math.round(r[4] + (n[4] - r[4]) * f);
      mixed[5] = Math.round(lerpAngle(r[5], n[5], f)) % 360;
      const late = f >= 0.5;
      mixed[6] = late ? n[6] : r[6];
      mixed[7] = late ? n[7] : r[7];
      mixed[8] = r[8] ?? n[8];
      mixed[9] = late ? n[9] : r[9];
      mixed[10] = late ? n[10] : r[10];
      mixed[11] = late ? n[11] : r[11];
      const lat = r[1] + (n[1] - r[1]) * f;
      const lon = r[2] + (n[2] - r[2]) * f;
      out.push({ ac: toAc(meta, mixed, lat, lon, 0), posAt: Math.round(t) });
      continue;
    }
    const dt = t - a.posAt;
    if (dt > COAST_MS) continue;
    const r = a.row;
    const p = r[11] === 1 ? { lat: r[1], lon: r[2] } : coast(r[1], r[2], r[5], r[4], dt);
    out.push({ ac: toAc(meta, r, p.lat, p.lon, dt / 1000), posAt: a.posAt });
  }
  return out;
}

/** Heure d'origine lisible : « 04/10 17:12:30 Z ». */
export function rejeuClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} Z`;
}
