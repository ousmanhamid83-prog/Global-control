import { useEffect, useRef, type MouseEvent } from "react";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { AO, haversineKm, headingBetween } from "@/lib/vigilair/geo";
import { MAG_DECLINATION_DEG, type PpiParams } from "@/lib/vigilair/ppi";
import { affiliationColorVar, affiliationOf, drawApp6Air, type Affiliation } from "@/lib/vigilair/app6";
import { detectRaids, raidTrackIds } from "@/lib/vigilair/raid";
import { getLiveZones } from "@/lib/vigilair/zones";
import { peekTracks, threatOf, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { isFriend } from "@/lib/vigilair/friends";
import { totalUncertaintyKm } from "@/lib/vigilair/integrity";
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

/**
 * Écran polaire des pistes RÉELLES, centré sur FTTJ. Le poste n'a pas de radar primaire : rien ici
 * ne simule un balayage, un écho ou un fouillis. Chaque piste est dessinée à sa dernière position
 * connue, à chaque image — c'est le direct de l'antenne 1090 et du relevé réseau.
 */
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
      drawFrame(canvas, peekTracks(), selRef.current, ppiRef.current);
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
  tracks: Track[],
  selectedId: string | null,
  params: PpiParams,
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

  const selected = tracks.find((t) => t.id === selectedId) ?? null;
  const raidIds = raidTrackIds(detectRaids(tracks));
  let shown = 0;

  for (const tr of tracks) {
    if (!trackVisible(tr, selectedId)) continue;
    const ami = isFriend(tr);
    const rng = haversineKm(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
    if (rng > params.rangeKm) continue;
    const brg = headingBetween(AO.airport.lat, AO.airport.lon, tr.lat, tr.lon);
    const p = polar(cx, cy, brg, (rng / params.rangeKm) * radius);
    shown += 1;
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
    // INCERTITUDE DE POSITION. Deux causes INDÉPENDANTES, donc composées en quadrature :
    //  — ce que l'aéronef ADMET ignorer de sa propre position : son rayon de confinement annoncé
    //    (ou déduit du NIC), et pour une position calculée par multilatération, un plancher prudent
    //    puisque l'agrégateur n'annonce aucune précision. 14 % du trafic réel dépasse 185 m, et
    //    certains 7,4 km : les peindre en points exacts était un mensonge par omission ;
    //  — ce que NOTRE extrapolation ajoute quand la piste s'est tue (piste mémoire).
    // Le cercle est tracé À L'ÉCHELLE. Gonfler un rayon de 200 m jusqu'à une taille « visible »
    // mentirait dans l'autre sens, en inventant une incertitude de plusieurs kilomètres. S'il tient
    // dans le symbole, on ne le trace pas — mais l'étiquette reste, car un point estimé doit se dire.
    const incKm = totalUncertaintyKm(tr.posRcKm ?? null, tr.coast?.radiusKm ?? null);
    const incPx = (incKm / params.rangeKm) * radius;
    if (incPx >= 4) {
      ctx.strokeStyle = hexAlpha(tr.coast ? warn : color, tr.coast ? 0.55 : 0.35);
      ctx.lineWidth = 1;
      ctx.setLineDash(tr.coast ? [3, 3] : [1, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, incPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Un transpondeur coupé doit SE VOIR, pas disparaître discrètement : « MÉM » et la durée du
    // silence. Hors silence, on n'écrit le rayon que s'il est assez gros pour changer une décision.
    if (!quiet && (tr.coast || incKm >= 1)) {
      const dx = Math.max(incPx, 6) + 3;
      ctx.fillStyle = hexAlpha(tr.coast ? warn : color, 0.95);
      ctx.font = "400 9px 'IBM Plex Mono', monospace";
      ctx.fillText(
        tr.coast ? `MÉM ${tr.coast.silentS}s` : `±${incKm.toFixed(1)} km`,
        p.x + dx,
        p.y - 3,
      );
    }
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
    if (params.labels && !quiet) {
      ctx.fillStyle = fg;
      ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const tag =
        params.iff && tr.iff
          ? `${tr.callsign}  ${tr.iff.squawk}`
          : `${tr.callsign}  ${Math.round(tr.altM)}m`;
      ctx.fillText(tag, p.x + 8, p.y - 10);
      if (plat) {
        ctx.fillStyle = muted;
        ctx.fillText(
          ami
            ? `${tr.iff?.surveillance === "adsb" ? "ADS-B" : "Mode S"} · ${plat.name}`
            : `${plat.origin} · ${Math.round(tr.speedKmh)}km/h`,
          p.x + 8,
          p.y + 2,
        );
      }
    }
    if (selected && selected.id === tr.id) {
      ctx.strokeStyle = warn;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
    }
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
  legend(`EN DIRECT  ·  ${shown} PISTE${shown > 1 ? "S" : ""} À L'ÉCRAN`, 11, 16, 56);
  const coverage =
    params.rangeKm >= 12000
      ? "COUVERTURE MONDE · TOUS CONTINENTS"
      : params.rangeKm >= 6000
        ? "COUVERTURE AFRIQUE"
        : params.rangeKm >= 2500
          ? "THÉÂTRE SAHEL · AES INCLUS"
          : `NORD ${params.northTrue ? "VRAI" : "MAGNÉTIQUE"}`;
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
  legend("Poste FTTJ · pistes 1090 reçues, pas de radar primaire", 10, 16, h - 16, false, true);
  legends = seen;
}
