/** Overlay Monde — frontières, graticule, libellés FR. */

import { COUNTRIES } from "./countries";

export const CONTINENTS: { name: string; lat: number; lon: number }[] = [
  { name: "AFRIQUE", lat: 4, lon: 20 },
  { name: "EUROPE", lat: 56, lon: 18 },
  { name: "ASIE", lat: 46, lon: 88 },
  { name: "AMÉRIQUE N.", lat: 48, lon: -100 },
  { name: "AMÉRIQUE S.", lat: -14, lon: -60 },
  { name: "OCÉANIE", lat: -24, lon: 145 },
  { name: "ANTARCTIQUE", lat: -78, lon: 20 },
];

/** Micro-États absents de Natural Earth 110m. */
export const EXTRA_STATES: { n: string; lat: number; lon: number; r: 2 | 3 }[] = [
  { n: "Andorre", lat: 42.51, lon: 1.52, r: 3 },
  { n: "Antigua-et-Barbuda", lat: 17.12, lon: -61.85, r: 3 },
  { n: "Bahreïn", lat: 26.03, lon: 50.55, r: 2 },
  { n: "Barbade", lat: 13.19, lon: -59.54, r: 3 },
  { n: "Cabo Verde", lat: 16.0, lon: -24.0, r: 3 },
  { n: "Comores", lat: -11.65, lon: 43.33, r: 3 },
  { n: "Dominique", lat: 15.42, lon: -61.37, r: 3 },
  { n: "Grenade", lat: 12.12, lon: -61.68, r: 3 },
  { n: "Kiribati", lat: -3.37, lon: -168.73, r: 3 },
  { n: "Liechtenstein", lat: 47.17, lon: 9.56, r: 3 },
  { n: "Maldives", lat: 3.2, lon: 73.22, r: 3 },
  { n: "Malte", lat: 35.94, lon: 14.38, r: 2 },
  { n: "Marshall", lat: 7.13, lon: 171.18, r: 3 },
  { n: "Maurice", lat: -20.2, lon: 57.5, r: 2 },
  { n: "Micronésie", lat: 6.89, lon: 158.22, r: 3 },
  { n: "Monaco", lat: 43.73, lon: 7.42, r: 3 },
  { n: "Nauru", lat: -0.52, lon: 166.93, r: 3 },
  { n: "Palaos", lat: 7.5, lon: 134.58, r: 3 },
  { n: "Saint-Kitts-et-Nevis", lat: 17.36, lon: -62.78, r: 3 },
  { n: "Saint-Marin", lat: 43.94, lon: 12.46, r: 3 },
  { n: "Saint-Vincent", lat: 13.25, lon: -61.2, r: 3 },
  { n: "Sainte-Lucie", lat: 13.91, lon: -60.98, r: 3 },
  { n: "Samoa", lat: -13.76, lon: -172.1, r: 3 },
  { n: "Sao Tomé-et-Principe", lat: 0.23, lon: 6.6, r: 3 },
  { n: "Seychelles", lat: -4.68, lon: 55.49, r: 3 },
  { n: "Singapour", lat: 1.35, lon: 103.82, r: 2 },
  { n: "Tonga", lat: -21.18, lon: -175.2, r: 3 },
  { n: "Tuvalu", lat: -7.11, lon: 177.65, r: 3 },
  { n: "Vatican", lat: 41.9, lon: 12.45, r: 3 },
];

const SKIP_LABEL = new Set([
  "Antarctique",
  "Somaliland",
  "Chypre du Nord",
  "TAAF",
  "Malouines",
]);

export const COUNTRY_COUNT =
  COUNTRIES.filter((c) => !SKIP_LABEL.has(c.n)).length + EXTRA_STATES.length;

function rankOf(name: string, area: number): 1 | 2 | 3 {
  if (name === "Tchad") return 1;
  if (area >= 28) return 1;
  if (area >= 5) return 2;
  return 3;
}

type Pj = (lat: number, lon: number) => { x: number; y: number };

let ringCache: { w: number; h: number; paths: Path2D[] } | null = null;

function countryRingPaths(pj: Pj, w: number, h: number): Path2D[] {
  if (ringCache && ringCache.w === w && ringCache.h === h) return ringCache.paths;
  const paths: Path2D[] = [];
  for (const c of COUNTRIES) {
    for (const ring of c.p) {
      let path = new Path2D();
      let started = false;
      let prevLon = 0;
      for (const pt of ring) {
        const lon = pt[0]!;
        const lat = pt[1]!;
        const p = pj(lat, lon);
        if (started && Math.abs(lon - prevLon) > 170) {
          paths.push(path);
          path = new Path2D();
          started = false;
        }
        if (!started) {
          path.moveTo(p.x, p.y);
          started = true;
        } else path.lineTo(p.x, p.y);
        prevLon = lon;
      }
      if (started) paths.push(path);
    }
  }
  ringCache = { w, h, paths };
  return paths;
}

export function drawMondeOverlay(
  ctx: CanvasRenderingContext2D,
  pj: Pj,
  w: number,
  h: number,
  ice: string,
  fg: string,
  muted: string,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(200,204,212,0.14)";
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 75; lat += 30) {
    ctx.beginPath();
    let first = true;
    for (let lon = -180; lon <= 180; lon += 8) {
      const p = pj(lat, lon);
      if (first) {
        ctx.moveTo(p.x, p.y);
        first = false;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath();
    let first = true;
    for (let lat = -80; lat <= 80; lat += 8) {
      const p = pj(lat, lon);
      if (first) {
        ctx.moveTo(p.x, p.y);
        first = false;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(200,204,212,0.32)";
  ctx.font = "400 8px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  for (const lat of [-60, -30, 0, 30, 60]) {
    const p = pj(lat, 15.06);
    if (p.y > 12 && p.y < h - 12) {
      ctx.fillText(`${lat === 0 ? "0°" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`}`, 10, p.y + 3);
    }
  }
  ctx.textAlign = "center";
  for (const lon of [-150, -90, -30, 30, 90, 150]) {
    const p = pj(0, lon);
    if (p.x > 28 && p.x < w - 28 && p.y > 14 && p.y < h - 14) {
      ctx.fillText(`${Math.abs(lon)}°${lon > 0 ? "E" : "O"}`, p.x, p.y - 5);
    }
  }
  ctx.textAlign = "left";

  ctx.strokeStyle = ice;
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = 0.7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const path of countryRingPaths(pj, w, h)) ctx.stroke(path);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.fillStyle = muted;
  ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
  for (const ct of CONTINENTS) {
    const p = pj(ct.lat, ct.lon);
    if (p.x < 28 || p.x > w - 28 || p.y < 18 || p.y > h - 18) continue;
    ctx.globalAlpha = 0.38;
    ctx.fillText(ct.name, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";

  type Box = { x: number; y: number; hw: number };
  const placed: Box[] = [];
  const fits = (x: number, y: number, hw: number) => {
    for (const b of placed) {
      if (Math.abs(b.x - x) < b.hw + hw + 6 && Math.abs(b.y - y) < 11) return false;
    }
    return true;
  };

  const labels: { n: string; lat: number; lon: number; r: 1 | 2 | 3 }[] = COUNTRIES.filter(
    (c) => !SKIP_LABEL.has(c.n),
  )
    .map((c) => ({ n: c.n, lat: c.lat, lon: c.lon, r: rankOf(c.n, c.a) }))
    .sort((a, b) => a.r - b.r);
  for (const e of EXTRA_STATES) labels.push({ n: e.n, lat: e.lat, lon: e.lon, r: e.r });

  for (const c of labels) {
    const p = pj(c.lat, c.lon);
    if (p.x < 6 || p.x > w - 6 || p.y < 8 || p.y > h - 16) continue;
    ctx.fillStyle = c.n === "Tchad" ? fg : ice;
    ctx.globalAlpha = c.r === 1 ? 0.95 : 0.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, c.n === "Tchad" ? 2.6 : c.r === 1 ? 1.7 : 1.15, 0, Math.PI * 2);
    ctx.fill();
    const wantLabel = c.r === 1 || (c.r === 2 && w > 300) || (c.r === 3 && w > 700);
    if (!wantLabel) continue;
    const hw = Math.min(52, c.n.length * 3.1 + 4);
    const lx = p.x + 5 + hw;
    const ly = p.y + 3;
    if (lx > w - 4 || ly < 10 || ly > h - 10) continue;
    if (!fits(lx, ly, hw)) continue;
    placed.push({ x: lx, y: ly, hw });
    ctx.globalAlpha = c.r === 1 ? 0.82 : 0.62;
    ctx.fillStyle = muted;
    ctx.font =
      c.r === 1
        ? "500 9px 'IBM Plex Sans', sans-serif"
        : "400 8px 'IBM Plex Sans', sans-serif";
    ctx.fillText(c.n, p.x + 5, p.y + 3);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
