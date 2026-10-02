import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useVigilair } from "@/lib/vigilair/store";
import {
  ageStatus,
  useTelemetry,
  useWallClock,
  type FeedStatus,
  type FeedTone,
} from "@/lib/vigilair/telemetry";


const LED: Record<FeedTone, string> = {
  ok: "bg-ok syn-led-live",
  warn: "bg-warn",
  crit: "bg-crit syn-led-crit",
  idle: "bg-muted",
};

const INK: Record<FeedTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  idle: "text-muted-foreground",
};

/** Voyant d'en-tête de graphique : la donnée est-elle vivante, et depuis quand ? */
export function FeedLamp({ status }: { status: FeedStatus }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] tabular-nums",
        INK[status.tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", LED[status.tone])} aria-hidden />
      {status.text}
    </span>
  );
}

const SERIES = [
  { key: "tracks", name: "Pistes live", color: "var(--color-series-1)" },
  { key: "alerts", name: "Alertes ouvertes", color: "var(--color-warn)" },
  { key: "links", name: "Liaisons live", color: "var(--color-ok)" },
] as const;

const WINDOW_S = 360;
const TICKS = [-360, -300, -240, -180, -120, -60, 0];

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  color: "var(--color-fg)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
};

/** Télémétrie du poste : six minutes glissantes, échantillon toutes les 6 s, horloge murale. */
export function TelemetryCard() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const { samples } = useTelemetry();
  const wall = useWallClock();
  const last = samples[samples.length - 1];
  const sources = useVigilair((s) => s.livePicture?.sources.length ?? 10);
  const data = last
    ? samples.map((s) => ({ ...s, x: Math.round((s.at - last.at) / 1000) }))
    : [];
  const status: FeedStatus = last
    ? ageStatus(last.at, wall)
    : { tone: "idle", text: "Acquisition" };

  return (
    <section className="hud col-span-2 flex flex-col rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Télémétrie poste</h2>
        <span className="flex items-center gap-4">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
            6 min glissantes · pas 6 s
          </span>
          <FeedLamp status={status} />
        </span>
      </div>
      <dl className="mb-2 grid grid-cols-3 gap-2">
        {SERIES.map((s) => (
          <div key={s.key} className="border-l-2 pl-2" style={{ borderColor: s.color }}>
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
              {s.name}
            </dt>
            <dd className="font-display text-2xl font-semibold tabular-nums leading-tight">
              {last ? last[s.key] : "—"}
              {s.key === "links" ? (
                <span className="text-sm font-normal text-muted-foreground"> / {sources}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="console-chart min-h-0 flex-1">
        {ready && data.length > 1 ? (
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[-WINDOW_S, 0]}
                ticks={TICKS}
                tickFormatter={(v: number) => (v === 0 ? "0" : `${v / 60} min`)}
                stroke="var(--color-muted)"
                fontSize={10}
              />
              <YAxis stroke="var(--color-muted)" fontSize={10} allowDecimals={false} width={30} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => (Number(v) === 0 ? "dernier relevé" : `${v} s`)}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="stepAfter"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="flex h-[190px] items-center justify-center font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
            Acquisition des premiers échantillons…
          </p>
        )}
      </div>
    </section>
  );
}

const zTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);

const DOT: Record<"ok" | "warn" | "crit" | "info", string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  info: "bg-primary",
};

/** Fil d'événements du poste : liaisons, alertes, posture, raids, dans l'ordre où ils tombent. */
export function EventFeed() {
  const { events } = useTelemetry();
  return (
    <section className="hud flex min-h-0 flex-col rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Fil d'événements</h2>
        <Link
          to="/journal"
          className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-primary hover:underline"
        >
          Journal
        </Link>
      </div>
      {events.length ? (
        <ol className="h-[262px] overflow-y-auto font-mono text-[11px]" aria-live="polite">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline gap-2 border-b border-border/60 py-1.5 last:border-b-0"
            >
              <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", DOT[e.tone])} aria-hidden />
              <span className="shrink-0 tabular-nums text-muted-foreground">{zTime(e.at)} Z</span>
              <span className="min-w-0 truncate text-fg" title={e.text}>
                {e.text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="flex h-[262px] items-center justify-center font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
          Aucun événement depuis l'ouverture
        </p>
      )}
    </section>
  );
}

/**
 * Halo phosphore des courbes. Région en coordonnées utilisateur : en boîte englobante, une
 * courbe parfaitement plate (hauteur nulle) disparaîtrait sous le filtre.
 */
export function PhosphorDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <filter
          id="phosphor"
          filterUnits="userSpaceOnUse"
          x="-2000"
          y="-2000"
          width="6000"
          height="6000"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
