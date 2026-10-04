import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import { detectRaids } from "@/lib/vigilair/raid";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import type { IdState } from "@/lib/vigilair/types";
import {
  freshness,
  LINK_LABEL,
  linkState,
  useTelemetry,
  useWallClock,
  type LinkState,
  type TelemetrySample,
} from "@/lib/vigilair/telemetry";
import { formatWatchDuration, shortWatchLabel } from "@/lib/vigilair/watch";

type Tone = "ok" | "warn" | "crit" | "idle";
type To = "/" | "/capteurs" | "/radar" | "/zones" | "/journal" | "/quart" | "/sentinelle" | "/division";

type SynNode = {
  id: string;
  col: number;
  y: number;
  h: number;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  to: To;
  /** Bloc capteur : état de liaison et âge du dernier relevé utile. */
  link?: { state: LinkState; age: string; ageTone: Tone };
  spark?: { values: number[]; label: string };
};

type SynLink = { from: string; to: string; tone: Tone; flow: boolean; side?: boolean };

export type SentinelStats = { open: number; ejected: number; auto: number; bindings: number };

const W = 1200;
const H = 470;
const COL_W = 184;
const GAP = 62;
const X0 = 16;
const colX = (c: number) => X0 + c * (COL_W + GAP);

const TONE: Record<Tone, string> = {
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  crit: "var(--color-crit)",
  idle: "var(--color-muted)",
};

const COLUMNS = ["01 · Liaisons", "02 · Fusion", "03 · Évaluation", "04 · Décision", "05 · Action · traces"];

/** Les onze liaisons réelles du poste, dans l'ordre du relevé. */
const SOURCES: { id: string; title: string }[] = [
  { id: "1090", title: "1090ES · réseau" },
  { id: "rx", title: "Antenne 1090" },
  { id: "metar", title: "METAR · NOAA" },
  { id: "taf", title: "TAF · NOAA" },
  { id: "sigmet", title: "SIGMET · OACI" },
  { id: "fttj", title: "FTTJ · AWC" },
  { id: "nic", title: "GNSS · NIC" },
  { id: "swpc", title: "Météo spatiale" },
  { id: "alert", title: "Alertes SWPC" },
  { id: "sol", title: "Soleil · FTTJ" },
  { id: "nat", title: "Phénomènes" },
];

const LINK_TONE: Record<LinkState, Tone> = {
  live: "ok",
  silence: "idle",
  injoignable: "warn",
  attente: "idle",
};

/** Chaîne d'identification, dans l'ordre où une piste la parcourt. */
const ID_MIX: { state: IdState; short: string; color: string }[] = [
  { state: "detecte", short: "dét", color: "var(--color-muted-foreground)" },
  { state: "classification", short: "clas", color: "var(--color-series-2)" },
  { state: "candidat", short: "cand", color: "var(--color-warn)" },
  { state: "confirme", short: "conf", color: "var(--color-ok)" },
  { state: "hors-mandat", short: "h-m", color: "var(--color-series-3)" },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// Budgets en caractères pour un bloc de 184 px (mono 10 px ≈ 6 px, titre espacé ≈ 6,8 px,
// valeur condensée 16 px ≈ 9,4 px). Vérifiés par mesure du rendu, au calme et sous charge.
const TITLE_MAX = 21;
const VALUE_MAX = 16;
const DETAIL_MAX = 26;
const LINE_MAX = 24;

function shortAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function Spark({
  x,
  y,
  w,
  h,
  values,
  color,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  values: number[];
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values
    .map((v, i) => `${(x + (n < 2 ? w : (i / (n - 1)) * w)).toFixed(1)},${(y + h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  const now = values[n - 1];
  return (
    <g aria-hidden>
      <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke="var(--color-border)" />
      {n > 1 ? (
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          className="syn-trace"
          style={{ color }}
        />
      ) : null}
      <text x={x} y={y - 5} className="fill-muted-foreground font-mono text-[9px]">
        {label}
      </text>
      {n > 0 ? (
        <text x={x + w} y={y - 5} textAnchor="end" className="font-mono text-[9px] tabular-nums" fill={color}>
          {now}
        </text>
      ) : null}
    </g>
  );
}

function IdBar({
  x,
  y,
  w,
  mix,
}: {
  x: number;
  y: number;
  w: number;
  mix: { state: IdState; short: string; color: string; n: number }[];
}) {
  const total = mix.reduce((a, m) => a + m.n, 0);
  let cx = x;
  const rows = [mix.slice(0, 3), mix.slice(3)];
  return (
    <g aria-hidden>
      <rect x={x} y={y} width={w} height={5} fill="var(--color-border)" />
      {total > 0
        ? mix.map((m) => {
            const sw = (m.n / total) * w;
            const r = <rect key={m.state} x={cx} y={y} width={sw} height={5} fill={m.color} />;
            cx += sw;
            return r;
          })
        : null}
      {rows.map((row, i) => (
        <text key={i} x={x} y={y + 20 + i * 14} className="font-mono text-[10px] tabular-nums">
          {row.map((m, j) => (
            <tspan key={m.state}>
              <tspan className="fill-muted-foreground">{`${j ? " · " : ""}${m.short} `}</tspan>
              <tspan fill={m.color}>{m.n}</tspan>
            </tspan>
          ))}
        </text>
      ))}
    </g>
  );
}

/**
 * Synoptique : la chaîne VIGILAIR telle qu'elle tourne, de la liaison à la trace. Chaque bloc lit
 * l'état réel du poste ; une particule ne circule que sur un lien où passe vraiment une donnée.
 */
export function Synoptique({ sentinel }: { sentinel: SentinelStats | null }) {
  const tracks = useVigilair((s) => s.tracks);
  const pic = useVigilair((s) => s.livePicture);
  const zonePicture = useVigilair((s) => s.zonePicture);
  const alerts = useVigilair((s) => s.alerts);
  const journal = useVigilair((s) => s.journal);
  const watch = useVigilair((s) => s.watch);
  const watchLoaded = useVigilair((s) => s.watchLoaded);
  const copLock = useVigilair((s) => s.copLock);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const now = useVigilair((s) => s.now);
  const { isSuperadmin } = useStaff();
  const { lastOk, samples } = useTelemetry();
  const wall = useWallClock();
  const reduced = useReducedMotion();

  const live = tracks.filter((t) => t.idState !== "perdu");
  const confirmed = live.filter((t) => t.idState === "confirme").length;
  const idMix = ID_MIX.map((m) => ({ ...m, n: live.filter((t) => t.idState === m.state).length }));
  const { posture, reason } = computePosture(tracks);
  const raids = detectRaids(tracks);
  const intrusion = zonePicture.filter((z) => z.level === "intrusion");
  const approche = zonePicture.filter((z) => z.level === "approche");
  const armed = zonePicture.filter((z) => z.zone.armed).length;
  const open = alerts.filter((a) => !a.acked);
  const sources = pic?.sources ?? [];
  const sourcesLive = sources.filter((s) => s.ok).length;
  const window6 = (key: keyof Omit<TelemetrySample, "at">) => samples.map((s) => s[key]);

  const sensorNodes: SynNode[] = SOURCES.map((src, i) => {
    const row = sources.find((s) => s.id === src.id);
    const state = pic ? linkState(row) : "attente";
    const ok = lastOk[src.id];
    const ageMs = ok ? wall - ok : null;
    const f = ageMs == null ? null : freshness(ageMs);
    return {
      id: `src-${src.id}`,
      col: 0,
      y: 34 + i * 40,
      h: 34,
      title: src.title,
      value: LINK_LABEL[state],
      detail: row?.detail ?? "aucun relevé",
      tone: LINK_TONE[state],
      to: "/capteurs",
      link: {
        state,
        age: ageMs == null ? "jamais" : shortAge(ageMs),
        ageTone: f === "live" ? "ok" : f === "retard" ? "warn" : "idle",
      },
    };
  });

  const zoneTone: Tone = intrusion.length ? "crit" : approche.length ? "warn" : "ok";
  const unackedCrit = open.some((a) => a.level === "critique");
  const nodes: SynNode[] = [
    ...sensorNodes,
    {
      id: "fusion",
      col: 1,
      y: 140,
      h: 190,
      title: "Fusion · ident",
      value: `${live.length} piste${live.length > 1 ? "s" : ""} live`,
      detail: `${confirmed} confirmée${confirmed > 1 ? "s" : ""} · ${sourcesLive}/${SOURCES.length} liaisons`,
      tone: live.length > 0 || sourcesLive > 0 ? "ok" : "idle",
      to: "/",
      spark: { values: [...window6("tracks"), live.length], label: "pistes · 6 min" },
    },
    {
      id: "menace",
      col: 2,
      y: 60,
      h: 78,
      title: "Menace · posture",
      value: postureLabel(posture),
      detail: reason,
      tone: posture === "menace" ? "crit" : posture === "alerte" ? "warn" : "ok",
      to: "/radar",
    },
    {
      id: "raids",
      col: 2,
      y: 196,
      h: 78,
      title: "Raids",
      value: raids.length ? `${raids[0].count} pistes` : "aucun",
      detail: raids.length ? `couloir ${raids[0].corridor}` : "pas de salve coordonnée",
      tone: raids.length ? "crit" : "ok",
      to: "/",
    },
    {
      id: "bulles",
      col: 2,
      y: 332,
      h: 78,
      title: "Bulles C-UAS",
      value: intrusion.length
        ? `${intrusion.length} intrusion${intrusion.length > 1 ? "s" : ""}`
        : approche.length
          ? `${approche.length} approche${approche.length > 1 ? "s" : ""}`
          : `${armed} armées`,
      detail: intrusion[0]?.zone.name ?? approche[0]?.zone.name ?? "aucune intrusion",
      tone: zoneTone,
      to: "/zones",
    },
    {
      id: "alertes",
      col: 3,
      y: 60,
      h: 104,
      title: "Alertes",
      value: `${open.length} ouverte${open.length > 1 ? "s" : ""}`,
      detail: `${alerts.length - open.length} acquittées`,
      tone: open.length ? (unackedCrit ? "crit" : "warn") : "ok",
      to: "/journal",
      spark: { values: [...window6("alerts"), open.length], label: "ouvertes · 6 min" },
    },
    {
      id: "poste",
      col: 3,
      y: 210,
      h: 78,
      title: "Poste chef · quart",
      value: !watchLoaded ? "…" : watch ? shortWatchLabel(watch.openedLabel) : "quart vacant",
      detail: watch
        ? `ouvert depuis ${formatWatchDuration(now - (Date.parse(watch.openedAt) || now))}`
        : "prise de poste requise",
      tone: !watchLoaded ? "idle" : watch ? "ok" : "warn",
      to: "/quart",
    },
    {
      id: "sentinelle",
      col: 3,
      y: 332,
      h: 78,
      title: "Sentinelle",
      value: copLock?.locked
        ? "COP figé"
        : isSuperadmin && sentinel
          ? `${sentinel.bindings} postes liés`
          : "garde active",
      detail: copLock?.locked
        ? "tentative d'intrusion"
        : isSuperadmin && sentinel
          ? `${sentinel.open} ouverts · ${sentinel.ejected} éjectés`
          : "clé liée au poste",
      tone: copLock?.locked ? "crit" : "ok",
      to: "/sentinelle",
    },
    {
      id: "journal",
      col: 4,
      y: 60,
      h: 78,
      title: "Journal · preuves",
      value: `${journal.length} dossier${journal.length > 1 ? "s" : ""}`,
      detail: "versés · hashés · PDF",
      tone: "ok",
      to: "/journal",
    },
    {
      id: "rf",
      col: 4,
      y: 210,
      h: 78,
      title: "Effecteur RF",
      value: ewArmed ? "armé" : "désarmé",
      detail: ewArmed ? "demande chef · externe" : "VIGILAIR n'émet pas",
      tone: ewArmed ? "warn" : "idle",
      to: "/division",
    },
  ];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fusionLive = live.length > 0 || sourcesLive > 0;
  const links: SynLink[] = [
    ...sensorNodes.map((n) => ({
      from: n.id,
      to: "fusion",
      tone: n.tone,
      flow: n.link?.state === "live",
    })),
    ...["menace", "raids", "bulles"].map((id) => ({
      from: "fusion",
      to: id,
      tone: fusionLive ? ("ok" as Tone) : ("idle" as Tone),
      flow: live.length > 0,
    })),
    ...["menace", "raids", "bulles"].map((id) => {
      const t = byId.get(id)!.tone;
      return {
        from: id,
        to: "alertes",
        tone: t === "ok" ? ("idle" as Tone) : t,
        flow: t === "crit" || t === "warn",
      };
    }),
    {
      from: "alertes",
      to: "poste",
      tone: open.length ? byId.get("alertes")!.tone : "idle",
      flow: open.length > 0,
      side: true,
    },
    { from: "alertes", to: "journal", tone: "ok", flow: false },
    { from: "poste", to: "rf", tone: ewArmed ? "warn" : "idle", flow: ewArmed },
    {
      from: "sentinelle",
      to: "journal",
      tone: copLock?.locked ? "crit" : "idle",
      flow: Boolean(copLock?.locked),
    },
  ];

  const path = (l: SynLink) => {
    const a = byId.get(l.from)!;
    const b = byId.get(l.to)!;
    if (l.side) {
      const x = colX(a.col) + 20;
      return `M ${x} ${a.y + a.h} L ${x} ${b.y}`;
    }
    const x1 = colX(a.col) + COL_W;
    const y1 = a.y + a.h / 2;
    const x2 = colX(b.col);
    const y2 = b.y + b.h / 2;
    const dx = (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="group"
      aria-label="Synoptique de la chaîne VIGILAIR, de la liaison à la trace"
    >
      {COLUMNS.map((c, i) => (
        <text
          key={c}
          x={colX(i)}
          y={20}
          className="fill-primary font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          {c}
        </text>
      ))}
      {links.map((l) => {
        const d = path(l);
        const color = l.tone === "idle" ? "var(--color-border)" : TONE[l.tone];
        return (
          <g key={`${l.from}-${l.to}`}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeOpacity={l.tone === "idle" ? 1 : 0.55}
              strokeWidth={l.flow ? 1.4 : 1.1}
              strokeDasharray={l.flow ? undefined : "3 5"}
            />
            {l.flow && !reduced
              ? [0, 0.55, 1.1].map((delay) => (
                  <circle key={delay} r={2.3} fill={color} className="syn-particle" style={{ color }}>
                    <animateMotion dur="1.65s" begin={`${delay}s`} repeatCount="indefinite" path={d} />
                  </circle>
                ))
              : null}
          </g>
        );
      })}
      {nodes.map((n) => {
        const x = colX(n.col);
        return (
          <Link
            key={n.id}
            to={n.to}
            className="syn-node"
            aria-label={`${n.title} : ${n.value}. ${n.detail}`}
          >
            <title>{`${n.title} — ${n.value} · ${n.detail}`}</title>
            <rect
              x={x}
              y={n.y}
              width={COL_W}
              height={n.h}
              rx={3}
              className="syn-box"
              fill="var(--color-surface)"
              stroke={n.tone === "idle" ? "var(--color-border)" : TONE[n.tone]}
              strokeOpacity={n.tone === "idle" ? 1 : 0.6}
            />
            <rect x={x} y={n.y} width={3} height={n.h} fill={TONE[n.tone]} />
            {n.link ? (
              <>
                <circle
                  cx={x + 12}
                  cy={n.y + 11}
                  r={3}
                  fill={TONE[n.tone]}
                  className={n.link.state === "live" ? "syn-led-live" : undefined}
                />
                <text
                  x={x + 20}
                  y={n.y + 14}
                  className="fill-muted-foreground font-mono text-[10px] uppercase tracking-[0.08em]"
                >
                  {clip(n.title, 15)}
                </text>
                <text
                  x={x + COL_W - 8}
                  y={n.y + 14}
                  textAnchor="end"
                  className="font-mono text-[10px] tabular-nums"
                  fill={n.link.ageTone === "idle" ? "var(--color-muted-foreground)" : TONE[n.link.ageTone]}
                >
                  {`↻ ${n.link.age}`}
                </text>
                <text x={x + 12} y={n.y + 29} className="font-mono text-[10px]">
                  <tspan
                    className="uppercase"
                    fill={n.tone === "idle" ? "var(--color-muted-foreground)" : TONE[n.tone]}
                  >
                    {n.value}
                  </tspan>
                  <tspan className="fill-muted-foreground">
                    {`  ${clip(n.detail, LINE_MAX - n.value.length - 1)}`}
                  </tspan>
                </text>
              </>
            ) : (
              <>
                <circle
                  cx={x + COL_W - 12}
                  cy={n.y + 13}
                  r={3.5}
                  fill={TONE[n.tone]}
                  className={n.tone === "crit" ? "syn-led-crit" : undefined}
                />
                <text
                  x={x + 12}
                  y={n.y + 16}
                  className="fill-muted-foreground font-mono text-[10px] uppercase tracking-[0.08em]"
                >
                  {clip(n.title, TITLE_MAX)}
                </text>
                <text
                  x={x + 12}
                  y={n.y + 38}
                  className="fill-fg font-display text-[16px] font-semibold uppercase tracking-[0.04em]"
                >
                  {clip(n.value, VALUE_MAX)}
                </text>
                <text x={x + 12} y={n.y + 54} className="fill-muted-foreground font-mono text-[10px]">
                  {clip(n.detail, DETAIL_MAX)}
                </text>
                {n.id === "fusion" ? (
                  <>
                    <text x={x + 12} y={n.y + 70} className="fill-muted-foreground font-mono text-[10px]">
                      Moteur VIGILAIR · n'émet pas
                    </text>
                    <IdBar x={x + 12} y={n.y + 82} w={COL_W - 24} mix={idMix} />
                  </>
                ) : null}
                {n.spark ? (
                  <Spark
                    x={x + 12}
                    y={n.y + n.h - 30}
                    w={COL_W - 24}
                    h={20}
                    values={n.spark.values}
                    color={TONE[n.tone === "idle" ? "ok" : n.tone]}
                    label={n.spark.label}
                  />
                ) : null}
              </>
            )}
          </Link>
        );
      })}
    </svg>
  );
}
