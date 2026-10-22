import { LiveWatch } from "@/components/vigilair/live-watch";
import { WatchPoll } from "@/components/vigilair/watch-poll";
import { GuardWatch } from "@/components/vigilair/guard-watch";
import { ZoneWatch } from "@/components/vigilair/zone-watch";
import { WatchMode } from "@/components/vigilair/watch-mode";
import { IdleLock } from "@/components/vigilair/idle-lock";
import { ChefSealHost } from "@/components/vigilair/chef-seal";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { diffHeatmap } from "@/lib/vigilair/change-diff";
import { fetchChangePair } from "@/lib/vigilair/live-feeds";
import { fetchDroneFrame } from "@/lib/vigilair/drones-api";
import { dronesSnapshot, hydrateDrones, subscribeDrones } from "@/lib/vigilair/drones";
import { MINES } from "@/lib/vigilair/mines";
import { routeHazards } from "@/lib/vigilair/nav";
import { useVigilair } from "@/lib/vigilair/store";
import { startTelemetry } from "@/lib/vigilair/telemetry";
import type { Threat } from "@/lib/vigilair/types";
import { hydrateSensors, sensorsSnapshot, subscribeSensors } from "@/lib/vigilair/ground-sensors";
import { hydrateRoutes } from "@/lib/vigilair/routes";
import { hydrateFromServer, subscribeWatchSites, watchSitesSnapshot } from "@/lib/vigilair/watch-sites";

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
      <ChangeWatch />
      <SensorWatch />
      <DroneWatch />
    </>
  );
}

/**
 * Veille MOUVEMENT sur l'imagerie de NOS drones. Pour chaque drone qui expose une image fixe
 * (station sol / nacelle), récupère une trame via le proxy serveur, la compare à la précédente
 * (diff par pixel) et SONNE si une part du cadre a bougé au-delà du seuil. C'est de la détection de
 * MOUVEMENT / PRÉSENCE — jamais d'identification de personne ni de désignation. L'imagerie est une
 * SOURCE D'ANALYSE, pas un fond. Un drone par tick ; silencieux si pas d'URL ou station injoignable.
 */
function DroneWatch() {
  const on = useVigilair((s) => s.droneWatch);
  const threshold = useVigilair((s) => s.droneThreshold);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const setDroneMotion = useVigilair((s) => s.setDroneMotion);
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesSnapshot);
  const idx = useRef(0);
  const prevFrame = useRef<Map<string, ImageData>>(new Map());
  const lastAlert = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!on) return;
    const watched = drones.filter((d) => d.snapshotUrl);
    if (watched.length === 0) return;
    let dead = false;
    const PX = 128;

    const analyse = async () => {
      if (dead) return;
      const drone = watched[idx.current % watched.length]!;
      idx.current++;
      const url = drone.snapshotUrl!;
      try {
        const res = await fetchDroneFrame({ data: { url } });
        if (dead) return;
        if (!res.ok || !res.dataUrl) {
          setDroneMotion(drone.id, { pct: null, at: Date.now(), error: res.error ?? "trame indisponible" });
          return;
        }
        const img = await loadImage(res.dataUrl);
        if (dead) return;
        const off = document.createElement("canvas");
        off.width = PX;
        off.height = PX;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, PX, PX);
        const cur = ctx.getImageData(0, 0, PX, PX);
        const prev = prevFrame.current.get(drone.id);
        prevFrame.current.set(drone.id, cur);
        if (!prev) {
          // Première trame : on établit la référence, pas de mesure encore.
          setDroneMotion(drone.id, { pct: null, at: Date.now() });
          return;
        }
        const diff = diffHeatmap(prev.data, cur.data, PX, PX, { threshold: 34 });
        const pct = Math.round(diff.changedFrac * 1000) / 10;
        setDroneMotion(drone.id, { pct, at: Date.now() });
        if (pct >= threshold) {
          const last = lastAlert.current.get(drone.id) ?? 0;
          if (Date.now() - last > 10 * 60 * 1000) {
            lastAlert.current.set(drone.id, Date.now());
            pushAlert({
              id: `drone-motion-${drone.id}-${Date.now()}`,
              trackId: "",
              at: Date.now(),
              level: "elevee",
              title: "Mouvement détecté (imagerie drone)",
              body: `${drone.name} · ${pct}% du cadre a bougé · ${drone.site || "site"} · présence/mouvement, pas d'identification`,
              acked: false,
            });
            navBeep();
          }
        }
      } catch {
        if (!dead) setDroneMotion(drone.id, { pct: null, at: Date.now(), error: "analyse impossible" });
      }
    };

    const first = window.setTimeout(() => void analyse(), 4000);
    const timer = window.setInterval(() => void analyse(), 15_000); // un drone toutes les 15 s
    return () => {
      dead = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on, threshold, drones, pushAlert, setDroneMotion]);

  return null;
}

/** Capteurs sol : alerte quand un capteur passe en « alarme » (manuel aujourd'hui, matériel demain). */
function SensorWatch() {
  const sensors = useSyncExternalStore(subscribeSensors, sensorsSnapshot, sensorsSnapshot);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const alarmed = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  useEffect(() => {
    const now = new Set(sensors.filter((s) => s.state === "alarme").map((s) => s.id));
    if (!seeded.current) {
      seeded.current = true;
      alarmed.current = now;
      return;
    }
    for (const s of sensors) {
      if (s.state === "alarme" && !alarmed.current.has(s.id)) {
        pushAlert({
          id: `sensor-${s.id}-${Date.now()}`,
          trackId: "",
          at: Date.now(),
          level: "elevee",
          title: "Capteur sol en alarme",
          body: `${s.name} (${s.type}) · ${s.site}`,
          acked: false,
        });
      }
    }
    alarmed.current = now;
  }, [sensors, pushAlert]);
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image illisible"));
    img.src = src;
  });
}

/** Scanne un site : % du cadre qui a changé entre deux passages Sentinel-2. null si clé absente / échec. */
async function scanSiteChange(lat: number, lon: number, radiusKm: number): Promise<number | null> {
  const pair = await fetchChangePair({ data: { lat, lon, radiusKm } });
  if (!pair.ok) return null;
  const [before, after] = await Promise.all([loadImage(pair.before.dataUrl), loadImage(pair.after.dataUrl)]);
  const px = pair.px;
  const off = document.createElement("canvas");
  off.width = px;
  off.height = px;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(before, 0, 0, px, px);
  const b = ctx.getImageData(0, 0, px, px);
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(after, 0, 0, px, px);
  const a = ctx.getImageData(0, 0, px, px);
  const res = diffHeatmap(b.data, a.data, px, px, { threshold: 34 });
  return Math.round(res.changedFrac * 1000) / 10;
}

/**
 * Surveillance CHANGEMENT auto : passe en revue les sites (miniers + ajoutés), un par tick, compare
 * seul les deux passages Sentinel-2 et SONNE si la zone a bougé au-delà du seuil. Détection de
 * CHANGEMENT, pas d'objet ni d'identité. Nécessite la clé Copernicus ; sinon le scan ne renvoie rien.
 */
function ChangeWatch() {
  const on = useVigilair((s) => s.changeWatch);
  const threshold = useVigilair((s) => s.changeThreshold);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const custom = useSyncExternalStore(subscribeWatchSites, watchSitesSnapshot, watchSitesSnapshot);
  const idx = useRef(0);
  const lastAlert = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!on) return;
    const sites = [
      ...MINES.map((m) => ({ id: m.id, name: m.short, lat: m.lat, lon: m.lon, radiusKm: m.radiusKm })),
      ...custom.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, radiusKm: s.radiusKm })),
    ];
    if (sites.length === 0) return;
    let dead = false;
    const scan = async () => {
      if (dead) return;
      const site = sites[idx.current % sites.length]!;
      idx.current++;
      let pct: number | null = null;
      try {
        pct = await scanSiteChange(site.lat, site.lon, site.radiusKm);
      } catch {
        pct = null;
      }
      if (dead || pct == null) return;
      if (pct >= threshold) {
        const last = lastAlert.current.get(site.id) ?? 0;
        if (Date.now() - last > 6 * 3600 * 1000) {
          lastAlert.current.set(site.id, Date.now());
          pushAlert({
            id: `site-change-${site.id}-${Date.now()}`,
            trackId: "",
            at: Date.now(),
            level: "elevee",
            title: "Changement détecté au site",
            body: `${site.name} · ${pct}% du cadre a changé (Sentinel-2) · ouvrir le comparateur avant/après`,
            acked: false,
            lat: site.lat,
            lon: site.lon,
          });
        }
      }
    };
    const first = window.setTimeout(() => void scan(), 8000);
    const timer = window.setInterval(() => void scan(), 180_000); // un site toutes les 3 min
    return () => {
      dead = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on, threshold, custom, pushAlert]);

  return null;
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
      void hydrateSensors();
      void hydrateDrones();
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  return null;
}
