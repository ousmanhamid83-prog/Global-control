/**
 * Télémétrie du poste, côté navigateur : fraîcheur de chaque liaison, historique court pour les
 * mini-courbes, fil des événements. Tout est dérivé du store ; rien n'est écrit, rien n'est émis.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { computePosture, postureLabel } from "./defense";
import type { SourceHealth } from "./live-adsb";
import { detectRaids } from "./raid";
import { useVigilair } from "./store";

export type LinkState = "live" | "silence" | "injoignable" | "attente";
export type Freshness = "live" | "retard" | "perdu";
export type TelemetrySample = { at: number; tracks: number; alerts: number; links: number };
export type TelemetryEvent = {
  id: string;
  at: number;
  tone: "ok" | "warn" | "crit" | "info";
  text: string;
};
export type FeedTone = "ok" | "warn" | "crit" | "idle";
export type FeedStatus = { tone: FeedTone; text: string };
export type Telemetry = {
  lastOk: Record<string, number>;
  samples: TelemetrySample[];
  events: TelemetryEvent[];
};

/** Le poste interroge les flux toutes les 12 s : au-delà de 30 s la donnée retarde, de 2 min elle est perdue. */
export const FRESH_MS = 30_000;
export const STALE_MS = 120_000;
const SAMPLE_EVERY = 6_000;
const SAMPLE_MAX = 60;
const EVENT_MAX = 40;

export const LINK_LABEL: Record<LinkState, string> = {
  live: "live",
  silence: "silence",
  injoignable: "injoignable",
  attente: "en attente",
};

/** Une source muette n'est pas une source coupée : l'erreur réseau ou HTTP se dit à part. */
export function linkState(s: SourceHealth | undefined): LinkState {
  if (!s) return "attente";
  if (s.ok) return "live";
  if (/\b[45]\d\d\b|fetch|network|réseau|timeout|abort|ECONN|ENOTFOUND|refus/i.test(s.detail)) {
    return "injoignable";
  }
  return "silence";
}

export function freshness(ageMs: number): Freshness {
  if (ageMs <= FRESH_MS) return "live";
  if (ageMs <= STALE_MS) return "retard";
  return "perdu";
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Donnée moteur (pistes, alertes) : vivante tant que le flux tourne. */
export function streamStatus(running: boolean, replay: boolean): FeedStatus {
  if (replay) return { tone: "warn", text: "Relecture AAR" };
  return running ? { tone: "ok", text: "Live" } : { tone: "warn", text: "Figé · pause" };
}

/** Donnée de liaison : son âge réel, mesuré sur le dernier relevé utile. */
export function ageStatus(at: number | null | undefined, wall: number): FeedStatus {
  if (!at) return { tone: "idle", text: "Aucun relevé" };
  const age = wall - at;
  const f = freshness(age);
  if (f === "live") return { tone: "ok", text: `Live · ${formatAge(age)}` };
  if (f === "retard") return { tone: "warn", text: `Retard · ${formatAge(age)}` };
  return { tone: "crit", text: `Perdu · ${formatAge(age)}` };
}

const g = globalThis as unknown as { __vigilairTelemetry?: Telemetry };
const state: Telemetry = (g.__vigilairTelemetry ??= { lastOk: {}, samples: [], events: [] });
let snapshot: Telemetry = { ...state };
const listeners = new Set<() => void>();

function publish() {
  snapshot = {
    lastOk: { ...state.lastOk },
    samples: [...state.samples],
    events: [...state.events],
  };
  for (const l of listeners) l();
}

function pushEvent(e: TelemetryEvent) {
  if (state.events.some((x) => x.id === e.id)) return;
  state.events = [e, ...state.events].sort((a, b) => b.at - a.at).slice(0, EVENT_MAX);
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function telemetrySnapshot(): Telemetry {
  return snapshot;
}

export function useTelemetry(): Telemetry {
  return useSyncExternalStore(subscribeTelemetry, telemetrySnapshot, telemetrySnapshot);
}

/** Horloge murale qui avance même quand le flux est en pause : les âges de données défilent. */
export function useWallClock(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

let running = false;

export function startTelemetry(): () => void {
  if (running || typeof window === "undefined") return () => {};
  running = true;

  let picAt = 0;
  const links: Record<string, LinkState> = {};
  const seen = new Set<string>();
  let posture = "";
  let raid = false;

  const onStore = () => {
    const st = useVigilair.getState();
    let changed = false;

    const pic = st.livePicture;
    if (pic && pic.at !== picAt) {
      picAt = pic.at;
      for (const s of pic.sources) {
        if (s.ok) state.lastOk[s.id] = pic.at;
        const next = linkState(s);
        const before = links[s.id];
        if (before && before !== next) {
          pushEvent({
            id: `link-${s.id}-${pic.at}`,
            at: pic.at,
            tone: next === "live" ? "ok" : next === "injoignable" ? "warn" : "info",
            text: `${s.label} · ${LINK_LABEL[before]} → ${LINK_LABEL[next]}`,
          });
        }
        links[s.id] = next;
      }
      changed = true;
    }

    for (const a of st.alerts) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      pushEvent({
        id: `al-${a.id}`,
        at: a.at,
        tone: a.level === "critique" ? "crit" : a.level === "elevee" ? "warn" : "info",
        text: a.title,
      });
      changed = true;
    }

    const p = computePosture(st.tracks).posture;
    if (p !== posture) {
      if (posture) {
        pushEvent({
          id: `posture-${p}-${Date.now()}`,
          at: Date.now(),
          tone: p === "menace" ? "crit" : p === "alerte" ? "warn" : "ok",
          text: `Posture · ${postureLabel(p)}`,
        });
      }
      posture = p;
      changed = true;
    }

    const r = detectRaids(st.tracks)[0];
    if (Boolean(r) !== raid) {
      raid = Boolean(r);
      pushEvent({
        id: `raid-${raid ? "on" : "off"}-${Date.now()}`,
        at: Date.now(),
        tone: raid ? "crit" : "ok",
        text: r ? `Raid ${r.corridor} · ${r.count} pistes` : "Fin du raid",
      });
      changed = true;
    }

    if (changed) publish();
  };

  const sample = () => {
    const st = useVigilair.getState();
    state.samples = [
      ...state.samples,
      {
        at: Date.now(),
        tracks: st.tracks.filter((t) => t.idState !== "perdu").length,
        alerts: st.alerts.filter((a) => !a.acked).length,
        links: st.livePicture?.sources.filter((s) => s.ok).length ?? 0,
      },
    ].slice(-SAMPLE_MAX);
    publish();
  };

  const unsub = useVigilair.subscribe(onStore);
  onStore();
  sample();
  const id = window.setInterval(sample, SAMPLE_EVERY);
  return () => {
    unsub();
    window.clearInterval(id);
    running = false;
  };
}
