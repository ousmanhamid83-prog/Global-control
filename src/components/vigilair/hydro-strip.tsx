import { focusWater, toggleMarine } from "@/lib/vigilair/place-zone";
import { SCALE } from "@/lib/vigilair/geo";
import {
  CHART_NOTE,
  HYDRO,
  HYDRO_REGION_LABEL,
  hydroById,
  hydroLabel,
  sensorVerdict,
  type HydroRegion,
} from "@/lib/vigilair/hydro";
import { layerGsd, pixelSpan } from "@/lib/vigilair/tiles";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

const ORDER: HydroRegion[] = ["tchad", "afrique", "monde"];

export function HydroStrip() {
  const marine = useVigilair((s) => s.marine);
  const waterId = useVigilair((s) => s.waterId);
  const satLayer = useVigilair((s) => s.satLayer);
  const mapScale = useVigilair((s) => s.mapScale);
  const viewOrigin = useVigilair((s) => s.viewOrigin);
  const capture = useVigilair((s) => s.capture);
  const water = hydroById(waterId);
  const live = layerGsd(satLayer, SCALE[mapScale].tileZ, capture?.lat ?? viewOrigin.lat);
  const pxHomme = pixelSpan(live.m, "homme");
  const pxVoiture = pixelSpan(live.m, "voiture");

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-1.5" data-chart="1">
      <div className="flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          data-marine={marine ? "1" : "0"}
          aria-pressed={marine}
          title={CHART_NOTE}
          onClick={() => toggleMarine()}
          className={cn(
            "h-11 shrink-0 rounded-md px-3 text-xs transition-colors duration-150",
            marine ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
          )}
        >
          Carte marine
        </button>
        {ORDER.map((region) => (
          <span key={region} className="contents">
            <span className="shrink-0 px-1 text-[11px] text-muted-foreground">
              {HYDRO_REGION_LABEL[region]}
            </span>
            {HYDRO.filter((w) => w.region === region).map((w) => (
              <button
                key={w.id}
                type="button"
                data-water={w.id}
                title={`${w.name}. ${w.note}`}
                aria-pressed={waterId === w.id}
                onClick={() => focusWater(w.id)}
                className={cn(
                  "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
                  waterId === w.id
                    ? "bg-secondary text-fg"
                    : "bg-bg/80 text-muted-foreground hover:text-fg",
                )}
              >
                {w.short}
              </button>
            ))}
          </span>
        ))}
      </div>
      <p
        className="px-1 text-xs leading-snug text-muted-foreground"
        data-chart-verdict="1"
        data-px-homme-cls={pxHomme.cls}
        data-px-voiture-cls={pxVoiture.cls}
      >
        {water ? `${hydroLabel(water)}. ${water.note} ` : marine ? `${CHART_NOTE} ` : ""}
        {sensorVerdict(satLayer, live.m)}
      </p>
    </div>
  );
}
