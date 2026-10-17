import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Plus, Shield, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearAlert,
  counts,
  loadConfig,
  loadSession,
  raiseAlert,
  resetStatuses,
  saveConfig,
  saveSession,
  setWorkerStatus,
  type AbriConfig,
  type AbriSession,
  type Site,
  type WorkerStatus,
} from "@/lib/vigilair/abri";
import { useStaff } from "@/lib/vigilair/staff-context";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<WorkerStatus, string> = {
  present: "présent",
  abri: "à l'abri",
  manque: "manque",
  detresse: "détresse",
};
const STATUS_TONE: Record<WorkerStatus, "ok" | "warn" | "crit" | "default"> = {
  present: "default",
  abri: "ok",
  manque: "warn",
  detresse: "crit",
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

/**
 * Mise à l'abri — sûreté des travailleurs. Vue DÉFENSIVE : mettre les employés à couvert, les
 * compter, lever l'alerte. Aucun pistage, aucune cible. Tout en local, fonctionne hors ligne.
 */
export function AbriView() {
  const { profile } = useStaff();
  const by = profile?.label ?? "Chef d'équipe";
  const [config, setConfig] = useState<AbriConfig | null>(null);
  const [session, setSession] = useState<AbriSession | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    setConfig(loadConfig());
    setSession(loadSession());
  }, []);
  // Horloge d'alerte (depuis N min).
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const upConfig = (c: AbriConfig) => {
    setConfig(c);
    saveConfig(c);
  };
  const upSession = (s: AbriSession) => {
    setSession(s);
    saveSession(s);
  };

  if (!config || !session) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement de la sûreté…</div>;
  }

  const siteOf = (id: string | null) => config.sites.find((s) => s.id === id) ?? null;
  const c = counts(config, session.siteId);

  // ---- Mode discret : écran sombre, rien qui trahit une position. Aucun son nulle part.
  if (session.state === "alerte" && session.discreet) {
    return <Discreet session={session} site={siteOf(session.siteId)} onExit={() => upSession({ ...session, discreet: false })} />;
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Mise à l'abri</h1>
            <p className="text-xs text-muted-foreground">Sûreté des travailleurs · hors ligne · aucun pistage</p>
          </div>
        </div>
        <Badge tone={session.state === "alerte" ? (session.drill ? "warn" : "crit") : "ok"}>
          {session.state === "alerte" ? (session.drill ? "EXERCICE" : "ALERTE") : "normal"}
        </Badge>
      </header>

      {session.state === "alerte" ? (
        <AlertPanel
          session={session}
          site={siteOf(session.siteId)}
          counts={c}
          onDiscreet={() => upSession({ ...session, discreet: true })}
          onClear={() => {
            if (window.confirm("Lever l'alerte — tout est clair ?")) {
              upConfig(resetStatuses(config));
              upSession(clearAlert(session, by));
            }
          }}
        />
      ) : (
        <Trigger
          config={config}
          onRaise={(siteId, reason, drill) => {
            upConfig(resetStatuses(config));
            upSession(raiseAlert(session, { by, siteId, reason, drill }));
          }}
        />
      )}

      {session.state === "alerte" ? (
        <Roster
          config={config}
          siteId={session.siteId}
          onStatus={(id, status) => {
            const r = setWorkerStatus(config, id, status, by);
            upConfig(r.config);
            if (r.event) upSession({ ...session, log: [r.event, ...session.log].slice(0, 200) });
          }}
        />
      ) : (
        <Editor config={config} onChange={upConfig} />
      )}

      <LogView session={session} />
      <p className="pb-2 text-center text-[11px] text-muted-foreground">
        Ce module sert à protéger les personnes. Il n'observe, ne piste et ne désigne personne.
      </p>
    </div>
  );
}

function Trigger({
  config,
  onRaise,
}: {
  config: AbriConfig;
  onRaise: (siteId: string | null, reason: string, drill: boolean) => void;
}) {
  const [siteId, setSiteId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">Déclencher la mise à l'abri</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Site</label>
        <select
          value={siteId ?? ""}
          onChange={(e) => setSiteId(e.target.value || null)}
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
        >
          <option value="">Tous les sites</option>
          {config.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Raison (ex. véhicules inconnus en approche)"
          className="min-w-[14rem] flex-1"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="default"
          className="h-14 flex-1 bg-crit text-base font-semibold text-white hover:bg-crit/90"
          onClick={() => onRaise(siteId, reason, false)}
        >
          <ShieldAlert className="mr-1 size-5" />À COUVERT
        </Button>
        <Button variant="outline" className="h-14" onClick={() => onRaise(siteId, reason || "Exercice", true)}>
          Lancer un exercice
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        « À couvert » met tout le monde à l'abri et ouvre le comptage. Un exercice fait la même chose,
        marqué comme entraînement.
      </p>
    </section>
  );
}

function AlertPanel({
  session,
  site,
  counts: c,
  onDiscreet,
  onClear,
}: {
  session: AbriSession;
  site: Site | null;
  counts: { total: number; present: number; abri: number; manque: number; detresse: number };
  onDiscreet: () => void;
  onClear: () => void;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border-2 p-4",
        session.drill ? "border-warn bg-warn/10" : "border-crit bg-crit/10",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn("size-6", session.drill ? "text-warn" : "text-crit")} />
          <div>
            <p className="text-xl font-bold tracking-tight">
              {session.drill ? "EXERCICE · à couvert" : "À COUVERT"}
            </p>
            <p className="text-xs text-muted-foreground">
              depuis {clock(session.since)}
              {session.reason ? ` · ${session.reason}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDiscreet}>
            <EyeOff className="mr-1 size-4" />
            Mode discret
          </Button>
          <Button variant="default" size="sm" className="bg-ok text-white hover:bg-ok/90" onClick={onClear}>
            Lever · tout est clair
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-bg/60 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Consignes {site ? `· ${site.name}` : "· tous les sites"}
        </p>
        {site ? (
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              <span className="text-muted-foreground">S'abriter :</span> {site.shelter}
            </li>
            <li>
              <span className="text-muted-foreground">Regroupement (après la levée) :</span> {site.muster}
            </li>
            {site.note ? <li className="text-muted-foreground">{site.note}</li> : null}
          </ul>
        ) : (
          <p className="mt-1 text-sm">
            Chaque site applique ses consignes d'abri. Rester à couvert, loin des fenêtres, en silence.
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <Count label="Total" v={c.total} />
        <Count label="À l'abri" v={c.abri} tone="ok" />
        <Count label="Manquent" v={c.manque} tone="warn" />
        <Count label="Détresse" v={c.detresse} tone="crit" />
      </div>
    </section>
  );
}

function Count({ label, v, tone }: { label: string; v: number; tone?: "ok" | "warn" | "crit" }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <p
        className={cn(
          "font-mono text-2xl font-semibold tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && v > 0 && "text-warn",
          tone === "crit" && v > 0 && "text-crit",
        )}
      >
        {v}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function Roster({
  config,
  siteId,
  onStatus,
}: {
  config: AbriConfig;
  siteId: string | null;
  onStatus: (id: string, status: WorkerStatus) => void;
}) {
  const list = useMemo(
    () => (siteId ? config.workers.filter((w) => w.siteId === siteId) : config.workers),
    [config.workers, siteId],
  );
  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">Comptage de l'équipe — ne laisser personne dehors</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg/50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              <Badge tone={STATUS_TONE[w.status]}>{STATUS_LABEL[w.status]}</Badge>
              {w.name}
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant={w.status === "abri" ? "default" : "outline"} onClick={() => onStatus(w.id, "abri")}>
                À l'abri
              </Button>
              <Button size="sm" variant={w.status === "manque" ? "secondary" : "ghost"} onClick={() => onStatus(w.id, "manque")}>
                Manque
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={w.status === "detresse" ? "text-crit" : ""}
                onClick={() => onStatus(w.id, "detresse")}
              >
                Détresse
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Editor({ config, onChange }: { config: AbriConfig; onChange: (c: AbriConfig) => void }) {
  const [open, setOpen] = useState(false);
  const addSite = () =>
    onChange({
      ...config,
      sites: [
        ...config.sites,
        {
          id: `site-${Date.now()}`,
          name: `Site ${config.sites.length + 1}`,
          shelter: "Abri désigné, loin des fenêtres.",
          muster: "Point de regroupement.",
          note: "",
        },
      ],
    });
  const addWorker = () =>
    onChange({
      ...config,
      workers: [
        ...config.workers,
        { id: `w-${Date.now()}`, name: `Employé ${config.workers.length + 1}`, siteId: config.sites[0]?.id ?? "site-1", status: "present", at: 0 },
      ],
    });
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpen((v) => !v)}>
        <span className="text-sm font-medium">Sites et équipe (à adapter)</span>
        <span className="text-xs text-muted-foreground">{open ? "replier" : "déplier"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sites</p>
              <Button size="sm" variant="outline" onClick={addSite}>
                <Plus className="mr-1 size-3" />
                Site
              </Button>
            </div>
            {config.sites.map((s) => (
              <div key={s.id} className="space-y-1 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      onChange({ ...config, sites: config.sites.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) })
                    }
                    className="font-medium"
                  />
                  {config.sites.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onChange({
                          ...config,
                          sites: config.sites.filter((x) => x.id !== s.id),
                          workers: config.workers.filter((w) => w.siteId !== s.id),
                        })
                      }
                    >
                      <Trash2 className="size-4 text-crit" />
                    </Button>
                  ) : null}
                </div>
                <Input
                  value={s.shelter}
                  onChange={(e) =>
                    onChange({ ...config, sites: config.sites.map((x) => (x.id === s.id ? { ...x, shelter: e.target.value } : x)) })
                  }
                  placeholder="Où s'abriter"
                  className="text-sm"
                />
                <Input
                  value={s.muster}
                  onChange={(e) =>
                    onChange({ ...config, sites: config.sites.map((x) => (x.id === s.id ? { ...x, muster: e.target.value } : x)) })
                  }
                  placeholder="Point de regroupement"
                  className="text-sm"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Équipe</p>
              <Button size="sm" variant="outline" onClick={addWorker}>
                <Plus className="mr-1 size-3" />
                Employé
              </Button>
            </div>
            {config.workers.map((w) => (
              <div key={w.id} className="flex items-center gap-2">
                <Input
                  value={w.name}
                  onChange={(e) =>
                    onChange({ ...config, workers: config.workers.map((x) => (x.id === w.id ? { ...x, name: e.target.value } : x)) })
                  }
                  className="flex-1"
                />
                <select
                  value={w.siteId}
                  onChange={(e) =>
                    onChange({ ...config, workers: config.workers.map((x) => (x.id === w.id ? { ...x, siteId: e.target.value } : x)) })
                  }
                  className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                >
                  {config.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...config, workers: config.workers.filter((x) => x.id !== w.id) })}
                >
                  <Trash2 className="size-4 text-crit" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LogView({ session }: { session: AbriSession }) {
  if (session.log.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-sm font-medium">Main courante</p>
      <ol className="space-y-1 font-mono text-xs">
        {session.log.slice(0, 20).map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-2 text-muted-foreground">
            <span className="tabular-nums">{new Date(e.at).toISOString().slice(11, 19)} Z</span>
            <span className="text-fg">{e.kind}</span>
            {e.worker ? <span>· {e.worker}</span> : null}
            {e.note ? <span>· {e.note}</span> : null}
            <span className="ml-auto">{e.by}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Mode discret : écran noir, texte très sombre, aucun son. Toucher révèle brièvement les consignes. */
function Discreet({
  session,
  site,
  onExit,
}: {
  session: AbriSession;
  site: Site | null;
  onExit: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const timer = useRef(0);
  const show = () => {
    setReveal(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setReveal(false), 6000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-center"
      onClick={show}
      role="button"
      tabIndex={0}
    >
      {reveal ? (
        <div className="space-y-4 px-6">
          <p className="text-sm text-neutral-400">Reste à couvert · en silence</p>
          {site ? (
            <p className="text-xs leading-relaxed text-neutral-500">{site.shelter}</p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="text-neutral-500"
            onClick={(e) => {
              e.stopPropagation();
              onExit();
            }}
          >
            <Eye className="mr-1 size-4" />
            Quitter le mode discret
          </Button>
        </div>
      ) : (
        // Quasi invisible : juste de quoi savoir que l'alerte tient, sans éclairer.
        <p className="text-[11px] text-neutral-800">· {session.drill ? "exercice" : "à couvert"} ·</p>
      )}
    </div>
  );
}
