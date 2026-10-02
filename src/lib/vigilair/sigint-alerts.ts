import type { AlertItem, Threat } from "./types.ts";

const WATCH = new Set(["aco", "fpv-a", "fpv-v", "tlm", "rid", "meta", "gnss", "sat"]);

export type LockStream = {
  id: string;
  label: string;
  state: "lock" | "scan" | "denied";
  detail: string;
};

/** Un verrou d'écoute = une alerte. Le set `warned` empêche le doublon. */
export function collectSigintAlerts(opts: {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  threat?: Threat;
  streams: LockStream[];
  now: number;
  warned: Set<string>;
}): AlertItem[] {
  const out: AlertItem[] = [];
  for (const stream of opts.streams) {
    if (stream.state !== "lock" || !WATCH.has(stream.id)) continue;
    const key = `${opts.id}:${stream.id}`;
    if (opts.warned.has(key)) continue;
    opts.warned.add(key);
    const level: Threat =
      stream.id === "rid"
        ? "faible"
        : stream.id === "gnss" || stream.id === "aco"
          ? "moderee"
          : opts.threat === "critique" || opts.threat === "elevee"
            ? opts.threat
            : "moderee";
    out.push({
      id: `al-sig-${opts.id}-${stream.id}`,
      trackId: opts.id,
      at: opts.now,
      level,
      title: `SIGINT · ${stream.label} · ${opts.callsign}`,
      body: stream.detail,
      acked: false,
      domain: "sigint",
      lat: opts.lat,
      lon: opts.lon,
    });
  }
  return out;
}
