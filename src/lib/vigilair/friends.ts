import { coveringSensors } from "./engine";
import {
  ASECNA_PLATFORMS,
  FATL_PLATFORMS,
  FRIEND_BY_ID,
  FRIEND_PLATFORMS,
} from "./catalog-friends";
import { AO, destPoint, headingBetween, haversineKm, THEATRE_RADIUS_KM } from "./geo";
import { mintAsecnaIff, mintFatlIff } from "./iff";
import { makeLaunchFix, makeStopFix } from "./trace";
import type { FriendKind, IffFix, Track } from "./types";


export type FriendBase = {
  id: string;
  icao: string;
  name: string;
  lat: number;
  lon: number;
};

export const FATL_BASES: FriendBase[] = [
  { id: "fttj", icao: "FTTJ", name: "N'Djamena / FATL", lat: 12.1336, lon: 15.034 },
  { id: "fttd", icao: "FTTD", name: "Moundou", lat: 8.624, lon: 16.071 },
  { id: "fttc", icao: "FTTC", name: "Abéché", lat: 13.847, lon: 20.844 },
  { id: "fttf", icao: "FTTF", name: "Faya-Largeau", lat: 17.917, lon: 19.111 },
  { id: "ftts", icao: "FTTS", name: "Sarh", lat: 9.146, lon: 18.375 },
];

export type Airway = {
  id: string;
  name: string;
  a: { lat: number; lon: number; label: string };
  b: { lat: number; lon: number; label: string };
};

/** Voies schématiques FIR FTTT (ASECNA) — pas un flux live. */
export const ASECNA_AIRWAYS: Airway[] = [
  {
    id: "ua400",
    name: "UA400",
    a: { lat: 13.512, lon: 2.112, label: "Niamey" },
    b: { lat: 15.501, lon: 32.532, label: "Khartoum" },
  },
  {
    id: "ub607",
    name: "UB607",
    a: { lat: 4.006, lon: 9.719, label: "Douala" },
    b: { lat: 17.926, lon: 19.104, label: "Faya" },
  },
  {
    id: "um114",
    name: "UM114",
    a: { lat: 12.002, lon: 8.592, label: "Kano" },
    b: { lat: 13.45, lon: 22.447, label: "Geneina" },
  },
  {
    id: "ug853",
    name: "UG853",
    a: { lat: 4.398, lon: 18.519, label: "Bangui" },
    b: { lat: 13.847, lon: 20.844, label: "Abéché" },
  },
];

const ASECNA_CS = [
  "ETH714",
  "KP042",
  "MS874",
  "QC211",
  "KQ508",
  "TT123",
  "5U441",
  "HF802",
  "AT557",
  "WB310",
];

let fatlSeq = 0;
let asecnaSeq = 0;

export function isFriend(t: { friendKind?: FriendKind | null }): boolean {
  return t.friendKind === "fatl" || t.friendKind === "asecna";
}

export function friendLabel(kind: FriendKind): string {
  return kind === "fatl" ? "FATL" : "ASECNA";
}

export function friendBlurb(kind: FriendKind): string {
  return kind === "fatl"
    ? "Force aérienne tchadienne — IFF Mode 4 (crypto clé du jour). Affiliation amie, pas une piste C-UAS."
    : "Trafic IFR ASECNA (FIR FTTT) — ADS-B / Mode S, pas de Mode 4. Plan de vol civil, pas un UAS.";
}

function wrap360(h: number) {
  let x = h % 360;
  if (x < 0) x += 360;
  return x;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function mintIff(kind: FriendKind, flightId: string, i: number): IffFix {
  return kind === "asecna" ? mintAsecnaIff(flightId, i) : mintFatlIff(flightId, i);
}


function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function spawnFriendTrack(
  now: number,
  opts?: {
    platformId?: string;
    kind?: FriendKind;
    lat?: number;
    lon?: number;
    heading?: number;
    corridor?: string;
    injected?: boolean;
  },
): Track {
  const kind = opts?.kind ?? (Math.random() < 0.55 ? "fatl" : "asecna");
  const pool = kind === "fatl" ? FATL_PLATFORMS : ASECNA_PLATFORMS;
  const plat =
    (opts?.platformId ? FRIEND_BY_ID[opts.platformId] : null) ??
    pick(pool.length ? pool : FRIEND_PLATFORMS);
  const friendKind: FriendKind = plat.friendKind ?? kind;

  let lat: number;
  let lon: number;
  let heading: number;
  let corridor: string;
  let motion: Track["motion"];
  let altM: number;
  let loiterCx = AO.centerLat;
  let loiterCy = AO.centerLon;
  let loiterR = 0.04;

  if (friendKind === "asecna") {
    const aw = pick(ASECNA_AIRWAYS);
    const t = rand(0.22, 0.78);
    lat = opts?.lat ?? lerp(aw.a.lat, aw.b.lat, t);
    lon = opts?.lon ?? lerp(aw.a.lon, aw.b.lon, t);
    const east = Math.random() < 0.5;
    heading =
      opts?.heading ??
      (east
        ? headingBetween(aw.a.lat, aw.a.lon, aw.b.lat, aw.b.lon)
        : headingBetween(aw.b.lat, aw.b.lon, aw.a.lat, aw.a.lon));
    corridor = opts?.corridor ?? `ASECNA ${aw.name}`;
    motion = "transit";
    altM = rand(8200, Math.min(plat.ceilingM * 0.85, 11800));
  } else {
    const base = pick(FATL_BASES);
    const rotary = plat.role === "rotary" || plat.uasClass === "vtol";
    const male = plat.uasClass === "male";
    if (rotary) {
      const p = destPoint(base.lat, base.lon, rand(0, 360), rand(4, 28));
      lat = opts?.lat ?? p.lat;
      lon = opts?.lon ?? p.lon;
      heading = opts?.heading ?? rand(0, 360);
      motion = "loiter";
      loiterCx = base.lat;
      loiterCy = base.lon;
      loiterR = rand(0.04, 0.12);
      altM = rand(80, 1400);
      corridor = opts?.corridor ?? `CAP ${base.icao} · ${base.name}`;
    } else if (male) {
      const p = destPoint(base.lat, base.lon, rand(0, 360), rand(18, 90));
      lat = opts?.lat ?? p.lat;
      lon = opts?.lon ?? p.lon;
      heading = opts?.heading ?? headingBetween(p.lat, p.lon, AO.centerLat, AO.centerLon);
      motion = "loiter";
      loiterCx = base.lat + rand(-0.4, 0.4);
      loiterCy = base.lon + rand(-0.4, 0.4);
      loiterR = rand(0.15, 0.35);
      altM = rand(3800, 6200);
      corridor = opts?.corridor ?? `ISR FATL ${base.icao}`;
    } else {
      const other = pick(FATL_BASES.filter((b) => b.id !== base.id));
      const t = rand(0.15, 0.85);
      lat = opts?.lat ?? lerp(base.lat, other.lat, t);
      lon = opts?.lon ?? lerp(base.lon, other.lon, t);
      heading =
        opts?.heading ?? headingBetween(base.lat, base.lon, other.lat, other.lon);
      motion = plat.uasClass === "chasse" ? "ingress" : "transit";
      altM =
        plat.uasClass === "chasse"
          ? rand(400, 2800)
          : rand(2800, Math.min(plat.ceilingM * 0.55, 7800));
      corridor = opts?.corridor ?? `FATL ${base.icao}–${other.icao}`;
    }
  }

  if (friendKind === "fatl") fatlSeq += 1;
  else asecnaSeq += 1;
  const callsign =
    friendKind === "fatl"
      ? `FATL-${String(fatlSeq).padStart(2, "0")}`
      : ASECNA_CS[(asecnaSeq - 1) % ASECNA_CS.length]!;
  const iff = mintIff(friendKind, callsign, friendKind === "fatl" ? fatlSeq : asecnaSeq);
  const cruise =
    plat.cruiseKmh * (friendKind === "asecna" ? rand(0.94, 1.02) : rand(0.82, 1.05));

  return {
    id: `trk-ami-${now}-${callsign}`,
    callsign,
    lat,
    lon,
    altM,
    heading: wrap360(heading),
    speedKmh: cruise,
    climbMs: 0,
    trail: [{ lat, lon }],
    truePlatformId: plat.id,
    idState: "confirme",
    confidence: 96,
    origin: plat.origin,
    classGuess: plat.uasClass,
    hypotheses: [{ platformId: plat.id, score: 96 }],
    sensors: coveringSensors(lat, lon),
    firstSeen: now,
    lastUpdate: now,
    dwellS: 40,
    confirmedAt: now,
    motion,
    loiterCx,
    loiterCy,
    loiterR,
    turnRate: rand(2, 8) * (Math.random() < 0.5 ? 1 : -1),
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: true,
    launchFix: makeLaunchFix(lat, lon, heading, now, plat.id),
    stopFix: null,
    locked: false,
    corridor,
    ew: null,
    injected: opts?.injected,
    friendKind,
    iff,
  };
}

export function seedFriendTracks(now: number, n = 6): Track[] {
  const out: Track[] = [];
  const mix: FriendKind[] = ["fatl", "fatl", "fatl", "asecna", "asecna", "asecna"];
  for (let i = 0; i < n; i++) {
    let t = spawnFriendTrack(now - rand(20, 80) * 1000, { kind: mix[i % mix.length] });
    const steps = 18 + Math.floor(Math.random() * 36);
    for (let s = 0; s < steps; s++) t = stepFriend(t, 0.9, now);
    if (t.idState !== "perdu") out.push(t);
  }
  return out;
}

export function stepFriend(track: Track, dt: number, now: number): Track {
  let lat = track.lat;
  let lon = track.lon;
  let heading = track.heading;
  const stepKm = (track.speedKmh / 3600) * dt;

  if (track.motion === "loiter") {
    heading = wrap360(heading + track.turnRate * dt);
  } else if (track.motion === "ingress") {
    const to = Math.atan2(AO.centerLon - lon, AO.centerLat - lat) * (180 / Math.PI);
    let err = to - heading;
    if (err < -180) err += 360;
    if (err > 180) err -= 360;
    heading = wrap360(heading + Math.max(-6, Math.min(6, err * 0.06)));
  }

  const next = destPoint(lat, lon, heading, stepKm);
  lat = next.lat;
  lon = next.lon;
  const nextTrack: Track = {
    ...track,
    lat,
    lon,
    heading,
    trail: [...track.trail, { lat, lon }].slice(-(track.locked ? 160 : 72)),
    dwellS: track.dwellS + dt,
    lastUpdate: now,
    sensors: coveringSensors(lat, lon),
    idState: "confirme",
    confidence: Math.max(92, track.confidence),
    origin: track.origin ?? FRIEND_BY_ID[track.truePlatformId]?.origin ?? "XX",
  };
  const fromCenter = haversineKm(lat, lon, AO.centerLat, AO.centerLon);
  if (fromCenter > THEATRE_RADIUS_KM) {
    return { ...nextTrack, idState: "perdu", stopFix: makeStopFix(nextTrack, now) };
  }
  return { ...nextTrack, stopFix: makeStopFix(nextTrack, now) };
}

export function countFriends(tracks: Track[]): { fatl: number; asecna: number; n: number } {
  let fatl = 0;
  let asecna = 0;
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    if (t.friendKind === "fatl") fatl += 1;
    else if (t.friendKind === "asecna") asecna += 1;
  }
  return { fatl, asecna, n: fatl + asecna };
}
