import { theaterOf, theaterRank } from "./geo.ts";
import type { Phenomenon } from "./capture.ts";
import type { Threat } from "./types.ts";

/** CSV public FIRMS VIIRS / MODIS. Point chaud thermique, pas un feu de voiture. */
export function parseFirms(csv: string, sensor: string): Phenomenon[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const head = lines[0]!.toLowerCase().split(",");
  const col = (name: string) => head.indexOf(name);
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iConf = col("confidence");
  const iFrp = col("frp");
  const iSat = col("satellite");
  if (iLat < 0 || iLon < 0) return [];
  const pixelM = /modis/i.test(sensor) ? 1000 : 375;
  type Row = Phenomenon & { frp: number };
  const best = new Map<string, Row>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.split(",");
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const confRaw = (iConf >= 0 ? c[iConf] : "")?.trim().toLowerCase() ?? "";
    const confN = Number(confRaw);
    const low = confRaw === "l" || confRaw === "low" || (Number.isFinite(confN) && confN < 30);
    if (low) continue;
    const frp = iFrp >= 0 ? Number(c[iFrp]) : 0;
    const frpOk = Number.isFinite(frp) ? frp : 0;
    const day = iDate >= 0 ? c[iDate] : "";
    const clock = iTime >= 0 ? (c[iTime] ?? "").padStart(4, "0") : "";
    const at = Date.parse(`${day}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:00Z`);
    const theater = theaterOf(lat, lon);
    const high = confRaw === "h" || confRaw === "high" || confN >= 80;
    const level: Threat =
      theaterRank(theater) >= 2 && (high || frpOk >= 40) ? "elevee" : "moderee";
    const sat = iSat >= 0 && c[iSat] ? c[iSat] : sensor;
    const key = `${Math.round(lat * 20) / 20}:${Math.round(lon * 20) / 20}`;
    const prev = best.get(key);
    if (prev && prev.frp >= frpOk) continue;
    best.set(key, {
      id: `firms-${sensor}-${key}-${day}`,
      kind: "feu",
      title: `Point chaud ${sat}`,
      body: `NASA FIRMS · ${sensor} · thermique · FRP ${frpOk.toFixed(1)} MW · confiance ${confRaw || "—"} · pixel ${pixelM} m · pas un feu de voiture`,
      lat,
      lon,
      at: Number.isFinite(at) ? at : Date.now(),
      theater,
      level,
      source: "NASA FIRMS",
      frp: frpOk,
    });
  }
  const rows = [...best.values()];
  rows.sort((a, b) => theaterRank(b.theater) - theaterRank(a.theater) || b.frp - a.frp);
  return rows.slice(0, 40).map(({ frp: _frp, ...p }) => p);
}

/** Couche Esri « VIIRS Thermal Hotspots » — le flux FIRMS, pas une couleur sur la photo. */
export function parseEsriFirms(raw: unknown): Phenomenon[] {
  if (!raw || typeof raw !== "object") return [];
  const features = (raw as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const lines = [
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
  ];
  const now = Date.now();
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const a = (feature as { attributes?: Record<string, unknown> }).attributes;
    if (!a) continue;
    const hours = Number(a.hours_old);
    const at = new Date(now - (Number.isFinite(hours) ? hours : 0) * 3_600_000);
    const day = at.toISOString().slice(0, 10);
    const clock = at.toISOString().slice(11, 13) + at.toISOString().slice(14, 16);
    lines.push(
      [
        a.latitude,
        a.longitude,
        a.bright_ti4 ?? "",
        "",
        "",
        day,
        clock,
        a.satellite ?? "VIIRS",
        "VIIRS",
        a.confidence ?? "",
        "",
        "",
        a.frp ?? "",
        a.daynight ?? "",
      ].join(","),
    );
  }
  return parseFirms(lines.join("\n"), "VIIRS");
}
