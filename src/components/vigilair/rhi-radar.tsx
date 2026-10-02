import { useEffect, useRef, type MouseEvent } from "react";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { AO, haversineKm } from "@/lib/vigilair/geo";
import { detectRaids, raidTrackIds } from "@/lib/vigilair/raid";
import { peekTracks, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { isFriend } from "@/lib/vigilair/friends";
import type { Origin } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

function token(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function RhiRadar({ className }: { className?: string }) {
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
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const tick = () => {
      drawRhi(canvas, peekTracks(), selRef.current, ppiRef.current.rangeKm);
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
    const layout = layoutRhi(canvas.clientWidth, canvas.clientHeight, ppiRef.current.rangeKm);
    let best: { id: string; d: number } | null = null;
    for (const tr of peekTracks()) {
      if (!trackVisible(tr, selRef.current)) continue;
      const rng = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
      if (rng > ppiRef.current.rangeKm) continue;
      const p = projectRhi(rng, tr.altM, layout);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 22 && (!best || d < best.d)) best = { id: tr.id, d };
    }
    lockTrack(best?.id ?? null);
  };

  return (
    <canvas
      ref={canvasRef}
      className={cn("block h-full w-full bg-bg", className)}
      onClick={onClick}
      aria-label="Coupe altitude RHI FTTJ"
    />
  );
}

type Layout = {
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  w: number;
  h: number;
  rangeKm: number;
  maxAlt: number;
};

function layoutRhi(w: number, h: number, rangeKm: number): Layout {
  return {
    padL: 44,
    padR: 12,
    padT: 22,
    padB: 22,
    w,
    h,
    rangeKm,
    maxAlt: 8000,
  };
}

function projectRhi(rng: number, altM: number, L: Layout) {
  const iw = L.w - L.padL - L.padR;
  const ih = L.h - L.padT - L.padB;
  return {
    x: L.padL + (rng / L.rangeKm) * iw,
    y: L.padT + ih - (Math.min(altM, L.maxAlt) / L.maxAlt) * ih,
  };
}

function drawRhi(
  canvas: HTMLCanvasElement,
  tracks: TrackLike[],
  selectedId: string | null,
  rangeKm: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const root = document.documentElement;
  const bg = token(root, "--color-bg", "#09090b");
  const fg = token(root, "--color-fg", "#f4f4f5");
  const muted = token(root, "--color-muted", "#71717a");
  const ok = token(root, "--color-ok", "#7d9b86");
  const warn = token(root, "--color-warn", "#c4a574");
  const origins: Record<Origin, string> = {
    CN: token(root, "--color-cn", "#c47a7a"),
    TR: token(root, "--color-tr", "#c4a574"),
    RU: token(root, "--color-ru", "#8aa0b8"),
    IR: token(root, "--color-ir", "#b89b7a"),
    XX: token(root, "--color-xx", "#71717a"),
  };
  const L = layoutRhi(w, h, rangeKm);
  const iw = L.w - L.padL - L.padR;
  const ih = L.h - L.padT - L.padB;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = token(root, "--color-border", "#27272a");
  ctx.strokeRect(L.padL, L.padT, iw, ih);

  ctx.strokeStyle = `${ok}33`;
  ctx.fillStyle = muted;
  ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const alt of [0, 2000, 4000, 6000, 8000]) {
    const y = L.padT + ih - (alt / L.maxAlt) * ih;
    ctx.beginPath();
    ctx.moveTo(L.padL, y);
    ctx.lineTo(L.padL + iw, y);
    ctx.stroke();
    ctx.fillText(`${alt / 1000} km`, L.padL - 6, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const x = L.padL + f * iw;
    ctx.beginPath();
    ctx.moveTo(x, L.padT);
    ctx.lineTo(x, L.padT + ih);
    ctx.stroke();
    ctx.fillText(`${Math.round(rangeKm * f)}`, x, L.padT + ih + 4);
  }

  ctx.fillStyle = ok;
  ctx.font = "11px IBM Plex Sans, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("RHI composite · altitude / distance FTTJ", 8, 6);

  const raidIds = raidTrackIds(detectRaids(tracks));
  const selected = tracks.find((t) => t.id === selectedId);

  for (const tr of tracks) {
    if (!trackVisible(tr, selectedId)) continue;
    const ami = isFriend(tr);
    const rng = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
    if (rng > rangeKm) continue;
    const p = projectRhi(rng, tr.altM, L);
    const plat = PLATFORM_BY_ID[tr.hypotheses[0]?.platformId ?? tr.truePlatformId];
    const origin = (tr.origin ?? plat?.origin ?? "XX") as Origin;
    const raid = raidIds.has(tr.id);
    ctx.fillStyle = ami ? ok : tr.locked ? warn : origins[origin];
    ctx.beginPath();
    if (ami) {
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
    } else {
      ctx.arc(p.x, p.y, tr.locked || raid ? 4.2 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (raid) {
      ctx.strokeStyle = warn;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (selected && selected.id === tr.id) {
      ctx.strokeStyle = warn;
      ctx.strokeRect(p.x - 8, p.y - 8, 16, 16);
    }
  }

  if (selected && selected.idState !== "perdu") {
    const rng = haversineKm(AO.airport.lat, AO.airport.lon, selected.lat, selected.lon);
    if (rng <= rangeKm) {
      const p = projectRhi(rng, selected.altM, L);
      ctx.strokeStyle = `${warn}88`;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, L.padT);
      ctx.lineTo(p.x, L.padT + ih);
      ctx.moveTo(L.padL, p.y);
      ctx.lineTo(L.padL + iw, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = fg;
      ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `${selected.callsign}  ${Math.round(selected.altM)} m  ${rng.toFixed(0)} km`,
        L.padL + 8,
        L.padT + 8,
      );
    }
  }
}

type TrackLike = ReturnType<typeof peekTracks>[number];
