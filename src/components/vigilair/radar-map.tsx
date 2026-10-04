import { useEffect, useRef } from "react";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import {
  AES_HULL,
  AO,
  LAKE_CHAD,
  SAHEL_CITIES,
  SAHEL_STATES,
  SCALE,
  HOME,
  destPoint,
  formatAzimut,
  formatCoord,
  formatGsdM,
  formatRange,
  haversineKm,
  headingBetween,
  isHiResScale,
  isHomeOrigin,
  isLocalScale,
  mgrsCompact,
  predictPath,
  project,
  unproject,
  type GeoOrigin,
  type MapScale,
} from "@/lib/vigilair/geo";
import { COUNTRY_COUNT, drawMondeOverlay } from "@/lib/vigilair/world-draw";
import {
  PEAKS,
  RANGE_AXES,
  axisLeg,
} from "@/lib/vigilair/terrain";
import { ACOUSTIC_SITES, SENSOR_SITES } from "@/lib/vigilair/sensors";
import { getLiveZones } from "@/lib/vigilair/zones";
import { peekTracks, threatOf, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { satCredit, drawTiles, liveGsd, pixelBudgetLine, formatPx, pixelSpan, pixelDetections, pixelClassLabel, scanCenterTile, localImageryShare, LOCAL_CREDIT } from "@/lib/vigilair/tiles";
import { formatFireAge, lockFire, fireAgeMs } from "@/lib/vigilair/fire-clock";
import { placeGpsZone, focusMine, focusWater } from "@/lib/vigilair/place-zone";
import { PASS_LABEL } from "@/lib/vigilair/passability";
import { LAKE_ROUTES, routeKm } from "@/lib/vigilair/lake-routes";
import { MINES } from "@/lib/vigilair/mines";
import { HYDRO, hydroKm, waterAt } from "@/lib/vigilair/hydro";
import { isFriend } from "@/lib/vigilair/friends";
import { affiliationColorVar, affiliationOf, drawApp6Air } from "@/lib/vigilair/app6";
import { m4Short } from "@/lib/vigilair/iff";
import type { Origin, Track } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

function token(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Remplissage translucide d'une couleur #rrggbb pour un cadre APP-6. */
function hexA(hex: string, a: number) {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function clampPt(x: number, y: number, w: number, h: number) {
  const m = 16;
  return {
    x: Math.max(m, Math.min(w - m, x)),
    y: Math.max(m, Math.min(h - m, y)),
    clipped: x < m || x > w - m || y < m || y > h - m,
  };
}

type CopHud = {
  cursor: { x: number; y: number; lat: number; lon: number } | null;
  a: { lat: number; lon: number } | null;
  b: { lat: number; lon: number } | null;
};

const copHud: CopHud = { cursor: null, a: null, b: null };
let liveCanvas: HTMLCanvasElement | null = null;

export function armMeasure(
  a: { lat: number; lon: number } | null,
  b: { lat: number; lon: number } | null = null,
) {
  copHud.a = a;
  copHud.b = b;
}

export function peekCopCursor() {
  return copHud.cursor;
}

export function snapshotCop(): void {
  const canvas = liveCanvas;
  if (!canvas) return;
  const scale = SCALE[useVigilair.getState().mapScale]?.label ?? "COP";
  canvas.toBlob((blob) => {
    if (!blob) return;
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AfriControl-COP-${scale}-${stamp}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

const VECTOR_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

/**
 * Durée du vecteur vitesse selon l'échelle : une piste à 300 km/h trace environ 1/12 de la
 * carte (1 min à 120 km de large, 1 s au zoom 0,3 m). La durée est écrite sur la plaque d'échelle.
 */
function vectorSeconds(sizeKm: number): number {
  const ideal = sizeKm * 0.5;
  return VECTOR_STEPS.find((s) => s >= ideal) ?? VECTOR_STEPS[VECTOR_STEPS.length - 1];
}

function drawRangeAxes(
  ctx: CanvasRenderingContext2D,
  pj: (lat: number, lon: number) => { x: number; y: number },
  w: number,
  h: number,
  scale: MapScale,
  ice: string,
  fg: string,
  muted: string,
  axisId: string | null,
) {
  if (scale === "k4" || scale === "ident") return;
  const overview = scale === "aes" || scale === "sahel" || scale === "monde";
  const home = pj(AO.airport.lat, AO.airport.lon);
  const slots: { x: number; y: number }[] = [];
  for (const ax of RANGE_AXES) {
    const b = pj(ax.lat, ax.lon);
    const inside = b.x >= 4 && b.x <= w - 4 && b.y >= 4 && b.y <= h - 4;
    if (!overview && !inside) continue;
    if (b.x < -120 || b.x > w + 120 || b.y < -120 || b.y > h + 120) continue;
    const on = ax.id === axisId;
    ctx.strokeStyle = on ? ice : "rgba(200,204,212,0.55)";
    ctx.globalAlpha = on ? 0.95 : 0.7;
    ctx.setLineDash(on ? [] : [5, 4]);
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(home.x, home.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = on ? ice : muted;
    ctx.beginPath();
    ctx.arc(b.x, b.y, on ? 3.2 : 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (scale === "monde" && !on) continue;
    const leg = axisLeg(ax);
    const dx = b.x - home.x;
    const dy = b.y - home.y;
    const len = Math.hypot(dx, dy) || 1;
    const push = len < 42 ? 46 : 8;
    const lx0 = Math.max(8, Math.min(w - 130, b.x + (dx / len) * push));
    let ly = Math.max(14, Math.min(h - 36, b.y + (dy / len) * push));
    for (let n = 0; n < 6; n++) {
      if (!slots.some((s) => Math.abs(s.x - lx0) < 108 && Math.abs(s.y - ly) < 12)) break;
      ly = Math.min(h - 20, ly + 13);
    }
    slots.push({ x: lx0, y: ly });
    ctx.fillStyle = on ? fg : muted;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.fillText(`${ax.short} ${formatRange(leg.km)}`, lx0, ly);
  }
}

function drawLakeRoutes(
  ctx: CanvasRenderingContext2D,
  pj: (lat: number, lon: number) => { x: number; y: number },
  w: number,
  h: number,
  scale: MapScale,
  ice: string,
  fg: string,
  muted: string,
  routeId: string | null,
) {
  if (scale === "k4" || scale === "ident") return;
  const labelAll = scale === "approche" || scale === "veille";
  for (const route of LAKE_ROUTES) {
    const pts = route.waypoints.map((fix) => ({
      ...fix,
      ...pj(fix.lat, fix.lon),
    }));
    const visible = pts.some((p) => p.x > -80 && p.x < w + 80 && p.y > -80 && p.y < h + 80);
    if (!visible) continue;
    const on = route.id === routeId;
    ctx.strokeStyle = route.craft === "jetski" ? ice : "rgba(125,155,134,0.9)";
    ctx.globalAlpha = on ? 0.95 : 0.75;
    ctx.lineWidth = on ? 2.2 : 1.25;
    ctx.setLineDash(route.craft === "jetski" ? [] : [8, 5]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = on ? ice : muted;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, on ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!on && !labelAll) continue;
    const mid = pts[Math.floor(pts.length / 2)]!;
    const tag = route.craft === "jetski" ? "JET" : "PIR";
    ctx.fillStyle = on ? fg : muted;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.fillText(`${tag} ${route.short} ${formatRange(routeKm(route))}`, mid.x + 8, mid.y - 8);
  }
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  pj: (lat: number, lon: number) => { x: number; y: number },
  w: number,
  h: number,
  sizeKm: number,
  scale: MapScale,
  ice: string,
  fg: string,
  muted: string,
  marine: boolean,
  waterId: string | null,
) {
  if (!marine) return;
  for (const place of HYDRO) {
    const line = place.line;
    if (line && line.length > 1) {
      const pts = line.map((fix) => ({ ...fix, ...pj(fix.lat, fix.lon) }));
      const visible = pts.some((p) => p.x > -80 && p.x < w + 80 && p.y > -80 && p.y < h + 80);
      if (!visible) continue;
      const on = place.id === waterId;
      ctx.strokeStyle = ice;
      ctx.globalAlpha = on ? 1 : 0.9;
      ctx.lineWidth = on ? 3.2 : 2.2;
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = on ? ice : muted;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, on ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (on || scale === "k4" || scale === "ident" || scale === "veille" || scale === "approche" || scale === "aes" || scale === "sahel") {
        const mid = pts[Math.floor(pts.length / 2)]!;
        ctx.fillStyle = on ? fg : muted;
        ctx.font = "500 10px 'IBM Plex Mono', monospace";
        ctx.fillText(`${place.short} ${formatRange(hydroKm(place))}`, mid.x + 8, mid.y - 8);
      }
      continue;
    }
    const c = pj(place.lat, place.lon);
    const r = Math.max(4, (place.radiusKm / sizeKm) * w);
    if (c.x < -r - 24 || c.x > w + r + 24 || c.y < -r - 24 || c.y > h + r + 24) continue;
    const on = place.id === waterId;
    if (place.circle) {
      ctx.beginPath();
      for (let hdg = 0; hdg < 360; hdg += 20) {
        const p = destPoint(place.lat, place.lon, hdg, place.radiusKm);
        const xy = pj(p.lat, p.lon);
        if (hdg === 0) ctx.moveTo(xy.x, xy.y);
        else ctx.lineTo(xy.x, xy.y);
      }
      ctx.closePath();
      ctx.fillStyle = ice;
      ctx.globalAlpha = on ? 0.28 : 0.16;
      ctx.fill();
      ctx.strokeStyle = ice;
      ctx.globalAlpha = on ? 0.95 : 0.72;
      ctx.lineWidth = on ? 2.4 : 1.6;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = on ? ice : muted;
    ctx.fillRect(c.x - 2.5, c.y - 2.5, 5, 5);
    const named =
      on ||
      ((place.region === "tchad" || scale === "veille" || scale === "approche") && scale !== "monde");
    if (!named) continue;
    ctx.fillStyle = on ? fg : muted;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText(place.short, c.x + 6, c.y - 4);
  }
}

function drawMines(
  ctx: CanvasRenderingContext2D,
  pj: (lat: number, lon: number) => { x: number; y: number },
  w: number,
  h: number,
  sizeKm: number,
  scale: MapScale,
  ice: string,
  fg: string,
  muted: string,
  warn: string,
  crit: string,
  mineId: string | null,
) {
  const taken: { x: number; y: number }[] = [];
  for (const mine of MINES) {
    const p = pj(mine.lat, mine.lon);
    const r = Math.max(3, (mine.radiusKm / sizeKm) * w);
    if (p.x < -r - 20 || p.x > w + r + 20 || p.y < -r - 20 || p.y > h + r + 20) continue;
    const on = mine.id === mineId;
    const level =
      useVigilair.getState().zonePicture.find((z) => z.zone.id === mine.id)?.level ?? "veille";
    ctx.strokeStyle =
      level === "intrusion" ? crit : level === "approche" ? warn : on ? ice : "rgba(196,165,116,0.55)";
    ctx.globalAlpha = on ? 0.95 : 0.8;
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = level === "intrusion" ? crit : on ? ice : warn;
    ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    ctx.globalAlpha = 1;
    const named = on || scale !== "monde";
    if (!named) continue;
    const lx = p.x + 7;
    let ly = p.y - 6;
    for (let n = 0; n < 5; n++) {
      if (!taken.some((s) => Math.abs(s.x - lx) < 72 && Math.abs(s.y - ly) < 11)) break;
      ly += 12;
    }
    taken.push({ x: lx, y: ly });
    ctx.fillStyle = on ? fg : muted;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText(on ? `${mine.short} · ${mine.commodity}` : mine.short, lx, ly);
  }
}

function drawPeaks(
  ctx: CanvasRenderingContext2D,
  pj: (lat: number, lon: number) => { x: number; y: number },
  w: number,
  h: number,
  scale: MapScale,
  ice: string,
  fg: string,
  muted: string,
  warn: string,
  peakId: string | null,
  thermal: boolean,
) {
  const taken: { x: number; y: number }[] = [];
  for (const pk of PEAKS) {
    const p = pj(pk.lat, pk.lon);
    if (p.x < 2 || p.x > w - 2 || p.y < 2 || p.y > h - 2) continue;
    const on = pk.id === peakId;
    ctx.strokeStyle = thermal ? warn : ice;
    ctx.fillStyle = on ? (thermal ? warn : ice) : "transparent";
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - (on ? 7 : 5));
    ctx.lineTo(p.x + (on ? 5 : 3.5), p.y + (on ? 4 : 3));
    ctx.lineTo(p.x - (on ? 5 : 3.5), p.y + (on ? 4 : 3));
    ctx.closePath();
    ctx.stroke();
    if (on) ctx.fill();
    const named = on || (scale === "monde" ? pk.mark : true);
    if (!named) continue;
    const lx = p.x + 6;
    const ly = p.y - 2;
    if (!on && taken.some((t) => Math.hypot(t.x - lx, t.y - ly) < 28)) continue;
    taken.push({ x: lx, y: ly });
    ctx.fillStyle = on ? fg : muted;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText(`${pk.name} ${pk.elevM} m`, lx, ly);
  }
}

function draw(
  canvas: HTMLCanvasElement,
  tracks: Track[],
  selectedId: string | null,
  sweep: number,
  forcedScale: MapScale | undefined,
  fr24: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = forcedScale ?? useVigilair.getState().mapScale;
  canvas.dataset.drawnScale = scale;
  const dpr = canvas.width / canvas.clientWidth;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const root = document.documentElement;
  const bg = token(root, "--color-bg", "#09090b");
  const fg = token(root, "--color-fg", "#f4f4f5");
  const muted = token(root, "--color-muted", "#71717a");
  const mutedFg = token(root, "--color-muted-foreground", "#94a7af");
  const border = token(root, "--color-border", "#27272a");
  const ice = token(root, "--color-primary", "#c8ccd4");
  const surface = token(root, "--color-surface", "#121214");
  const ok = token(root, "--color-ok", "#7d9b86");
  const warn = token(root, "--color-warn", "#c4a574");
  const crit = token(root, "--color-crit", "#c45c5c");
  const originStroke: Record<Origin, string> = {
    CN: token(root, "--color-cn", "#c47a7a"),
    TR: token(root, "--color-tr", "#c4a574"),
    RU: token(root, "--color-ru", "#8aa0b8"),
    IR: token(root, "--color-ir", "#b89b7a"),
    XX: token(root, "--color-xx", "#71717a"),
  };

  const cfg = SCALE[scale];
  const sizeKm = cfg.sizeKm;
  const close = isLocalScale(scale);
  const st = useVigilair.getState();
  const origin: GeoOrigin = isHiResScale(scale) ? st.viewOrigin : HOME;
  const pj = (lat: number, lon: number) => project(lat, lon, w, h, sizeKm, origin);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const nTiles = drawTiles(ctx, w, h, cfg.tileZ, sizeKm, st.satLayer, origin);
  const sat = nTiles > 0;
  const layer = useVigilair.getState().satLayer;
  if (sat) {
    ctx.fillStyle =
      layer === "vis"
        ? scale === "k4"
          ? "rgba(9,9,11,0.02)"
          : scale === "ident"
            ? "rgba(9,9,11,0.04)"
            : scale === "veille" || scale === "approche"
              ? "rgba(9,9,11,0.05)"
              : "rgba(9,9,11,0.08)"
        : layer === "th"
          ? "rgba(32,12,6,0.06)"
          : layer === "nv"
            ? "rgba(4,6,12,0.04)"
            : layer === "rel"
              ? "rgba(12,10,6,0.05)"
              : "rgba(6,10,18,0.05)";
    ctx.fillRect(0, 0, w, h);
  }

  const city = pj(AO.city.lat, AO.city.lon);
  const rCity = (AO.city.rKm / sizeKm) * w;

  if (!sat) {
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.arc(city.x, city.y, Math.max(3, rCity), 0, Math.PI * 2);
    ctx.fill();
  }

  if (scale !== "monde") {
    ctx.strokeStyle = sat ? "rgba(244,244,245,0.05)" : border;
    ctx.lineWidth = 1;
    if (close) {
      const gridKm = scale === "k4" || scale === "ident" ? 0.5 : 2;
      const px = (gridKm / sizeKm) * w;
      const anchor = pj(origin.lat, origin.lon);
      if (px > 8) {
        const x0 = anchor.x % px;
        const y0 = anchor.y % px;
        for (let x = x0; x <= w; x += px) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = y0; y <= h; y += px) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }
    } else {
      const step = w / 8;
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
  }

  const drawPoly = (
    pts: { lat: number; lon: number }[],
    color: string,
    width: number,
    fill?: string,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const xy = pj(p.lat, p.lon);
      if (i === 0) ctx.moveTo(xy.x, xy.y);
      else ctx.lineTo(xy.x, xy.y);
    });
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.stroke();
  };

  if (close) {
    drawPoly(AO.river, "rgba(138,160,184,0.45)", 2.2);
    drawPoly(AO.logone, "rgba(138,160,184,0.28)", 1.4);
  } else if (scale === "monde") {
    drawMondeOverlay(ctx, pj, w, h, ice, fg, muted);
    drawPoly(LAKE_CHAD, "rgba(138,160,184,0.7)", 1, "rgba(138,160,184,0.2)");
  } else if (scale === "approche" || scale === "veille") {
    drawPoly(LAKE_CHAD, "rgba(138,160,184,0.55)", 1.2, "rgba(138,160,184,0.12)");
    if (scale === "veille") {
      drawPoly(AO.river, "rgba(138,160,184,0.4)", 1.6);
      drawPoly(AO.logone, "rgba(138,160,184,0.22)", 1.2);
    }
  } else {
    drawPoly(LAKE_CHAD, "rgba(138,160,184,0.55)", 1.2, "rgba(138,160,184,0.12)");
    ctx.setLineDash([6, 5]);
    drawPoly(AES_HULL, "rgba(200,204,212,0.35)", 1.4);
    ctx.setLineDash([]);
  }

  drawLakeRoutes(ctx, pj, w, h, scale, ice, fg, muted, st.lakeRouteId);
  drawChart(ctx, pj, w, h, sizeKm, scale, ice, fg, muted, st.marine, st.waterId);

  const pic = useVigilair.getState().livePicture;
  if (!close && scale !== "monde" && pic?.sigmets?.length) {
    for (const s of pic.sigmets) {
      if (!s.inAo || s.coords.length < 3) continue;
      drawPoly(
        s.coords,
        "rgba(196,165,116,0.55)",
        1.2,
        "rgba(196,165,116,0.08)",
      );
    }
  }
  if (!close && scale !== "monde" && pic?.jam?.length) {
    for (const cell of pic.jam) {
      if (cell.level === "low") continue;
      const p = pj(cell.lat, cell.lon);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      const r = Math.max(8, (90 / sizeKm) * w);
      ctx.strokeStyle =
        cell.level === "high" ? "rgba(196,92,92,0.7)" : "rgba(196,165,116,0.7)";
      ctx.fillStyle =
        cell.level === "high" ? "rgba(196,92,92,0.10)" : "rgba(196,165,116,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (pic?.metar?.length && scale !== "monde") {
    for (const m of pic.metar) {
      if (m.lat == null || m.lon == null) continue;
      if (close && m.icao === "FTTJ") continue;
      const p = pj(m.lat, m.lon);
      if (p.x < -12 || p.x > w + 12 || p.y < -12 || p.y > h + 12) continue;
      const tone =
        m.cat === "IFR" || m.cat === "LIFR" ? crit : m.cat === "MVFR" ? warn : ok;
      ctx.fillStyle = tone;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.rect(p.x - 2.5, p.y - 2.5, 5, 5);
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = muted;
      ctx.font = "400 8px 'IBM Plex Mono', monospace";
      ctx.fillText(`${m.icao} ${m.cat ?? ""}`.trim(), p.x + 6, p.y + 3);
      ctx.globalAlpha = 1;
    }
  }

  const ap = pj(AO.airport.lat, AO.airport.lon);
  if (scale === "monde") {
    ctx.fillStyle = ice;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(ap.x, ap.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = muted;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText("FTTJ", ap.x + 6, ap.y - 5);
    ctx.globalAlpha = 1;
  } else if (scale === "k4") {
    const a = destPoint(AO.airport.lat, AO.airport.lon, 50, 1.4);
    const b = destPoint(AO.airport.lat, AO.airport.lon, 230, 1.4);
    const pa = pj(a.lat, a.lon);
    const pb = pj(b.lat, b.lon);
    ctx.strokeStyle = ice;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = muted;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    const fttjMetarK4 = pic?.metar?.find((m) => m.icao === "FTTJ");
    ctx.fillText(
      fttjMetarK4?.cat ? `FTTJ ${fttjMetarK4.cat}` : "FTTJ 05/23",
      ap.x + 10,
      ap.y - 6,
    );
  } else if (!close || isHomeOrigin(origin)) {
    ctx.save();
    ctx.translate(ap.x, ap.y);
    ctx.rotate((50 * Math.PI) / 180);
    ctx.strokeStyle = ice;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = close ? 3 : 2;
    const rw = close ? 22 : scale === "veille" ? 14 : 8;
    ctx.beginPath();
    ctx.moveTo(-rw, 0);
    ctx.lineTo(rw, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.fillStyle = muted;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    const fttjMetar = pic?.metar?.find((m) => m.icao === "FTTJ");
    ctx.fillText(
      fttjMetar?.cat ? `FTTJ ${fttjMetar.cat}` : "FTTJ",
      ap.x + 10,
      ap.y - 6,
    );
  }

  const radar = SENSOR_SITES.find((s) => s.id === "rad-1");
  const ringAt = st.capture || !isHomeOrigin(origin) ? origin : radar;
  if (ringAt && scale !== "monde") {
    const rp = pj(ringAt.lat, ringAt.lon);
    for (const km of cfg.rings) {
      const r = (km / sizeKm) * w;
      ctx.strokeStyle = "rgba(200,204,212,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(200,204,212,0.35)";
      ctx.font = "400 9px 'IBM Plex Mono', monospace";
      ctx.fillText(`${km} km`, rp.x + 6, rp.y - r + 10);
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && (close || scale === "veille")) {
      const r = (cfg.rings[cfg.rings.length - 1]! / sizeKm) * w;
      const grad = ctx.createRadialGradient(rp.x, rp.y, 0, rp.x, rp.y, r);
      grad.addColorStop(0, "rgba(200,204,212,0.05)");
      grad.addColorStop(1, "rgba(200,204,212,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(rp.x, rp.y);
      ctx.arc(rp.x, rp.y, r, sweep, sweep + 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (!close && scale !== "monde" && scale !== "veille") {
    ctx.textAlign = "center";
    for (const st of SAHEL_STATES) {
      const p = pj(st.lat, st.lon);
      if (p.x < 16 || p.x > w - 16 || p.y < 14 || p.y > h - 14) continue;
      ctx.fillStyle = st.aes ? ice : muted;
      ctx.globalAlpha = st.aes ? 0.9 : 0.55;
      ctx.font = st.aes
        ? "600 12px 'IBM Plex Sans', sans-serif"
        : "500 11px 'IBM Plex Sans', sans-serif";
      ctx.fillText(st.name.toUpperCase(), p.x, p.y);
      if (st.aes) {
        ctx.font = "500 8px 'IBM Plex Mono', monospace";
        ctx.globalAlpha = 0.7;
        ctx.fillText("AES", p.x, p.y + 11);
      }
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.font = "500 10px 'IBM Plex Sans', sans-serif";
    const maxTier = scale === "sahel" ? 1 : 2;
    for (const c of SAHEL_CITIES) {
      if (c.tier > maxTier) continue;
      const p = pj(c.lat, c.lon);
      if (p.x < 8 || p.x > w - 8 || p.y < 8 || p.y > h - 8) continue;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.name === "N'Djamena" ? 2.6 : 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = muted;
      ctx.fillText(c.name, p.x + 6, p.y + 3);
      ctx.fillStyle = fg;
    }
    ctx.globalAlpha = 1;
  } else if (close || scale === "veille") {
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.75;
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText("N'DJAMENA", city.x - 34, city.y + 4);
    ctx.globalAlpha = 1;
    for (const site of getLiveZones()) {
      const sp = pj(site.lat, site.lon);
      const r = (site.radiusKm / sizeKm) * w;
      const level =
        useVigilair.getState().zonePicture.find((p) => p.zone.id === site.id)?.level ??
        "veille";
      ctx.strokeStyle =
        level === "intrusion"
          ? "rgba(196,92,92,0.75)"
          : level === "approche"
            ? "rgba(196,165,116,0.6)"
            : level === "trafic"
              ? "rgba(125,155,134,0.45)"
              : "rgba(196,92,92,0.28)";
      ctx.setLineDash(site.armed ? [4, 4] : [2, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(3, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted;
      ctx.font = "400 9px 'IBM Plex Mono', monospace";
      ctx.fillText(site.name, sp.x + 6, sp.y - 6);
    }
  }

  drawMines(ctx, pj, w, h, sizeKm, scale, ice, fg, muted, warn, crit, st.mineId);

  const sensors =
    close || scale === "veille"
      ? SENSOR_SITES
      : scale === "monde"
        ? []
        : SENSOR_SITES.filter((s) => s.kind === "radar" || s.id === "rf-c");
  for (const s of sensors) {
    const p = pj(s.lat, s.lon);
    if (p.x < -8 || p.x > w + 8 || p.y < -8 || p.y > h + 8) continue;
    ctx.fillStyle = ice;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x + 3.5, p.y);
    ctx.lineTo(p.x, p.y + 4);
    ctx.lineTo(p.x - 3.5, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = muted;
    ctx.font = "400 8px 'IBM Plex Mono', monospace";
    ctx.fillText(s.name, p.x + 6, p.y + 3);
    ctx.globalAlpha = 1;
  }

  const peaksOn =
    !close &&
    (st.showPeaks || st.satLayer === "ir" || st.satLayer === "th" || st.satLayer === "rel");
  canvas.dataset.axis = st.axisId ?? "";
  canvas.dataset.peak = st.peakId ?? "";
  canvas.dataset.gps = st.gpsZone?.id ?? "";
  canvas.dataset.gpsMode = st.gpsZone?.mode ?? "";
  canvas.dataset.lake = st.lakeRouteId ?? "";
  canvas.dataset.mine = st.mineId ?? "";
  canvas.dataset.marine = st.marine ? "1" : "0";
  canvas.dataset.water = st.waterId ?? "";
  drawRangeAxes(ctx, pj, w, h, scale, ice, fg, muted, st.axisId);
  const gz = st.gpsZone;
  if (gz) {
    ctx.beginPath();
    for (let hdg = 0; hdg < 360; hdg += 18) {
      const p = destPoint(gz.lat, gz.lon, hdg, gz.radiusKm);
      const xy = pj(p.lat, p.lon);
      if (hdg === 0) ctx.moveTo(xy.x, xy.y);
      else ctx.lineTo(xy.x, xy.y);
    }
    ctx.closePath();
    ctx.strokeStyle = ice;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const c = pj(gz.lat, gz.lon);
    if (c.x > -20 && c.x < w + 20 && c.y > -20 && c.y < h + 20) {
      ctx.fillStyle = ice;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = "500 11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${gz.name} · ${PASS_LABEL[gz.mode]}`, c.x + 8, c.y - 6);
      ctx.fillStyle = muted;
      ctx.font = "400 10px 'IBM Plex Mono', monospace";
      ctx.fillText(formatCoord(gz.lat, gz.lon), c.x + 8, c.y + 8);
    }
  }
  if (peaksOn) {
    drawPeaks(
      ctx,
      pj,
      w,
      h,
      scale,
      ice,
      fg,
      muted,
      warn,
      st.peakId,
      st.satLayer === "ir" || st.satLayer === "th",
    );
  }

  for (const ph of st.phenomena) {
    const p = pj(ph.lat, ph.lon);
    if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
    if (ph.kind === "feu" && ph.source === "NASA FIRMS") {
      ctx.strokeStyle = crit;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = crit;
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      lockFire(ph.id);
      const age = fireAgeMs(ph.id, Date.now()) ?? 0;
      ctx.fillText(`VIIRS ${formatFireAge(age)}`, p.x + 10, p.y - 4);
      continue;
    }
    const tone =
      ph.level === "critique" ? crit : ph.level === "elevee" ? warn : ice;
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.rect(p.x - 3, p.y - 3, 6, 6);
    ctx.fill();
    if (scale !== "monde" || ph.theater !== "monde" || ph.level === "critique" || ph.level === "elevee") {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = muted;
      ctx.font = "400 8px 'IBM Plex Mono', monospace";
      ctx.fillText(ph.title.slice(0, 28), p.x + 7, p.y + 3);
    }
    ctx.globalAlpha = 1;
  }

  if (st.capture) {
    const cp = pj(st.capture.lat, st.capture.lon);
    ctx.strokeStyle = ice;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cp.x - 22, cp.y);
    ctx.lineTo(cp.x + 22, cp.y);
    ctx.moveTo(cp.x, cp.y - 22);
    ctx.lineTo(cp.x, cp.y + 22);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText(st.capture.title.slice(0, 22), cp.x + 18, cp.y - 22);
    ctx.fillText(`GSD ${formatGsdM(st.capture.gsdM)}`, cp.x + 18, cp.y - 10);
    if (scale === "ident" || scale === "k4") {
      for (const o of st.capture.objects) {
        if (!o.resolvable || o.lat == null || o.lon == null) continue;
        if (o.id === "gsd" || o.id === "mgrs" || o.id === "land") continue;
        const op = pj(o.lat, o.lon);
        if (op.x < 8 || op.x > w - 8 || op.y < 8 || op.y > h - 8) continue;
        ctx.fillStyle = o.kind === "feu" ? crit : o.kind === "eau" ? ice : fg;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.rect(op.x - 2, op.y - 2, 4, 4);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = fg;
        ctx.font = "400 9px 'IBM Plex Sans', sans-serif";
        ctx.fillText(o.label.slice(0, 22), op.x + 6, op.y - 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  const selected = tracks.find((t) => t.id === selectedId) ?? tracks.find((t) => t.locked);

  if (selected?.acoustic?.locked && close) {
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    for (const b of selected.acoustic.bearings) {
      const site = ACOUSTIC_SITES.find((s) => s.id === b.siteId);
      if (!site) continue;
      const a = pj(site.lat, site.lon);
      const bxy = pj(selected.lat, selected.lon);
      ctx.strokeStyle = "rgba(125,155,134,0.55)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(bxy.x, bxy.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (selected?.pilotFix) {
    const pf = pj(selected.pilotFix.lat, selected.pilotFix.lon);
    const tp = pj(selected.lat, selected.lon);
    ctx.strokeStyle = ice;
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pf.x, pf.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ice;
    ctx.beginPath();
    ctx.rect(pf.x - 3, pf.y - 3, 6, 6);
    ctx.fill();
    ctx.fillStyle = muted;
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillText("TEL", pf.x + 7, pf.y + 3);
  }

  if (selected?.launchFix) {
    const lf = pj(selected.launchFix.lat, selected.launchFix.lon);
    const tp = pj(selected.lat, selected.lon);
    const cl = clampPt(lf.x, lf.y, w, h);
    ctx.strokeStyle = ice;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cl.x, cl.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ice;
    ctx.beginPath();
    ctx.moveTo(cl.x, cl.y - 6);
    ctx.lineTo(cl.x + 5, cl.y + 4);
    ctx.lineTo(cl.x - 5, cl.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = muted;
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    const dSrc = haversineKm(
      selected.launchFix.lat,
      selected.launchFix.lon,
      selected.lat,
      selected.lon,
    );
    ctx.fillText(cl.clipped ? `SRC ${dSrc.toFixed(0)} km` : "SRC", cl.x + 7, cl.y + 3);
  }

  if (selected?.stopFix) {
    const sf = pj(selected.stopFix.lat, selected.stopFix.lon);
    if (sf.x > -20 && sf.x < w + 20 && sf.y > -20 && sf.y < h + 20) {
      ctx.strokeStyle = ice;
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(sf.x - 4, sf.y - 4, 8, 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted;
      ctx.font = "400 9px 'IBM Plex Mono', monospace";
      ctx.fillText(selected.stopFix.predicted ? "ARR?" : "ARR", sf.x + 8, sf.y + 3);
    }
  }

  if (selected && (selected.locked || selected.id === selectedId)) {
    const pred = predictPath(selected.lat, selected.lon, selected.heading, selected.speedKmh);
    ctx.strokeStyle = ok;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const tp = pj(selected.lat, selected.lon);
    ctx.moveTo(tp.x, tp.y);
    for (const pt of pred) {
      const xy = pj(pt.lat, pt.lon);
      ctx.lineTo(xy.x, xy.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const vecS = vectorSeconds(sizeKm);
  const symbols = st.ppi.symbols;
  // Échelles continentales : des centaines d'avions réels. Petits symboles, et une étiquette
  // seulement pour ce qui compte (sélection, verrou, urgence, drone B6, piste non coopérative).
  const wide = scale === "aes" || scale === "sahel" || scale === "monde";
  for (const t of tracks) {
    if (!trackVisible(t, selectedId)) continue;
    const ami = isFriend(t);
    const p = pj(t.lat, t.lon);
    if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
    const affil = affiliationOf(t, threatOf(t)).affiliation;
    const color = symbols
      ? token(root, affiliationColorVar(affil), mutedFg)
      : ami
        ? ok
        : t.origin && originStroke[t.origin]
          ? originStroke[t.origin]
          : ice;
    ctx.strokeStyle = color;
    ctx.globalAlpha = t.locked ? 0.85 : 0.4;
    ctx.lineWidth = t.locked ? 2.2 : 1.2;
    ctx.beginPath();
    t.trail.forEach((pt, i) => {
      const xy = pj(pt.lat, pt.lon);
      if (i === 0) ctx.moveTo(xy.x, xy.y);
      else ctx.lineTo(xy.x, xy.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    const rad = (t.heading * Math.PI) / 180;
    // Vecteur vitesse : où sera la piste dans vecS secondes, au cap et à la vitesse mesurés.
    if (t.speedKmh > 5) {
      const km = (t.speedKmh * vecS) / 3600;
      const q = pj(
        t.lat + (km * Math.cos(rad)) / 111.32,
        t.lon + (km * Math.sin(rad)) / (111.32 * Math.cos((t.lat * Math.PI) / 180)),
      );
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const isSel = t.id === selectedId || t.locked;
    if (isSel) {
      ctx.strokeStyle = t.locked ? ok : ice;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (t.ew?.state === "effet") {
      ctx.strokeStyle = "rgba(196,92,92,0.7)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (t.emergency) {
      ctx.strokeStyle = crit;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (t.nic != null && t.nic < 5) {
      ctx.strokeStyle = warn;
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (t.category?.toUpperCase() === "B6") {
      ctx.strokeStyle = crit;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (t.iff?.m4 === "invalid") {
      ctx.strokeStyle = crit;
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (t.iff?.m4 === "demande") {
      ctx.strokeStyle = warn;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Cadre APP-6 (affiliation) autour du marqueur, non pivoté ; le glyphe plateforme reste dessous.
    if (symbols) {
      drawApp6Air(ctx, p.x, p.y, t.locked ? 13 : wide ? 6 : 11, affil, color, hexA(color, 0.1));
    }

    const plat = PLATFORM_BY_ID[t.truePlatformId];
    if (symbols && wide) {
      // Échelle continentale : le cadre APP-6 suffit, plus un point au centre.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (!ami || t.feed === "adsb") ctx.rotate(rad);
      ctx.fillStyle = color;
      const chasse = plat?.uasClass === "chasse";
      const wingish =
        plat &&
        (chasse ||
          plat.uasClass === "fixed-wing" ||
          plat.uasClass === "male" ||
          plat.uasClass === "ucav" ||
          plat.uasClass === "vtol" ||
          plat.uasClass === "loitering");
      ctx.beginPath();
      if (t.feed === "adsb") {
        ctx.moveTo(0, -7);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 7);
        ctx.lineTo(-7, 0);
      } else if (ami) {
        ctx.rect(-5, -5, 10, 10);
      } else if (chasse) {
        ctx.moveTo(0, -12);
        ctx.lineTo(8, 8);
        ctx.lineTo(0, 3);
        ctx.lineTo(-8, 8);
      } else if (wingish) {
        ctx.moveTo(0, -8);
        ctx.lineTo(5, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-5, 6);
      } else {
        ctx.moveTo(0, -7);
        ctx.lineTo(6, 5);
        ctx.lineTo(-6, 5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const quiet =
      wide &&
      ami &&
      !isSel &&
      !t.emergency &&
      t.category?.toUpperCase() !== "B6";
    if (quiet) continue;
    ctx.fillStyle = fg;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    const tag =
      t.feed === "rejeu"
        ? `${t.callsign} REJ`
        : t.feed === "adsb"
        ? `${t.callsign}${t.military ? " MIL" : ""}${t.category?.toUpperCase() === "B6" ? " UAV" : ""} 1090`
        : ami
          ? `${t.callsign} AMI`
          : t.injected
            ? `${t.callsign} INJ`
            : t.callsign;
    ctx.fillText(tag, p.x + 10, p.y - 6);
    ctx.fillStyle = muted;
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    if (t.iff) {
      ctx.fillText(
        `${t.iff.mode}  ${t.iff.squawk}  ${m4Short(t.iff.m4)}`,
        p.x + 10,
        p.y + 6,
      );
      if (fr24 || close) {
        ctx.fillText(plat ? plat.name : "", p.x + 10, p.y + 16);
      }
    } else if (fr24 || close) {
      const name = plat ? plat.name : "";
      const alt =
        plat?.uasClass === "chasse"
          ? `FL${Math.round(t.altM / 30.48)}`
          : `${Math.round(t.altM)} m`;
      ctx.fillText(`${alt}  ${Math.round(t.speedKmh)} km/h`, p.x + 10, p.y + 6);
      if (name) {
        ctx.fillText(name, p.x + 10, p.y + 16);
      }
    } else {
      ctx.fillText(`${Math.round(t.altM)} m`, p.x + 10, p.y + 6);
    }
  }

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const scaleKm = cfg.barKm;
  const scalePx = (scaleKm / sizeKm) * w;
  const sx = 16;
  const sy = h - 18;
  ctx.font = "400 10px 'IBM Plex Mono', monospace";
  const gsdNow = liveGsd(st.satLayer, cfg.tileZ, origin.lat, st.satMeta?.visSrc);
  const pxH = pixelSpan(gsdNow.m, "homme");
  const pxV = pixelSpan(gsdNow.m, "voiture");
  const pxP = pixelSpan(gsdNow.m, "pirogue");
  const onWater =
    st.marine || !!st.lakeRouteId || !!st.waterId || waterAt(origin.lat, origin.lon) != null;
  const scan = scanCenterTile(st.satLayer, cfg.tileZ, origin.lat, origin.lon, onWater);
  const dets = pixelDetections(gsdNow.m, st.satLayer);
  canvas.dataset.gsd = String(Math.round(gsdNow.m * 10) / 10);
  canvas.dataset.gsdLabel = gsdNow.label;
  canvas.dataset.pxHomme = formatPx(pxH.px);
  canvas.dataset.pxVoiture = formatPx(pxV.px);
  canvas.dataset.pxPirogue = formatPx(pxP.px);
  canvas.dataset.pxHommeCls = pxH.cls;
  canvas.dataset.pxVoitureCls = pxV.cls;
  canvas.dataset.pxPirogueCls = pxP.cls;
  canvas.dataset.detHomme = dets[0]?.cls ?? "aucune";
  canvas.dataset.detVoiture = dets[1]?.cls ?? "aucune";
  canvas.dataset.detPirogue = dets[2]?.cls ?? "aucune";
  canvas.dataset.detHommeN = String(scan.homme);
  canvas.dataset.detVoitureN = String(scan.voiture);
  canvas.dataset.detPirogueN = String(scan.pirogue);
  canvas.dataset.fireVehicule = String(scan.feuVehicule);
  canvas.dataset.fireNaturel = String(scan.feuNaturel);
  canvas.dataset.detReady = scan.ready ? "1" : "0";
  const pxLine = pixelBudgetLine(gsdNow.m);
  canvas.dataset.pxLine = pxLine;
  const vecLabel = `vecteur ${vecS < 60 ? `${vecS} s` : `${vecS / 60} min`}`;
  const barLabel =
    scaleKm < 1
      ? `${Math.round(scaleKm * 1000)} m · ${cfg.label} · ${gsdNow.label} · ${vecLabel}`
      : scale === "monde"
        ? `${scaleKm} km · ${cfg.label} · ${COUNTRY_COUNT} États · ${gsdNow.label} · ${vecLabel}`
        : `${scaleKm} km · ${cfg.label} · ${gsdNow.label} · ${vecLabel}`;
  const credit = sat
    ? localImageryShare() > 0.5
      ? LOCAL_CREDIT
      : satCredit(cfg.tileZ, useVigilair.getState().satLayer, useVigilair.getState().satMeta)
    : "Schéma — imagerie satellitaire en chargement";
  const creditLine = scale === "monde" ? `${credit} · vis / IR / TH / nuit / relief` : credit;
  // Plaque sombre sous l'échelle et le crédit : lisibles même sur une imagerie claire.
  const plateW = Math.max(
    ctx.measureText(creditLine).width,
    scalePx + 8 + ctx.measureText(barLabel).width,
  );
  const plate = { x: sx - 8, y: sy - 25, w: Math.min(w - sx, plateW + 16), h: 35 };
  ctx.fillStyle = "rgba(5, 9, 11, 0.82)";
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
  canvas.dataset.plate = `${plate.x},${plate.y},${Math.round(plate.x + plate.w)},${plate.y + plate.h}`;
  ctx.strokeStyle = ice;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + scalePx, sy);
  ctx.moveTo(sx, sy - 4);
  ctx.lineTo(sx, sy + 4);
  ctx.moveTo(sx + scalePx, sy - 4);
  ctx.lineTo(sx + scalePx, sy + 4);
  ctx.stroke();
  ctx.fillStyle = mutedFg;
  ctx.fillText(barLabel, sx + scalePx + 8, sy + 3);
  ctx.fillText(creditLine, sx, sy - 12);
  if ((scale === "ident" || scale === "k4") && st.satLayer === "vis") {
    for (const hit of scan.hits) {
      const p = pj(hit.lat, hit.lon);
      if (p.x < 4 || p.x > w - 4 || p.y < 4 || p.y > h - 4) continue;
      ctx.strokeStyle = ice;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
      ctx.fillStyle = fg;
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      const tag = hit.id === "voiture" ? "V" : hit.id === "pirogue" ? "P" : "H";
      ctx.fillText(`${tag} ${pixelClassLabel(hit.cls)}`, p.x + 7, p.y - 6);
    }
    for (const fire of scan.fires) {
      const p = pj(fire.lat, fire.lon);
      if (p.x < 4 || p.x > w - 4 || p.y < 4 || p.y > h - 4) continue;
      ctx.strokeStyle = crit;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      ctx.fillStyle = crit;
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      const fid = `px-${fire.lat.toFixed(3)}-${fire.lon.toFixed(3)}`;
      lockFire(fid);
      const age = formatFireAge(fireAgeMs(fid, Date.now()) ?? 0);
      ctx.fillText(fire.kind === "vehicule" ? `feu voiture ${age}` : `feu ${age}`, p.x + 8, p.y - 7);
    }
  }

  const rubber =
    copHud.a && !copHud.b && copHud.cursor
      ? { lat: copHud.cursor.lat, lon: copHud.cursor.lon }
      : copHud.b;
  if (copHud.a) {
    const pa = pj(copHud.a.lat, copHud.a.lon);
    ctx.fillStyle = ice;
    ctx.beginPath();
    ctx.arc(pa.x, pa.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (rubber) {
      const pb = pj(rubber.lat, rubber.lon);
      ctx.strokeStyle = ice;
      ctx.globalAlpha = copHud.b ? 0.9 : 0.55;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pb.x, pb.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      const dist = haversineKm(copHud.a.lat, copHud.a.lon, rubber.lat, rubber.lon);
      const az = headingBetween(copHud.a.lat, copHud.a.lon, rubber.lat, rubber.lon);
      ctx.fillStyle = fg;
      ctx.font = "500 11px 'IBM Plex Mono', monospace";
      ctx.fillText(
        `${formatRange(dist)}  az ${formatAzimut(az)}`,
        (pa.x + pb.x) / 2 + 8,
        (pa.y + pb.y) / 2 - 6,
      );
    }
  }

  if (copHud.cursor) {
    const c = copHud.cursor;
    ctx.strokeStyle = ice;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.x - 7, c.y);
    ctx.lineTo(c.x + 7, c.y);
    ctx.moveTo(c.x, c.y - 7);
    ctx.lineTo(c.x, c.y + 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const dist = haversineKm(AO.airport.lat, AO.airport.lon, c.lat, c.lon);
    const az = headingBetween(AO.airport.lat, AO.airport.lon, c.lat, c.lon);
    const mgrs = mgrsCompact(c.lat, c.lon, scale === "k4" ? 5 : 4);
    const gsdCur = liveGsd(st.satLayer, cfg.tileZ, c.lat, st.satMeta?.visSrc);
    ctx.textAlign = "right";
    ctx.fillStyle = fg;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.fillText(formatCoord(c.lat, c.lon), w - 16, h - 56);
    ctx.fillStyle = muted;
    ctx.font = "400 10px 'IBM Plex Mono', monospace";
    ctx.fillText(mgrs, w - 16, h - 44);
    ctx.fillStyle = fg;
    ctx.fillText(gsdCur.label, w - 16, h - 32);
    if (peaksOn && copHud.cursor) {
      let near: (typeof PEAKS)[number] | null = null;
      let best = 22;
      for (const pk of PEAKS) {
        const q = pj(pk.lat, pk.lon);
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d < best) {
          best = d;
          near = pk;
        }
      }
      if (near) {
        ctx.fillStyle = muted;
        ctx.fillText(
          `${near.name} ${near.elevM} m · pas d'intérieur`,
          w - 16,
          h - 68,
        );
      }
    }
    let nearMine: (typeof MINES)[number] | null = null;
    let bestMine = 18;
    for (const mine of MINES) {
      const q = pj(mine.lat, mine.lon);
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      if (d < bestMine) {
        bestMine = d;
        nearMine = mine;
      }
    }
    if (nearMine) {
      ctx.fillStyle = muted;
      ctx.fillText(`${nearMine.short} · périmètre · pas un homme`, w - 16, h - 68);
    }
    ctx.fillStyle = muted;
    ctx.fillText(`depuis FTTJ ${formatRange(dist)}  az ${formatAzimut(az)}`, w - 16, h - 20);
    ctx.textAlign = "left";
  }

  ctx.save();
  ctx.translate(w - 28, 28);
  ctx.strokeStyle = ice;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = "600 9px 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -2);
  ctx.restore();
}

export function RadarMap({
  tracks,
  selectedId,
  onSelect,
  className,
  scale: scaleProp,
  fr24 = false,
}: {
  tracks: Track[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  scale?: MapScale;
  fr24?: boolean;
}) {
  const storeScale = useVigilair((s) => s.mapScale);
  const scale = scaleProp ?? storeScale;
  const setSatMeta = useVigilair((s) => s.setSatMeta);
  const ref = useRef<HTMLCanvasElement>(null);
  const tracksRef = useRef(tracks);
  const selectedRef = useRef(selectedId);
  const scaleRef = useRef(scale);
  const fr24Ref = useRef(fr24);
  const copTool = useVigilair((s) => s.copTool);
  const copToolRef = useRef(copTool);
  const forcedScaleRef = useRef(scaleProp);
  copToolRef.current = copTool;
  forcedScaleRef.current = scaleProp;
  tracksRef.current = tracks;
  selectedRef.current = selectedId;
  scaleRef.current = scale;
  fr24Ref.current = fr24;

  useEffect(() => {
    if (copTool !== "mesure") {
      copHud.a = null;
      copHud.b = null;
    }
  }, [copTool]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    liveCanvas = canvas;
    let raf = 0;
    let sweep = 0;
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.max(1, Math.floor(rect.height * dpr)));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    const loop = () => {
      if (!reduced) sweep += 0.012;
      draw(
        canvas,
        peekTracks(),
        selectedRef.current,
        sweep,
        forcedScaleRef.current,
        fr24Ref.current,
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (liveCanvas === canvas) liveCanvas = null;
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      fetch("/api/sat")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!stop && j && typeof j === "object") setSatMeta(j);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 45000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [setSatMeta]);

  return (
    <canvas
      ref={ref}
      className={cn("block size-full cursor-crosshair", className)}
      data-map-scale={scale}
      role="img"
      aria-label="Carte satellitaire 4K, visible, infrarouge, thermique, nuit et relief"
      onPointerMove={(e) => {
        const canvas = ref.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const stNow = useVigilair.getState();
        const sc = forcedScaleRef.current ?? stNow.mapScale;
        const sizeKm = SCALE[sc].sizeKm;
        const origin = isHiResScale(sc) ? stNow.viewOrigin : HOME;
        const geo = unproject(x, y, rect.width, rect.height, sizeKm, origin);
        copHud.cursor = { x, y, lat: geo.lat, lon: geo.lon };
      }}
      onClick={(e) => {
        const canvas = ref.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const stNow = useVigilair.getState();
        const sc = forcedScaleRef.current ?? stNow.mapScale;
        const sizeKm = SCALE[sc].sizeKm;
        const origin = isHiResScale(sc) ? stNow.viewOrigin : HOME;
        const geo = unproject(x, y, rect.width, rect.height, sizeKm, origin);
        copHud.cursor = { x, y, lat: geo.lat, lon: geo.lon };
        if (copToolRef.current === "mesure") {
          if (!copHud.a || copHud.b) {
            copHud.a = { lat: geo.lat, lon: geo.lon };
            copHud.b = null;
          } else {
            copHud.b = { lat: geo.lat, lon: geo.lon };
          }
          return;
        }
        if (copToolRef.current === "zone") {
          placeGpsZone(geo.lat, geo.lon);
          return;
        }
        if (stNow.marine) {
          let bestWater: { id: string; d: number } | null = null;
          for (const place of HYDRO) {
            const p = project(place.lat, place.lon, rect.width, rect.height, sizeKm, origin);
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < 16 && (!bestWater || d < bestWater.d)) bestWater = { id: place.id, d };
          }
          if (bestWater) {
            focusWater(bestWater.id);
            return;
          }
        }
        let bestMine: { id: string; d: number } | null = null;
        for (const mine of MINES) {
          const p = project(mine.lat, mine.lon, rect.width, rect.height, sizeKm, origin);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < 14 && (!bestMine || d < bestMine.d)) bestMine = { id: mine.id, d };
        }
        if (bestMine) {
          focusMine(bestMine.id);
          return;
        }
        const peaksOn =
          !isLocalScale(sc) &&
          (stNow.showPeaks ||
            stNow.satLayer === "ir" ||
            stNow.satLayer === "th" ||
            stNow.satLayer === "rel");
        if (peaksOn) {
          let bestPk: { id: string; d: number } | null = null;
          for (const pk of PEAKS) {
            const p = project(pk.lat, pk.lon, rect.width, rect.height, sizeKm, origin);
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < 14 && (!bestPk || d < bestPk.d)) bestPk = { id: pk.id, d };
          }
          if (bestPk) {
            stNow.setPeakId(bestPk.id);
            return;
          }
        }
        let bestPh: { id: string; d: number } | null = null;
        for (const ph of stNow.phenomena) {
          const p = project(ph.lat, ph.lon, rect.width, rect.height, sizeKm, origin);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < 16 && (!bestPh || d < bestPh.d)) bestPh = { id: ph.id, d };
        }
        if (bestPh) {
          const ph = stNow.phenomena.find((p) => p.id === bestPh.id);
          if (ph) {
            stNow.openCapture({
              lat: ph.lat,
              lon: ph.lon,
              kind: ph.kind,
              title: ph.title,
              body: ph.body,
              source: ph.source,
              id: `cap-${ph.id}`,
            });
          }
          return;
        }
        let best: { id: string; d: number } | null = null;
        for (const t of peekTracks()) {
          if (!trackVisible(t, selectedRef.current)) continue;
          const p = project(t.lat, t.lon, rect.width, rect.height, sizeKm, origin);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < 22 && (!best || d < best.d)) best = { id: t.id, d };
        }
        onSelect(best ? best.id : null);
      }}
      onDoubleClick={(e) => {
        const canvas = ref.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const stNow = useVigilair.getState();
        const sc = forcedScaleRef.current ?? stNow.mapScale;
        const sizeKm = SCALE[sc].sizeKm;
        const origin = isHiResScale(sc) ? stNow.viewOrigin : HOME;
        const geo = unproject(x, y, rect.width, rect.height, sizeKm, origin);
        stNow.openCapture({
          lat: geo.lat,
          lon: geo.lon,
          kind: "scene",
          title: "Scène ident",
          body: "Ident visible au double-clic — centre = le point cliqué, FTTJ = distance depuis N'Djamena",
          source: "COP",
        });
      }}
    />
  );
}
