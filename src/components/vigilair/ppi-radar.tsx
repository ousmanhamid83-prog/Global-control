import { useEffect, useRef, type MouseEvent } from "react";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { AO, haversineKm, headingBetween } from "@/lib/vigilair/geo";
import { MAG_DECLINATION_DEG, prfHz, type PpiParams } from "@/lib/vigilair/ppi";
import { affiliationColorVar, affiliationOf, drawApp6Air, type Affiliation } from "@/lib/vigilair/app6";
import { detectRaids, raidTrackIds } from "@/lib/vigilair/raid";
import { getLiveZones } from "@/lib/vigilair/zones";
import { peekTracks, threatOf, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { isFriend } from "@/lib/vigilair/friends";
import { m4Short } from "@/lib/vigilair/iff";
import type { Origin, Track, UasClass } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

function token(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function hexAlpha(hex: string, a: number) {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function polar(cx: number, cy: number, bearing: number, r: number) {
  const rad = (bearing * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function swept(prev: number, next: number, bearing: number) {
  const b = ((bearing % 360) + 360) % 360;
  if (next >= prev) return b >= prev && b <= next;
  return b >= prev || b <= next;
}

function drawBlip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  klass: UasClass | null,
  color: string,
  size: number,
  friend = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (friend) {
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.restore();
    return;
  }
  if (klass === "chasse") {
    ctx.moveTo(0, -size * 1.4);
    ctx.lineTo(size * 0.7, size * 0.6);
    ctx.lineTo(0, size * 0.2);
    ctx.lineTo(-size * 0.7, size * 0.6);
    ctx.closePath();
    ctx.fill();
  } else if (klass === "male" || klass === "ucav" || klass === "fixed-wing") {
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, size);
    ctx.lineTo(-size * 0.7, size);
    ctx.closePath();
    ctx.stroke();
  } else if (klass === "loitering") {
    ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.stroke();
  } else {
    ctx.moveTo(0, -size);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -size * 2.1);
  ctx.stroke();
  ctx.restore();
}

type Paint = { glow: number; last: number };

export function PpiRadar({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedId = useVigilair((s) => s.selectedId);
  const ppi = useVigilair((s) => s.ppi);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const ppiRef = useRef(ppi);
  const selRef = useRef(selectedId);
  ppiRef.current = ppi;
  selRef.current = selectedId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paints = new Map<string, Paint>();
    const flashes: { x: number; y: number; born: number }[] = [];
    const clutter: { brg: number; r: number }[] = [];
    for (let i = 0; i < 90; i++) {
      clutter.push({ brg: Math.random() * 360, r: 0.35 + Math.random() * 0.62 });
    }
    let sweep = 0;
    let prevSweep = 0;
    let last = performance.now();
    let raf = 0;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const phosphor = document.createElement("canvas");
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      phosphor.width = canvas.width;
      phosphor.height = canvas.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const params = ppiRef.current;
      const degPerS = reduced ? 0 : params.rpm * 6;
      prevSweep = sweep;
      sweep = (sweep + degPerS * dt) % 360;
      drawFrame(
        canvas,
        phosphor,
        peekTracks(),
        selRef.current,
        sweep,
        prevSweep,
        params,
        paints,
        flashes,
        clutter,
        t,
        reduced,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const { cx, cy, radius } = scopeGeom(w, h);
    const params = ppiRef.current;
    let best: { id: string; d: number } | null = null;
    for (const tr of peekTracks()) {
      if (!trackVisible(tr, selRef.current)) continue;
      const rng = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
      if (rng > params.rangeKm) continue;
      const brg = headingBetween(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
      const p = polar(cx, cy, brg, (rng / params.rangeKm) * radius);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 28 && (!best || d < best.d)) best = { id: tr.id, d };
    }
    lockTrack(best?.id ?? null);
  };

  return (
    <div className={cn("relative min-h-0 min-w-0 bg-bg", className)}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onClick={onClick}
        aria-label="Écran radar PPI FTTJ"
      />
      <div className="pointer-events-none absolute inset-0 radar-scan" />
    </div>
  );
}

type Legend = { width: number; size: number; base: number; right: boolean; bottom: boolean };

/** Légendes d'angle relevées au dernier tracé ; largeurs estimées avant le premier. */
let legends: Legend[] = [
  { width: 80, size: 12, base: 22, right: false, bottom: false },
  { width: 190, size: 11, base: 40, right: false, bottom: false },
  { width: 220, size: 11, base: 56, right: false, bottom: false },
  { width: 60, size: 11, base: 72, right: false, bottom: false },
  { width: 185, size: 11, base: 22, right: true, bottom: false },
  { width: 115, size: 11, base: 38, right: true, bottom: false },
  { width: 240, size: 10, base: 16, right: false, bottom: true },
];

/**
 * Centre et rayon de l'écran : le plus grand disque, anneau compris, qui tient dans le canvas
 * sans toucher une légende, centré au plus près de h/2 + 4. Écran large : rien ne gêne, même
 * géométrie qu'avant. Écran étroit : le disque descend et rétrécit juste ce qu'il faut, sans saut.
 */
function scopeGeom(w: number, h: number) {
  const cx = w / 2;
  const rects = legends.map((l) => {
    const base = l.bottom ? h - l.base : l.base;
    const x0 = l.right ? w - 16 - l.width : 16;
    return { x0, x1: x0 + l.width, y0: base - l.size * 0.8, y1: base + l.size * 0.25, bottom: l.bottom };
  });
  // Plage de centres possibles pour un rayon : chaque légende proche en interdit une partie.
  const span = (r: number) => {
    const ro = r + 18;
    let lo = ro;
    let hi = h - ro;
    for (const b of rects) {
      const dx = cx < b.x0 ? b.x0 - cx : cx > b.x1 ? cx - b.x1 : 0;
      if (dx >= ro) continue;
      const s = Math.sqrt(ro * ro - dx * dx);
      if (b.bottom) hi = Math.min(hi, b.y0 - s);
      else lo = Math.max(lo, b.y1 + s);
    }
    return lo <= hi ? { lo, hi } : null;
  };
  let radius = Math.min(w, h) * 0.42;
  let fit = span(radius);
  if (!fit) {
    let a = 0;
    let b = radius;
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      if (span(m)) a = m;
      else b = m;
    }
    radius = a;
    fit = span(radius);
  }
  const prefer = h / 2 + 4;
  const cy = fit ? Math.min(fit.hi, Math.max(fit.lo, prefer)) : prefer;
  return { cx, cy, radius: Math.max(8, radius) };
}

function drawFrame(
  canvas: HTMLCanvasElement,
  phosphor: HTMLCanvasElement,
  tracks: Track[],
  selectedId: string | null,
  sweep: number,
  prevSweep: number,
  params: PpiParams,
  paints: Map<string, Paint>,
  flashes: { x: number; y: number; born: number }[],
  clutter: { brg: number; r: number }[],
  now: number,
  reduced: boolean,
) {
  const ctx = canvas.getContext("2d");
  const pctx = phosphor.getContext("2d");
  if (!ctx || !pctx) return;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const root = document.documentElement;
  const bg = token(root, "--color-bg", "#09090b");
  const fg = token(root, "--color-fg", "#f4f4f5");
  const muted = token(root, "--color-muted", "#71717a");
  const border = token(root, "--color-border", "#27272a");
  const ok = token(root, "--color-ok", "#7d9b86");
  const warn = token(root, "--color-warn", "#c4a574");
  const crit = token(root, "--color-crit", "#c45c5c");
  const origins: Record<Origin, string> = {
    CN: token(root, "--color-cn", "#c47a7a"),
    TR: token(root, "--color-tr", "#c4a574"),
    RU: token(root, "--color-ru", "#8aa0b8"),
    IR: token(root, "--color-ir", "#b89b7a"),
    XX: token(root, "--color-xx", "#71717a"),
  };
  const affilColor = (a: Affiliation) => token(root, affiliationColorVar(a), muted);

  const { cx, cy, radius } = scopeGeom(w, h);
  canvas.dataset.scope = `${cx.toFixed(1)},${cy.toFixed(1)},${radius.toFixed(1)}`;
  const seen: Legend[] = [];
  const legend = (text: string, size: number, x: number, base: number, right = false, bottom = false) => {
    ctx.fillText(text, x, base);
    seen.push({ width: ctx.measureText(text).width, size, base: bottom ? h - base : base, right, bottom });
  };

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 18, 0, Math.PI * 2);
  ctx.fillStyle = token(root, "--color-surface", "#121214");
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = border;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  if (params.afterglow && !reduced) {
    pctx.globalCompositeOperation = "source-over";
    pctx.fillStyle = "rgba(9,9,11,0.08)";
    pctx.fillRect(0, 0, w, h);
    pctx.save();
    pctx.beginPath();
    pctx.arc(cx, cy, radius, 0, Math.PI * 2);
    pctx.clip();
    const span = 18;
    const a0 = ((sweep - span) * Math.PI) / 180 - Math.PI / 2;
    const a1 = (sweep * Math.PI) / 180 - Math.PI / 2;
    const grd = pctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grd.addColorStop(0, hexAlpha(ok, 0.18));
    grd.addColorStop(1, hexAlpha(ok, 0.02));
    pctx.fillStyle = grd;
    pctx.beginPath();
    pctx.moveTo(cx, cy);
    pctx.arc(cx, cy, radius, a0, a1, false);
    pctx.closePath();
    pctx.fill();
    pctx.restore();
    ctx.drawImage(phosphor, 0, 0, w, h);
  }

  const rings = [0.25, 0.5, 0.75, 1];
  ctx.strokeStyle = hexAlpha(ok, 0.28);
  ctx.lineWidth = 1;
  for (const f of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = hexAlpha(ok, 0.16);
  for (let deg = 0; deg < 360; deg += 30) {
    const inner = polar(cx, cy, deg, radius * 0.08);
    const outer = polar(cx, cy, deg, radius);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }

  ctx.strokeStyle = hexAlpha(warn, 0.45);
  ctx.fillStyle = hexAlpha(warn, 0.12);
  ctx.lineWidth = 1;
  for (const site of getLiveZones()) {
    const rng = haversineKm(AO.airport.lat, AO.airport.lon, site.lat, site.lon);
    if (rng > params.rangeKm) continue;
    const brg = headingBetween(AO.airport.lat, AO.airport.lon, site.lat, site.lon);
    const p = polar(cx, cy, brg, (rng / params.rangeKm) * radius);
    const rr = Math.max(3, (site.radiusKm / params.rangeKm) * radius);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (params.rangeKm <= 250) {
      ctx.fillStyle = muted;
      ctx.font = "9px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(site.name, p.x, p.y - rr - 4);
      ctx.fillStyle = hexAlpha(warn, 0.12);
    }
  }

  const gain = Math.max(0.4, Math.min(1.6, params.gain));
  if (params.clutter > 0) {
    ctx.fillStyle = hexAlpha(ok, 0.12 * params.clutter * gain);
    for (const c of clutter) {
      if (!reduced && !swept(prevSweep, sweep, c.brg) && !params.afterglow) continue;
      const p = polar(cx, cy, c.brg, c.r * radius);
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }
  }

  const beam = polar(cx, cy, sweep, radius);
  ctx.strokeStyle = hexAlpha(ok, 0.85);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(beam.x, beam.y);
  ctx.stroke();

  const selected = tracks.find((t) => t.id === selectedId) ?? null;
  const raidIds = raidTrackIds(detectRaids(tracks));

  for (const tr of tracks) {
    if (!trackVisible(tr, selectedId)) continue;
    const ami = isFriend(tr);
    const rng = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
    if (rng > params.rangeKm) continue;
    const brg = headingBetween(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
    const p = polar(cx, cy, brg, (rng / params.rangeKm) * radius);
    const hit = reduced || swept(prevSweep, sweep, brg);
    let paint = paints.get(tr.id);
    if (!paint) {
      paint = { glow: reduced ? 1 : 0.15, last: now };
      paints.set(tr.id, paint);
    }
    if (hit) {
      paint.glow = 1;
      paint.last = now;
      flashes.push({ x: p.x, y: p.y, born: now });
    } else {
      paint.glow = Math.max(0.12, paint.glow * (params.afterglow ? 0.985 : 0.92));
    }
    const vis = Math.min(1, paint.glow * gain);
    if (vis < 0.08) continue;
    const plat = PLATFORM_BY_ID[tr.hypotheses[0]?.platformId ?? tr.truePlatformId];
    const origin = tr.origin ?? plat?.origin ?? "XX";
    const affil = affiliationOf(tr, threatOf(tr)).affiliation;
    const color = params.symbols
      ? affilColor(affil)
      : ami
        ? ok
        : params.iff
          ? origins[origin]
          : ok;
    ctx.globalAlpha = vis;
    if (tr.locked && params.trails) {
      ctx.strokeStyle = hexAlpha(warn, 0.5);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Vecteur vitesse : la piste projetée dans params.timeVector minutes, au cap et à la vitesse.
    if (params.timeVector > 0 && tr.speedKmh > 5) {
      const projKm = (tr.speedKmh * params.timeVector) / 60;
      const dLat = (projKm * Math.cos((tr.heading * Math.PI) / 180)) / 111.32;
      const dLon =
        (projKm * Math.sin((tr.heading * Math.PI) / 180)) /
        (111.32 * Math.cos((tr.lat * Math.PI) / 180));
      const rng2 = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat + dLat, tr.lon + dLon);
      if (rng2 <= params.rangeKm) {
        const brg2 = headingBetween(AO.airport.lat, AO.airport.lon, tr.lat + dLat, tr.lon + dLon);
        const q = polar(cx, cy, brg2, (rng2 / params.rangeKm) * radius);
        ctx.strokeStyle = tr.locked ? warn : color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
    // Portée continentale : des centaines d'avions réels — petits cadres, étiquettes réservées
    // à ce qui compte (sélection, verrou, urgence, piste non coopérative).
    const wide = params.rangeKm >= 2500;
    const quiet = wide && ami && !tr.locked && tr.id !== selectedId && !tr.emergency;
    if (params.symbols) {
      drawApp6Air(ctx, p.x, p.y, tr.locked ? 9 : wide ? 5 : 7, affil, tr.locked ? warn : color, hexAlpha(color, 0.12));
    } else {
      drawBlip(
        ctx,
        p.x,
        p.y,
        tr.heading,
        plat?.uasClass ?? tr.classGuess,
        tr.locked ? warn : color,
        tr.locked ? 7 : 5,
        ami,
      );
    }
    if (raidIds.has(tr.id)) {
      ctx.strokeStyle = hexAlpha(crit, 0.7);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (tr.iff?.m4 === "invalid") {
      ctx.strokeStyle = hexAlpha(crit, 0.8);
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (params.labels && vis > 0.45 && !quiet) {
      ctx.fillStyle = fg;
      ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const tag =
        params.iff && tr.iff
          ? `${tr.callsign}  ${tr.iff.squawk} ${m4Short(tr.iff.m4)}`
          : `${tr.callsign}  ${Math.round(tr.altM)}m`;
      ctx.fillText(tag, p.x + 8, p.y - 10);
      if (plat && vis > 0.7) {
        ctx.fillStyle = muted;
        ctx.fillText(
          ami
            ? `${tr.friendKind === "fatl" ? "FATL" : "ADS-B"} · ${plat.name}`
            : `${plat.origin} · ${Math.round(tr.speedKmh)}km/h`,
          p.x + 8,
          p.y + 2,
        );
      }
    }
    ctx.globalAlpha = 1;
    if (selected && selected.id === tr.id) {
      ctx.strokeStyle = warn;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
    }
  }

  const alive = now;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = (alive - f.born) / 600;
    if (age > 1) {
      flashes.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = hexAlpha(ok, 0.45 * (1 - age));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 6 + age * 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  ctx.strokeStyle = ok;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = ok;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = muted;
  ctx.font = "11px IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cardinals: [number, string][] = [
    [0, "N"],
    [90, "E"],
    [180, "S"],
    [270, "O"],
  ];
  for (const [deg, lab] of cardinals) {
    const p = polar(cx, cy, deg, radius + 14);
    ctx.fillStyle = deg === 0 ? ok : muted;
    ctx.fillText(lab, p.x, p.y);
  }

  ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
  ctx.fillStyle = muted;
  ctx.textAlign = "left";
  for (const f of rings) {
    const km = Math.round(params.rangeKm * f);
    const p = polar(cx, cy, 45, radius * f);
    ctx.fillText(`${km}`, p.x + 4, p.y);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = ok;
  ctx.font = "12px IBM Plex Sans, sans-serif";
  legend("AfriControl PPI", 12, 16, 22);
  ctx.fillStyle = muted;
  ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
  legend(`FTTJ  N'DJAMENA  ·  ${params.rangeKm} km`, 11, 16, 40);
  legend(`BALAYAGE ${params.rpm} tr/min  ·  PRF ${prfHz(params.rangeKm)} Hz`, 11, 16, 56);
  const azShown = params.northTrue ? sweep : (sweep - MAG_DECLINATION_DEG + 360) % 360;
  const coverage =
    params.rangeKm >= 6000
      ? "COUVERTURE AFRIQUE"
      : params.rangeKm >= 2500
        ? "THÉÂTRE SAHEL · AES INCLUS"
        : `AZ ${azShown.toFixed(0).padStart(3, "0")}° ${params.northTrue ? "VRAI" : "MAG"}`;
  legend(coverage, 11, 16, 72, false);

  ctx.textAlign = "right";
  ctx.fillStyle = muted;
  legend("SILENCIEUX · RÉCEPTION SEULE", 11, w - 16, 22, true);
  legend(params.symbols ? "APP-6 · AMI / HOSTILE / INCONNU" : "CN / TR / RU / IR", 11, w - 16, 38, true);

  if (selected && selected.idState !== "perdu") {
    const plat =
      PLATFORM_BY_ID[selected.hypotheses[0]?.platformId ?? selected.truePlatformId];
    const rng = haversineKm(
      AO.airport.lat,
      AO.airport.lon,
      selected.lat,
      selected.lon,
    );
    const brg = headingBetween(
      AO.airport.lat,
      AO.airport.lon,
      selected.lat,
      selected.lon,
    );
    const boxW = 220;
    const boxH = 88;
    const bx = w - boxW - 16;
    const by = h - boxH - 16;
    ctx.fillStyle = hexAlpha(bg, 0.86);
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = selected.locked ? warn : ok;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    ctx.font = "12px IBM Plex Mono, ui-monospace, monospace";
    ctx.fillText(selected.callsign, bx + 10, by + 18);
    ctx.fillStyle = muted;
    ctx.font = "11px IBM Plex Sans, sans-serif";
    ctx.fillText(
      plat ? `${plat.manufacturer} ${plat.name}` : "Non identifié",
      bx + 10,
      by + 36,
    );
    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    const brgShown = params.northTrue ? brg : (brg - MAG_DECLINATION_DEG + 360) % 360;
    ctx.fillText(
      `BRG ${brgShown.toFixed(0)}°${params.northTrue ? "" : "M"}  RNG ${rng.toFixed(1)} km  ALT ${Math.round(selected.altM)} m`,
      bx + 10,
      by + 54,
    );
    ctx.fillText(
      `SPD ${Math.round(selected.speedKmh)} km/h  ${plat?.origin ?? "—"}  ${Math.round(selected.confidence)}%`,
      bx + 10,
      by + 72,
    );
  }

  ctx.textAlign = "left";
  ctx.fillStyle = muted;
  ctx.font = "10px IBM Plex Sans, sans-serif";
  legend("Poste FTTJ · coverage PPI · télépilote non informé", 10, 16, h - 16, false, true);

  if (selected?.ew?.state === "effet") {
    ctx.fillStyle = crit;
    ctx.font = "11px IBM Plex Sans, sans-serif";
    legend("EFFET RF EXTERNE", 11, 16, h - 32, false, true);
  }
  legends = seen;
}
