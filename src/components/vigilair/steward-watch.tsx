import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useStaff } from "@/lib/vigilair/staff-context";
import { emptyFlags, planSteward, STEWARD_PARAMS, type StewardFlags } from "@/lib/vigilair/steward";
import { useVigilair } from "@/lib/vigilair/store";
import { clearTileCache } from "@/lib/vigilair/tiles";
import { formatClock } from "@/lib/vigilair/format";

const KEY = "vigilair-weekly";
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function saveDesk(): void {
  const s = useVigilair.getState();
  localStorage.setItem(
    KEY,
    JSON.stringify({
      flags: s.stewardFlags,
      day: s.weeklyDay,
      hour: s.weeklyHour,
      lastAt: s.lastWeeklyAt,
    }),
  );
}

export function StewardWatch() {
  const { isSuperadmin, loading } = useStaff();

  useEffect(() => {
    if (loading || !isSuperadmin) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as {
        flags?: Partial<StewardFlags>;
        on?: boolean;
        day?: number;
        hour?: number;
        lastAt?: number;
      };
      const st = useVigilair.getState();
      st.setWeekly({
        day: Number.isFinite(j.day) ? Number(j.day) : 1,
        hour: Number.isFinite(j.hour) ? Number(j.hour) : 5,
        lastAt: Number.isFinite(j.lastAt) ? Number(j.lastAt) : 0,
      });
      const flags = { ...emptyFlags(), ...(j.flags ?? {}) };
      if (j.on) flags.hebdo = true;
      for (const param of STEWARD_PARAMS) {
        if (flags[param.id]) st.setStewardFlag(param.id, true);
      }
    } catch {
      /* réglage illisible : on garde les valeurs du poste */
    }
  }, [isSuperadmin, loading]);

  useEffect(() => {
    if (!isSuperadmin) {
      useVigilair.getState().setStewardOn(false);
      return;
    }
    const tick = () => {
      const st = useVigilair.getState();
      const flags = st.stewardFlags;
      if (!flags.photo && !flags.feu && !flags.hebdo) return;
      const firms = st.phenomena.filter((p) => p.source === "NASA FIRMS").length;
      const errs = st.livePicture?.errors ?? [];
      const silent = errs.some((e) => e.includes("FIRMS")) || (st.liveError ?? "").includes("FIRMS");
      const acts = planSteward({
        now: Date.now(),
        visAt: st.satMeta?.visAt ?? null,
        satLayer: st.satLayer,
        heldIr: st.stewardHeldIr,
        firms,
        firmsSilent: silent,
        flags,
        weeklyDay: st.weeklyDay,
        weeklyHour: st.weeklyHour,
        lastWeeklyAt: st.lastWeeklyAt,
      });
      for (const act of acts) {
        if (act.id === "vis-ir") {
          st.setSatLayer("ir");
          useVigilair.setState({ stewardHeldIr: true });
        } else if (act.id === "ir-vis") {
          st.setSatLayer("vis");
          useVigilair.setState({ stewardHeldIr: false });
        } else if (act.id === "weekly") {
          clearTileCache();
          st.setWeekly({ lastAt: Date.now() });
          saveDesk();
        }
        useVigilair.getState().pushSteward(act.text, Date.now());
      }
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [isSuperadmin]);

  return null;
}

export function StewardDesk() {
  const flags = useVigilair((s) => s.stewardFlags);
  const day = useVigilair((s) => s.weeklyDay);
  const hour = useVigilair((s) => s.weeklyHour);
  const last = useVigilair((s) => s.lastWeeklyAt);
  const log = useVigilair((s) => s.stewardLog);
  const setFlag = useVigilair((s) => s.setStewardFlag);
  const setWeekly = useVigilair((s) => s.setWeekly);
  const groups = [...new Set(STEWARD_PARAMS.map((p) => p.group))];

  const arm = (id: (typeof STEWARD_PARAMS)[number]["id"]) => {
    setFlag(id, !flags[id]);
    saveDesk();
  };

  return (
    <section className="space-y-4 rounded-md border border-border bg-surface p-4">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold">Intendant</h2>
        <p className="text-sm text-muted-foreground">
          Chaque option s'arme ici, et seulement par le chef. L'émission n'est
          pas au nombre : le poste ne l'arme pas.
        </p>
      </header>
      {groups.map((group) => (
        <div key={group} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
          <ul className="space-y-2">
            {STEWARD_PARAMS.filter((p) => p.group === group).map((param) => (
              <li key={param.id} className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">{param.label}</span>
                  <span className="block text-xs text-muted-foreground">{param.detail}</span>
                </span>
                <Button
                  size="sm"
                  variant={flags[param.id] ? "default" : "outline"}
                  onClick={() => arm(param.id)}
                >
                  {flags[param.id] ? "Armé" : "Armer"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex items-start justify-between gap-3 opacity-70">
        <span>
          <span className="block text-sm font-medium">Émission</span>
          <span className="block text-xs text-muted-foreground">Refusée. Le poste n'émet pas.</span>
        </span>
        <Button size="sm" variant="outline" disabled>
          Refusé
        </Button>
      </div>
      {flags.hebdo ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Jour UTC</span>
          {DAYS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={
                i === day
                  ? "rounded-md bg-primary px-2 py-1 text-primary-foreground"
                  : "rounded-md border border-border px-2 py-1"
              }
              onClick={() => {
                setWeekly({ day: i });
                saveDesk();
              }}
            >
              {label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-muted-foreground">
            Heure
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-fg"
              onChange={(e) => {
                setWeekly({ hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) });
                saveDesk();
              }}
            />
          </label>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Dernière maintenance : {last ? formatClock(last) : "jamais"}
      </p>
      <ul className="space-y-1">
        {log.length === 0 ? (
          <li className="text-sm text-muted-foreground">Aucune action.</li>
        ) : (
          log.map((row) => (
            <li key={`${row.at}-${row.text}`} className="text-sm">
              <span className="font-mono text-xs text-muted-foreground">{formatClock(row.at)}</span>
              {" · "}
              {row.text}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
