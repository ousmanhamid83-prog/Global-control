import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Compass, Crosshair, Download, Eraser, FolderOpen, Mountain, Navigation, Plus, RotateCcw, Route, Save, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KIND_LABEL } from "@/lib/vigilair/capture";
import { threatTone } from "@/lib/vigilair/format";
import { gpsStatus } from "@/lib/vigilair/live-feeds";
import { fetchElevationProfile, fetchRoadRoute, type ElevationProfile, type RoadRoute } from "@/lib/vigilair/nav-api";
import { MINE_REGION_LABEL, MINES } from "@/lib/vigilair/mines";
import {
  axisHazards,
  cardinal,
  declinationEstimate,
  parsePoints,
  profileCrossings,
  routeHazards,
  routePath,
  routeTotals,
  safeDetour,
  toGpx,
  toWaypointText,
  type Hazard,
  type LatLon,
  type NamedPoint,
} from "@/lib/vigilair/nav";
import { nearestPlace, searchPlaces, type Place } from "@/lib/vigilair/places";
import { deleteRoute, routesSnapshot, routesServerSnapshot, saveRoute, subscribeRoutes } from "@/lib/vigilair/routes";
import { useVigilair } from "@/lib/vigilair/store";
import type { Threat } from "@/lib/vigilair/types";
import { addCustomSite, subscribeWatchSites, watchSitesSnapshot, watchSitesServerSnapshot } from "@/lib/vigilair/watch-sites";

type Pt = { name: string; lat: string; lon: string };
const EMPTY: Pt = { name: "", lat: "", lon: "" };
function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}
function toLL(p: Pt): LatLon | null {
  const lat = num(p.lat);
  const lon = num(p.lon);
  return lat != null && lon != null ? { lat, lon } : null;
}
function etaText(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
function mag(trueDeg: number, decl: number): number {
  return ((trueDeg - decl) % 360 + 360) % 360;
}
function download(filename: string, text: string, mime: string): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* téléchargement bloqué */
  }
}

type SiteOpt = { name: string; lat: number; lon: number };

function Picker({
  label,
  pt,
  setPt,
  sites,
  extra,
}: {
  label: string;
  pt: Pt;
  setPt: (p: Pt) => void;
  sites: SiteOpt[];
  extra?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const results: Place[] = q.trim() ? searchPlaces(q, 6) : [];
  return (
    <div className="space-y-2 rounded-sm border border-border bg-bg/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg">{label}</span>
        {extra}
      </div>
      <div className="relative">
        <Input
          data-nav={`search-${label}`}
          placeholder="Rechercher un lieu (Amdjarass, Fada…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {results.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-sm border border-border bg-bg shadow-xl">
            {results.map((pl) => (
              <li key={`${pl.name}-${pl.lat}-${pl.lon}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPt({ name: pl.name, lat: String(pl.lat), lon: String(pl.lon) });
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary"
                >
                  <span className="text-fg">{pl.name}</span>
                  {pl.region ? <span className="text-muted-foreground">{pl.region}</span> : null}
                  <span className="ml-auto font-mono text-muted-foreground">
                    {pl.lat.toFixed(2)}, {pl.lon.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {sites.length > 0 ? (
        <select
          data-nav={`site-${label}`}
          value=""
          onChange={(e) => {
            const s = sites[Number(e.target.value)];
            if (s) setPt({ name: s.name, lat: String(s.lat), lon: String(s.lon) });
          }}
          className="w-full rounded-sm border border-border bg-bg px-2 py-1.5 text-xs text-fg"
        >
          <option value="">— ou choisir un site surveillé —</option>
          {sites.map((s, i) => (
            <option key={`${s.name}-${i}`} value={i}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <Input data-nav={`name-${label}`} placeholder="Nom" value={pt.name} onChange={(e) => setPt({ ...pt, name: e.target.value })} />
        <Input data-nav={`lat-${label}`} className="w-24" inputMode="decimal" placeholder="Lat" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} />
        <Input data-nav={`lon-${label}`} className="w-24" inputMode="decimal" placeholder="Lon" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} />
      </div>
    </div>
  );
}

/** Flèche de cap (SVG) — pointe vers le cap, le Nord reste en haut. */
function CompassRose({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 120 120" className="size-24 shrink-0" aria-hidden>
      <circle cx="60" cy="60" r="56" className="fill-none stroke-border" strokeWidth="2" />
      <text x="60" y="16" textAnchor="middle" className="fill-muted-foreground" fontSize="11">N</text>
      <text x="108" y="64" textAnchor="middle" className="fill-muted-foreground" fontSize="11">E</text>
      <text x="60" y="112" textAnchor="middle" className="fill-muted-foreground" fontSize="11">S</text>
      <text x="12" y="64" textAnchor="middle" className="fill-muted-foreground" fontSize="11">O</text>
      <g transform={`rotate(${deg} 60 60)`}>
        <line x1="60" y1="60" x2="60" y2="16" className="stroke-crit" strokeWidth="3" />
        <polygon points="60,10 54,24 66,24" className="fill-crit" />
      </g>
      <circle cx="60" cy="60" r="3" className="fill-fg" />
    </svg>
  );
}

/** Schéma de route (équirectangulaire) : étapes, segments et obstacles. Axe tracé, mis à jour en continu. */
function RouteMap({ pts, hazards }: { pts: LatLon[]; hazards: { lat: number; lon: number; id: string }[] }) {
  const W = 620;
  const H = 300;
  const pad = 26;
  const all = [...pts, ...hazards];
  if (all.length < 2) return null;
  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180) || 1;
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  const spanLat = Math.max(0.1, maxLat - minLat);
  const spanLon = Math.max(0.1, (maxLon - minLon) * kx);
  // marge
  minLat -= spanLat * 0.1;
  maxLat += spanLat * 0.1;
  minLon -= (spanLon / kx) * 0.1;
  maxLon += (spanLon / kx) * 0.1;
  const sx = (W - 2 * pad) / Math.max(0.1, (maxLon - minLon) * kx);
  const sy = (H - 2 * pad) / Math.max(0.1, maxLat - minLat);
  const s = Math.min(sx, sy);
  const X = (lon: number) => pad + (lon - minLon) * kx * s;
  const Y = (lat: number) => H - pad - (lat - minLat) * s;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${X(p.lon).toFixed(1)} ${Y(p.lat).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-sm border border-border bg-bg" aria-hidden>
      <path d={path} className="fill-none stroke-ok" strokeWidth="2" strokeDasharray="6 4" />
      {hazards.map((h) => (
        <g key={`h-${h.id}`}>
          <circle cx={X(h.lon)} cy={Y(h.lat)} r="14" className="fill-crit/15 stroke-crit/50" />
          <circle cx={X(h.lon)} cy={Y(h.lat)} r="4" className="fill-crit" />
        </g>
      ))}
      {pts.map((p, i) => (
        <g key={`p-${i}`}>
          <circle cx={X(p.lon)} cy={Y(p.lat)} r="5" className={i === 0 || i === pts.length - 1 ? "fill-fg" : "fill-ok"} />
          <text x={X(p.lon) + 7} y={Y(p.lat) - 6} className="fill-muted-foreground" fontSize="10">
            {i === 0 ? "départ" : i === pts.length - 1 ? "arrivée" : `étape ${i}`}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Profil de terrain (élévation le long de la route) — relief réel ASTER 30 m. */
function TerrainProfile({ prof }: { prof: Extract<ElevationProfile, { ok: true }> }) {
  const W = 620;
  const H = 150;
  const pad = 30;
  const totalKm = prof.points[prof.points.length - 1]?.alongKm || 1;
  const range = Math.max(1, prof.maxM - prof.minM);
  const X = (km: number) => pad + (km / totalKm) * (W - 2 * pad);
  const Y = (m: number) => H - pad - ((m - prof.minM) / range) * (H - 2 * pad);
  const line = prof.points.map((p, i) => `${i ? "L" : "M"} ${X(p.alongKm).toFixed(1)} ${Y(p.elevM).toFixed(1)}`).join(" ");
  const area = `${line} L ${X(totalKm).toFixed(1)} ${H - pad} L ${X(0).toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-sm border border-border bg-bg" aria-hidden>
      <path d={area} className="fill-ok/15" />
      <path d={line} className="fill-none stroke-ok" strokeWidth="2" />
      <text x={pad} y={Y(prof.maxM) - 3} className="fill-muted-foreground" fontSize="10">{prof.maxM} m</text>
      <text x={pad} y={H - pad + 12} className="fill-muted-foreground" fontSize="10">{prof.minM} m · 0 km</text>
      <text x={W - pad} y={H - pad + 12} textAnchor="end" className="fill-muted-foreground" fontSize="10">
        {Math.round(totalKm)} km
      </text>
    </svg>
  );
}

/**
 * Navigation directe dynamique jusqu'au site — cap, distance, ETA, étapes, et SÛRETÉ DE L'AXE en
 * continu : dès qu'un phénomène réel borde la route, le poste le signale, propose un contournement,
 * ou conseille le demi-tour s'il n'y a pas de route sûre. Pas de route goudronnée dans le BET : on
 * tient un cap. Réception seule : ça aide un véhicule à tenir un cap, ça ne guide rien.
 */
export function NavPanel() {
  const custom = useSyncExternalStore(subscribeWatchSites, watchSitesSnapshot, watchSitesServerSnapshot);
  const phenomena = useVigilair((s) => s.phenomena);
  const [start, setStart] = useState<Pt>(EMPTY);
  const [dest, setDest] = useState<Pt>(EMPTY);
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [speed, setSpeed] = useState("40");
  const [decl, setDecl] = useState("");
  const [fix, setFix] = useState<LatLon | null>(null);
  const setNavRoute = useVigilair((s) => s.setNavRoute);
  const navAlarm = useVigilair((s) => s.navAlarm);
  const setNavAlarm = useVigilair((s) => s.setNavAlarm);
  const [elev, setElev] = useState<ElevationProfile | null>(null);
  const [elevBusy, setElevBusy] = useState(false);
  const savedRoutes = useSyncExternalStore(subscribeRoutes, routesSnapshot, routesServerSnapshot);
  const [road, setRoad] = useState<RoadRoute | null>(null);
  const [roadBusy, setRoadBusy] = useState(false);
  const [maxSlope, setMaxSlope] = useState("15");
  const [maxAlt, setMaxAlt] = useState("");
  const [saveName, setSaveName] = useState("");
  const openCapture = useVigilair((s) => s.openCapture);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [fine, setFine] = useState<ElevationProfile | null>(null);
  const [fineBusy, setFineBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    const run = () =>
      gpsStatus()
        .then((s) => {
          if (!dead) setFix(s && s.hasFix && s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null);
        })
        .catch(() => undefined);
    run();
    const id = window.setInterval(run, 5000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  const sites: SiteOpt[] = [
    ...custom.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    ...MINES.map((m) => ({ name: `${m.short} · ${MINE_REGION_LABEL[m.region]}`, lat: m.lat, lon: m.lon })),
  ];

  const spd = num(speed) ?? 0;
  const pts = useMemo<LatLon[]>(() => {
    const a = toLL(start);
    const b = toLL(dest);
    if (!a || !b) return [];
    const w = waypoints.map(toLL).filter((x): x is LatLon => x != null);
    return [a, ...w, b];
  }, [start, dest, waypoints]);
  const ready = pts.length >= 2;

  /** Déclinaison saisie, tenue à jour après chaque rendu (déclaré AVANT l'effet qui la lit). */
  const declRef = useRef(decl);
  useEffect(() => {
    declRef.current = decl;
  });

  // Déclinaison auto-estimée depuis le DÉPART, et seulement si l'opérateur n'en a pas saisi une.
  // On lit la saisie par référence : en dépendre ferait rejouer l'effet dès qu'on vide le champ, qui
  // se re-remplirait aussitôt tout seul — impossible d'effacer une déclinaison.
  const startLat = start.lat;
  const startLon = start.lon;
  useEffect(() => {
    const lat = num(startLat);
    const lon = num(startLon);
    if (declRef.current.trim() === "" && lat != null && lon != null) {
      const d = declinationEstimate(lat, lon);
      if (d != null) setDecl(String(d));
    }
  }, [startLat, startLon]);

  const hazList: Hazard[] = useMemo(
    () => phenomena.map((p) => ({ id: p.id, kind: p.kind, level: p.level, lat: p.lat, lon: p.lon, title: p.title })),
    [phenomena],
  );

  const totals = useMemo(() => (pts.length >= 2 ? routeTotals(pts, spd) : null), [pts, spd]);
  const hazards = useMemo(() => (pts.length >= 2 ? routeHazards(pts, hazList, 25, 5) : []), [pts, hazList]);

  // Première étape non sûre + contournement proposé.
  const analysis = useMemo(() => {
    if (pts.length < 2) return null;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (axisHazards(a.lat, a.lon, b.lat, b.lon, hazList, 25).length > 0) {
        return { legIndex: k, detour: safeDetour(a.lat, a.lon, b.lat, b.lon, hazList, 25) };
      }
    }
    return null;
  }, [pts, hazList]);

  const declNum = num(decl) ?? 0;
  const firstLeg = totals?.legs[0] ?? null;

  // Points nommés (pour export / enregistrement) et route EFFECTIVE (routière si trouvée, sinon cap).
  const namedPts: NamedPoint[] = useMemo(() => {
    const a = toLL(start);
    const b = toLL(dest);
    if (!a || !b) return [];
    const mid: NamedPoint[] = [];
    waypoints.forEach((w) => {
      const ll = toLL(w);
      if (ll) mid.push({ lat: ll.lat, lon: ll.lon, name: w.name || "étape" });
    });
    return [{ lat: a.lat, lon: a.lon, name: start.name || "départ" }, ...mid, { lat: b.lat, lon: b.lon, name: dest.name || "arrivée" }];
  }, [start, dest, waypoints]);
  const effPts: NamedPoint[] = useMemo(
    () => (road?.ok ? road.geometry.map((g) => ({ lat: g.lat, lon: g.lon })) : namedPts),
    [road, namedPts],
  );
  const crossing = elev?.ok ? profileCrossings(elev.points, num(maxSlope) ?? 999, num(maxAlt)) : null;

  // Une route routière devient caduque dès que les points changent.
  useEffect(() => {
    setRoad(null);
  }, [namedPts]);

  // Publie la route active dans le store : tracée sur le COP, surveillée par l'alarme.
  useEffect(() => {
    if (effPts.length >= 2) {
      setNavRoute({ points: effPts, hazards: hazards.map((h) => ({ id: h.id, lat: h.lat, lon: h.lon, level: h.level })) });
    } else {
      setNavRoute(null);
    }
  }, [effPts, hazards, setNavRoute]);

  const runProfile = () => {
    if (pts.length < 2) return;
    setElevBusy(true);
    setFine(null);
    fetchElevationProfile({ data: { points: effPts.length >= 2 ? effPts : pts } })
      .then(setElev)
      .catch(() => setElev({ ok: false, reason: "échec" }))
      .finally(() => setElevBusy(false));
  };
  // Zoom relief : ré-échantillonne finement le tronçon le plus raide du profil grossier.
  const runFineRelief = () => {
    if (!elev?.ok || elev.points.length < 2) return;
    let k = 1;
    let best = -1;
    for (let i = 1; i < elev.points.length; i++) {
      const dKm = elev.points[i]!.alongKm - elev.points[i - 1]!.alongKm;
      const s = dKm > 0 ? Math.abs(elev.points[i]!.elevM - elev.points[i - 1]!.elevM) / dKm : 0;
      if (s > best) {
        best = s;
        k = i;
      }
    }
    const a = elev.points[k - 1]!;
    const b = elev.points[k]!;
    setFineBusy(true);
    fetchElevationProfile({ data: { points: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], stepKm: 0.3 } })
      .then(setFine)
      .catch(() => setFine({ ok: false, reason: "échec" }))
      .finally(() => setFineBusy(false));
  };
  const captureAt = (lat: number, lon: number, name: string) =>
    openCapture({ lat, lon, kind: "scene", title: `Axe · ${name}`, body: "inspection imagerie de l'axe", source: "navigation" });
  const doImportRoute = () => {
    const parsed = parsePoints(importText);
    if (parsed.length < 2) {
      setImportMsg("Il faut au moins 2 points (une ligne « lat, lon » par point).");
      return;
    }
    loadSaved(parsed);
    setImportMsg(`${parsed.length} points → route chargée.`);
  };
  const doImportSites = async () => {
    const parsed = parsePoints(importText);
    if (parsed.length === 0) {
      setImportMsg("Aucun point valide (une ligne « lat, lon » par point).");
      return;
    }
    let ok = 0;
    for (const p of parsed) {
      const r = await addCustomSite({ name: p.name || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`, lat: p.lat, lon: p.lon, radiusKm: 5 });
      if (r.ok) ok++;
    }
    setImportMsg(`${ok}/${parsed.length} sites ajoutés (rayon 5 km).`);
  };
  const runRoad = () => {
    if (!ready) return;
    setRoadBusy(true);
    fetchRoadRoute({ data: { points: pts } })
      .then(setRoad)
      .catch(() => setRoad({ ok: false, reason: "échec" }))
      .finally(() => setRoadBusy(false));
  };
  const exportGpx = () => {
    if (effPts.length < 2) return;
    const name = `${start.name || "départ"} → ${dest.name || "arrivée"}`;
    const gpx = toGpx(name, effPts, hazards.map((h) => ({ lat: h.lat, lon: h.lon, name: h.title })));
    download(`${name.replace(/[^\w]+/g, "_")}.gpx`, gpx, "application/gpx+xml");
  };
  const copyPoints = () => void navigator.clipboard?.writeText(toWaypointText(namedPts)).catch(() => undefined);
  const doSave = async () => {
    if (namedPts.length < 2) return;
    const nm = saveName.trim() || `${start.name || "départ"} → ${dest.name || "arrivée"}`;
    const res = await saveRoute(nm, namedPts);
    if (res.ok) setSaveName("");
  };
  const loadSaved = (pointsIn: NamedPoint[]) => {
    if (pointsIn.length < 2) return;
    const first = pointsIn[0]!;
    const last = pointsIn[pointsIn.length - 1]!;
    setStart({ name: first.name || "départ", lat: String(first.lat), lon: String(first.lon) });
    setDest({ name: last.name || "arrivée", lat: String(last.lat), lon: String(last.lon) });
    setWaypoints(pointsIn.slice(1, -1).map((p) => ({ name: p.name || "étape", lat: String(p.lat), lon: String(p.lon) })));
    setRoad(null);
  };
  const clearRoute = () => {
    setStart(EMPTY);
    setDest(EMPTY);
    setWaypoints([]);
    setElev(null);
    setRoad(null);
    setFine(null);
  };

  // Points d'inspection le long de l'axe (≤ 10) — chacun ouvre une capture imagerie à l'œil.
  const axisPoints = useMemo(() => {
    if (effPts.length < 2) return [] as { lat: number; lon: number; alongKm: number; name: string }[];
    const path = routePath(effPts, Math.max(5, Math.round(routeTotals(effPts).distanceKm / 10)));
    const keep = Math.max(1, Math.ceil(path.length / 10));
    return path
      .filter((_, i) => i % keep === 0 || i === path.length - 1)
      .map((p) => ({ lat: p.lat, lon: p.lon, alongKm: p.alongKm, name: nearestPlace(p.lat, p.lon)?.place.name ?? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` }));
  }, [effPts]);

  const insertDetour = () => {
    if (!analysis || analysis.detour.clear || !analysis.detour.waypoint) return;
    const w = analysis.detour.waypoint;
    const next = [...waypoints];
    next.splice(analysis.legIndex, 0, { name: "Contournement", lat: w.lat.toFixed(4), lon: w.lon.toFixed(4) });
    setWaypoints(next);
  };
  const demiTour = () => {
    setStart(dest);
    setDest(start);
    setWaypoints([]);
  };

  return (
    <section className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <div className="flex flex-wrap items-center gap-2">
          <Navigation className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium">Navigation directe jusqu'au site</h2>
          <Badge tone="default">cap vrai · orthodromie · dynamique</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Pas de route dans le BET ni l'Ennedi : on tient un <strong>cap</strong>. Le poste calcule le
          cap, la distance et l'ETA, trace l'axe, et surveille <strong>en continu</strong> les
          obstacles réels captés (crue, feu, séisme). Si l'axe n'est pas sûr, il propose un
          <strong> contournement</strong> ou conseille le <strong>demi-tour</strong>. Réception seule.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Picker
            label="Départ"
            pt={start}
            setPt={setStart}
            sites={sites}
            extra={
              <Button data-nav="gps" size="sm" variant="outline" disabled={!fix} onClick={() => fix && setStart({ name: "Position GPS", lat: String(fix.lat), lon: String(fix.lon) })}>
                <Crosshair className="mr-1 size-3.5" />
                {fix ? "Position GPS" : "GPS —"}
              </Button>
            }
          />
          <Picker label="Destination" pt={dest} setPt={setDest} sites={sites} />
        </div>

        {waypoints.length > 0 ? (
          <div className="space-y-2">
            {waypoints.map((w, i) => (
              <Picker
                key={`wp-${i}`}
                label={`Étape ${i + 1}`}
                pt={w}
                setPt={(p) => setWaypoints(waypoints.map((x, j) => (j === i ? p : x)))}
                sites={sites}
                extra={
                  <Button size="sm" variant="ghost" onClick={() => setWaypoints(waypoints.filter((_, j) => j !== i))} aria-label={`retirer étape ${i + 1}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setWaypoints([...waypoints, EMPTY])}>
            <Plus className="mr-1 size-3.5" />
            Ajouter une étape
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Vitesse (km/h)
            <Input className="w-20" inputMode="decimal" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Déclinaison °E (approchée)
            <Input data-nav="decl" className="w-20" inputMode="decimal" value={decl} onChange={(e) => setDecl(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={navAlarm} onChange={(e) => setNavAlarm(e.target.checked)} />
            Alarme sonore
          </label>
          <Button data-nav="profile" size="sm" variant="outline" disabled={!ready || elevBusy} onClick={runProfile}>
            <Mountain className="mr-1 size-3.5" />
            {elevBusy ? "Profil…" : "Profil de terrain"}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearRoute}>
            <Eraser className="mr-1 size-3.5" />
            Effacer
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button data-nav="road" size="sm" variant={road?.ok ? "default" : "outline"} disabled={!ready || roadBusy} onClick={runRoad}>
            <Route className="mr-1 size-3.5" />
            {roadBusy ? "Route…" : "Itinéraire routier (OSM)"}
          </Button>
          {road ? (
            road.ok ? (
              <Badge tone="ok">
                route {road.distanceKm} km · {Math.floor(road.durationMin / 60)} h {String(road.durationMin % 60).padStart(2, "0")}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">{road.reason}</span>
            )
          ) : null}
          <Button data-nav="gpx" size="sm" variant="outline" disabled={!ready} onClick={exportGpx}>
            <Download className="mr-1 size-3.5" />
            Export GPX
          </Button>
          <Button size="sm" variant="ghost" disabled={!ready} onClick={copyPoints}>
            Copier les points
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Pente max %
            <Input className="w-16" inputMode="decimal" value={maxSlope} onChange={(e) => setMaxSlope(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Alt. max m
            <Input className="w-20" inputMode="decimal" placeholder="—" value={maxAlt} onChange={(e) => setMaxAlt(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          La route et les obstacles s'affichent aussi sur la carte du COP (onglet Situation). L'alarme
          sonne, même hors de cet onglet, dès qu'un nouvel obstacle réel borde la route active.
        </p>
      </div>

      {/* Routes mémorisées — partagées entre postes, comme les sites. */}
      <div className="space-y-2 rounded-md border border-border bg-surface p-4 hud">
        <div className="flex flex-wrap items-center gap-2">
          <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">Routes mémorisées (partagées)</h3>
          <Badge tone="default">{savedRoutes.length}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            data-nav="save-name"
            className="max-w-xs"
            placeholder={ready ? `${start.name || "départ"} → ${dest.name || "arrivée"}` : "Nom de la route"}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <Button data-nav="save" size="sm" variant="outline" disabled={!ready} onClick={() => void doSave()}>
            <Save className="mr-1 size-3.5" />
            Enregistrer cette route
          </Button>
        </div>
        {savedRoutes.length > 0 ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {savedRoutes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                <span className="truncate text-fg">{r.name}</span>
                <span className="font-mono text-muted-foreground">{r.points.length} pts</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => loadSaved(r.points)}>
                    Charger
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteRoute(r.id)} aria-label={`supprimer ${r.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Aucune route enregistrée. Trace une route, puis « Enregistrer ».</p>
        )}
      </div>

      {/* Import de points — zones non sourcées : coller une liste lat/lon → route ou sites. */}
      <div className="space-y-2 rounded-md border border-border bg-surface p-4 hud">
        <div className="flex flex-wrap items-center gap-2">
          <Plus className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">Importer des points (zone non sourcée)</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Le répertoire ne couvre pas tout. Colle une liste — une ligne par point : « Nom, lat, lon »
          ou « lat, lon ». On en fait une <strong>route</strong> ou des <strong>sites surveillés</strong>,
          sans dépendre d'une carte externe.
        </p>
        <textarea
          data-nav="import"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          placeholder={"Camp Nord, 16.03, 22.63\nPoste 2, 15.2, 21.9\n14.9, 21.4"}
          className="w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button data-nav="import-route" size="sm" variant="outline" onClick={doImportRoute}>
            En route
          </Button>
          <Button data-nav="import-sites" size="sm" variant="outline" onClick={() => void doImportSites()}>
            En sites surveillés
          </Button>
          {importMsg ? <span className="text-xs text-muted-foreground">{importMsg}</span> : null}
        </div>
      </div>

      {/* Bandeau de sûreté dynamique */}
      {ready && analysis ? (
        <div className="space-y-2 rounded-md border border-crit/60 bg-crit/10 p-4">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-crit" aria-hidden />
            <span className="text-sm font-medium text-crit">Axe non sûr — obstacle réel sur la route</span>
          </div>
          {!analysis.detour.clear && analysis.detour.waypoint ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-fg">
                Contournement possible par la {analysis.detour.side} (+{Math.round(analysis.detour.offsetKm)} km).
              </span>
              <Button size="sm" variant="outline" onClick={insertDetour}>
                <RotateCcw className="mr-1 size-3.5" />
                Insérer le contournement
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-fg">Aucune route sûre trouvée (≤ 180 km de détour). Demi-tour conseillé.</span>
              <Button size="sm" variant="outline" onClick={demiTour}>
                <RotateCcw className="mr-1 size-3.5" />
                Itinéraire retour (demi-tour)
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {totals && firstLeg ? (
        <div className="flex flex-wrap items-center gap-6 rounded-md border border-border bg-surface p-4">
          <CompassRose deg={firstLeg.bearingDeg} />
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <Compass className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-mono text-3xl text-fg">{Math.round(firstLeg.bearingDeg)}°</span>
              <span className="text-lg text-muted-foreground">{cardinal(firstLeg.bearingDeg)}</span>
              <span className="text-sm text-muted-foreground">
                · magn. {Math.round(mag(firstLeg.bearingDeg, declNum))}°
              </span>
            </div>
            <p className="text-sm text-fg">
              {road?.ok ? "Route routière " : "Route "}
              <strong className="font-mono">{(road?.ok ? road.distanceKm : totals.distanceKm).toFixed(1)} km</strong>
              {!road?.ok && waypoints.length > 0 ? ` · ${totals.legs.length} étapes` : ""} · ETA{" "}
              <strong className="font-mono">{etaText(road?.ok ? road.durationMin : totals.etaMin)}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Premier cap : {start.name || "départ"} → {(waypoints[0]?.name || dest.name) || "arrivée"} · cap
              vrai (magn. = vrai − déclinaison)
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
          Choisis un <strong>départ</strong> (bouton « Position GPS », un lieu, ou des coordonnées) et
          une <strong>destination</strong> pour tracer la route et obtenir le cap.
        </p>
      )}

      {totals ? <RouteMap pts={pts} hazards={hazards} /> : null}

      {axisPoints.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <Navigation className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">Inspection imagerie de l'axe</h3>
            <Badge tone="default">{axisPoints.length} points</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Capture l'imagerie réelle à chaque point de l'axe, à inspecter à l'œil — l'image n'est pas
            analysée par la machine (pas de détection auto). La meilleure résolution dispo s'ouvre dans la vue.
          </p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {axisPoints.map((pt, i) => (
              <li key={`ax-${i}`} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{Math.round(pt.alongKm)} km</span>
                <span className="truncate text-fg">{pt.name}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => captureAt(pt.lat, pt.lon, pt.name)}>
                  Capture
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {elev ? (
        <div className="space-y-2 rounded-md border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Mountain className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">Profil de terrain</h3>
            {elev.ok ? (
              <Badge tone="default">
                {elev.minM}–{elev.maxM} m · D+ {elev.gainM} m
              </Badge>
            ) : (
              <Badge tone="warn">indisponible</Badge>
            )}
          </div>
          {elev.ok ? (
            <>
              <TerrainProfile prof={elev} />
              {crossing ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={crossing.slopeExceeded || crossing.altExceeded ? "warn" : "ok"}>
                    {crossing.slopeExceeded || crossing.altExceeded ? "franchissement" : "franchissable"}
                  </Badge>
                  <span className="text-muted-foreground">
                    pente moy. max {crossing.maxSlopePct} % (à {Math.round(crossing.atKmSlope)} km) · sommet{" "}
                    {crossing.maxElevM} m (à {Math.round(crossing.atKmElev)} km)
                  </span>
                  {crossing.slopeExceeded ? <span className="text-warn">pente &gt; {maxSlope} %</span> : null}
                  {crossing.altExceeded ? <span className="text-warn">altitude &gt; {maxAlt} m</span> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button data-nav="fine" size="sm" variant="outline" disabled={fineBusy} onClick={runFineRelief}>
                  <Mountain className="mr-1 size-3.5" />
                  {fineBusy ? "Zoom…" : "Zoom relief (tronçon le plus raide)"}
                </Button>
                {fine && !fine.ok ? <span className="text-xs text-crit">{fine.reason}</span> : null}
              </div>
              {fine && fine.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="warn">zoom ~300 m/pas</Badge>
                    <span className="text-muted-foreground">
                      tronçon {fine.minM}–{fine.maxM} m · pente locale max {profileCrossings(fine.points, 999, null).maxSlopePct} %
                    </span>
                  </div>
                  <TerrainProfile prof={fine} />
                </div>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                {elev.source} — un massif se voit, pas un ravin d'un mètre. Pente = moyenne entre relevés.
                Nécessite Internet.
              </p>
            </>
          ) : (
            <p className="font-mono text-xs text-crit">{elev.reason} — le profil a besoin d'Internet.</p>
          )}
        </div>
      ) : null}

      {totals ? (
        <div className="space-y-2 rounded-md border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">Sûreté de l'axe</h3>
            <Badge tone={hazards.length ? "warn" : "ok"}>
              {hazards.length ? `${hazards.length} obstacle${hazards.length > 1 ? "s" : ""}` : "axe dégagé"}
            </Badge>
          </div>
          {hazards.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucun phénomène capté à moins de 25 km de la route, au dernier relevé (mis à jour en
              continu). Le terrain (oueds, dunes, champs de mines) se reconnaît à l'œil.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {hazards.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                  <Badge tone={threatTone((h.level ?? "moderee") as Threat)}>{h.level ?? "—"}</Badge>
                  <Badge>{KIND_LABEL[h.kind as keyof typeof KIND_LABEL] ?? h.kind}</Badge>
                  <span className="text-fg">{h.title}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    à {Math.round(h.alongKm)} km sur la route · {Math.round(h.offsetKm)} km à {h.side}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <p className="rounded-md border border-border bg-surface px-4 py-2 text-[11px] text-muted-foreground">
        Navigation directe (orthodromie), cap vrai — pas d'itinéraire routier, pas de guidage d'arme.
        Le contournement est une proposition (point de passage qui dégage l'axe), pas un plan de route
        optimal ; le relief et les pistes se lisent sur l'imagerie et à l'œil. Déclinaison approchée, à
        vérifier sur carte. Réception seule.
      </p>
    </section>
  );
}
