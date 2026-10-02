/** Fusion capteurs → identification. VIGILAIR n'émet pas. */
import { OUT_OF_MANDATE, PLATFORMS, PLATFORM_BY_ID } from "./catalog";
import { haversineKm } from "./geo";
import { iffEvidenceLine } from "./mode-s";
import { SENSOR_SITES } from "./sensors";
import type { Hypothesis, SensorKind, Track } from "./types";

export function coveringSensors(lat: number, lon: number): SensorKind[] {
  const seen = new Set<SensorKind>();
  for (const s of SENSOR_SITES) {
    if (!s.online) continue;
    if (haversineKm(lat, lon, s.lat, s.lon) <= s.rangeKm) seen.add(s.kind);
  }
  return [...seen];
}

export function pickTruePlatform(): string {
  const roll = Math.random();
  if (roll < 0.07 && OUT_OF_MANDATE.length > 0) {
    return OUT_OF_MANDATE[Math.floor(Math.random() * OUT_OF_MANDATE.length)]!.id;
  }
  const chasse = PLATFORMS.filter((p) => p.uasClass === "chasse");
  const male = PLATFORMS.filter(
    (p) => p.uasClass === "male" || p.uasClass === "ucav" || p.uasClass === "loitering",
  );
  const rest = PLATFORMS.filter(
    (p) =>
      p.uasClass !== "chasse" &&
      p.uasClass !== "male" &&
      p.uasClass !== "ucav" &&
      p.uasClass !== "loitering",
  );
  const bag =
    roll < 0.16 && chasse.length
      ? chasse
      : roll < 0.48 && male.length
        ? male
        : rest.length
          ? rest
          : PLATFORMS;
  return bag[Math.floor(Math.random() * bag.length)]!.id;
}

function scoreAgainst(track: Track, platformId: string): number {
  const plat = PLATFORM_BY_ID[platformId];
  if (!plat) return 0;
  let s = 18;
  if (track.classGuess && track.classGuess === plat.uasClass) s += 22;
  if (track.origin && track.origin === plat.origin) s += 16;
  if (track.sensors.includes("rf")) s += 14;
  if (track.sensors.includes("radar")) s += 10;
  if (track.sensors.includes("eoir")) s += 8;
  if (track.sensors.includes("acoustic")) s += 6;
  if (plat.id === track.truePlatformId) {
    s += 18 + Math.min(28, track.dwellS * 1.4);
  } else {
    s += (Math.abs(hashStr(platformId) % 17) - 8) * 0.4;
  }
  return Math.max(4, Math.min(99, s));
}

function hashStr(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hypothesesFor(track: Track, topScore: number): Hypothesis[] {
  const trueId = track.truePlatformId;
  const pool = PLATFORMS.filter((p) => !p.friendKind);
  const sameClass = pool.filter((p) => p.uasClass === (track.classGuess ?? PLATFORM_BY_ID[trueId]?.uasClass));
  const candidates = (sameClass.length >= 3 ? sameClass : pool).slice();
  if (!candidates.some((p) => p.id === trueId)) {
    const tp = PLATFORM_BY_ID[trueId];
    if (tp && !tp.friendKind) candidates.push(tp);
  }
  const scored = candidates
    .map((p) => ({
      platformId: p.id,
      score: p.id === trueId ? topScore : Math.min(topScore - 6, scoreAgainst(track, p.id)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored;
}

export function advanceIdentification(track: Track): Track {
  if (track.friendKind) return track;
  if (track.idState === "perdu") return track;
  const plat = PLATFORM_BY_ID[track.truePlatformId];
  if (!plat) return track;

  const nSens = Math.max(1, track.sensors.length);
  const boost = nSens >= 3 ? 1.2 : nSens === 2 ? 1.05 : 0.88;
  const dwell = track.dwellS;
  let idState = track.idState;
  let confidence = track.confidence;
  let classGuess = track.classGuess;
  let origin = track.origin;

  if (idState === "detecte" && dwell > 2.4 / boost) {
    idState = "classification";
    classGuess = plat.uasClass;
    confidence = Math.max(confidence, 26 + nSens * 2);
  }
  if (
    (idState === "classification" || idState === "detecte") &&
    dwell > 6.2 / boost
  ) {
    idState = "candidat";
    classGuess = plat.uasClass;
    origin = plat.origin;
    confidence = Math.max(confidence, 48 + nSens * 3);
  }
  if (idState === "candidat" && dwell > 12.4 / boost) {
    classGuess = plat.uasClass;
    origin = plat.origin;
    if (plat.origin === "XX") {
      idState = "hors-mandat";
      confidence = Math.max(confidence, 68 + nSens * 2);
    } else {
      idState = "confirme";
      confidence = Math.min(96, Math.max(confidence, 76 + nSens * 3));
    }
  }
  if (idState === "confirme" || idState === "hors-mandat") {
    confidence = Math.min(97, Math.max(confidence, 76 + Math.min(14, dwell * 0.15)));
    origin = plat.origin;
    classGuess = plat.uasClass;
  }

  const hyps =
    idState === "detecte"
      ? []
      : hypothesesFor(
          { ...track, classGuess, origin, idState, confidence },
          Math.round(confidence),
        );

  return {
    ...track,
    idState,
    confidence: Math.round(confidence),
    classGuess,
    origin,
    hypotheses: hyps,
  };
}

export function methodBlurb(track: Track): string {
  if (track.feed === "adsb") {
    const iff = track.iff;
    const nic = track.nic != null ? `NIC ${track.nic}` : "NIC —";
    const nat = track.nation ? ` · ${track.nation}` : "";
    const mil = track.military ? " · militaire (dbFlags)" : "";
    return `ADS-B 1090ES live · ${iff?.flightId ?? track.callsign} · ${iff?.icao24 ?? "—"} · squawk ${iff?.squawk ?? "—"} · ${nic} · pas de Mode 4 · réseau passif, VIGILAIR n'émet pas${nat}${mil}`;
  }
  if (track.friendKind === "fatl") {
    const iff = track.iff;
    const mlat = iff?.mlat
      ? iff.mlat.spoofSuspect
        ? " · MLAT désaccord"
        : ` · MLAT ${iff.mlat.nSites} sites`
      : "";
    return `Corrélation IFF FATL Mode 4 · squawk ${iff?.squawk ?? "—"} · ${iff?.m4 === "valid" ? "crypto valide" : "Mode 4 à confirmer"} · EHS ${iff?.icao24 ?? "—"} · affiliation Tchad (origine constructeur distincte)${mlat}`;
  }
  if (track.friendKind === "asecna") {
    const iff = track.iff;
    const mlat = iff?.mlat
      ? ` · MLAT ${iff.mlat.nSites} sites, résidu ${iff.mlat.residualKm.toFixed(2)} km`
      : "";
    return `ADS-B 1090ES / Mode S · ${iff?.flightId ?? track.callsign} · squawk ${iff?.squawk ?? "—"} · pas de Mode 4 · inject ASECNA (FIR FTTT, pas un flux live)${mlat}`;
  }
  const bits: string[] = [];
  if (track.sensors.includes("rf")) bits.push("empreinte RF / protocole");
  if (track.sensors.includes("radar")) bits.push("enveloppe radar 3D");
  if (track.sensors.includes("eoir")) bits.push("silhouette EO/IR");
  if (track.sensors.includes("acoustic")) bits.push("BPF acoustique");
  if (track.acoustic?.channel === "analog-fpv") bits.push("sous-porteuse analogique");
  if (track.pilotFix) bits.push("gonio TEL");
  if (track.launchFix) bits.push("rétro-cinématique SRC");
  bits.push("scène Sentinel-2");
  bits.push("cinématique");
  const iff = iffEvidenceLine(track);
  const fusion = `Fusion ${bits.join(" · ")}`;
  return iff ? `${fusion} · ${iff}` : fusion;
}
