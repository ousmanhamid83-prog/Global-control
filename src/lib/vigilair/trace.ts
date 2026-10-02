import { PLATFORM_BY_ID } from "./catalog";
import { destPoint, formatCoord, formatCoordShort, haversineKm } from "./geo";
import { formatDate } from "./format";
import { SAT_CREDIT, tileRef } from "./tiles";
import type { EvidencePack, TraceFix, Track } from "./types";

export const SAR_NOTE =
  "Sentinel-1 C-SAR GRD — appui tout-temps, nuit et harmattan. Pas une scène taskée du jour.";

export const SCENE_NOTE =
  "Fond optique : mosaïque Sentinel-2 cloudless 2023 (Copernicus / EOX). Les plots SRC / TEL / ARR sont horodatés au versement. Une scène S2 / S1 du jour se demande hors VIGILAIR.";

export function makeLaunchFix(
  lat: number,
  lon: number,
  heading: number,
  now: number,
  platformId: string,
): TraceFix {
  const plat = PLATFORM_BY_ID[platformId];
  const back = (heading + 180) % 360;
  let dist = 7;
  if (plat?.uasClass === "loitering") dist = 18 + (platformId.length % 12);
  else if (plat?.uasClass === "male" || plat?.uasClass === "ucav") dist = 22;
  else if (plat?.uasClass === "chasse") dist = 40;
  else if (plat?.role === "consumer") dist = 1.2 + (platformId.length % 5) / 4;
  const p = destPoint(lat, lon, back, dist);
  return {
    lat: p.lat,
    lon: p.lon,
    at: now - Math.round(dist / Math.max(0.04, (plat?.cruiseKmh ?? 80) / 3600)) * 1000,
    quality: plat?.uasClass === "chasse" ? 42 : 68,
    method: plat?.role === "consumer" ? "Home point RF" : "Rétro-cinématique + gonio",
    predicted: true,
  };
}

export function makeStopFix(track: Track, now: number): TraceFix {
  if (track.idState === "perdu") {
    return {
      lat: track.lat,
      lon: track.lon,
      at: now,
      quality: 88,
      method: "Dernier plot radar/RF",
      predicted: false,
    };
  }
  if (track.ew?.state === "effet") {
    const ahead = Math.min(4, Math.max(0.8, track.speedKmh / 70));
    const p = destPoint(track.lat, track.lon, track.heading, ahead);
    return {
      lat: p.lat,
      lon: p.lon,
      at: now + Math.round((ahead / Math.max(0.02, track.speedKmh / 3600)) * 1000),
      quality: 62,
      method: "Arrêt prévu · liaison C2 dégradée (effet RF externe)",
      predicted: true,
    };
  }
  if (track.cpa?.closing && track.cpa.etaS && track.cpa.etaS < 900) {
    const p = destPoint(track.lat, track.lon, track.heading, (track.speedKmh / 3600) * track.cpa.etaS);
    return {
      lat: p.lat,
      lon: p.lon,
      at: now + Math.round(track.cpa.etaS * 1000),
      quality: 55,
      method: `CPA prévu · ${track.cpa.name}`,
      predicted: true,
    };
  }
  const ahead = Math.min(12, Math.max(2, track.speedKmh / 40));
  const p = destPoint(track.lat, track.lon, track.heading, ahead);
  return {
    lat: p.lat,
    lon: p.lon,
    at: now + Math.round((ahead / Math.max(0.03, track.speedKmh / 3600)) * 1000),
    quality: 40,
    method: "Extrapolation cap/vitesse",
    predicted: true,
  };
}

export function evidenceOf(track: Track): EvidencePack | null {
  if (!track.launchFix || !track.stopFix) return null;
  return {
    satScene: "Sentinel-2 cloudless 2023 · tuile Copernicus / EOX",
    satCredit: SAT_CREDIT,
    sarNote: SAR_NOTE,
    sceneNote: SCENE_NOTE,
    launch: track.launchFix,
    stop: track.stopFix,
    c2: track.pilotFix,
    path: track.trail,
    sensors: track.sensors,
    method: [
      track.launchFix.method,
      track.pilotFix?.method,
      "fond Sentinel-2 Copernicus",
    ]
      .filter(Boolean)
      .join(" · "),
    launchTile: tileRef(track.launchFix.lat, track.launchFix.lon),
    c2Tile: track.pilotFix
      ? tileRef(track.pilotFix.lat, track.pilotFix.lon)
      : null,
    stopTile: tileRef(track.stopFix.lat, track.stopFix.lon),
  };
}

export function evidenceText(track: Track): string {
  const ev = evidenceOf(track);
  const plat = PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  if (!ev) return "";
  const dLaunch = haversineKm(ev.launch.lat, ev.launch.lon, track.lat, track.lon);
  const dStop = haversineKm(track.lat, track.lon, ev.stop.lat, ev.stop.lon);
  const dC2 = ev.c2
    ? haversineKm(ev.c2.lat, ev.c2.lon, track.lat, track.lon)
    : null;
  const lines = [
    `VIGILAIR · fiche de preuve · ${track.callsign}`,
    plat ? `${plat.manufacturer} ${plat.name} · ${plat.originLabel}` : "",
    `Lancement SRC : ${formatCoord(ev.launch.lat, ev.launch.lon)} · ${formatDate(ev.launch.at)} · ${ev.launch.method} · ${ev.launchTile}`,
    ev.c2
      ? `Source C2 / TEL : ${formatCoord(ev.c2.lat, ev.c2.lon)} · ${ev.c2.method} · ${dC2?.toFixed(2)} km de l'objet · ${ev.c2Tile}`
      : "Source C2 : non géolocalisée",
    `Position actuelle : ${formatCoord(track.lat, track.lon)} · ${Math.round(track.altM)} m · ${Math.round(track.speedKmh)} km/h · cap ${Math.round(track.heading)}°`,
    `Distance SRC → actuel : ${dLaunch.toFixed(2)} km`,
    `Arrêt ${ev.stop.predicted ? "prévu" : "constaté"} ARR : ${formatCoord(ev.stop.lat, ev.stop.lon)} · ${formatDate(ev.stop.at)} · ${ev.stop.method} · ${dStop.toFixed(2)} km`,
    `Capteurs : ${track.sensors.join(", ") || "—"}`,
    ev.satScene,
    ev.sceneNote,
    ev.sarNote,
    track.ew?.state === "effet"
      ? "Effet RF simulé (effecteur externe) — VIGILAIR n'émet pas."
      : "Écoute SIGINT passive — pas de prise de contrôle.",
    "Pas de brouillage émis par VIGILAIR. Pas d'injection C2.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatCoordShortPair(lat: number, lon: number): string {
  return formatCoordShort(lat, lon);
}
