import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { threatTone } from "@/lib/vigilair/format";
import { useVigilair } from "@/lib/vigilair/store";

export function AlertStrip() {
  const alerts = useVigilair((s) => s.alerts);
  const ackAlert = useVigilair((s) => s.ackAlert);
  const ackAll = useVigilair((s) => s.ackAll);
  const select = useVigilair((s) => s.select);
  const open = alerts.filter((a) => !a.acked).slice(0, 4);
  if (open.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-border bg-surface px-3 py-2">
      <div className="flex min-w-0 flex-1 gap-2">
        {open.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              if (a.lat != null && a.lon != null) {
                useVigilair.getState().openCapture({
                  lat: a.lat,
                  lon: a.lon,
                  kind: "scene",
                  title: a.title,
                  body: a.body,
                  source: "alerte",
                });
              } else {
                select(a.trackId);
              }
              ackAlert(a.id);
            }}
            className="flex min-w-[220px] flex-1 flex-col rounded-md bg-secondary px-3 py-2 text-left"
          >
            <div className="flex items-center gap-2">
              <Badge tone={threatTone(a.level)}>{a.level}</Badge>
              <span className="truncate text-xs font-medium">{a.title}</span>
            </div>
            <span className="truncate text-xs text-muted-foreground">{a.body}</span>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={ackAll} className="shrink-0">
        Acquitter
      </Button>
    </div>
  );
}
