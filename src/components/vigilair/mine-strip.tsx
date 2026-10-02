import { focusMine } from "@/lib/vigilair/place-zone";
import {
  MINE_REGION_LABEL,
  MINE_WATCH,
  MINES,
  mineById,
  type MineRegion,
} from "@/lib/vigilair/mines";
import { formatAzimut, formatCoord, formatRange, haversineKm, headingBetween, AO } from "@/lib/vigilair/geo";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

const ORDER: MineRegion[] = ["tchad", "sahel", "maghreb", "est"];

export function MineStrip() {
  const mineId = useVigilair((s) => s.mineId);
  const picture = useVigilair((s) => s.zonePicture);
  const mine = mineById(mineId);
  const hot = picture.filter(
    (z) => z.zone.kind === "mine" && (z.level === "intrusion" || z.level === "approche"),
  );

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-1.5" data-mines="1">
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="shrink-0 px-1 font-mono text-[11px] text-muted-foreground">Mines</span>
        {ORDER.map((region) => (
          <span key={region} className="contents">
            <span className="shrink-0 px-1 text-[11px] text-muted-foreground">
              {MINE_REGION_LABEL[region]}
            </span>
            {MINES.filter((m) => m.region === region).map((m) => {
              const alert = hot.some((z) => z.zone.id === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  data-mine={m.id}
                  title={`${m.name} · ${m.operator} · ${m.note}`}
                  aria-pressed={mineId === m.id}
                  onClick={() => focusMine(m.id)}
                  className={cn(
                    "h-11 shrink-0 rounded-md px-3 font-mono text-xs transition-colors duration-150",
                    mineId === m.id
                      ? "bg-secondary text-fg"
                      : alert
                        ? "bg-bg/80 text-crit"
                        : "bg-bg/80 text-muted-foreground hover:text-fg",
                  )}
                >
                  {m.short}
                </button>
              );
            })}
          </span>
        ))}
      </div>
      {mine ? (
        <div data-mine-readout="1" className="px-1 pb-1">
          <p className="font-mono text-xs text-fg">
            {mine.name} · {formatCoord(mine.lat, mine.lon)} · rayon {formatRange(mine.radiusKm)} ·{" "}
            {mine.commodity} · depuis FTTJ{" "}
            {formatRange(haversineKm(AO.airport.lat, AO.airport.lon, mine.lat, mine.lon))} az{" "}
            {formatAzimut(headingBetween(AO.airport.lat, AO.airport.lon, mine.lat, mine.lon))}
          </p>
          <p className="mt-0.5 max-w-3xl text-xs leading-snug text-muted-foreground">
            {mine.operator}. {mine.note} {MINE_WATCH}
          </p>
        </div>
      ) : (
        <p className="px-1 text-xs text-muted-foreground" data-mine-hint="1">
          {MINES.length} sites. La photo montre la fosse, les pistes et les engins qui y sont.
          {hot.length > 0 ? ` Alerte : ${hot.map((z) => z.zone.name).join(", ")}.` : ""}
        </p>
      )}
    </div>
  );
}
