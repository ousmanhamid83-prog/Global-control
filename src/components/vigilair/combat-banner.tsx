import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { computePosture } from "@/lib/vigilair/defense";
import { detectRaids } from "@/lib/vigilair/raid";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import { threatTone } from "@/lib/vigilair/format";

export function CombatBanner() {
  const tracks = useVigilair((s) => s.tracks);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const { isSuperadmin } = useStaff();
  const instruction = useVigilair((s) => s.instruction);
  const raids = detectRaids(tracks);
  const { posture, reason } = computePosture(tracks);
  const raid = raids[0];
  const hot = Boolean(raid) || posture === "menace";
  if (!hot) return null;

  const title = raid
    ? `${instruction ? "INJECT · " : ""}RAID ${raid.corridor.toUpperCase()} · ${raid.count} pistes`
    : instruction
      ? "INJECT · MENACE (formation)"
      : "MENACE PROCHE";
  const body = raid
    ? `${raid.leadCallsign} · ${raid.originLabels.join(" / ")} · couloir ${raid.corridor}`
    : reason;

  return (
    <div
      className="combat-banner flex items-center gap-3 border-b border-crit/40 bg-crit/15 px-4 py-2"
      role="status"
      aria-live="assertive"
    >
      <ShieldAlert className="size-5 shrink-0 text-crit" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold tracking-wide text-fg">
          {title}
        </p>
        <p className="truncate text-xs text-muted-foreground">{body}</p>
      </div>
      {raid ? (
        <Badge tone={threatTone(raid.worst)}>{raid.worst}</Badge>
      ) : (
        <Badge tone="crit">menace</Badge>
      )}
      {raid ? (
        <button
          type="button"
          className="hidden h-9 shrink-0 rounded-md px-3 text-xs text-fg hover:bg-secondary sm:inline-flex sm:items-center"
          onClick={() => lockTrack(raid.trackIds[0] ?? null)}
        >
          Verrouiller
        </button>
      ) : null}
      {isSuperadmin && !ewArmed ? (
        <span className="hidden text-xs text-muted-foreground lg:inline">
          Effecteur RF désarmé
        </span>
      ) : null}
      <Link
        to="/radar"
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-secondary px-3 text-xs text-fg"
      >
        PPI
      </Link>
    </div>
  );
}
