import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Compass, Crosshair, Navigation, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KIND_LABEL } from "@/lib/vigilair/capture";
import { threatTone } from "@/lib/vigilair/format";
import { gpsStatus } from "@/lib/vigilair/live-feeds";
import { MINE_REGION_LABEL, MINES } from "@/lib/vigilair/mines";
import { axisHazards, solve, type Hazard } from "@/lib/vigilair/nav";
import { searchPlaces, type Place } from "@/lib/vigilair/places";
import { useVigilair } from "@/lib/vigilair/store";
import type { Threat } from "@/lib/vigilair/types";
import { subscribeWatchSites, watchSitesSnapshot } from "@/lib/vigilair/watch-sites";

type Pt = { name: string; lat: string; lon: string };
const EMPTY: Pt = { name: "", lat: "", lon: "" };
function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}
function etaText(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
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
        <Input placeholder="Nom" value={pt.name} onChange={(e) => setPt({ ...pt, name: e.target.value })} />
        <Input className="w-24" inputMode="decimal" placeholder="Lat" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} />
        <Input className="w-24" inputMode="decimal" placeholder="Lon" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} />
      </div>
    </div>
  );
}

/** Flèche de cap (SVG) — pointe vers le cap, le Nord reste en haut. */
function CompassRose({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 120 120" className="size-28" aria-hidden>
      <circle cx="60" cy="60" r="56" className="fill-none stroke-border" strokeWidth="2" />
      <text x="60" y="16" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        N
      </text>
      <text x="108" y="64" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        E
      </text>
      <text x="60" y="112" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        S
      </text>
      <text x="12" y="64" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        O
      </text>
      <g transform={`rotate(${deg} 60 60)`}>
        <line x1="60" y1="60" x2="60" y2="16" className="stroke-crit" strokeWidth="3" />
        <polygon points="60,10 54,24 66,24" className="fill-crit" />
      </g>
      <circle cx="60" cy="60" r="3" className="fill-fg" />
    </svg>
  );
}

/**
 * Navigation directe jusqu'à un site — cap vrai, distance, ETA, et sûreté de l'axe. En Afrique
 * saharo-sahélienne il n'y a pas de route : on tient un CAP (comme en mer, comme dans le désert).
 * Réception seule : ça aide un véhicule à tenir un cap, ça ne guide rien. Aucun logiciel grand public
 * ne fait ça depuis une console de surveillance.
 */
export function NavPanel() {
  const custom = useSyncExternalStore(subscribeWatchSites, watchSitesSnapshot, watchSitesSnapshot);
  const phenomena = useVigilair((s) => s.phenomena);
  const [start, setStart] = useState<Pt>(EMPTY);
  const [dest, setDest] = useState<Pt>(EMPTY);
  const [speed, setSpeed] = useState("40");
  const [fix, setFix] = useState<{ lat: number; lon: number } | null>(null);

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

  const aLat = num(start.lat);
  const aLon = num(start.lon);
  const bLat = num(dest.lat);
  const bLon = num(dest.lon);
  const ready = aLat != null && aLon != null && bLat != null && bLon != null;
  const spd = num(speed) ?? 0;

  const nav = useMemo(
    () => (ready ? solve(aLat!, aLon!, bLat!, bLon!, spd) : null),
    [ready, aLat, aLon, bLat, bLon, spd],
  );

  const hazards = useMemo(() => {
    if (!ready) return [];
    const list: Hazard[] = phenomena.map((p) => ({ id: p.id, kind: p.kind, level: p.level, lat: p.lat, lon: p.lon, title: p.title }));
    return axisHazards(aLat!, aLon!, bLat!, bLon!, list, 25, 5);
  }, [ready, aLat, aLon, bLat, bLon, phenomena]);

  return (
    <section className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <div className="flex flex-wrap items-center gap-2">
          <Navigation className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium">Navigation directe jusqu'au site</h2>
          <Badge tone="default">cap vrai · orthodromie</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Pas de route dans le BET ni l'Ennedi : on tient un <strong>cap</strong>, pas un itinéraire
          routier (il n'existe pas de données routières fiables ici). Le poste calcule le cap vrai, la
          distance et l'ETA d'un point à un site, et signale les <strong>obstacles captés</strong>
          (crue, feu, séisme) qui bordent l'axe. Réception seule : ça aide un véhicule à tenir un cap.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Picker
            label="Départ"
            pt={start}
            setPt={setStart}
            sites={sites}
            extra={
              <Button
                data-nav="gps"
                size="sm"
                variant="outline"
                disabled={!fix}
                onClick={() => fix && setStart({ name: "Position GPS", lat: String(fix.lat), lon: String(fix.lon) })}
              >
                <Crosshair className="mr-1 size-3.5" />
                {fix ? "Position GPS" : "GPS —"}
              </Button>
            }
          />
          <Picker label="Destination" pt={dest} setPt={setDest} sites={sites} />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Vitesse de marche (km/h)
          <Input className="w-24" inputMode="decimal" value={speed} onChange={(e) => setSpeed(e.target.value)} />
        </label>
      </div>

      {nav ? (
        <div className="flex flex-wrap items-center gap-6 rounded-md border border-border bg-surface p-4">
          <CompassRose deg={nav.bearingDeg} />
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <Compass className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-mono text-3xl text-fg">{Math.round(nav.bearingDeg)}°</span>
              <span className="text-lg text-muted-foreground">{nav.cardinal}</span>
            </div>
            <p className="text-sm text-fg">
              Distance <strong className="font-mono">{nav.distanceKm.toFixed(1)} km</strong> · ETA{" "}
              <strong className="font-mono">{etaText(nav.etaMin)}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              {start.name || "départ"} → {dest.name || "destination"} · cap vrai (ajouter la
              déclinaison magnétique si boussole)
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
          Choisis un <strong>départ</strong> (bouton « Position GPS », un lieu, ou des coordonnées) et
          une <strong>destination</strong> pour obtenir le cap et la distance.
        </p>
      )}

      {nav ? (
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
              Aucun phénomène capté à moins de 25 km de la ligne droite, au dernier relevé. Le terrain
              (oueds, dunes, champs de mines) se reconnaît à l'œil — ceci n'est pas un relevé de route.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {hazards.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                  <Badge tone={threatTone((h.level ?? "moderee") as Threat)}>{h.level ?? "—"}</Badge>
                  <Badge>{KIND_LABEL[h.kind as keyof typeof KIND_LABEL] ?? h.kind}</Badge>
                  <span className="text-fg">{h.title}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    à {Math.round(h.alongKm)} km sur l'axe · {Math.round(h.offsetKm)} km à {h.side}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <p className="rounded-md border border-border bg-surface px-4 py-2 text-[11px] text-muted-foreground">
        Navigation directe (orthodromie), cap vrai — pas d'itinéraire routier, pas de guidage d'arme.
        Les obstacles sont ceux captés (phénomènes réels) ; le relief et les pistes se lisent sur
        l'imagerie et à l'œil. Réception seule.
      </p>
    </section>
  );
}
