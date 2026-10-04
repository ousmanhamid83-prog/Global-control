/** Quart de veille — gel capteurs réel, pas un scénario. */

import type { LivePicture } from "./live-adsb";

export type WatchSnap = {
  at: number;
  fluxOk: number;
  fluxN: number;
  ac: number;
  local: number;
  emergency: number;
  military: number;
  uav: number;
  metarFttj: string | null;
  cat: string | null;
  tafFttj: string | null;
  sigmetAo: number;
  sigmetN: number;
  kp: number | null;
  gScale: string | null;
  xray: string | null;
  rwy: string | null;
  rwyM: number | null;
  night: boolean;
  sunrise: string | null;
  sunset: string | null;
  swpc: number;
  jamHot: number;
  instruction: boolean;
  tracks: number;
  unacked: number;
  locked: number;
  source: string;
};

export type WatchCop = {
  instruction: boolean;
  tracks: number;
  unacked: number;
  locked: number;
};

export type WatchShiftRow = {
  id: string;
  openedBy: string;
  openedLabel: string;
  openedRole: string;
  openedTeam: string;
  openedAt: string;
  closedBy: string | null;
  closedLabel: string | null;
  closedAt: string | null;
  status: "open" | "closed";
  snapIn: WatchSnap;
  snapOut: WatchSnap | null;
  aar: string | null;
  noteIn: string;
  noteOut: string;
};

const EMPTY_SNAP: WatchSnap = {
  at: 0,
  fluxOk: 0,
  fluxN: 0,
  ac: 0,
  local: 0,
  emergency: 0,
  military: 0,
  uav: 0,
  metarFttj: null,
  cat: null,
  tafFttj: null,
  sigmetAo: 0,
  sigmetN: 0,
  kp: null,
  gScale: null,
  xray: null,
  rwy: null,
  rwyM: null,
  night: false,
  sunrise: null,
  sunset: null,
  swpc: 0,
  jamHot: 0,
  instruction: false,
  tracks: 0,
  unacked: 0,
  locked: 0,
  source: "sans ingest",
};

function cap(s: string | null | undefined, n = 400): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

export function snapFromPicture(pic: LivePicture | null, cop: WatchCop): WatchSnap {
  if (!pic) {
    return {
      ...EMPTY_SNAP,
      at: Date.now(),
      instruction: cop.instruction,
      tracks: cop.tracks,
      unacked: cop.unacked,
      locked: cop.locked,
    };
  }
  const fttj = pic.metar.find((m) => m.icao === "FTTJ") ?? null;
  const taf =
    pic.taf.find((t) => t.icao === "FTTJ") ??
    pic.taf.find((t) => t.raw.includes("FTTJ")) ??
    null;
  return {
    at: pic.at,
    fluxOk: pic.sources.filter((s) => s.ok).length,
    fluxN: pic.sources.length,
    ac: pic.sahelN || pic.aircraft.length,
    local: pic.localN,
    emergency: pic.emergencies.length,
    military: pic.aircraft.filter((a) => a.military).length,
    uav: pic.aircraft.filter((a) => (a.category ?? "").toUpperCase() === "B6").length,
    metarFttj: cap(fttj?.raw),
    cat: fttj?.cat ?? null,
    tafFttj: cap(taf?.raw, 600),
    sigmetAo: pic.sigmets.filter((s) => s.inAo).length,
    sigmetN: pic.sigmets.length,
    kp: pic.space.kp,
    gScale: pic.space.gScale ?? null,
    xray: pic.space.xrayClass ?? null,
    rwy: pic.airport?.rwy ?? null,
    rwyM: pic.airport?.rwyM ?? null,
    night: Boolean(pic.solar?.nightOps),
    sunrise: pic.solar?.sunrise ?? null,
    sunset: pic.solar?.sunset ?? null,
    swpc: pic.alerts.length,
    jamHot: pic.jam.filter((j) => j.level !== "low").length,
    instruction: cop.instruction,
    tracks: cop.tracks,
    unacked: cop.unacked,
    locked: cop.locked,
    source: cap(pic.source, 180) ?? "ingest",
  };
}

export function parseSnap(raw: string | null | undefined): WatchSnap | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as WatchSnap;
    if (!v || typeof v !== "object") return null;
    return {
      ...EMPTY_SNAP,
      ...v,
      at: Number(v.at) || 0,
      fluxOk: Number(v.fluxOk) || 0,
      fluxN: Number(v.fluxN) || 0,
      ac: Number(v.ac) || 0,
      local: Number(v.local) || 0,
    };
  } catch {
    return null;
  }
}

export function snapLine(s: WatchSnap): string {
  const raw = (s.metarFttj ?? "").replace(/^METAR\s+/, "");
  const metar = s.metarFttj
    ? `${s.cat ? `${s.cat} ` : ""}${raw}`.trim().slice(0, 88)
    : "FTTJ METAR absent";
  const g =
    s.gScale == null || s.gScale === ""
      ? ""
      : /^G/i.test(s.gScale)
        ? s.gScale
        : `G${s.gScale}`;
  return [
    `1090 ${s.ac} (ident ${s.local})`,
    metar,
    `SIGMET AO ${s.sigmetAo}`,
    s.kp != null ? `Kp ${s.kp}${g ? ` ${g}` : ""}` : "Kp —",
    s.xray ? `GOES ${s.xray}` : null,
    s.rwy ? `RWY ${s.rwy}` : null,
    s.night ? "nuit" : "jour",
    s.instruction ? "EXERCICE" : "veille réelle",
  ]
    .filter(Boolean)
    .join(" · ");
}

function delta(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return "stable";
  return d > 0 ? `+${d}` : String(d);
}

export function composeAar(opts: {
  openedLabel: string;
  openedRole: string;
  openedTeam: string;
  openedAt: string;
  closedLabel: string;
  closedAt: string;
  durationMs: number;
  snapIn: WatchSnap;
  snapOut: WatchSnap;
  noteIn: string;
  noteOut: string;
}): string {
  const hours = formatWatchDuration(opts.durationMs);
  const metarChanged =
    (opts.snapIn.metarFttj ?? "") !== (opts.snapOut.metarFttj ?? "") ||
    opts.snapIn.cat !== opts.snapOut.cat;
  const lines = [
    `QUART AfriControl · FTTJ`,
    `Agent : ${opts.openedLabel} · ${opts.openedRole} · ${opts.openedTeam}`,
    `Ouverture : ${opts.openedAt}`,
    `Clôture : ${opts.closedAt} · ${opts.closedLabel} · ${hours}`,
    `Gel ouverture : ${snapLine(opts.snapIn)}`,
    `Gel clôture : ${snapLine(opts.snapOut)}`,
    `Delta 1090 : ${delta(opts.snapIn.ac, opts.snapOut.ac)} · ident ${delta(opts.snapIn.local, opts.snapOut.local)} · urgences ${delta(opts.snapIn.emergency, opts.snapOut.emergency)}`,
    `METAR FTTJ : ${metarChanged ? "changé" : "inchangé"}`,
    `SIGMET AO : ${opts.snapIn.sigmetAo} → ${opts.snapOut.sigmetAo}`,
    `GNSS chaud : ${opts.snapIn.jamHot} → ${opts.snapOut.jamHot} · SWPC ${opts.snapIn.swpc} → ${opts.snapOut.swpc}`,
    opts.noteIn ? `Consigne entrée : ${opts.noteIn}` : "Consigne entrée : (aucune)",
    opts.noteOut ? `Consigne sortie : ${opts.noteOut}` : "Consigne sortie : (aucune)",
    `AfriControl n'émet pas. Gel capteurs réels — 0 contact 1090 est un silence capteur, pas une panne du poste.`,
  ];
  return lines.join("\n");
}

export function formatWatchDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 min";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(0, m)} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h${String(rm).padStart(2, "0")}` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}j ${rh}h` : `${d} j`;
}

export function shortWatchLabel(label: string): string {
  const t = label.replace(/^Chef de division\s*[·•\-–]\s*/i, "").trim();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /\.$/.test(parts[0]!)) return parts[1]!;
  return parts[0] ?? t;
}

export const EMPTY_WATCH_SNAP = EMPTY_SNAP;
