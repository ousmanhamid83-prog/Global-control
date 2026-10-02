import { armMeasure } from "@/components/vigilair/radar-map";
import { AO } from "@/lib/vigilair/geo";
import { useVigilair } from "@/lib/vigilair/store";
import {
  PEAKS,
  RANGE_AXES,
  axisLeg,
  frameAxis,
  peakById,
  peakLeg,
  peakSense,
} from "@/lib/vigilair/terrain";
import { sceneAgeLabel } from "@/lib/vigilair/sat";
import { cn } from "@/lib/utils";

export function AxisStrip() {
  const axisId = useVigilair((s) => s.axisId);
  const peakId = useVigilair((s) => s.peakId);
  const showPeaks = useVigilair((s) => s.showPeaks);
  const satLayer = useVigilair((s) => s.satLayer);
  const setAxisId = useVigilair((s) => s.setAxisId);
  const setPeakId = useVigilair((s) => s.setPeakId);
  const setShowPeaks = useVigilair((s) => s.setShowPeaks);
  const setMapScale = useVigilair((s) => s.setMapScale);
  const setSatLayer = useVigilair((s) => s.setSatLayer);
  const setCopTool = useVigilair((s) => s.setCopTool);
  const satMeta = useVigilair((s) => s.satMeta);
  const setViewOrigin = useVigilair((s) => s.setViewOrigin);
  const peak = peakById(peakId);

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-1.5" data-axes="1">
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="shrink-0 px-1 font-mono text-[11px] text-muted-foreground">FTTJ</span>
        {RANGE_AXES.map((ax) => {
          const leg = axisLeg(ax);
          const on = axisId === ax.id;
          return (
            <button
              key={ax.id}
              type="button"
              data-axis={ax.id}
              data-km={String(Math.round(leg.km))}
              title={`${ax.name} · ${ax.note} · ${leg.label}`}
              aria-pressed={on}
              onClick={() => {
                if (on) {
                  setAxisId(null);
                  setCopTool("lock");
                  armMeasure(null);
                  return;
                }
                setAxisId(ax.id);
                setMapScale(frameAxis());
                setCopTool("mesure");
                armMeasure(
                  { lat: AO.airport.lat, lon: AO.airport.lon },
                  { lat: ax.lat, lon: ax.lon },
                );
              }}
              className={cn(
                "h-11 shrink-0 rounded-md px-3 font-mono text-xs tabular-nums transition-colors duration-150",
                on ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
              )}
            >
              {ax.short} {leg.label.split("  ")[0]}
            </button>
          );
        })}
        <button
          type="button"
          data-massifs="1"
          aria-pressed={showPeaks}
          title="Catalogue de sommets. IR et thermique voient le massif, pas les gens à l'intérieur."
          onClick={() => {
            const next = !showPeaks;
            setShowPeaks(next);
            if (!next) {
              setPeakId(null);
              return;
            }
            setMapScale("monde");
            if (satLayer === "vis" || satLayer === "nv") setSatLayer("ir");
          }}
          className={cn(
            "h-11 shrink-0 rounded-md px-3 text-xs transition-colors duration-150",
            showPeaks ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
          )}
        >
          Massifs
        </button>
      </div>
      {showPeaks ? (
        <div className="flex items-center gap-1 overflow-x-auto" data-peak-row="1">
          {PEAKS.map((pk) => {
            const on = peakId === pk.id;
            return (
              <button
                key={pk.id}
                type="button"
                data-peak={pk.id}
                title={`${pk.name} · ${pk.country} · ${pk.elevM} m`}
                aria-pressed={on}
                onClick={() => {
                  if (on) {
                    setPeakId(null);
                    return;
                  }
                  setPeakId(pk.id);
                  setViewOrigin({ lat: pk.lat, lon: pk.lon });
                  setMapScale("approche");
                  setSatLayer("ir");
                }}
                className={cn(
                  "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
                  on ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
                )}
              >
                {pk.name} {pk.elevM} m
              </button>
            );
          })}
        </div>
      ) : null}
      {peak ? (
        <div data-peak-readout="1" className="px-1 pb-1">
          <p className="font-mono text-xs text-fg">
            {peak.name} · {peak.country} · {peak.elevM.toLocaleString("fr-FR")} m · depuis FTTJ{" "}
            {peakLeg(peak).label}
            {satLayer === "ir" || satLayer === "th"
              ? ` · scène ${sceneAgeLabel(satLayer === "ir" ? (satMeta?.irAt ?? null) : (satMeta?.thAt ?? null))}`
              : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button
              type="button"
              data-peak-layer="ir"
              onClick={() => setSatLayer("ir")}
              className={cn(
                "h-11 rounded-md px-3 text-xs",
                satLayer === "ir" ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground",
              )}
            >
              IR 10.5
            </button>
            <button
              type="button"
              data-peak-layer="th"
              onClick={() => setSatLayer("th")}
              className={cn(
                "h-11 rounded-md px-3 text-xs",
                satLayer === "th" ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground",
              )}
            >
              Thermique
            </button>
            <button
              type="button"
              data-peak-layer="rel"
              onClick={() => setSatLayer("rel")}
              className={cn(
                "h-11 rounded-md px-3 text-xs",
                satLayer === "rel" ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground",
              )}
            >
              Relief
            </button>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-snug text-muted-foreground">{peakSense(satLayer)}</p>
        </div>
      ) : showPeaks ? (
        <p className="px-1 pb-1 text-xs leading-snug text-muted-foreground" data-peak-hint="1">
          Catalogue de sommets, pas toutes les collines. IR et thermique ~1 km : forme thermique du
          massif. Personne à l'intérieur — non.
        </p>
      ) : null}
    </div>
  );
}
