import { PLATFORM_BY_ID } from "./catalog";
import { destPoint, haversineKm, headingBetween } from "./geo";
import { ACOUSTIC_SITES, SENSOR_SITES } from "./sensors";
import { getLiveZones } from "./zones";
import type {
  AcousticState,
  AudioChannel,
  PilotFix,
  Platform,
  SiteCpa,
  Track,
} from "./types";

export function bpfFor(plat: Platform): number {
  if (plat.uasClass === "chasse") return 92;
  if (plat.uasClass === "male" || plat.uasClass === "ucav") return 58;
  if (plat.uasClass === "loitering") return 74;
  if (plat.uasClass === "fixed-wing" || plat.uasClass === "vtol") return 86;
  if (plat.role === "agriculture" || plat.role === "logistics") return 64;
  if (plat.massKg < 0.3) return 128;
  if (plat.massKg < 2) return 104;
  return 88;
}

export function interceptChannel(plat: Platform): {
  channel: AudioChannel;
  note: string;
} {
  const p = `${plat.protocol} ${plat.rfBands.join(" ")} ${plat.manufacturer}`.toLowerCase();
  if (plat.uasClass === "chasse") {
    return {
      channel: "none",
      note: "Chasse habitée — pas de sous-porteuse FPV. Acoustique jet seulement.",
    };
  }
  if (
    plat.manufacturer === "DJI" ||
    plat.manufacturer === "Autel Robotics" ||
    p.includes("ocusync") ||
    p.includes("skylink") ||
    p.includes("satcom") ||
    p.includes("lpi") ||
    p.includes("iff")
  ) {
    return {
      channel: "blocked-crypto",
      note: "Liaison numérique chiffrée — démodulation audio impossible.",
    };
  }
  if (
    p.includes("fpv") ||
    p.includes("devo") ||
    p.includes("hubsan") ||
    p.includes("granat") ||
    p.includes("zala") ||
    p.includes("enics") ||
    p.includes("lightbridge") ||
    p.includes("walkera") ||
    p.includes("fimi")
  ) {
    return {
      channel: "analog-fpv",
      note: "Sous-porteuse analogique 5.8 / UHF — présence audio verrouillée, sans transcription.",
    };
  }
  return {
    channel: "acoustic",
    note: "Pas de sous-porteuse analogique. Écoute limitée au BPF hélices / moteur.",
  };
}

export function sampleAcoustic(track: Track): AcousticState | null {
  const plat = PLATFORM_BY_ID[track.truePlatformId];
  if (!plat) return null;
  const bpf = bpfFor(plat);
  const { channel, note } = interceptChannel(plat);
  const bearings = [];
  let bestSnr = -20;
  for (const s of ACOUSTIC_SITES) {
    if (!s.online) continue;
    const horiz = haversineKm(track.lat, track.lon, s.lat, s.lon);
    const slant = Math.sqrt(horiz * horiz + (track.altM / 1000) ** 2);
    if (slant > s.rangeKm * 1.15) continue;
    let snr = 38 - 14 * Math.log10(Math.max(0.08, slant)) - track.altM / 380;
    if (plat.uasClass === "chasse") snr -= 16;
    if (plat.uasClass === "male" || plat.uasClass === "ucav") snr -= 4;
    snr += (Math.sin(track.dwellS * 1.7 + s.lat * 40) + 1) * 1.4;
    if (snr < 4) continue;
    bestSnr = Math.max(bestSnr, snr);
    const quality = Math.max(8, Math.min(98, snr * 2.4));
    const deg = headingBetween(s.lat, s.lon, track.lat, track.lon);
    bearings.push({ siteId: s.id, deg, quality });
  }
  const locked = bearings.length > 0 && bestSnr >= 8;
  const analogBoost = channel === "analog-fpv" && locked ? 4 : 0;
  return {
    snrDb: Math.round((locked ? bestSnr + analogBoost : Math.max(-6, bestSnr)) * 10) / 10,
    bpfHz: bpf,
    harmonics: [bpf, Math.round(bpf * 2), Math.round(bpf * 3)],
    bearings,
    channel: locked ? channel : "none",
    channelNote: locked ? note : "Hors portée des réseaux de micros.",
    splDb: Math.round(48 + Math.max(0, bestSnr) * 0.7),
    locked,
  };
}

export function samplePilotFix(track: Track): PilotFix | null {
  const plat = PLATFORM_BY_ID[track.truePlatformId];
  if (!plat) return null;
  if (plat.uasClass === "chasse") return null;
  const rf = SENSOR_SITES.some(
    (s) =>
      s.kind === "rf" &&
      s.online &&
      haversineKm(track.lat, track.lon, s.lat, s.lon) <= s.rangeKm,
  );
  if (!rf) return null;
  if (plat.protocol.toLowerCase().includes("gnss") && !track.sensors.includes("rf")) {
    return null;
  }
  const back = (track.heading + 180) % 360;
  const dist = 0.6 + (track.id.charCodeAt(4) % 17) / 10;
  const jitter = Math.sin(track.dwellS * 0.35) * 0.08;
  const pos = destPoint(track.lat, track.lon, back + jitter * 20, dist);
  const quality = Math.max(
    18,
    Math.min(86, 40 + (track.sensors.includes("rf") ? 22 : 0) - dist * 8),
  );
  return {
    lat: pos.lat,
    lon: pos.lon,
    quality,
    method: "Gonio RF TDOA · poste de pilotage",
  };
}

export function sampleCpa(track: Track): SiteCpa | null {
  let best: SiteCpa | null = null;
  const sites = getLiveZones();
  for (const site of sites) {
    const distKm = haversineKm(track.lat, track.lon, site.lat, site.lon);
    const bear = headingBetween(track.lat, track.lon, site.lat, site.lon);
    let err = bear - track.heading;
    if (err < -180) err += 360;
    if (err > 180) err -= 360;
    const closing = Math.abs(err) < 55 && track.speedKmh > 12;
    const along = (track.speedKmh / 3600) * Math.cos((err * Math.PI) / 180);
    const etaS =
      closing && along > 0.002 ? Math.round((distKm / along) * 1) : null;
    const row: SiteCpa = {
      siteId: site.id,
      name: site.name,
      distKm,
      etaS,
      closing,
    };
    if (!best || distKm < best.distKm) best = row;
  }
  return best;
}

export function spectrogramColumn(track: Track, bins = 64): number[] {
  const ac = track.acoustic;
  const out = new Array(bins).fill(0);
  if (!ac || !ac.locked) {
    for (let i = 0; i < bins; i++) out[i] = 0.04 + Math.random() * 0.1;
    return out;
  }
  const nyquist = 400;
  const peakBin = Math.min(bins - 2, Math.round((ac.bpfHz / nyquist) * bins));
  for (let i = 0; i < bins; i++) {
    const dist = Math.abs(i - peakBin);
    let v = Math.exp(-dist * dist / 6) * (0.45 + ac.snrDb / 80);
    const h2 = Math.abs(i - Math.min(bins - 1, peakBin * 2));
    v += Math.exp(-h2 * h2 / 5) * 0.28;
    if (ac.channel === "analog-fpv") {
      v += 0.08 + Math.random() * 0.12;
    }
    v += Math.random() * 0.06;
    out[i] = Math.min(1, v);
  }
  return out;
}

export function channelLabel(c: AudioChannel): string {
  switch (c) {
    case "acoustic":
      return "BPF hélices";
    case "analog-fpv":
      return "FPV analogique";
    case "blocked-crypto":
      return "Chiffré";
    case "none":
      return "Pas de lock";
  }
}
