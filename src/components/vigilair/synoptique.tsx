import { Link } from "@tanstack/react-router";
import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import { detectRaids } from "@/lib/vigilair/raid";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
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
};

type SynLink = { from: string; to: string; tone: Tone; flow: boolean; side?: boolean };

export type SentinelStats = { open: number; ejected: number; auto: number; bindings: number };

const W = 1200;
const H = 300;
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

const COLUMNS = ["01 · Capteurs", "02 · Fusion", "03 · Évaluation", "04 · Décision", "05 · Action · traces"];

const SENSOR_GROUPS: { id: string; title: string; ids: string[] }[] = [
  { id: "adsb", title: "1090ES · ADS-B", ids: ["1090"] },
  { id: "wx", title: "Météo · METAR TAF", ids: ["metar", "taf", "sigmet", "fttj"] },
  { id: "gnss", title: "GNSS · NIC", ids: ["nic"] },
  { id: "space", title: "Espace · SWPC", ids: ["swpc", "alert", "sol"] },
  { id: "nat", title: "Phénomènes · FIRMS", ids: ["nat"] },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// Budgets en caractères pour un bloc de 184 px (mesurés : mono 10 px ≈ 6 px, titre espacé ≈ 6,8 px,
// valeur condensée 16 px ≈ 9,4 px) ; le voyant d'état occupe l'angle haut droit.
const TITLE_MAX = 21;
const VALUE_MAX = 16;
const DETAIL_MAX = 26;
const LINE_MAX = 24;

/**
 * Synoptique : la chaîne VIGILAIR telle qu'elle tourne, du capteur à la trace. Chaque bloc
 * lit l'état réel du poste ; un lien animé signale des données qui circulent vraiment.
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

  const live = tracks.filter((t) => t.idState !== "perdu");
  const confirmed = live.filter((t) => t.idState === "confirme").length;
  const { posture, reason } = computePosture(tracks);
  const raids = detectRaids(tracks);
  const intrusion = zonePicture.filter((z) => z.level === "intrusion");
  const approche = zonePicture.filter((z) => z.level === "approche");
  const armed = zonePicture.filter((z) => z.zone.armed).length;
  const open = alerts.filter((a) => !a.acked);
  const sources = pic?.sources ?? [];
  const sourcesOk = sources.filter((s) => s.ok).length;

  const sensorNodes: SynNode[] = SENSOR_GROUPS.map((g, i) => {
    const rows = sources.filter((s) => g.ids.includes(s.id));
    const ok = rows.filter((s) => s.ok).length;
    const tone: Tone = !pic || ok === 0 ? "idle" : ok === rows.length ? "ok" : "warn";
    const value = !pic
      ? "en attente"
      : ok === 0
        ? "silence"
        : ok === rows.length
          ? "live"
          : `partiel ${ok}/${rows.length}`;
    const lead = rows.find((s) => s.ok) ?? rows[0];
    return {
      id: g.id,
      col: 0,
      y: 36 + i * 52,
      h: 44,
      title: g.title,
      value,
      detail: lead?.detail ?? "aucun relevé",
      tone,
      to: "/capteurs",
    };
  });

  const zoneTone: Tone = intrusion.length ? "crit" : approche.length ? "warn" : "ok";
  const unackedCrit = open.some((a) => a.level === "critique");
  const nodes: SynNode[] = [
    ...sensorNodes,
    {
      id: "fusion",
      col: 1,
      y: 98,
      h: 112,
      title: "Fusion · ident",
      value: `${live.length} piste${live.length > 1 ? "s" : ""} live`,
      detail: `${confirmed} confirmée${confirmed > 1 ? "s" : ""} · ${sourcesOk} flux réels`,
      tone: live.length > 0 || sourcesOk > 0 ? "ok" : "idle",
      to: "/",
    },
    {
      id: "menace",
      col: 2,
      y: 40,
      h: 58,
      title: "Menace · posture",
      value: postureLabel(posture),
      detail: reason,
      tone: posture === "menace" ? "crit" : posture === "alerte" ? "warn" : "ok",
      to: "/radar",
    },
    {
      id: "raids",
      col: 2,
      y: 126,
      h: 58,
      title: "Raids",
      value: raids.length ? `${raids[0].count} pistes` : "aucun",
      detail: raids.length ? `couloir ${raids[0].corridor}` : "pas de salve coordonnée",
      tone: raids.length ? "crit" : "ok",
      to: "/",
    },
    {
      id: "bulles",
      col: 2,
      y: 212,
      h: 58,
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
      y: 40,
      h: 58,
      title: "Alertes",
      value: `${open.length} ouverte${open.length > 1 ? "s" : ""}`,
      detail: `${alerts.length - open.length} acquittées`,
      tone: open.length ? (unackedCrit ? "crit" : "warn") : "ok",
      to: "/journal",
    },
    {
      id: "poste",
      col: 3,
      y: 126,
      h: 58,
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
      y: 212,
      h: 58,
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
      y: 40,
      h: 58,
      title: "Journal · preuves",
      value: `${journal.length} dossier${journal.length > 1 ? "s" : ""}`,
      detail: "versés · hashés · PDF",
      tone: "ok",
      to: "/journal",
    },
    {
      id: "rf",
      col: 4,
      y: 126,
      h: 58,
      title: "Effecteur RF",
      value: ewArmed ? "armé" : "désarmé",
      detail: ewArmed ? "demande chef · externe" : "VIGILAIR n'émet pas",
      tone: ewArmed ? "warn" : "idle",
      to: "/division",
    },
  ];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fusionLive = live.length > 0 || sourcesOk > 0;
  const links: SynLink[] = [
    ...sensorNodes.map((n) => ({ from: n.id, to: "fusion", tone: n.tone, flow: n.tone === "ok" || n.tone === "warn" })),
    ...["menace", "raids", "bulles"].map((id) => ({
      from: "fusion",
      to: id,
      tone: fusionLive ? ("ok" as Tone) : ("idle" as Tone),
      flow: fusionLive,
    })),
    ...["menace", "raids", "bulles"].map((id) => {
      const t = byId.get(id)!.tone;
      return { from: id, to: "alertes", tone: t === "ok" ? ("idle" as Tone) : t, flow: t === "crit" || t === "warn" };
    }),
    { from: "alertes", to: "poste", tone: open.length ? byId.get("alertes")!.tone : "idle", flow: open.length > 0, side: true },
    { from: "alertes", to: "journal", tone: "ok", flow: false },
    { from: "poste", to: "rf", tone: ewArmed ? "warn" : "idle", flow: ewArmed },
    { from: "sentinelle", to: "journal", tone: copLock?.locked ? "crit" : "idle", flow: Boolean(copLock?.locked) },
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
      aria-label="Synoptique de la chaîne VIGILAIR, du capteur à la trace"
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
      {links.map((l) => (
        <path
          key={`${l.from}-${l.to}`}
          d={path(l)}
          fill="none"
          stroke={l.tone === "idle" ? "var(--color-border)" : TONE[l.tone]}
          strokeOpacity={l.tone === "idle" ? 1 : 0.75}
          strokeWidth={l.flow ? 1.6 : 1.2}
          className={l.flow ? "syn-flow" : undefined}
          strokeDasharray={l.flow ? undefined : "3 5"}
        />
      ))}
      {nodes.map((n) => {
        const x = colX(n.col);
        const small = n.h < 50;
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
            <circle
              cx={x + COL_W - 12}
              cy={n.y + 13}
              r={3.5}
              fill={TONE[n.tone]}
              className={n.tone === "crit" ? "syn-led-crit" : undefined}
            />
            <text x={x + 12} y={n.y + 16} className="fill-muted-foreground font-mono text-[10px] uppercase tracking-[0.08em]">
              {clip(n.title, TITLE_MAX)}
            </text>
            {small ? (
              <text x={x + 12} y={n.y + 34} className="fill-fg font-mono text-[11px]">
                <tspan className="uppercase" fill={n.tone === "idle" ? "var(--color-muted-foreground)" : TONE[n.tone]}>
                  {n.value}
                </tspan>
                <tspan className="fill-muted-foreground">
                  {`  ${clip(n.detail, LINE_MAX - n.value.length - 2)}`}
                </tspan>
              </text>
            ) : (
              <>
                <text
                  x={x + 12}
                  y={n.y + (n.h > 80 ? 52 : 36)}
                  className="fill-fg font-display text-[16px] font-semibold uppercase tracking-[0.04em]"
                >
                  {clip(n.value, VALUE_MAX)}
                </text>
                <text
                  x={x + 12}
                  y={n.y + (n.h > 80 ? 72 : 50)}
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {clip(n.detail, DETAIL_MAX)}
                </text>
                {n.h > 80 ? (
                  <text x={x + 12} y={n.y + 96} className="fill-muted-foreground font-mono text-[10px]">
                    Moteur VIGILAIR · n'émet pas
                  </text>
                ) : null}
              </>
            )}
          </Link>
        );
      })}
    </svg>
  );
}
