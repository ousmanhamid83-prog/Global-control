import { haversineKm } from "./geo.ts";
import type { JamCell, MetarRow, SigmetRow } from "./live-adsb.ts";

export type TreatInput = {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altM: number;
  nic: number | null;
  nacp: number | null;
  squawk: string | null;
  icao24: string | null;
  mode: string | null;
};

export type TreatLock = {
  trackId: string;
  xpdr: string;
  metar: string;
  sigmet: string;
  gnss: string;
  verdict: string;
};

function inside(lat: number, lon: number, ring: { lat: number; lon: number }[]): boolean {
  if (ring.length < 3) return false;
  let n = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i]!.lat;
    const yj = ring[j]!.lat;
    const xi = ring[i]!.lon;
    const xj = ring[j]!.lon;
    const cross = (yj - yi) === 0 ? xi : ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (yi > lat !== yj > lat && lon < cross) n += 1;
  }
  return n % 2 === 1;
}

function nearestMetar(lat: number, lon: number, rows: MetarRow[]): MetarRow | null {
  let best: MetarRow | null = null;
  let bestD = Infinity;
  for (const row of rows) {
    if (row.lat == null || row.lon == null) continue;
    const d = haversineKm(lat, lon, row.lat, row.lon);
    if (d < bestD) {
      best = row;
      bestD = d;
    }
  }
  return best ?? rows.find((r) => r.icao === "FTTJ") ?? rows[0] ?? null;
}

function jamAt(lat: number, lon: number, cells: JamCell[]): JamCell | null {
  let best: JamCell | null = null;
  let bestD = Infinity;
  for (const cell of cells) {
    const d = haversineKm(lat, lon, cell.lat, cell.lon);
    if (d < bestD) {
      best = cell;
      bestD = d;
    }
  }
  return best && bestD <= 250 ? best : null;
}

/** Croise le squitter verrouillé avec le METAR, le SIGMET et le GNSS du même passage. */
export function treatContact(
  track: TreatInput,
  pic: { metar: MetarRow[]; sigmets: SigmetRow[]; jam: JamCell[] } | null,
): TreatLock {
  const xpdr = track.icao24
    ? `${track.mode ?? "ADS-B"} ${track.icao24} squawk ${track.squawk ?? "0000"}`
    : "Aucun transpondeur 1090ES sur cette piste";
  const metar = pic ? nearestMetar(track.lat, track.lon, pic.metar) : null;
  const metarLine = metar
    ? `${metar.icao} ${metar.cat ?? "—"} vis ${metar.visM != null ? `${Math.round(metar.visM)} m` : "—"} · ${Math.round(haversineKm(track.lat, track.lon, metar.lat ?? track.lat, metar.lon ?? track.lon))} km`
    : "METAR non reçu";
  const hits = (pic?.sigmets ?? []).filter(
    (s) => inside(track.lat, track.lon, s.coords) || (s.coords.length < 3 && s.inAo && s.fir.startsWith("FT")),
  );
  const sigmetLine = hits.length
    ? hits
        .slice(0, 2)
        .map((s) => `${s.fir} ${s.hazard}`)
        .join(" · ")
    : "Aucun SIGMET sur la piste";
  const cell = pic ? jamAt(track.lat, track.lon, pic.jam) : null;
  const board = track.nic == null ? "NIC absent" : track.nic < 5 ? `NIC ${track.nic} dégradé` : `NIC ${track.nic}`;
  const gnssLine = cell ? `${board} · sol ${cell.level} ${Math.round(cell.pct)} %` : `${board} · sol non dégradé`;
  const low = metar?.cat === "LIFR" || metar?.cat === "IFR";
  let verdict = "1090ES traité";
  if (!track.icao24) verdict = "Piste sans transpondeur";
  else if (track.nic != null && track.nic < 5) verdict = "GNSS bord dégradé";
  else if (cell && cell.level === "high") verdict = "GNSS sol dégradé";
  else if (hits.length) verdict = "SIGMET sur la piste";
  else if (low && track.altM < 1500) verdict = "METAR sous le niveau de la piste";
  return {
    trackId: track.id,
    xpdr,
    metar: metarLine,
    sigmet: sigmetLine,
    gnss: gnssLine,
    verdict,
  };
}
