import { Link } from "@tanstack/react-router";
import { Radar, ShieldAlert, ShieldCheck, ShieldOff, Target, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import { threatTone } from "@/lib/vigilair/format";
import { COP_LOCK_MSG } from "@/lib/vigilair/guard";
import { setCopLock } from "@/lib/vigilair/guard-ops";
import { detectRaids } from "@/lib/vigilair/raid";
import { withChefSeal } from "@/lib/vigilair/seal-client";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "crit";

const TONE_BAR: Record<Tone, string> = {
  ok: "border-l-ok bg-surface",
  warn: "border-l-warn bg-warn/10",
  crit: "border-l-crit bg-crit/15",
};

const TONE_ICON: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", crit: "text-crit" };

const ACTION =
  "inline-flex h-7 shrink-0 items-center rounded-sm px-2.5 font-mono text-[11px] uppercase tracking-wider text-fg hover:bg-secondary";

/**
 * Barre de situation : toujours là, toujours à la même hauteur. Elle remplace les bannières
 * qui apparaissaient en poussant la page (et le radar) de 50 px sous le curseur de l'opérateur.
 * Ordre : COP figé, intrusion de bulle, raid / menace, approche de bulle, alerte, veille.
 */
export function SituationBar() {
  const tracks = useVigilair((s) => s.tracks);
  const lock = useVigilair((s) => s.copLock);
  const setLock = useVigilair((s) => s.setCopLock);
  const zonePicture = useVigilair((s) => s.zonePicture);
  const instruction = useVigilair((s) => s.instruction);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const { isSuperadmin } = useStaff();

  const { posture, reason, recs } = computePosture(tracks);
  const raid = detectRaids(tracks)[0];
  const intrusion = zonePicture.filter((z) => z.level === "intrusion");
  const approche = zonePicture.filter((z) => z.level === "approche");
  const inj = instruction ? "INJECT · " : "";
  const zoneLine = (list: typeof zonePicture) =>
    list
      .map((z) => {
        const n = z.inside.filter((c) => c.uas).length || z.approaching.filter((c) => c.uas).length;
        return `${z.zone.name} · ${n} piste${n > 1 ? "s" : ""}`;
      })
      .join(" · ");

  let tone: Tone = "ok";
  let Icon: LucideIcon = ShieldCheck;
  let title = postureLabel(posture);
  let body = reason;
  let side: ReactNode = <span className="truncate text-xs text-muted-foreground">{recs[0]}</span>;

  if (lock?.locked) {
    tone = "crit";
    Icon = ShieldOff;
    title = "COP figé · tentative d'intrusion";
    body = lock.reason || COP_LOCK_MSG;
    side = isSuperadmin ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => {
          void withChefSeal(() => setCopLock({ data: { locked: false, reason: "" } }))
            .then((row) => setLock(row))
            .catch(() => undefined);
        }}
      >
        Lever le verrou
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">Chef alerté · lecture seule</span>
    );
  } else if (intrusion.length > 0) {
    tone = "crit";
    Icon = Target;
    title = `${inj}Intrusion de bulle`;
    body = zoneLine(intrusion);
    side = (
      <Link to="/zones" className={ACTION}>
        Bulles
      </Link>
    );
  } else if (raid || posture === "menace") {
    tone = "crit";
    Icon = ShieldAlert;
    title = raid
      ? `${inj}Raid ${raid.corridor} · ${raid.count} pistes`
      : instruction
        ? "INJECT · Menace (formation)"
        : "Menace proche";
    body = raid
      ? `${raid.leadCallsign} · ${raid.originLabels.join(" / ")} · couloir ${raid.corridor}`
      : reason;
    side = (
      <>
        {raid ? (
          <Badge tone={threatTone(raid.worst)}>{raid.worst}</Badge>
        ) : (
          <Badge tone="crit">menace</Badge>
        )}
        {raid ? (
          <button type="button" className={ACTION} onClick={() => lockTrack(raid.trackIds[0] ?? null)}>
            Verrouiller
          </button>
        ) : null}
        {isSuperadmin && !ewArmed ? (
          <span className="text-xs text-muted-foreground">Effecteur RF désarmé</span>
        ) : null}
        <Link to="/radar" className={cn(ACTION, "bg-secondary")}>
          <Radar className="mr-1.5 size-3.5" aria-hidden />
          PPI
        </Link>
      </>
    );
  } else if (approche.length > 0) {
    tone = "warn";
    Icon = Target;
    title = `${inj}Approche de bulle`;
    body = zoneLine(approche);
    side = (
      <Link to="/zones" className={ACTION}>
        Bulles
      </Link>
    );
  } else if (posture === "alerte") {
    tone = "warn";
    Icon = TriangleAlert;
  }

  return (
    <div
      data-situation={tone}
      role={tone === "ok" ? "status" : "alert"}
      aria-live={tone === "crit" ? "assertive" : "polite"}
      className={cn(
        "flex h-10 shrink-0 items-center gap-3 border-b border-l-4 border-border px-4",
        TONE_BAR[tone],
      )}
    >
      <Icon className={cn("size-4 shrink-0", TONE_ICON[tone])} aria-hidden />
      <p
        className={cn(
          "shrink-0 font-display text-sm font-semibold uppercase tracking-[0.08em]",
          tone === "ok" ? "text-ok" : "text-fg",
        )}
      >
        {title}
      </p>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{body}</p>
      <div className="flex max-w-[45%] min-w-0 shrink-0 items-center justify-end gap-2">{side}</div>
    </div>
  );
}
