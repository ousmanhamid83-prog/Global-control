import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import { useVigilair } from "@/lib/vigilair/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function DefenseStrip() {
  const tracks = useVigilair((s) => s.tracks);
  const { posture, reason, recs } = computePosture(tracks);
  const tone =
    posture === "menace" ? "crit" : posture === "alerte" ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-3 py-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{postureLabel(posture)}</Badge>
        <p className="truncate text-xs text-muted-foreground">{reason}</p>
      </div>
      <p
        className={cn(
          "truncate text-xs text-muted-foreground sm:ml-auto sm:max-w-md sm:text-right",
        )}
      >
        {recs[0]}
      </p>
    </div>
  );
}
