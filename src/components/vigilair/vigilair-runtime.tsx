import { LiveWatch } from "@/components/vigilair/live-watch";
import { WatchPoll } from "@/components/vigilair/watch-poll";
import { GuardWatch } from "@/components/vigilair/guard-watch";
import { ZoneWatch } from "@/components/vigilair/zone-watch";
import { WatchMode } from "@/components/vigilair/watch-mode";
import { IdleLock } from "@/components/vigilair/idle-lock";
import { ChefSealHost } from "@/components/vigilair/chef-seal";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { allBlobs, blobStats, diffHeatmap, foregroundDiff, frameHeading, isGlobalChange, mergeNearbyBlobs, presenceHint } from "@/lib/vigilair/change-diff";
import { createRing, medianBackground, pushLuma, type FrameRing } from "@/lib/vigilair/motion-bg";
import { confirmedTracks, detectOcclusions, isStationary, stepTracker, type Track2D } from "@/lib/vigilair/track2d";
import { inArmWindow, pointInPolygon } from "@/lib/vigilair/zones2d";
import { fetchChangePair } from "@/lib/vigilair/live-feeds";
import { fetchDroneFrame } from "@/lib/vigilair/drones-api";
import { dronesSnapshot, effectiveUrl, hydrateDrones, scanRangeClient, sourceArmRule, sourceZones, subscribeDrones } from "@/lib/vigilair/drones";
import { hydrateSiteNets, recordSiteScan, siteNetsSnapshot, subscribeSiteNets } from "@/lib/vigilair/sitenets";
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
      <SiteNetWatch />
    </>
  );
}

/**
 * Re-scan PÉRIODIQUE des sites distants (plages réseau mémorisées). À chaque tour, balaie chaque site,
 * compare aux caméras vues au tour précédent et SONNE si une caméra est TOMBÉE (disparue) ou si une
 * NOUVELLE est apparue sur le périmètre. C'est de la présence d'ÉQUIPEMENT réseau — jamais d'identité.
 * Silencieux si désactivé ou si aucun site mémorisé. Cadence en minutes (balayage lourd, on espace).
 */
function SiteNetWatch() {
  const on = useVigilair((s) => s.siteNetWatch);
  const cadenceMin = useVigilair((s) => s.siteNetCadenceMin);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const sites = useSyncExternalStore(subscribeSiteNets, siteNetsSnapshot, siteNetsSnapshot);
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  useEffect(() => {
    void hydrateSiteNets();
  }, []);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const period = Math.max(1, Math.min(120, cadenceMin || 15)) * 60 * 1000;
    const run = async () => {
      for (const s of sitesRef.current) {
        if (cancelled) return;
        try {
          const res = await scanRangeClient(s.range);
          if (res.error) continue;
          const addrs = res.cameras.map((c) => `${c.host}:${c.port}`);
          const diff = await recordSiteScan(s.id, addrs);
          if (cancelled) return;
          if (diff.removed.length || diff.added.length) {
            const parts: string[] = [];
            if (diff.removed.length) parts.push(`${diff.removed.length} caméra(s) TOMBÉE(S) : ${diff.removed.join(", ")}`);
            if (diff.added.length) parts.push(`${diff.added.length} NOUVELLE(S) : ${diff.added.join(", ")}`);
            pushAlert({
              id: `sitenet-${s.id}-${Date.now()}`,
              trackId: "",
              at: Date.now(),
              level: diff.removed.length ? "critique" : "elevee",
              title: `${s.name} · changement caméras réseau`,
              body: `${parts.join(" · ")}. Présence réseau (équipement) sur le périmètre, sans identité.`,
              acked: false,
            });
          }
        } catch {
          /* site injoignable : on réessaie au prochain tour */
        }
      }
    };
    const first = window.setTimeout(() => void run(), 5000);
    const timer = window.setInterval(() => void run(), period);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on, cadenceMin, pushAlert]);
  return null;
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
  const cadence = useVigilair((s) => s.droneCadence);
  const nightOnly = useVigilair((s) => s.droneNightOnly);
  const armFrom = useVigilair((s) => s.droneArmFrom);
  const armTo = useVigilair((s) => s.droneArmTo);
  const pushAlert = useVigilair((s) => s.pushAlert);
  const setDroneMotion = useVigilair((s) => s.setDroneMotion);
  const pushDroneLog = useVigilair((s) => s.pushDroneLog);
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesSnapshot);
  const idx = useRef(0);
  /** Fond MULTI-TRAMES par drone (anneau de N trames → médiane) + nombre de trames vues (warmup). */
  const ringRef = useRef<Map<string, FrameRing>>(new Map());
  const warmRef = useRef<Map<string, number>>(new Map());
  const lastAlert = useRef<Map<string, number>>(new Map());
  /** Trames consécutives où la zone d'une présence immobile est VIDE (→ elle est partie, on libère). */
  const emptyStreak = useRef<Map<string, number>>(new Map());
  /** Pistage multi-cibles, par drone (sans identité) : pistes en cours, prochain id, heure du relevé. */
  const tracksRef = useRef<Map<string, Track2D[]>>(new Map());
  const seedRef = useRef<Map<string, number>>(new Map());
  const lastAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!on) return;
    const watched = drones.filter((d) => effectiveUrl(d));
    if (watched.length === 0) return;
    let dead = false;
    const PX = 128;

    const norm = (s?: string) => (s ?? "").trim().toLowerCase();
    /** Le site du drone est-il un PÉRIMÈTRE ARMÉ (mine, ou site surveillé armé) ? → alerte critique. */
    const isArmedPerimeter = (site?: string) => {
      const s = norm(site);
      if (!s) return false;
      if (MINES.some((m) => norm(m.short) === s || norm(m.name) === s)) return true;
      return watchSitesSnapshot().some((w) => norm(w.name) === s && w.armed !== false);
    };

    const analyse = async () => {
      if (dead) return;
      const drone = watched[idx.current % watched.length]!;
      idx.current++;
      const url = effectiveUrl(drone)!;
      try {
        const res = await fetchDroneFrame({ data: { url } });
        if (dead) return;
        if (!res.ok || !res.dataUrl) {
          setDroneMotion(drone.id, { pct: null, at: Date.now(), error: res.error ?? "trame indisponible" });
          pushDroneLog(drone.id, { at: Date.now(), ok: false, msg: res.error ?? "trame indisponible" });
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
        // Fond MULTI-TRAMES : la médiane des N dernières trames. Un objet qui traverse ne décale pas
        // la médiane, un éclair d'une trame est rejeté → détection plus stable, sans bandes.
        let ring = ringRef.current.get(drone.id);
        if (!ring) {
          ring = createRing(PX * PX, 5);
          pushLuma(ring, cur.data);
          ringRef.current.set(drone.id, ring);
          warmRef.current.set(drone.id, 0);
          setDroneMotion(drone.id, { pct: null, at: Date.now() });
          return;
        }
        const bg = medianBackground(ring);
        const WARMUP = 3;
        const warm = (warmRef.current.get(drone.id) ?? 0) + 1;
        warmRef.current.set(drone.id, warm);
        const diff = foregroundDiff(bg, cur.data, PX, PX, { threshold: 34, mask: true });
        if (warm <= WARMUP) {
          // La fenêtre se remplit : on ne mesure pas encore, on nourrit juste le fond.
          pushLuma(ring, cur.data);
          setDroneMotion(drone.id, { pct: null, at: Date.now() });
          return;
        }
        const pct = Math.round(diff.changedFrac * 1000) / 10;
        const now2 = Date.now();
        const prevAt = lastAt.current.get(drone.id) ?? now2 - (Math.max(2, cadence || 15) * 1000);
        const dt = Math.max(0.2, (now2 - prevAt) / 1000);
        lastAt.current.set(drone.id, now2);
        // maxMisses 4 : une piste survit à un croisement court ; stationaryGrace énorme : une présence
        // immobile est tenue indéfiniment (on la libère nous-mêmes quand sa zone redevient vide).
        const TRK = { gate: PX * 0.4, maxMisses: 4, maxTrail: 8, stillEps: 3, stationaryGrace: 100000 };

        // PARADE ÉCLAIRAGE : un basculement GLOBAL (exposition, voile, nuage, phare) fait virer une
        // énorme part du cadre d'un coup. La médiane rejette déjà un flash bref ; ici on n'alerte pas
        // et on laisse la fenêtre absorber un vrai changement durable.
        if (isGlobalChange(diff.changedFrac)) {
          pushLuma(ring, cur.data);
          const coast = stepTracker(tracksRef.current.get(drone.id) ?? [], [], seedRef.current.get(drone.id) ?? 1, TRK);
          tracksRef.current.set(drone.id, coast.tracks);
          seedRef.current.set(drone.id, coast.nextId);
          setDroneMotion(drone.id, { pct, at: now2, note: "variation d'éclairage — ré-étalonnage" });
          return;
        }

        const stats = diff.mask ? blobStats(diff.mask, PX, PX, 6) : { count: 0, totalChanged: 0, largest: null };
        const hint = presenceHint(stats.largest, PX, PX);

        // Pistage MULTI-CIBLES par soustraction de fond (sans identité) : un objet = une zone à sa
        // position → recollage minime. On attache une SIGNATURE D'APPARENCE (luminance moyenne + aire)
        // à chaque zone, pour désambiguïser au croisement — « le plus clair/grand », jamais « qui ».
        const meanLum = (b: { x0: number; y0: number; x1: number; y1: number }) => {
          let s = 0;
          let n = 0;
          for (let y = b.y0; y <= b.y1; y++)
            for (let x = b.x0; x <= b.x1; x++) {
              const p = (y * PX + x) * 4;
              s += 0.299 * cur.data[p]! + 0.587 * cur.data[p + 1]! + 0.114 * cur.data[p + 2]!;
              n++;
            }
          return n ? s / n : 0;
        };
        // Zones d'intérêt (plusieurs secteurs possibles) : ne garder que les présences DANS L'UNE
        // d'elles (ignore la route). Aucune zone = toute l'image surveillée.
        const zones = sourceZones(drone);
        const detections = (diff.mask ? mergeNearbyBlobs(allBlobs(diff.mask, PX, PX, 6), 3) : [])
          .filter((b) => zones.length === 0 || zones.some((z) => pointInPolygon({ x: b.cx / PX, y: b.cy / PX }, z)))
          .map((b) => ({ cx: b.cx, cy: b.cy, lum: meanLum(b), area: b.area }));
        const prevTracks = tracksRef.current.get(drone.id) ?? [];
        const occ = detectOcclusions(prevTracks, detections, TRK.gate);
        const stepped = stepTracker(prevTracks, detections, seedRef.current.get(drone.id) ?? 1, { ...TRK, appearanceWeight: 0.15 });
        let confirmed = confirmedTracks(stepped.tracks, 2, TRK.stationaryGrace);

        // LIBÉRATION d'une présence immobile : tant que sa zone montre de l'avant-plan, on la tient ;
        // dès qu'elle est VIDE plusieurs trames (l'objet est vraiment parti), on l'abandonne.
        const regionDensity = (m: Uint8Array, cx: number, cy: number, r: number) => {
          let on = 0;
          let tot = 0;
          const x0 = Math.max(0, Math.round(cx) - r);
          const x1 = Math.min(PX - 1, Math.round(cx) + r);
          const y0 = Math.max(0, Math.round(cy) - r);
          const y1 = Math.min(PX - 1, Math.round(cy) + r);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tot++; on += m[y * PX + x] ? 1 : 0; }
          return tot ? on / tot : 0;
        };
        const released = new Set<number>();
        const RELEASE = 4;
        for (const t of confirmed) {
          const key = `${drone.id}:${t.id}`;
          if (!isStationary(t)) { emptyStreak.current.delete(key); continue; }
          const empty = !diff.mask || regionDensity(diff.mask, t.cx, t.cy, 8) < 0.03;
          const s = empty ? (emptyStreak.current.get(key) ?? 0) + 1 : 0;
          emptyStreak.current.set(key, s);
          if (s >= RELEASE) { released.add(t.id); emptyStreak.current.delete(key); }
        }
        const keptTracks = released.size > 0 ? stepped.tracks.filter((t) => !released.has(t.id)) : stepped.tracks;
        tracksRef.current.set(drone.id, keptTracks);
        seedRef.current.set(drone.id, stepped.nextId);
        if (released.size > 0) confirmed = confirmed.filter((t) => !released.has(t.id));

        // GEL du fond sous TOUTE piste confirmée : sa zone ne nourrit jamais la médiane. Un objet en
        // mouvement ne pollue donc pas le fond sur son passage, et surtout un intrus qui se FIGE reste
        // de l'avant-plan — donc TENU indéfiniment — jusqu'à ce qu'il reparte (zone vide → libérée).
        let freeze: Uint8Array | undefined;
        const still = confirmed;
        if (still.length > 0) {
          freeze = new Uint8Array(PX * PX);
          const r = 10;
          for (const t of still) {
            const x0 = Math.max(0, Math.round(t.cx) - r);
            const x1 = Math.min(PX - 1, Math.round(t.cx) + r);
            const y0 = Math.max(0, Math.round(t.cy) - r);
            const y1 = Math.min(PX - 1, Math.round(t.cy) + r);
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) freeze[y * PX + x] = 1;
          }
        }
        pushLuma(ring, cur.data, bg, freeze);

        const whereOf = (cx: number, cy: number) => {
          const hx = cx / PX < 0.34 ? "gauche" : cx / PX > 0.66 ? "droite" : "centre";
          const hy = cy / PX < 0.34 ? "haut" : cy / PX > 0.66 ? "bas" : "milieu";
          return `${hy}-${hx}`;
        };
        const tracksOut = confirmed
          .map((t) => ({
            id: t.id,
            heading: frameHeading(t.vx, t.vy),
            speed: Math.round(((Math.hypot(t.vx, t.vy) / PX) * 100 / dt) * 10) / 10,
            where: whereOf(t.cx, t.cy),
            stationary: isStationary(t),
            dwell: isStationary(t) ? Math.round((t.still ?? 0) * dt) : undefined,
          }))
          .sort((a, b) => a.id - b.id);
        // Piste principale (la plus établie) pour l'affichage compact.
        const primary = confirmed.slice().sort((a, b) => b.hits - a.hits)[0];
        const heading = primary ? frameHeading(primary.vx, primary.vy) : undefined;
        const speed = primary
          ? Math.round(((Math.hypot(primary.vx, primary.vy) / PX) * 100 / dt) * 10) / 10
          : undefined;
        const note = occ > 0 ? "croisement de pistes (un id peut s'échanger)" : undefined;

        // Capture de preuve en PLEINE RÉSOLUTION (plafonnée) : l'image NETTE de la caméra, pour que
        // l'agent la lise/zoome lui-même, avec de fines annotations (boîtes + trace + labels). Pas de
        // voile orange qui masquerait la scène. L'œil humain lit — aucune reconnaissance.
        let frame: string | undefined;
        try {
          const natW = img.naturalWidth || PX;
          const natH = img.naturalHeight || PX;
          const capScale = Math.min(1, 960 / Math.max(natW, natH));
          const capW = Math.max(1, Math.round(natW * capScale));
          const capH = Math.max(1, Math.round(natH * capScale));
          const sx = capW / PX; // la grille d'analyse (128²) → résolution capture (indépendant X/Y)
          const sy = capH / PX;
          const comp = document.createElement("canvas");
          comp.width = capW;
          comp.height = capH;
          const cctx = comp.getContext("2d");
          if (cctx) {
            cctx.drawImage(img, 0, 0, capW, capH);
            if (stats.largest) {
              cctx.strokeStyle = "rgba(120,230,160,0.95)";
              cctx.lineWidth = 2;
              cctx.strokeRect(stats.largest.x0 * sx, stats.largest.y0 * sy, (stats.largest.x1 - stats.largest.x0 + 1) * sx, (stats.largest.y1 - stats.largest.y0 + 1) * sy);
            }
            cctx.font = `${Math.max(10, Math.round(11 * sy))}px monospace`;
            for (const t of confirmed) {
              if (t.trail.length >= 2) {
                cctx.strokeStyle = "rgba(120,200,255,0.9)";
                cctx.lineWidth = 1.5;
                cctx.beginPath();
                cctx.moveTo(t.trail[0]!.x * sx, t.trail[0]!.y * sy);
                for (let i = 1; i < t.trail.length; i++) cctx.lineTo(t.trail[i]!.x * sx, t.trail[i]!.y * sy);
                cctx.stroke();
              }
              cctx.fillStyle = "rgba(120,200,255,0.95)";
              cctx.beginPath();
              cctx.arc(t.cx * sx, t.cy * sy, 3, 0, Math.PI * 2);
              cctx.fill();
              cctx.fillText(`T${t.id}`, Math.min(capW - 16, t.cx * sx + 5), Math.max(11, t.cy * sy - 5));
            }
            frame = comp.toDataURL("image/jpeg", 0.85);
          }
        } catch {
          /* capture indisponible : l'alerte et les chiffres suffisent */
        }

        const armed = pct >= threshold && isArmedPerimeter(drone.site);
        const level: "elevee" | "critique" = armed ? "critique" : "elevee";
        const armedShown = pct >= threshold || confirmed.length > 0; // une présence immobile peut tenir sans % de mouvement
        setDroneMotion(drone.id, {
          pct,
          at: Date.now(),
          zones: stats.count,
          targets: confirmed.length,
          tracks: tracksOut,
          hint: hint.hint,
          where: hint.where,
          heading,
          speed,
          note,
          frame,
          level: armedShown ? level : undefined,
        });
        pushDroneLog(drone.id, {
          at: now2,
          ok: true,
          msg: `${pct}% · ${confirmed.length} piste${confirmed.length > 1 ? "s" : ""}${note ? ` · ${note}` : ""}`,
        });

        // ARMEMENT DE NUIT : hors de la fenêtre horaire, on continue à suivre et journaliser, mais on
        // N'ALERTE PAS. La règle PROPRE à la source (par emplacement) l'emporte sur le réglage global.
        const nowD = new Date();
        const rule = sourceArmRule(drone, { nightOnly, from: armFrom, to: armTo });
        const armedTime = !rule.nightOnly || inArmWindow(nowD.getHours() + nowD.getMinutes() / 60, rule.from, rule.to);
        if (armedTime && (pct >= threshold || confirmed.length > 0)) {
          const last = lastAlert.current.get(drone.id) ?? 0;
          if (Date.now() - last > 10 * 60 * 1000) {
            lastAlert.current.set(drone.id, Date.now());
            const nT = tracksOut.length;
            const pistesTxt = nT > 0 ? `${nT} piste${nT > 1 ? "s" : ""} · ` : `${hint.hint} · `;
            const detail = tracksOut
              .slice(0, 3)
              .map((t) => `T${t.id} ${t.stationary ? `immobile${t.dwell ? ` ${t.dwell}s` : ""}` : `→ ${t.heading}${t.speed ? ` ${t.speed}%/s` : ""}`}`)
              .join(" · ");
            const occTxt = note ? ` · ${note}` : "";
            const patrol = armed ? " · périmètre armé : vérifier la capture, envoyer une patrouille" : "";
            pushAlert({
              id: `drone-motion-${drone.id}-${Date.now()}`,
              trackId: "",
              at: Date.now(),
              level,
              title: armed ? "Présence sur périmètre armé (drone)" : "Mouvement détecté (imagerie drone)",
              body: `${drone.name} · ${pct}% du cadre · ${pistesTxt}${detail || hint.where}${occTxt} · ${drone.site || "site"}${patrol} · suivi/présence, identification à l'œil sur la capture`,
              acked: false,
            });
            navBeep();
          }
        }
      } catch {
        if (!dead) setDroneMotion(drone.id, { pct: null, at: Date.now(), error: "analyse impossible" });
      }
    };

    const everyMs = Math.max(2, cadence || 15) * 1000; // cadence réglable (rapproché = suivi quasi continu)
    const first = window.setTimeout(() => void analyse(), 4000);
    const timer = window.setInterval(() => void analyse(), everyMs);
    return () => {
      dead = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on, threshold, cadence, nightOnly, armFrom, armTo, drones, pushAlert, setDroneMotion, pushDroneLog]);

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
