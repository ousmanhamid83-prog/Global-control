import { LiveWatch } from "@/components/vigilair/live-watch";
import { WatchPoll } from "@/components/vigilair/watch-poll";
import { GuardWatch } from "@/components/vigilair/guard-watch";
import { ZoneWatch } from "@/components/vigilair/zone-watch";
import { WatchMode } from "@/components/vigilair/watch-mode";
import { IdleLock } from "@/components/vigilair/idle-lock";
import { ChefSealHost } from "@/components/vigilair/chef-seal";
import { useEffect, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { routeHazards } from "@/lib/vigilair/nav";
import { useVigilair } from "@/lib/vigilair/store";
import { startTelemetry } from "@/lib/vigilair/telemetry";
import type { Threat } from "@/lib/vigilair/types";
import { hydrateRoutes } from "@/lib/vigilair/routes";
import { hydrateFromServer } from "@/lib/vigilair/watch-sites";

/** Survives les changements de route — AppShell se démonte, pas le 1090 ni le quart. */
export function VigilairRuntime() {
  const { user, isPending } = useCurrentUserState();
  if (isPending || !user) return null;
  return (
    <>
      <LiveWatch />
      <TelemetryWatch />
      <WatchPoll />
      <GuardWatch />
      <ZoneWatch />
      <WatchMode />
      <IdleLock />
      <ChefSealHost />
      <WatchSitesHydrate />
      <NavWatch />
    </>
  );
}

/** Bip court (WebAudio) — deux tons descendants. Silencieux si le navigateur bloque le son. */
function navBeep() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    g.gain.value = 0.07;
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(620, ctx.currentTime + 0.16);
    o.start();
    o.stop(ctx.currentTime + 0.32);
    window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    /* pas de son disponible : l'alerte visuelle suffit */
  }
}

/**
 * Surveille la ROUTE ACTIVE : quand un phénomène réel surgit à moins de 25 km de l'axe (et qu'il
 * n'y était pas), pousse une alerte dans le bandeau et sonne (si l'alarme est armée). Toujours monté,
 * donc ça guide même quand on n'est pas sur l'onglet Navigation. Réception seule.
 */
function NavWatch() {
  const navRoute = useVigilair((s) => s.navRoute);
  const phenomena = useVigilair((s) => s.phenomena);
  const navAlarm = useVigilair((s) => s.navAlarm);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const seen = useRef<Set<string>>(new Set());
  const sig = useRef<string>("");

  useEffect(() => {
    if (!navRoute || navRoute.points.length < 2) {
      seen.current.clear();
      sig.current = "";
      return;
    }
    // Clé POSITIONNELLE (lieu + type) : un même foyer ne re-sonne pas même si son id change d'un relevé à l'autre.
    const keyOf = (h: { kind: string; lat: number; lon: number }) => `${h.kind}:${h.lat.toFixed(2)},${h.lon.toFixed(2)}`;
    const haz = routeHazards(
      navRoute.points,
      phenomena.map((p) => ({ id: p.id, kind: p.kind, level: p.level, lat: p.lat, lon: p.lon, title: p.title })),
      25,
      5,
    );
    const nextSig = JSON.stringify(navRoute.points);
    if (nextSig !== sig.current) {
      // route changée : on repart sur un suivi neuf (les obstacles présents ne re-sonnent pas en boucle)
      sig.current = nextSig;
      seen.current = new Set(haz.map(keyOf));
      return;
    }
    const fresh = haz.filter((h) => !seen.current.has(keyOf(h)));
    for (const h of haz) seen.current.add(keyOf(h));
    if (fresh.length > 0) {
      const h0 = fresh[0]!;
      pushAlert({
        id: `nav-haz-${keyOf(h0)}`,
        trackId: "",
        at: Date.now(),
        level: (h0.level as Threat) ?? "elevee",
        title: "Obstacle sur la route active",
        body: `${h0.title} · à ${Math.round(h0.alongKm)} km sur l'axe · ${Math.round(h0.offsetKm)} km à ${h0.side} · dévier ou demi-tour`,
        acked: false,
        lat: h0.lat,
        lon: h0.lon,
      });
      if (navAlarm) navBeep();
    }
  }, [navRoute, phenomena, navAlarm, pushAlert]);

  return null;
}

/** Fraîcheur des liaisons, historique court et fil d'événements de la console. */
function TelemetryWatch() {
  useEffect(() => startTelemetry(), []);
  return null;
}

/** Charge les sites surveillés partagés du poste au démarrage, et re-synchronise au retour de focus. */
function WatchSitesHydrate() {
  useEffect(() => {
    const sync = () => {
      void hydrateFromServer();
      void hydrateRoutes();
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  return null;
}
