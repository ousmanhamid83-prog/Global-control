/** La méthode d'identification d'une piste RÉELLE, dite en une ligne. AfriControl n'émet pas. */
import { PLATFORM_BY_ID } from "./catalog.ts";
import type { Track } from "./types";

export function methodBlurb(track: Track): string {
  if (track.exercice) {
    const p = PLATFORM_BY_ID[track.exercice.plateforme];
    const joue = p ? `${p.manufacturer} ${p.name}` : track.exercice.plateforme;
    return `EXERCICE · vol réel de notre drone ${track.exercice.drone} (liaison MAVLink), joue ${joue} · pas un contact réel`;
  }
  const iff = track.iff;
  const quoi =
    track.feed === "rejeu"
      ? "REJEU RÉEL 1090ES (trafic réellement reçu, rejoué : pas un contact live)"
      : track.sensors.includes("antenne")
        ? "1090ES en direct, antenne du poste"
        : "1090ES en direct, relevé réseau";
  const nic = track.nic != null ? `NIC ${track.nic}` : "NIC —";
  const nat = track.nation ? ` · ${track.nation}` : "";
  const mil = track.military ? " · militaire (dbFlags)" : "";
  return `${quoi} · ${iff?.flightId ?? track.callsign} · ${iff?.icao24 ?? "—"} · squawk ${iff?.squawk ?? "—"} · ${nic} · réception passive, AfriControl n'émet pas${nat}${mil}`;
}
