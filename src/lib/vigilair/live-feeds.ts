/** Ingest capteurs réels — 1090ES, METAR/TAF/SIGMET NOAA, NOAA SWPC. Auth requise. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { AERO_BY_ICAO, METAR_IDS, TAF_IDS } from "./aerodromes";
import {
  mergePhenomena,
  parseEonet,
  parseUsgs,
  parseGdacs,
  parseFirms,
  parseEsriFirms,
  type Phenomenon,
} from "./capture";
import { theaterOf } from "./geo";
import {
  gpsTime,
  jamFromAircraft,
  parseDump1090,
  solarFttj,
  xrayClassOf,
  type AirportRow,
  type JamCell,
  type LiveAc,
  type LivePicture,
  type MetarRow,
  type SigmetRow,
  type SourceHealth,
  type SpaceWx,
  type SwpcAlert,
  type TafRow,
} from "./live-adsb";

import type { ReceiverFeed, ReceiverStatus } from "./rx1090.server";

const UA = "VIGILAIR-COP/10.0 (C-UAS detection N'Djamena; read-only)";

type Cell = { lat: number; lon: number; label: string };

/** adsb.fi répond vide au-delà de 250 NM : même rayon partout. */
const CELL_NM = 250;

/**
 * Théâtre, interrogé à chaque relevé. Mesuré en réel (octobre 2026) : les agrégateurs n'y ont
 * presque aucun récepteur — 0 avion à FTTJ, Niamey, Khartoum, 2 à Douala. Seul un récepteur
 * local (dump1090, « Antenne 1090 ») y donne de vrais avions. On interroge quand même : le jour
 * où un récepteur apparaît, il est pris.
 */
const THEATRE_CELLS: Cell[] = [
  { lat: 12.1348, lon: 15.0557, label: "FTTJ" },
  { lat: 4.006, lon: 9.719, label: "Douala" },
  { lat: 13.481, lon: 2.184, label: "Niamey" },
  { lat: 15.589, lon: 32.553, label: "Khartoum" },
];

/**
 * Continent : les zones où les agrégateurs ont réellement des récepteurs (Maghreb, Égypte,
 * Afrique de l'Est et australe). Interrogées en rotation, trois par relevé, pour rester sous les
 * limites de débit des API ; chaque cellule reste affichée 100 s.
 */
const CONTINENT_CELLS: Cell[] = [
  { lat: 36.7, lon: 3.2, label: "Alger" },
  { lat: 36.8, lon: 10.2, label: "Tunis" },
  { lat: 32.7, lon: 13.2, label: "Tripoli" },
  { lat: 32.1, lon: 20.1, label: "Benghazi" },
  { lat: 30.1, lon: 31.4, label: "Le Caire" },
  { lat: 33.4, lon: -7.6, label: "Casablanca" },
  { lat: 30.4, lon: -9.6, label: "Agadir" },
  { lat: -1.3, lon: 36.9, label: "Nairobi" },
  { lat: -26.1, lon: 28.2, label: "Johannesburg" },
  { lat: -29.9, lon: 31.0, label: "Durban" },
  { lat: -33.9, lon: 18.6, label: "Le Cap" },
];
const CONTINENT_PER_PULL = 3;
const CONTINENT_TTL_MS = 100_000;
let continentNext = 0;
const continentCache = new Map<string, { at: number; ac: LiveAc[] }>();

let cache: { at: number; data: LivePicture } | null = null;
let lastGood: LivePicture | null = null;
const TTL_MS = 20_000;

async function fetchText(url: string, ms: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "text/csv,text/plain", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.text();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const ESRI_VIIRS =
  "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query";

function esriFirmsUrl(where: string, limit: number): string {
  return (
    ESRI_VIIRS +
    "?where=" +
    encodeURIComponent(where) +
    "&outFields=latitude,longitude,confidence,frp,satellite,hours_old,bright_ti4,daynight&returnGeometry=false&orderByFields=frp%20DESC&resultRecordCount=" +
    limit +
    "&f=json"
  );
}

const FIRMS_URLS: { sensor: string; url: string }[] = [
  {
    sensor: "VIIRS NOAA-20",
    url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
  },
  {
    sensor: "VIIRS NOAA-21",
    url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
  },
];

let firmsCache: { at: number; rows: Phenomenon[]; error: string | null; ttl: number } | null = null;
const FIRMS_TTL_MS = 15 * 1000;

async function pullFirms(): Promise<{ rows: Phenomenon[]; errors: string[] }> {
  if (firmsCache && Date.now() - firmsCache.at < firmsCache.ttl) {
    return { rows: firmsCache.rows, errors: firmsCache.error ? [firmsCache.error] : [] };
  }
  const errors: string[] = [];
  const take = async (where: string, limit: number): Promise<unknown[]> => {
    try {
      const raw = await fetchJson(esriFirmsUrl(where, limit), 12000);
      const features = (raw as { features?: unknown[] } | null)?.features;
      return Array.isArray(features) ? features : [];
    } catch (e) {
      errors.push(`FIRMS VIIRS: ${e instanceof Error ? e.message : "échec"}`);
      return [];
    }
  };
  const features = [
    ...(await take(
      "hours_old<=2 AND latitude>=7 AND latitude<=24 AND longitude>=-18 AND longitude<=38",
      80,
    )),
    ...(await take("hours_old<=2", 20)),
  ];
  if (features.length > 0) {
    const rows = parseEsriFirms({ features });
    if (rows.length > 0) {
      firmsCache = { at: Date.now(), rows, error: null, ttl: FIRMS_TTL_MS };
      return { rows, errors: [] };
    }
  }
  if (!errors.length) errors.push("FIRMS VIIRS: aucun point");
  for (const src of FIRMS_URLS) {
    try {
      const csv = await fetchText(src.url, 12000);
      const rows = parseFirms(csv, src.sensor);
      if (rows.length === 0) {
        errors.push(`FIRMS ${src.sensor}: aucun point`);
        continue;
      }
      firmsCache = { at: Date.now(), rows, error: null, ttl: FIRMS_TTL_MS };
      return { rows, errors: [] };
    } catch (e) {
      errors.push(`FIRMS ${src.sensor}: ${e instanceof Error ? e.message : "échec"}`);
    }
  }
  firmsCache = { at: Date.now(), rows: [], error: errors[0] ?? "FIRMS échec", ttl: 60_000 };
  return { rows: [], errors };
}

async function fetchJson(url: string, ms = 4500): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (res.status === 204) return null;
    if (res.status === 429) throw new Error("429");
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { ac?: unknown; aircraft?: unknown };
    if (Array.isArray(o.ac)) return o.ac;
    if (Array.isArray(o.aircraft)) return o.aircraft;
  }
  return [];
}

/** Une cellule : adsb.lol d'abord (limites larges), adsb.fi en secours. */
async function pullCell(c: Cell): Promise<{ ac: LiveAc[] | null; refused: boolean; err: string }> {
  let refused = false;
  let err = "";
  for (const base of ["https://api.adsb.lol/v2", "https://opendata.adsb.fi/api/v2"]) {
    try {
      const value = await fetchJson(`${base}/lat/${c.lat}/lon/${c.lon}/dist/${CELL_NM}`, 8000);
      if (value == null) continue;
      return { ac: parseDump1090(asList(value)), refused, err };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "429") refused = true;
      else if (msg) err = msg;
    }
  }
  return { ac: null, refused, err };
}

async function pullAdsb(): Promise<{
  ac: LiveAc[];
  errors: string[];
  source: string;
  ok: boolean;
}> {
  const errors: string[] = [];
  const byHex = new Map<string, LiveAc>();
  let ok = 0;
  let refused = 0;
  let lastErr = "";
  const merge = (list: LiveAc[]) => {
    for (const ac of list) {
      const prev = byHex.get(ac.hex);
      if (!prev || ac.seenS <= prev.seenS) {
        byHex.set(ac.hex, {
          ...ac,
          emergency: ac.emergency ?? prev?.emergency ?? null,
          military: ac.military || Boolean(prev?.military),
        });
      } else if (!prev.emergency && ac.emergency) {
        byHex.set(ac.hex, { ...prev, emergency: ac.emergency });
      }
    }
  };
  const rotation = Array.from(
    { length: CONTINENT_PER_PULL },
    (_, i) => CONTINENT_CELLS[(continentNext + i) % CONTINENT_CELLS.length]!,
  );
  continentNext = (continentNext + CONTINENT_PER_PULL) % CONTINENT_CELLS.length;
  for (const c of [...THEATRE_CELLS, ...rotation]) {
    const got = await pullCell(c);
    if (got.refused) refused += 1;
    if (got.err) lastErr = got.err;
    if (got.ac) {
      ok += 1;
      if (THEATRE_CELLS.includes(c)) merge(got.ac);
      else continentCache.set(c.label, { at: Date.now(), ac: got.ac });
    }
    // Courtoisie envers les API publiques : un relevé n'est pas une rafale.
    await new Promise((r) => setTimeout(r, 200));
  }
  let continentLive = 0;
  for (const [label, hit] of continentCache) {
    const age = Date.now() - hit.at;
    if (age > CONTINENT_TTL_MS) {
      continentCache.delete(label);
      continue;
    }
    continentLive += 1;
    // L'âge du cache s'ajoute à celui de la position : rien ne paraît plus frais qu'il n'est.
    merge(hit.ac.map((a) => ({ ...a, seenS: a.seenS + age / 1000 })));
  }
  if (refused > 0 && ok === 0) errors.push("1090ES refusé (429)");
  // Aucune cellule jointe : c'est une coupure de liaison, pas un ciel vide.
  else if (ok === 0 && lastErr) errors.push(`1090ES: ${lastErr}`);
  const ac = [...byHex.values()];
  return {
    ac,
    errors: [...new Set(errors)].slice(0, 4),
    source:
      ok > 0
        ? `1090ES adsb.lol / adsb.fi · théâtre ${THEATRE_CELLS.length} cellules · continent ${continentLive}/${CONTINENT_CELLS.length} · ${ac.length} squitters`
        : "1090ES indisponible",
    ok: ok > 0,
  };
}

/** Avions au-dessus du Sahel (Tchad, Darfour, AES, bande Dakar → mer Rouge). */
function sahelCount(ac: LiveAc[]): number {
  return ac.filter((a) => theaterOf(a.lat, a.lon) !== "monde").length;
}

function visToM(v: unknown): number | null {
  if (typeof v === "number") return v > 50 ? v : v * 1609.34;
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (s === "CAVOK" || s === "9999") return 10000;
  if (s.endsWith("SM")) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n * 1609.34 : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (n > 50 ? n : n * 1609.34) : null;
}

function windDirOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

async function pullMetar(): Promise<{ metar: MetarRow[]; taf: TafRow[]; errors: string[] }> {
  const errors: string[] = [];
  const metar: MetarRow[] = [];
  const taf: TafRow[] = [];
  const [metarRes, tafRes] = await Promise.allSettled([
    fetchJson(
      `https://aviationweather.gov/api/data/metar?ids=${METAR_IDS}&format=json`,
      7000,
    ),
    fetchJson(
      `https://aviationweather.gov/api/data/taf?ids=${TAF_IDS}&format=json`,
      6000,
    ),
  ]);
  if (metarRes.status === "fulfilled") {
    for (const row of asList(metarRes.value)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const icao = String(r.icaoId ?? r.icao ?? "").toUpperCase();
      if (!icao) continue;
      const aero = AERO_BY_ICAO[icao];
      metar.push({
        icao,
        name: aero?.city ?? String(r.name ?? icao),
        raw: String(r.rawOb ?? r.raw ?? ""),
        tempC: typeof r.temp === "number" ? r.temp : null,
        dewC: typeof r.dewp === "number" ? r.dewp : null,
        windDir: windDirOf(r.wdir),
        windKt: typeof r.wspd === "number" ? r.wspd : null,
        visM: visToM(r.visib),
        qnh: typeof r.altim === "number" ? Math.round(r.altim) : null,
        wx: typeof r.wxString === "string" && r.wxString ? r.wxString : null,
        cat: typeof r.fltCat === "string" ? r.fltCat : null,
        lat: typeof r.lat === "number" ? r.lat : aero?.lat ?? null,
        lon: typeof r.lon === "number" ? r.lon : aero?.lon ?? null,
        obsAt:
          typeof r.obsTime === "number"
            ? new Date(r.obsTime * 1000).toISOString()
            : typeof r.reportTime === "string"
              ? r.reportTime
              : null,
      });
    }
  } else {
    const e = metarRes.reason;
    errors.push(`METAR: ${e instanceof Error ? e.message : "échec"}`);
  }
  if (tafRes.status === "fulfilled") {
    for (const row of asList(tafRes.value)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const icao = String(r.icaoId ?? "").toUpperCase();
      const text = String(r.rawTAF ?? r.raw ?? "");
      if (icao && text) taf.push({ icao, raw: text });
    }
  } else {
    const e = tafRes.reason;
    errors.push(`TAF: ${e instanceof Error ? e.message : "échec"}`);
  }
  return { metar, taf, errors };
}

function inAoPoint(lat: number, lon: number): boolean {
  return lat >= 0 && lat <= 28 && lon >= -18 && lon <= 38;
}

function coordsOf(raw: unknown): { lat: number; lon: number }[] {
  if (!Array.isArray(raw)) return [];
  const pts: { lat: number; lon: number }[] = [];
  for (const c of raw) {
    if (c && typeof c === "object" && "lat" in c && "lon" in c) {
      const lat = Number((c as { lat: unknown }).lat);
      const lon = Number((c as { lon: unknown }).lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    }
  }
  return pts;
}

async function pullSigmet(): Promise<{ rows: SigmetRow[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const raw = await fetchJson("https://aviationweather.gov/api/data/isigmet?format=json", 6000);
    const rows: SigmetRow[] = [];
    for (const row of asList(raw)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const coords = coordsOf(r.coords);
      const fir = String(r.firId ?? "");
      const firName = String(r.firName ?? fir);
      const inAo =
        coords.some((p) => inAoPoint(p.lat, p.lon)) ||
        /^(FT|DR|DF|DN|FC|FE|GO|GM|GA|HS|HL|HC|HT|HU|DA|DT|HE)/.test(fir);
      rows.push({
        fir,
        firName,
        hazard: String(r.hazard ?? "SIGMET"),
        qualifier: typeof r.qualifier === "string" && r.qualifier ? r.qualifier : null,
        raw: String(r.rawSigmet ?? ""),
        coords,
        validFrom:
          typeof r.validTimeFrom === "number"
            ? new Date(r.validTimeFrom * 1000).toISOString()
            : null,
        validTo:
          typeof r.validTimeTo === "number"
            ? new Date(r.validTimeTo * 1000).toISOString()
            : null,
        inAo,
      });
    }
    rows.sort((a, b) => Number(b.inAo) - Number(a.inAo));
    return { rows: rows.slice(0, 40), errors };
  } catch (e) {
    errors.push(`SIGMET: ${e instanceof Error ? e.message : "échec"}`);
    return { rows: [], errors };
  }
}

async function pullSpace(): Promise<SpaceWx> {
  const { week, towS } = gpsTime();
  let kp = 0;
  let kpTime: string | null = null;
  let gScale = "G0";
  let xrayFlux: number | null = null;
  let xrayAt: string | null = null;
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
      4000,
    );
    const list = asList(raw);
    const last = list[list.length - 1] as Record<string, unknown> | undefined;
    if (last) {
      kp = typeof last.kp_index === "number" ? last.kp_index : Number(last.kp) || 0;
      kpTime = typeof last.time_tag === "string" ? last.time_tag : null;
    }
  } catch {
    /* NOAA timeout — GPS week remains real */
  }
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/products/noaa-scales.json",
      4000,
    );
    if (raw && typeof raw === "object") {
      const now = (raw as Record<string, { G?: { Scale?: string } }>)["0"];
      if (now?.G?.Scale) gScale = now.G.Scale;
    }
  } catch {
    gScale = kp >= 8 ? "G4" : kp >= 7 ? "G3" : kp >= 6 ? "G2" : kp >= 5 ? "G1" : "G0";
  }
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
      4000,
    );
    const list = asList(raw);
    const last = list[list.length - 1] as Record<string, unknown> | undefined;
    if (last) {
      xrayFlux = typeof last.flux === "number" ? last.flux : null;
      xrayAt = typeof last.time_tag === "string" ? last.time_tag : null;
    }
  } catch {
    /* GOES optional */
  }
  const xrayClass = xrayClassOf(xrayFlux);
  const note =
    kp >= 5
      ? "Orage géomagnétique — GNSS dégradé possible (scintillation ionosphérique)."
      : xrayClass.startsWith("M") || xrayClass.startsWith("X")
        ? `Éruption solaire ${xrayClass} — surveiller L1 / scintillation.`
        : "Indice Kp calme — intégrité GNSS nominale.";
  return {
    kp,
    kpTime,
    gScale,
    note,
    gpsWeek: week,
    gpsTowS: towS,
    xrayClass,
    xrayFlux,
    xrayAt,
  };
}

function localN(ac: LiveAc[]): number {
  let n = 0;
  for (const a of ac) {
    const dlat = a.lat - 12.1348;
    const dlon = a.lon - 15.0557;
    const km = Math.hypot(dlat * 110.57, dlon * 111.32 * Math.cos((12.1348 * Math.PI) / 180));
    if (km <= 120) n += 1;
  }
  return n;
}

function emptyPicture(err: string): LivePicture {
  const g = gpsTime();
  return {
    at: Date.now(),
    source: "ingest partiel",
    aircraft: [],
    localN: 0,
    sahelN: 0,
    emergencies: [],
    metar: [],
    taf: [],
    space: {
      kp: 0,
      kpTime: null,
      gScale: "G?",
      note: "NOAA / 1090 encore en cours.",
      gpsWeek: g.week,
      gpsTowS: g.towS,
      xrayClass: "—",
      xrayFlux: null,
      xrayAt: null,
    },
    sigmets: [],
    jam: [],
    airport: null,
    alerts: [],
    solar: solarFttj(),
    sources: [],
    errors: [err],
    phenomena: [],
  };
}

function health(
  id: string,
  label: string,
  ok: boolean,
  detail: string,
): SourceHealth {
  return { id, label, ok, detail };
}

function nicHealth(ac: LiveAc[], jam: JamCell[]): SourceHealth {
  return health(
    "nic",
    "GNSS NIC (ADS-B)",
    jam.length > 0 || ac.some((a) => a.nic != null),
    jam.some((j) => j.level !== "low")
      ? `${jam.filter((j) => j.level !== "low").length} cellules dégradées`
      : "pas de jamming mesuré sur le flux",
  );
}

/**
 * Ajoute l'antenne du poste à l'image réseau : ses avions passent devant ceux des agrégateurs
 * (plus frais, entendus en direct), le registre réseau complète le type et l'immatriculation.
 */
function withReceiver(net: LivePicture, rx: ReceiverStatus, rxAc: LiveAc[]): LivePicture {
  const now = Date.now();
  const live = rx.enabled && rx.connected && rx.lastLineAt != null && now - rx.lastLineAt < 60_000;
  const silentS = rx.lastLineAt ? Math.round((now - rx.lastLineAt) / 1000) : null;
  const rxHealth = health(
    "rx",
    "Antenne 1090 du poste",
    live,
    !rx.enabled
      ? "coupée (VIGILAIR_1090=off)"
      : live
        ? `${rx.positioned} positionnés · ${rx.heard} entendus · ${rx.msgPerS} msg/s · ${rx.endpoint}`
        : rx.connected
          ? `connectée ${rx.endpoint} · aucune trame${silentS != null ? ` depuis ${silentS} s` : ""}`
          : `${rx.lastError ?? "connexion en cours"} · ${rx.endpoint}`,
  );
  const byHex = new Map(net.aircraft.map((a) => [a.hex, a] as const));
  for (const a of rxAc) {
    const n = byHex.get(a.hex);
    byHex.set(
      a.hex,
      n
        ? {
            ...a,
            flight: a.flight !== a.hex.toUpperCase() ? a.flight : n.flight,
            icaoType: n.icaoType,
            reg: n.reg,
            military: n.military,
            category: a.category ?? n.category,
          }
        : a,
    );
  }
  const aircraft = [...byHex.values()];
  const jam = jamFromAircraft(aircraft);
  const sources: SourceHealth[] = [];
  for (const src of net.sources) {
    sources.push(src.id === "nic" ? nicHealth(aircraft, jam) : src);
    if (src.id === "1090") sources.push(rxHealth);
  }
  if (!sources.includes(rxHealth)) sources.unshift(rxHealth);
  const sourceAt: Record<string, number> = { ...net.sourceAt };
  for (const src of net.sources) sourceAt[src.id] ??= net.at;
  sourceAt.rx = now;
  if (live) sourceAt.nic = now;
  return {
    ...net,
    at: live ? now : net.at,
    sourceAt,
    source: live
      ? `antenne ${rx.endpoint} · ${rxAc.length} avions${net.aircraft.length ? ` + ${net.source}` : ""}`
      : net.source,
    aircraft,
    localN: localN(aircraft),
    sahelN: sahelCount(aircraft),
    emergencies: aircraft.filter((a) => Boolean(a.emergency)),
    jam,
    sources,
    errors: !live && rx.enabled && rx.lastError ? [...net.errors, `Antenne: ${rx.lastError}`] : net.errors,
  };
}

async function pullAirport(): Promise<{ airport: AirportRow | null; errors: string[] }> {
  try {
    const raw = await fetchJson(
      "https://aviationweather.gov/api/data/airport?ids=FTTJ&format=json",
      5000,
    );
    const row = asList(raw)[0];
    if (!row || typeof row !== "object") return { airport: null, errors: [] };
    const r = row as Record<string, unknown>;
    const runways = Array.isArray(r.runways) ? r.runways : [];
    const rwy0 = runways[0] as Record<string, unknown> | undefined;
    const dim = typeof rwy0?.dimension === "string" ? rwy0.dimension : "";
    const ft = parseInt(dim, 10);
    return {
      airport: {
        icao: String(r.icaoId ?? "FTTJ"),
        name: String(r.name ?? "N'Djamena"),
        lat: typeof r.lat === "number" ? r.lat : 12.1331,
        lon: typeof r.lon === "number" ? r.lon : 15.0339,
        elevM: typeof r.elev === "number" ? r.elev : 295,
        rwy: typeof rwy0?.id === "string" ? rwy0.id : null,
        rwyM: Number.isFinite(ft) ? Math.round(ft * 0.3048) : null,
        freqs: typeof r.freqs === "string" && r.freqs ? r.freqs : null,
        country: typeof r.country === "string" ? r.country : "TD",
      },
      errors: [],
    };
  } catch (e) {
    return {
      airport: null,
      errors: [`FTTJ: ${e instanceof Error ? e.message : "échec"}`],
    };
  }
}

async function pullAlerts(): Promise<{ alerts: SwpcAlert[]; errors: string[] }> {
  try {
    const raw = await fetchJson(
      "https://services.swpc.noaa.gov/products/alerts.json",
      4000,
    );
    const out: SwpcAlert[] = [];
    const seen = new Set<string>();
    for (const row of asList(raw).slice().reverse()) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const msg = String(r.message ?? "");
      const kindLine = msg
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^(ALERT|WATCH|WARNING|SUMMARY):/i.test(l));
      if (!kindLine) continue;
      const kind = kindLine.split(":")[0]!.toUpperCase();
      const title = kindLine.replace(/^[A-Z]+:\s*/i, "").trim();
      const impact =
        msg.match(/Potential Impacts:\s*([^\r\n]+)/i)?.[1]?.trim().slice(0, 180) ??
        null;
      const key = `${kind}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code: String(r.product_id ?? ""),
        at: typeof r.issue_datetime === "string" ? r.issue_datetime : null,
        kind,
        title,
        impact,
      });
      if (out.length >= 6) break;
    }
    return { alerts: out, errors: [] };
  } catch (e) {
    return {
      alerts: [],
      errors: [`SWPC: ${e instanceof Error ? e.message : "échec"}`],
    };
  }
}

export function peekLiveCache(): LivePicture | null {
  return cache?.data ?? lastGood;
}

async function pullPhenomena(): Promise<{ rows: Phenomenon[]; errors: string[] }> {
  const errors: string[] = [];
  const chunks: Phenomenon[][] = [];
  try {
    const raw = await fetchJson(
      "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=120",
      7000,
    );
    chunks.push(parseEonet(raw));
  } catch (e) {
    errors.push(`EONET: ${e instanceof Error ? e.message : "échec"}`);
  }
  try {
    const raw = await fetchJson(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
      6000,
    );
    chunks.push(parseUsgs(raw));
  } catch (e) {
    errors.push(`USGS: ${e instanceof Error ? e.message : "échec"}`);
  }
  try {
    const raw = await fetchJson(
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF",
      7000,
    );
    chunks.push(parseGdacs(raw));
  } catch (e) {
    errors.push(`GDACS: ${e instanceof Error ? e.message : "échec"}`);
  }
  const firms = await pullFirms();
  chunks.push(firms.rows);
  errors.push(...firms.errors);
  return { rows: mergePhenomena(chunks).slice(0, 120), errors };
}

function sigmetsAsPhenomena(rows: { fir: string; hazard: string; raw: string; coords: { lat: number; lon: number }[]; inAo: boolean }[]): Phenomenon[] {
  const out: Phenomenon[] = [];
  for (const s of rows) {
    if (s.coords.length === 0) continue;
    const lat = s.coords.reduce((a, p) => a + p.lat, 0) / s.coords.length;
    const lon = s.coords.reduce((a, p) => a + p.lon, 0) / s.coords.length;
    const theater = theaterOf(lat, lon);
    const haz = s.hazard.toUpperCase();
    const kind =
      /TS|STORM|TURB/.test(haz) ? "tempete" as const :
      /VA|VOLCAN/.test(haz) ? "volcan" as const :
      /DS|SS|DUST/.test(haz) ? "poussiere" as const :
      "sigmet" as const;
    out.push({
      id: `sig-${s.fir}-${haz}-${Math.round(lat * 10)}-${Math.round(lon * 10)}`,
      kind,
      title: `SIGMET ${s.fir} · ${s.hazard}`,
      body: (s.raw || s.hazard).slice(0, 160),
      lat,
      lon,
      at: Date.now(),
      theater,
      level: s.inAo ? "elevee" : "moderee",
      source: "SIGMET OACI",
    });
  }
  return out;
}

/** Image des sources Internet (agrégateurs 1090ES, NOAA, NASA…), mise en cache 20 s. */
async function pullNetwork(): Promise<LivePicture> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  try {
    const data = await Promise.race([
      (async () => {
        const [adsb, wx, space, sig, apt, swpc, nat] = await Promise.all([
          pullAdsb(),
          pullMetar(),
          pullSpace(),
          pullSigmet(),
          pullAirport(),
          pullAlerts(),
          pullPhenomena(),
        ]);
        const jam: JamCell[] = jamFromAircraft(adsb.ac);
        const emergencies = adsb.ac.filter((a) => Boolean(a.emergency));
        const solar = solarFttj();
        const sources: SourceHealth[] = [
          health(
            "1090",
            "1090ES adsb.lol",
            adsb.ok,
            adsb.ok
              ? `${adsb.ac.length} squitters · ${adsb.source}`
              : adsb.errors[0] ?? "silence",
          ),
          health(
            "metar",
            "METAR NOAA",
            wx.metar.length > 0,
            wx.metar.length
              ? `${wx.metar.length} aérodromes ASECNA/Sahel`
              : wx.errors[0] ?? "aucun METAR",
          ),
          health(
            "taf",
            "TAF NOAA",
            wx.taf.length > 0,
            wx.taf.length
              ? `${wx.taf.length} TAF`
              : (wx.errors.find((e) => e.startsWith("TAF:")) ?? "aucun TAF"),
          ),
          health(
            "sigmet",
            "SIGMET OACI",
            sig.rows.length > 0,
            sig.rows.length
              ? `${sig.rows.filter((s) => s.inAo).length} Afrique · ${sig.rows.length} monde`
              : sig.errors[0] ?? "aucun SIGMET",
          ),
          health(
            "swpc",
            "NOAA SWPC",
            space.kpTime != null || space.xrayFlux != null,
            `Kp ${space.kp} · GOES ${space.xrayClass}`,
          ),
          nicHealth(adsb.ac, jam),
          health(
            "fttj",
            "FTTJ AWC",
            apt.airport != null,
            apt.airport
              ? `RWY ${apt.airport.rwy ?? "—"} · ${apt.airport.rwyM ?? "—"} m · ${apt.airport.freqs ?? "TWR"}`
              : apt.errors[0] ?? "aéroport indisponible",
          ),
          health(
            "alert",
            "Alertes SWPC",
            swpc.alerts.length > 0,
            swpc.alerts.length
              ? `${swpc.alerts[0]!.kind} · ${swpc.alerts[0]!.title}`
              : "aucune alerte en cours",
          ),
          health(
            "sol",
            "Soleil FTTJ",
            true,
            solar.nightOps
              ? `Nuit · lev ${solar.sunrise} WAT`
              : `Jour · couch ${solar.sunset} WAT`,
          ),
          health(
            "nat",
            "Phénomènes NASA/USGS/GDACS/FIRMS",
            nat.rows.length > 0,
            nat.rows.length
              ? `${nat.rows.length} événements · ${
                  nat.rows.filter((p) => p.source === "NASA FIRMS").length
                } FIRMS · ${nat.rows.filter((p) => p.theater !== "monde").length} théâtre${
                  nat.errors.find((e) => e.startsWith("FIRMS"))
                    ? ` · ${nat.errors.find((e) => e.startsWith("FIRMS"))}`
                    : ""
                }`
              : nat.errors[0] ?? "aucun événement",
          ),
        ];
        const phenomena = mergePhenomena([
          nat.rows,
          sigmetsAsPhenomena(sig.rows),
        ]).slice(0, 120);
        return {
          at: Date.now(),
          source: adsb.source,
          aircraft: adsb.ac,
          localN: localN(adsb.ac),
          sahelN: sahelCount(adsb.ac),
          emergencies,
          metar: wx.metar,
          taf: wx.taf,
          space,
          sigmets: sig.rows,
          jam,
          airport: apt.airport,
          alerts: swpc.alerts,
          solar,
          sources,
          errors: [...adsb.errors, ...wx.errors, ...sig.errors, ...apt.errors, ...swpc.errors, ...nat.errors],
          phenomena,
        } satisfies LivePicture;
      })(),
      new Promise<LivePicture>((resolve) => {
        setTimeout(() => resolve(emptyPicture("timeout 12s")), 12000);
      }),
    ]);
    const usable =
      data.aircraft.length > 0 ||
      data.metar.length > 0 ||
      data.taf.length > 0 ||
      data.sigmets.length > 0 ||
      data.airport != null ||
      data.alerts.length > 0;
    const rateLimited = data.errors.some((e) => e.includes("429"));
    let next = data;
    if (
      data.aircraft.length === 0 &&
      lastGood &&
      lastGood.aircraft.length > 0 &&
      Date.now() - lastGood.at < 180_000 &&
      rateLimited
    ) {
      next = {
        ...data,
        aircraft: lastGood.aircraft,
        localN: lastGood.localN,
        sahelN: lastGood.sahelN,
        emergencies: lastGood.emergencies,
        jam: lastGood.jam,
        source: `${lastGood.source} · cache 1090`,
      };
    }
    if (usable || next.aircraft.length > 0) {
      cache = { at: Date.now(), data: next };
      lastGood = next;
      return next;
    }
    if (lastGood && Date.now() - lastGood.at < 120_000) {
      return {
        ...lastGood,
        errors: [...data.errors, "cache conservé"].slice(0, 6),
      };
    }
    return data;
  } catch (e) {
    if (lastGood) return lastGood;
    return emptyPicture(e instanceof Error ? e.message : "ingest échoué");
  }
}

let netPending: Promise<LivePicture> | null = null;
let netLast: LivePicture | null = null;

/** Un seul relevé Internet à la fois, même quand le poste interroge souvent. */
function refreshNetwork(): Promise<LivePicture> {
  netPending ??= pullNetwork()
    .then((p) => {
      netLast = p;
      return p;
    })
    .finally(() => {
      netPending = null;
    });
  return netPending;
}

export const fetchLivePicture = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<LivePicture> => {
    const rx = await import("./rx1090.server");
    await rx.receiverReady();
    const status = rx.receiverStatus();
    let net: LivePicture;
    if (cache && Date.now() - cache.at < TTL_MS) {
      net = cache.data;
    } else if (!status.connected) {
      net = await refreshNetwork();
    } else {
      // Antenne branchée : les pistes locales n'attendent jamais un Internet lent ou coupé.
      const pending = refreshNetwork();
      net =
        netLast ??
        (await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 1500))])) ??
        emptyPicture("relevé Internet en cours");
    }
    return withReceiver(net, status, rx.receiverAircraft());
  });

/** Écoute brute de l'antenne : les trames telles qu'elles arrivent, décodées, sans filtre. */
export const fetchReceiverFeed = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw: { after?: number }) => ({
    after: typeof raw?.after === "number" && Number.isFinite(raw.after) ? raw.after : 0,
  }))
  .handler(async ({ data }): Promise<ReceiverFeed> => {
    const rx = await import("./rx1090.server");
    return rx.receiverFeed(data.after);
  });

export type AircraftLookup = {
  ok: boolean;
  hex: string;
  type: string | null;
  icaoType: string | null;
  manufacturer: string | null;
  registration: string | null;
  operator: string | null;
  country: string | null;
  error?: string;
};

export const lookupAircraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { hex: string }) => ({
    hex: String(raw.hex ?? "")
      .replace(/[^0-9a-f]/gi, "")
      .toLowerCase()
      .slice(0, 6),
  }))
  .handler(async ({ data }): Promise<AircraftLookup> => {
    if (!/^[0-9a-f]{6}$/.test(data.hex)) {
      return { ok: false, hex: data.hex, type: null, icaoType: null, manufacturer: null, registration: null, operator: null, country: null, error: "ICAO24 — 6 hex" };
    }
    try {
      const raw = await fetchJson(`https://api.adsbdb.com/v0/aircraft/${data.hex}`, 6000);
      const ac =
        raw && typeof raw === "object"
          ? (raw as { response?: { aircraft?: Record<string, unknown> } }).response?.aircraft
          : null;
      if (!ac) {
        return {
          ok: false,
          hex: data.hex,
          type: null,
          icaoType: null,
          manufacturer: null,
          registration: null,
          operator: null,
          country: null,
          error: "Inconnu du registre adsbdb",
        };
      }
      return {
        ok: true,
        hex: data.hex,
        type: typeof ac.type === "string" ? ac.type : null,
        icaoType: typeof ac.icao_type === "string" ? ac.icao_type : null,
        manufacturer: typeof ac.manufacturer === "string" ? ac.manufacturer : null,
        registration: typeof ac.registration === "string" ? ac.registration : null,
        operator: typeof ac.registered_owner === "string" ? ac.registered_owner : null,
        country:
          typeof ac.registered_owner_country_name === "string"
            ? ac.registered_owner_country_name
            : null,
      };
    } catch (e) {
      return {
        ok: false,
        hex: data.hex,
        type: null,
        icaoType: null,
        manufacturer: null,
        registration: null,
        operator: null,
        country: null,
        error: e instanceof Error ? e.message : "registre indisponible",
      };
    }
  });

export const briefLivePicture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Outil briefing indisponible sur ce poste" };
    const pic = peekLiveCache();
    if (!pic) return { ok: false, error: "Pas encore d'ingest — attendre le 1090 / METAR" };
    const fttj = pic.metar.find((m) => m.icao === "FTTJ");
    const aoSig = pic.sigmets.filter((s) => s.inAo).slice(0, 6);
    const jam = pic.jam.filter((j) => j.level !== "low").slice(0, 6);
    const sample = pic.aircraft
      .slice()
      .sort((a, b) => {
        const da = Math.hypot(a.lat - 12.13, a.lon - 15.05);
        const db = Math.hypot(b.lat - 12.13, b.lon - 15.05);
        return da - db;
      })
      .slice(0, 12)
      .map(
        (a) =>
          `${a.flight} ${a.hex} ${a.icaoType ?? "?"} ${a.reg ?? ""} FL${Math.round(a.altM / 30.48)} nic=${a.nic ?? "?"} ${a.military ? "MIL" : ""} ${a.emergency ?? ""}`.trim(),
      );
    const prompt = [
      "Officier COP C-UAS VIGILAIR, N'Djamena (FTTJ), Tchad. Briefing opérationnel en français, 12 lignes max, factuel, sans fiction, sans markdown.",
      "Les données ci-dessous sont des capteurs réels (ADS-B 1090ES, METAR NOAA, SIGMET OACI, NOAA SWPC, AWC FTTJ). Ne pas inventer de pistes.",
      `Heure ingest: ${new Date(pic.at).toISOString()}`,
      `1090ES: ${pic.aircraft.length} contacts en Afrique, ${pic.sahelN} au Sahel, ${pic.localN} dans 120 km FTTJ, ${pic.emergencies.length} urgences.`,
      `METAR FTTJ: ${fttj?.raw ?? "absent (station parfois muette — c'est réel)"}`,
      `Piste FTTJ: ${pic.airport ? `RWY ${pic.airport.rwy ?? "—"} ${pic.airport.rwyM ?? "—"} m · ${pic.airport.freqs ?? ""}` : "AWC indisponible"}`,
      `Soleil FTTJ WAT: lev ${pic.solar.sunrise} civil ${pic.solar.civilBegin} / coucher ${pic.solar.sunset} · ${pic.solar.nightOps ? "nuit" : "jour"}`,
      `Kp ${pic.space.kp} ${pic.space.gScale} GOES ${pic.space.xrayClass}. ${pic.space.note}`,
      `Alertes SWPC: ${pic.alerts.map((a) => `${a.kind} ${a.title}`).join(" ; ") || "aucune"}`,
      `SIGMET Afrique: ${aoSig.map((s) => `${s.fir} ${s.hazard} ${s.qualifier ?? ""}`).join(" ; ") || "aucun"}`,
      `GNSS dégradé (méthode NIC/NACp, gpsjam): ${jam.map((j) => `${j.lat},${j.lon} ${j.pct.toFixed(0)}%`).join(" ; ") || "pas de cellule chaude"}`,
      `Échantillon 1090 proche FTTJ:`,
      ...sample,
      "Conclure: posture, ce qui est réel vs silence capteur, une action chef de division.",
    ].join("\n");
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 420,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return { ok: false, error: `xAI ${res.status}` };
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) return { ok: false, error: "Briefing vide" };
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "briefing échoué" };
    }
  });
