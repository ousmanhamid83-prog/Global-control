import { focusLakeRoute, placeGpsZone, placePreset } from "@/lib/vigilair/place-zone";
import { PERSONNEL_LIMIT, ZONE_PRESETS, zoneReadout } from "@/lib/vigilair/passability";
import { LAKE_ROUTES, routeById, routeKm, routeLabel } from "@/lib/vigilair/lake-routes";
import { RANGE_AXES } from "@/lib/vigilair/terrain";
import { formatCoord, formatRange } from "@/lib/vigilair/geo";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

export function GpsZoneStrip() {
  const copTool = useVigilair((s) => s.copTool);
  const setCopTool = useVigilair((s) => s.setCopTool);
  const gpsZone = useVigilair((s) => s.gpsZone);
  const setGpsZone = useVigilair((s) => s.setGpsZone);
  const lakeRouteId = useVigilair((s) => s.lakeRouteId);
  const lac = RANGE_AXES.find((a) => a.id === "lac");
  const route = routeById(lakeRouteId);

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-1.5" data-gps="1">
      <div className="flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          data-tool="zone"
          aria-pressed={copTool === "zone"}
          title="Clic sur la carte : cercle GPS réel, n'importe où. Afrique, Moyen-Orient, Europe, reste du monde."
          onClick={() => setCopTool(copTool === "zone" ? "lock" : "zone")}
          className={cn(
            "h-11 shrink-0 rounded-md px-3 text-xs transition-colors duration-150",
            copTool === "zone" ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
          )}
        >
          Zone GPS
        </button>
        {ZONE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-zone={p.id}
            title={`${p.note} · ${formatCoord(p.lat, p.lon)}`}
            onClick={() => placePreset(p)}
            className={cn(
              "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
              gpsZone?.id === p.id ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
            )}
          >
            {p.name}
          </button>
        ))}
        {lac ? (
          <button
            type="button"
            data-live="lac"
            title="Lac Tchad en IR géostationnaire, presque temps réel. Pas un homme."
            onClick={() =>
              placeGpsZone(lac.lat, lac.lon, {
                id: "lac-live",
                name: "Lac Tchad",
                region: "afrique",
                radiusKm: 28,
                scale: "approche",
                layer: "ir",
              })
            }
            className={cn(
              "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
              gpsZone?.id === "lac-live"
                ? "bg-secondary text-fg"
                : "bg-bg/80 text-muted-foreground hover:text-fg",
            )}
          >
            Lac IR
          </button>
        ) : null}
        {LAKE_ROUTES.map((r) => (
          <button
            key={r.id}
            type="button"
            data-lake={r.id}
            data-lake-km={String(Math.round(routeKm(r)))}
            title={r.note}
            aria-pressed={lakeRouteId === r.id}
            onClick={() => focusLakeRoute(r.id)}
            className={cn(
              "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
              lakeRouteId === r.id
                ? "bg-secondary text-fg"
                : "bg-bg/80 text-muted-foreground hover:text-fg",
            )}
          >
            {r.short} {formatRange(routeKm(r))}
          </button>
        ))}
        {gpsZone ? (
          <button
            type="button"
            onClick={() => setGpsZone(null)}
            className="h-11 shrink-0 rounded-md px-3 text-xs text-muted-foreground hover:text-fg"
          >
            Effacer
          </button>
        ) : null}
      </div>
      {gpsZone ? (
        <div data-gps-readout="1" data-gps-mode={gpsZone.mode} data-gps-status={gpsZone.status} className="px-1 pb-1">
          <p className="font-mono text-xs text-fg">{zoneReadout(gpsZone)}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            N {formatCoord(gpsZone.north.lat, gpsZone.north.lon)} · E{" "}
            {formatCoord(gpsZone.east.lat, gpsZone.east.lon)}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            S {formatCoord(gpsZone.south.lat, gpsZone.south.lon)} · O{" "}
            {formatCoord(gpsZone.west.lat, gpsZone.west.lon)}
            {gpsZone.source ? ` · ${gpsZone.source}` : ""}
          </p>
          <p className="mt-0.5 max-w-3xl text-xs leading-snug text-muted-foreground">
            {gpsZone.note} {PERSONNEL_LIMIT}
          </p>
        </div>
      ) : null}
      {route ? (
        <div data-lake-readout="1" data-lake-craft={route.craft} className="px-1 pb-1">
          <p className="font-mono text-xs text-fg">{routeLabel(route)}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {route.waypoints.map((p) => p.name).join(" → ")}
          </p>
          <p className="mt-0.5 max-w-3xl text-xs leading-snug text-muted-foreground">{route.note}</p>
        </div>
      ) : null}
      {!gpsZone && !route ? (
        <p className="px-1 text-xs text-muted-foreground" data-gps-hint="1">
          Zone GPS : clic n'importe où. Axes du lac : embarcadères réels. Jet ski seulement sur la cuvette sud. Le bassin nord, vers Nguigmi, n'a pas de route.
        </p>
      ) : null}
    </div>
  );
}
