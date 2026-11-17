import { THREAT_FLOOR_ORDER, threatFloorLabel } from "@/lib/vigilair/iff";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

const CHIP =
  "h-9 shrink-0 rounded-md px-3 text-xs transition-colors duration-150";

export function PaintFilters({
  variant = "overlay",
}: {
  variant?: "overlay" | "rail";
}) {
  const threatFloor = useVigilair((s) => s.threatFloor);
  const declutter = useVigilair((s) => s.declutter);
  const setThreatFloor = useVigilair((s) => s.setThreatFloor);
  const cycleThreatFloor = useVigilair((s) => s.cycleThreatFloor);
  const toggleDeclutter = useVigilair((s) => s.toggleDeclutter);

  if (variant === "rail") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {THREAT_FLOOR_ORDER.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setThreatFloor(f)}
              className={cn(
                "h-9 rounded-sm px-2.5 text-xs transition-colors duration-150",
                threatFloor === f
                  ? f === "critique" || f === "elevee"
                    ? "bg-crit/20 text-crit"
                    : f === "moderee"
                      ? "bg-warn/20 text-warn"
                      : "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-fg",
              )}
              aria-pressed={threatFloor === f}
            >
              {threatFloorLabel(f)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={toggleDeclutter}
            className={cn(
              "h-9 rounded-sm px-2.5 text-xs transition-colors duration-150",
              declutter
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-fg",
            )}
            aria-pressed={declutter}
            title="Débruitage : ne garder que le trafic pertinent pour le site (D)"
          >
            Pertinent
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={cycleThreatFloor}
        className={cn(
          CHIP,
          "h-11 min-w-11 rounded-sm border border-border/80 font-mono text-[11px] uppercase tracking-wider",
          threatFloor !== "ALL"
            ? threatFloor === "critique"
              ? "bg-crit/20 text-crit"
              : "bg-warn/20 text-warn"
            : "bg-bg/85 text-muted-foreground hover:text-fg",
        )}
        aria-pressed={threatFloor !== "ALL"}
        title="Filtre de menace (T)"
      >
        {threatFloor === "ALL" ? "Menace" : threatFloorLabel(threatFloor)}
      </button>
      <button
        type="button"
        onClick={toggleDeclutter}
        className={cn(
          CHIP,
          "h-11 min-w-11 rounded-sm border border-border/80 font-mono text-[11px] uppercase tracking-wider",
          declutter ? "bg-primary text-primary-foreground" : "bg-bg/85 text-muted-foreground hover:text-fg",
        )}
        aria-pressed={declutter}
        title="Débruitage : trafic pertinent pour le site seulement (D)"
      >
        Pertinent
      </button>
    </>
  );
}
