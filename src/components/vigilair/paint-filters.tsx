import { Badge } from "@/components/ui/badge";
import {
  IFF_FILTER_ORDER,
  THREAT_FLOOR_ORDER,
  iffFilterLabel,
  threatFloorLabel,
  type IffFilter,
  type ThreatFloor,
} from "@/lib/vigilair/iff";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

const CHIP =
  "h-9 rounded-md px-3 text-xs transition-colors duration-150";

export function PaintFilters({
  variant = "overlay",
}: {
  variant?: "overlay" | "rail";
}) {
  const threatFloor = useVigilair((s) => s.threatFloor);
  const iffFilter = useVigilair((s) => s.iffFilter);
  const setThreatFloor = useVigilair((s) => s.setThreatFloor);
  const setIffFilter = useVigilair((s) => s.setIffFilter);
  const cycleThreatFloor = useVigilair((s) => s.cycleThreatFloor);
  const cycleIffFilter = useVigilair((s) => s.cycleIffFilter);

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
          {IFF_FILTER_ORDER.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setIffFilter(f)}
              className={cn(
                "h-9 rounded-sm px-2.5 text-xs transition-colors duration-150",
                iffFilter === f
                  ? f === "m4"
                    ? "bg-ok/20 text-ok"
                    : f === "sans-m4"
                      ? "bg-warn/20 text-warn"
                      : "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-fg",
              )}
              aria-pressed={iffFilter === f}
            >
              {iffFilterLabel(f)}
            </button>
          ))}
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
          threatFloor !== "ALL"
            ? threatFloor === "critique"
              ? "bg-crit/20 text-crit"
              : "bg-warn/20 text-warn"
            : "bg-bg/80 text-muted-foreground hover:text-fg",
        )}
        aria-pressed={threatFloor !== "ALL"}
        title="Filtre de menace (T)"
      >
        {threatFloor === "ALL" ? "Menace" : threatFloorLabel(threatFloor)}
      </button>
      <button
        type="button"
        onClick={cycleIffFilter}
        className={cn(
          CHIP,
          iffFilter === "m4"
            ? "bg-ok/20 text-ok"
            : iffFilter === "sans-m4"
              ? "bg-warn/20 text-warn"
              : "bg-bg/80 text-muted-foreground hover:text-fg",
        )}
        aria-pressed={iffFilter !== "ALL"}
        title="Filtre IFF Mode 4 (I)"
      >
        {iffFilterLabel(iffFilter)}
      </button>
    </>
  );
}

export function IffBadge({
  m4,
}: {
  m4: "absent" | "valid" | "invalid" | "timeout" | "demande";
}) {
  if (m4 === "valid") return <Badge tone="ok">M4+</Badge>;
  if (m4 === "invalid") return <Badge tone="crit">M4-</Badge>;
  if (m4 === "timeout") return <Badge tone="warn">M4?</Badge>;
  if (m4 === "demande") return <Badge tone="warn">M4…</Badge>;
  return <Badge>sans M4</Badge>;
}

export type { IffFilter, ThreatFloor };
