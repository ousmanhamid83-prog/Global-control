import { Link } from "@tanstack/react-router";
import { Clock, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatClock, formatDate } from "@/lib/vigilair/format";
import { useVigilair } from "@/lib/vigilair/store";
import { formatWatchDuration, shortWatchLabel, snapLine } from "@/lib/vigilair/watch";

export function WatchStrip() {
  const watch = useVigilair((s) => s.watch);
  const loaded = useVigilair((s) => s.watchLoaded);
  const now = useVigilair((s) => s.now);
  const watchMode = useVigilair((s) => s.watchMode);
  const watchDimmed = useVigilair((s) => s.watchDimmed);
  const watchWokeReason = useVigilair((s) => s.watchWokeReason);

  const modeBadge = watchMode ? (
    <Badge tone={watchDimmed ? "ok" : "crit"}>
      <Eye className="mr-1 size-3" />
      {watchDimmed ? "Veille armée" : `Réveil · ${watchWokeReason ?? "contact"}`}
    </Badge>
  ) : null;

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="inline-block h-4 w-32 animate-pulse rounded-sm bg-secondary" />
      </div>
    );
  }

  if (!watch) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        {modeBadge}
        <Badge tone="warn">
          <Clock className="mr-1 size-3" />
          Quart vacant
        </Badge>
        <p className="text-xs text-muted-foreground">
          {watchMode
            ? "Veille machine — le COP reste live. Prendre le poste pour le gel capteurs."
            : "Aucun agent n'a pris le poste. Gel capteurs à la prise."}
        </p>
        <Link
          to="/quart"
          className="ml-auto inline-flex h-11 items-center rounded-md px-3 text-xs text-fg hover:bg-secondary"
        >
          Prendre le poste
        </Link>
      </div>
    );
  }

  const opened = Date.parse(watch.openedAt);
  const held = Number.isFinite(opened) ? now - opened : 0;
  const fttj = watch.snapIn.cat;

  return (
    <div className="flex border-b border-border bg-surface px-3 py-2 flex-row items-center gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {modeBadge}
        <Badge tone="ok">
          <Clock className="mr-1 size-3" />
          Quart · {shortWatchLabel(watch.openedLabel)} · {formatWatchDuration(held)}
        </Badge>
        {fttj ? <Badge tone={fttj === "VFR" ? "ok" : fttj === "MVFR" ? "warn" : "crit"}>{fttj}</Badge> : null}
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {snapLine(watch.snapIn)}
        </p>
      </div>
      <Link
        to="/quart"
        className="inline-flex h-11 shrink-0 items-center rounded-md px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-fg ml-auto"
      >
        Relève · {Number.isFinite(opened) ? formatClock(opened) : formatDate(now)} WAT
      </Link>
    </div>
  );
}