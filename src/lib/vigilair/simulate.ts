import { sampleAcoustic, sampleCpa, samplePilotFix } from "./acoustics";
import { PLATFORM_BY_ID } from "./catalog";
import { makeLaunchFix, makeStopFix } from "./trace";
import { advanceIdentification, coveringSensors, pickTruePlatform } from "./engine";
import { isFriend, spawnFriendTrack, stepFriend } from "./friends";
import { maybeHostileIff, mintSpoofAdsb } from "./iff";
import { AO, CORRIDORS, THEATRE_RADIUS_KM, destPoint, haversineKm } from "./geo";
import type { Track } from "./types";

let seq = 17;

function nextCallsign(kind: "air" | "uas"): string {
  seq += 1;
  const prefix = kind === "air" ? "A" : "T";
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function wrap360(h: number) {
  let x = h % 360;
  if (x < 0) x += 360;
  return x;
}

function spawnPose(platformId: string): {
  lat: number;
  lon: number;
  corridor: string | null;
} {
  const plat = PLATFORM_BY_ID[platformId];
  const cls = plat?.uasClass;
  const role = plat?.role;
  if (role === "consumer" || role === "agriculture" || role === "logistics") {
    const p = destPoint(AO.centerLat, AO.centerLon, rand(0, 360), rand(3, 38));
    return { ...p, corridor: "Périurbain N'Djamena" };
  }
  if (role === "enterprise-isr") {
    const p = destPoint(AO.centerLat, AO.centerLon, rand(0, 360), rand(8, 85));
    return { ...p, corridor: "AO ident 120 km" };
  }
  if (cls === "loitering" || cls === "male" || cls === "ucav") {
    const c = CORRIDORS[Math.floor(Math.random() * CORRIDORS.length)]!;
    const p = destPoint(c.lat, c.lon, rand(0, 360), rand(8, 60));
    return { ...p, corridor: c.name };
  }
  if (cls === "chasse") {
    const p = destPoint(AO.centerLat, AO.centerLon, rand(0, 360), rand(80, 3600));
    return { ...p, corridor: "Transit aérien Sahel" };
  }
  const c = CORRIDORS[Math.floor(Math.random() * CORRIDORS.length)]!;
  const mix = Math.random() < 0.55;
  const p = mix
    ? destPoint(c.lat, c.lon, rand(0, 360), rand(6, 80))
    : destPoint(AO.centerLat, AO.centerLon, rand(0, 360), rand(25, 420));
  return { ...p, corridor: mix ? c.name : "Approche théâtre" };
}

export function spawnTrack(now: number): Track {
  const truePlatformId = pickTruePlatform();
  const plat = PLATFORM_BY_ID[truePlatformId]!;
  const pose = spawnPose(truePlatformId);
  const lat = pose.lat;
  const lon = pose.lon;

  const toCity = Math.atan2(AO.centerLon - lon, AO.centerLat - lat) * (180 / Math.PI);
  const heading = wrap360(toCity + rand(-22, 22));
  const chasse = plat.uasClass === "chasse";
  const cruise = chasse
    ? plat.cruiseKmh * rand(0.88, 1.06)
    : plat.cruiseKmh * rand(0.75, 1.12);
  const isLoiter = chasse
    ? false
    : plat.uasClass === "multirotor" || plat.uasClass === "loitering"
      ? Math.random() < 0.4
      : Math.random() < 0.18;
  const altBase = chasse
    ? rand(Math.min(7200, plat.ceilingM * 0.4), Math.min(plat.ceilingM * 0.7, 12800))
    : plat.uasClass === "male" || plat.uasClass === "ucav"
      ? rand(1800, Math.min(plat.ceilingM * 0.45, 6200))
      : plat.role === "agriculture"
        ? rand(8, 28)
        : plat.uasClass === "loitering"
          ? rand(80, 420)
          : rand(40, 280);
  const callsign = nextCallsign(chasse ? "air" : "uas");

  return {
    id: `trk-${now}-${seq}`,
    callsign,
    lat,
    lon,
    altM: altBase,
    heading,
    speedKmh: cruise,
    climbMs: 0,
    trail: [{ lat, lon }],
    truePlatformId,
    idState: "detecte",
    confidence: 10,
    origin: null,
    classGuess: null,
    hypotheses: [],
    sensors: coveringSensors(lat, lon),
    firstSeen: now,
    lastUpdate: now,
    dwellS: 0,
    confirmedAt: null,
    motion: chasse ? "transit" : isLoiter ? "loiter" : Math.random() < 0.62 ? "ingress" : "transit",
    loiterCx: AO.centerLat + rand(-0.08, 0.08),
    loiterCy: AO.centerLon + rand(-0.09, 0.09),
    loiterR: rand(0.012, 0.05),
    turnRate: rand(3, 12) * (Math.random() < 0.5 ? 1 : -1),
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: false,
    launchFix: makeLaunchFix(lat, lon, heading, now, truePlatformId),
    stopFix: null,
    locked: false,
    corridor: pose.corridor,
    ew: null,
    iff: maybeHostileIff(plat, callsign, seq),
  };
}

export function stepTrack(track: Track, dt: number, now: number): Track {
  if (isFriend(track)) return stepFriend(track, dt, now);
  let lat = track.lat;
  let lon = track.lon;
  let heading = track.heading;
  const speed = track.speedKmh;
  const stepKm = (speed / 3600) * dt;

  if (track.motion === "loiter") {
    heading = wrap360(heading + track.turnRate * dt);
  } else if (track.motion === "ingress") {
    const toCity = Math.atan2(AO.centerLon - lon, AO.centerLat - lat) * (180 / Math.PI);
    let err = toCity - heading;
    if (err < -180) err += 360;
    if (err > 180) err -= 360;
    heading = wrap360(heading + Math.max(-8, Math.min(8, err * 0.08)));
  }

  const next = destPoint(lat, lon, heading, stepKm);
  lat = next.lat;
  lon = next.lon;
  const trail = [...track.trail, { lat, lon }].slice(-(track.locked ? 160 : 72));

  let nextTrack: Track = {
    ...track,
    lat,
    lon,
    heading,
    trail,
    dwellS: track.dwellS + dt,
    lastUpdate: now,
    sensors: coveringSensors(lat, lon),
    acoustic: sampleAcoustic({ ...track, lat, lon, heading }),
    pilotFix: samplePilotFix({ ...track, lat, lon, heading, sensors: coveringSensors(lat, lon) }),
    cpa: sampleCpa({ ...track, lat, lon, heading }),
  };

  nextTrack = {
    ...nextTrack,
    stopFix: makeStopFix(nextTrack, now),
  };

  if (nextTrack.ew?.state === "effet" && nextTrack.pilotFix) {
    nextTrack = {
      ...nextTrack,
      pilotFix: {
        ...nextTrack.pilotFix,
        quality: Math.max(8, nextTrack.pilotFix.quality * 0.45),
        method: "Gonio C2 dégradé · effecteur RF externe (silence contrôleur)",
      },
    };
  }

  nextTrack = { ...nextTrack, stopFix: makeStopFix(nextTrack, now) };

  const fromCenter = haversineKm(lat, lon, AO.centerLat, AO.centerLon);
  if (fromCenter > THEATRE_RADIUS_KM) {
    nextTrack = { ...nextTrack, idState: "perdu" };
  } else {
    nextTrack = advanceIdentification(nextTrack);
    if (nextTrack.idState === "confirme" && track.confirmedAt === null) {
      nextTrack = { ...nextTrack, confirmedAt: now };
    }
  }
  return nextTrack;
}

export function spawnInjectedTrack(opts: {
  now: number;
  platformId: string;
  lat: number;
  lon: number;
  heading: number;
  corridor: string;
  spoofIff?: boolean;
  spoofAdsb?: boolean;
}): Track {
  const plat = PLATFORM_BY_ID[opts.platformId];
  if (!plat) return spawnTrack(opts.now);
  if (plat.friendKind) {
    return spawnFriendTrack(opts.now, {
      platformId: opts.platformId,
      kind: plat.friendKind,
      lat: opts.lat,
      lon: opts.lon,
      heading: opts.heading,
      corridor: opts.corridor,
      injected: true,
    });
  }
  const chasse = plat.uasClass === "chasse";
  const cruise = chasse ? plat.cruiseKmh * 0.96 : plat.cruiseKmh * 0.92;
  const altBase = chasse
    ? Math.min(plat.ceilingM * 0.55, 11000)
    : plat.uasClass === "male" || plat.uasClass === "ucav"
      ? Math.min(plat.ceilingM * 0.4, 5200)
      : plat.uasClass === "loitering"
        ? 220
        : plat.role === "consumer"
          ? 85
          : 160;
  const callsign = nextCallsign(chasse ? "air" : "uas");
  return {
    id: `trk-inj-${opts.now}-${seq}`,
    callsign,
    lat: opts.lat,
    lon: opts.lon,
    altM: altBase,
    heading: opts.heading,
    speedKmh: cruise,
    climbMs: 0,
    trail: [{ lat: opts.lat, lon: opts.lon }],
    truePlatformId: opts.platformId,
    idState: "detecte",
    confidence: 14,
    origin: null,
    classGuess: null,
    hypotheses: [],
    sensors: coveringSensors(opts.lat, opts.lon),
    firstSeen: opts.now,
    lastUpdate: opts.now,
    dwellS: 0,
    confirmedAt: null,
    motion: chasse ? "transit" : "ingress",
    loiterCx: AO.centerLat,
    loiterCy: AO.centerLon,
    loiterR: 0.03,
    turnRate: 6,
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: false,
    launchFix: makeLaunchFix(opts.lat, opts.lon, opts.heading, opts.now, opts.platformId),
    stopFix: null,
    locked: false,
    corridor: opts.corridor,
    ew: null,
    injected: true,
    iff: opts.spoofAdsb
      ? mintSpoofAdsb(callsign, seq, opts.lat, opts.lon)
      : maybeHostileIff(plat, callsign, seq, Boolean(opts.spoofIff)),
  };
}

export function seedTracks(now: number, n = 16): Track[] {
  const out: Track[] = [];
  for (let i = 0; i < n; i++) {
    let t = spawnTrack(now - rand(12, 90) * 1000);
    const steps = 24 + Math.floor(Math.random() * 50);
    for (let s = 0; s < steps; s++) t = stepTrack(t, 0.8, now);
    if (t.idState !== "perdu") out.push(t);
  }
  return out;
}
