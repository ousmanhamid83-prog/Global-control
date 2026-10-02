import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useVigilair } from "@/lib/vigilair/store";
import {
  formatAge,
  freshness,
  linkState,
  useTelemetry,
  useWallClock,
} from "@/lib/vigilair/telemetry";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "crit" | "idle";

const LED: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit syn-led-crit",
  idle: "bg-muted",
};

const INK: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  idle: "text-muted-foreground",
};

function Cell({ tone, label, children }: { tone: Tone; label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-r border-border px-3">
      <span className={cn("size-1.5 rounded-full", LED[tone])} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", INK[tone])}>{children}</span>
    </div>
  );
}

const zTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** Barre d'état de console : l'état réel des liaisons, et l'âge de la donnée qui défile. */
export function ConsoleStatus() {
  const wall = useWallClock();
  const pic = useVigilair((s) => s.livePicture);
  const liveAt = useVigilair((s) => s.liveAt);
  const liveError = useVigilair((s) => s.liveError);
  const tracks = useVigilair((s) => s.tracks);
  const alerts = useVigilair((s) => s.alerts);
  const running = useVigilair((s) => s.running);
  const clockMode = useVigilair((s) => s.clockMode);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const { events } = useTelemetry();

  const sources = pic?.sources ?? [];
  const live = sources.filter((s) => linkState(s) === "live").length;
  const down = sources.filter((s) => linkState(s) === "injoignable").length;
  const linkTone: Tone = !pic
    ? liveError
      ? "crit"
      : "idle"
    : live === sources.length
      ? "ok"
      : live === 0
        ? "crit"
        : "warn";
  const age = liveAt ? wall - liveAt : null;
  const fresh = age == null ? null : freshness(age);
  const openAlerts = alerts.filter((a) => !a.acked).length;
  const tracksLive = tracks.filter((t) => t.idState !== "perdu").length;
  const last = events[0];

  return (
    <footer
      className="flex h-7 shrink-0 items-stretch border-t border-border bg-surface font-mono text-[10.5px] uppercase tracking-[0.06em]"
      aria-label="État du poste"
    >
      <Cell tone={linkTone} label="Liaisons">
        {pic ? `${live}/${sources.length}` : "—"}
        {down > 0 ? ` · ${down} injoignable${down > 1 ? "s" : ""}` : ""}
      </Cell>
      <Cell
        tone={fresh === "live" ? "ok" : fresh === "retard" ? "warn" : fresh === "perdu" ? "crit" : "idle"}
        label="Trame"
      >
        {age == null ? (liveError ? "réseau injoignable" : "en attente") : `il y a ${formatAge(age)}`}
      </Cell>
      <Cell tone={tracksLive > 0 ? "ok" : "idle"} label="Pistes">
        {tracksLive}
      </Cell>
      <Cell tone={openAlerts > 0 ? "crit" : "ok"} label="Alertes">
        {openAlerts}
      </Cell>
      <Cell
        tone={clockMode === "replay" ? "warn" : running ? "ok" : "warn"}
        label="Flux"
      >
        {clockMode === "replay" ? "relecture AAR" : running ? "en marche" : "en pause"}
      </Cell>
      <Cell tone={ewArmed ? "warn" : "ok"} label="Émission">
        {ewArmed ? "RF armé" : "aucune"}
      </Cell>
      <Link
        to="/journal"
        className="flex min-w-0 flex-1 items-center gap-2 px-3 text-muted-foreground hover:bg-secondary/60 hover:text-fg"
        title="Journal du poste"
      >
        {last ? (
          <>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                last.tone === "crit"
                  ? "bg-crit"
                  : last.tone === "warn"
                    ? "bg-warn"
                    : last.tone === "ok"
                      ? "bg-ok"
                      : "bg-primary",
              )}
              aria-hidden
            />
            <span className="shrink-0 tabular-nums">{zTime(last.at)} Z</span>
            <span className="truncate normal-case tracking-normal text-fg">{last.text}</span>
          </>
        ) : (
          <span>Aucun événement</span>
        )}
      </Link>
      <div className="flex shrink-0 items-center border-l border-border px-3 text-muted-foreground">
        COP/21
      </div>
    </footer>
  );
}
