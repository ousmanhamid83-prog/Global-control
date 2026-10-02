import type { Origin, Threat } from "./types";

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Ndjamena",
  });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Ndjamena",
  });
}

export function formatWatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Ndjamena",
  });
}

/** Niveau de vol : altitude / 100 ft. 1 FL = 30,48 m. */
export function formatFl(altM: number): string {
  const fl = Math.max(0, Math.round(altM / 30.48));
  return `FL${String(fl).padStart(3, "0")}`;
}

export function altToFl(altM: number): number {
  return Math.max(0, altM / 30.48);
}

export function kmhToKt(kmh: number): number {
  return kmh / 1.852;
}

export function originTone(o: Origin | null): "cn" | "tr" | "ru" | "ir" | "xx" | "default" {
  if (o === "CN") return "cn";
  if (o === "TR") return "tr";
  if (o === "RU") return "ru";
  if (o === "IR") return "ir";
  if (o === "XX") return "xx";
  return "default";
}

export function threatTone(t: Threat): "ok" | "warn" | "crit" | "default" {
  if (t === "faible") return "ok";
  if (t === "moderee") return "warn";
  if (t === "elevee" || t === "critique") return "crit";
  return "default";
}

export function formatHash(hex: string): string {
  const h = hex.toLowerCase();
  if (h.length < 16) return h;
  return `${h.slice(0, 8)} · ${h.slice(-8)}`;
}
