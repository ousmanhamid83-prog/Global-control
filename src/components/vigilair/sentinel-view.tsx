import { useEffect, useState } from "react";
import {
  FileText,
  FolderLock,
  Laptop,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  INCIDENT_LABEL,
  ackIncident,
  drillExfil,
  getSentinelPdf,
  listDeviceBindings,
  listIncidents,
  sentinelStats,
  type DeviceBindingRow,
  type IncidentRow,
} from "@/lib/vigilair/command";
import { formatDate, formatHash } from "@/lib/vigilair/format";
import { SENTINEL_DOCTRINE } from "@/lib/vigilair/sentinel";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import { StewardDesk } from "@/components/vigilair/steward-watch";
import type { AuthAttemptRow } from "@/lib/vigilair/guard";
import { listAuthAttempts, setCopLock } from "@/lib/vigilair/guard-ops";
import { withChefSeal } from "@/lib/vigilair/seal-client";
import {
  privacyStatus,
  purgeSessionTraces,
  type PrivacyStatus,
} from "@/lib/vigilair/privacy-ops";

function downloadPdf(b64: string, filename: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SentinelView() {
  const { isSuperadmin, loading, profile } = useStaff();
  if (loading) {
    return <div className="h-full min-h-64 animate-pulse bg-secondary/40" />;
  }
  if (!isSuperadmin) {
    return <AgentSentinel name={profile?.label ?? "Agent"} />;
  }
  return <ChefSentinel />;
}

function AgentSentinel({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sentinelle
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
      </header>
      <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
        Votre clé VA- est collée à ce poste. Copier le logiciel (Ctrl+S,
        inspection) ou un dossier de preuve coupe la session sur-le-champ. Le
        chef reçoit l'alerte avec votre travail, et un PDF hashé est versé.
      </p>
      <ul className="space-y-3">
        {SENTINEL_DOCTRINE.filter((d) => d.id !== "chef").map((d) => (
          <li key={d.id} className="rounded-md border border-border bg-surface p-4">
            <p className="text-sm font-medium">{d.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{d.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChefSentinel() {
  const [tab, setTab] = useState<"doctrine" | "postes" | "incidents" | "attaques" | "anonymat" | "intendant">("incidents");
  const [stats, setStats] = useState({ open: 0, ejected: 0, bindings: 0, auto: 0 });

  const reloadStats = () => {
    sentinelStats()
      .then(setStats)
      .catch(() => undefined);
  };

  useEffect(() => {
    reloadStats();
    const id = window.setInterval(reloadStats, 8000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Partie 7 · garde logiciel
          </p>
          <h1 className="text-xl font-semibold tracking-tight">Sentinelle</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Un agent pose sa clé VA- sur une machine : ce poste est scellé.
            Copie du logiciel ou d'un dossier = alerte immédiate, déconnexion,
            clé morte, dossier SHA-256 versé. L'anonymat du chef : aucune IP
            de poste vers un tiers, aucune IP en session.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat k="Incidents ouverts" v={String(stats.open)} tone={stats.open ? "crit" : "ok"} />
          <Stat k="Coupures auto" v={String(stats.auto)} tone={stats.auto ? "warn" : "ok"} />
          <Stat k="Agents éjectés" v={String(stats.ejected)} />
          <Stat k="Postes scellés" v={String(stats.bindings)} />
        </div>

        <DrillPanel onDone={reloadStats} />

        <div className="flex flex-wrap gap-1 rounded-md border border-border p-1">
          {(
            [
              ["incidents", "Incidents"],
              ["attaques", "Attaques"],
              ["postes", "Postes liés"],
              ["anonymat", "Anonymat"],
              ["doctrine", "Doctrine"],
              ["intendant", "Intendant"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                tab === id
                  ? "h-11 flex-1 rounded-md bg-secondary text-sm text-fg"
                  : "h-11 flex-1 rounded-md text-sm text-muted-foreground"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "doctrine" ? <DoctrinePanel /> : null}
        {tab === "intendant" ? <StewardDesk /> : null}
        {tab === "postes" ? <BindingsPanel /> : null}
        {tab === "incidents" ? <IncidentsPanel onChange={reloadStats} /> : null}
        {tab === "attaques" ? <AttacksPanel /> : null}
        {tab === "anonymat" ? <AnonymatPanel /> : null}
      </div>
    </div>
  );
}

function Stat({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "ok" | "warn" | "crit";
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p
        className={
          tone === "crit"
            ? "mt-1 font-mono text-lg tabular-nums text-crit"
            : tone === "warn"
              ? "mt-1 font-mono text-lg tabular-nums text-warn"
              : tone === "ok"
                ? "mt-1 font-mono text-lg tabular-nums text-ok"
                : "mt-1 font-mono text-lg tabular-nums"
        }
      >
        {v}
      </p>
    </div>
  );
}

function DoctrinePanel() {
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {SENTINEL_DOCTRINE.map((d) => (
        <li key={d.id} className="rounded-md border border-border bg-surface p-4">
          <p className="text-sm font-medium">{d.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{d.body}</p>
        </li>
      ))}
    </ul>
  );
}

function AnonymatPanel() {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    privacyStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 12000);
    return () => window.clearInterval(id);
  }, []);

  const onPurge = async () => {
    setBusy(true);
    setErr(null);
    try {
      setStatus(await withChefSeal(() => purgeSessionTraces()));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Purge impossible");
    } finally {
      setBusy(false);
    }
  };

  const leak = (status?.withIp ?? 0) + (status?.withUa ?? 0);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Partie 13 · anonymat
        </p>
        <h2 className="text-sm font-semibold">Chef de division et COP</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          L'adresse IP du poste n'est plus envoyée à Google (polices) ni à EOX
          (cartes). Les sessions sont nettoyées d'IP et de User-Agent. L'e-mail
          du chef n'est plus affiché sur le bandeau. VIGILAIR n'émet pas et
          ne riposte pas sur le réseau adverse.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat k="Sessions" v={String(status?.sessions ?? "—")} />
        <Stat k="IP en session" v={String(status?.withIp ?? "—")} tone={leak ? "crit" : "ok"} />
        <Stat k="User-Agent" v={String(status?.withUa ?? "—")} tone={status?.withUa ? "warn" : "ok"} />
        <Stat k="Tiers navigateur" v="0" tone="ok" />
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LeakCard
          ok
          title="Polices"
          body="Pile système uniquement. Plus de preconnect ni de feuille Google Fonts."
        />
        <LeakCard
          ok
          title="Carte Sentinel"
          body="Tuiles locales, puis proxy same-origin. EOX voit l'IP du serveur, jamais celle du poste chef."
        />
        <LeakCard
          ok
          title="Session"
          body="Colonnes ipAddress et userAgent vidées à chaque prise de poste. Purge chef ci-dessous."
        />
        <LeakCard
          ok
          title="Identité chef"
          body="Bandeau : rôle, pas l'e-mail. Google / X retirés de la page d'accès. Libellé machine = « poste »."
        />
        <LeakCard
          ok
          title="Sceau chef"
          body="Clé, éjection, verrou, purge : mot de passe retapé. 5 minutes. Inactivité 8 min : poste figé."
        />
        <LeakCard
          ok
          title="Sessions"
          body="Chef : 2 postes. Agent : 1. Aperçu Android : jeton interne si cookies bloqués, pas d'IP en clair."
        />
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onPurge()}>
          Purger les traces IP
        </Button>
        <p className="text-xs text-muted-foreground">
          Ne pirate pas, ne scanne pas, n'exfiltre pas. Coupe et consigne
          seulement.
        </p>
      </div>
      {err ? <p className="text-sm text-crit">{err}</p> : null}
    </section>
  );
}

function LeakCard({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Badge tone={ok ? "ok" : "crit"}>{ok ? "scellé" : "fuite"}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </li>
  );
}

function BindingsPanel() {
  const [rows, setRows] = useState<DeviceBindingRow[]>([]);
  useEffect(() => {
    const load = () => {
      listDeviceBindings()
        .then(setRows)
        .catch(() => setRows([]));
    };
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, []);
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
        Aucun poste scellé. La première connexion d'un agent avec sa clé VA-
        lie la machine. Lancez un exercice « autre poste » pour voir la
        coupure.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{r.actor}</p>
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                empreinte {formatHash(r.fpHash)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {r.ejected ? (
                <Badge tone="crit">Éjecté</Badge>
              ) : (
                <Badge tone="ok">Scellé</Badge>
              )}
              <span className="font-mono text-xs text-muted-foreground">
                {formatDate(Date.parse(r.lastSeen) || Date.now())}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IncidentsPanel({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => {
    listIncidents()
      .then(setRows)
      .catch(() => setRows([]));
  };

  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 8000);
    return () => window.clearInterval(id);
  }, []);

  const onPdf = async (id: string) => {
    setBusy(id);
    try {
      const pdf = await getSentinelPdf({ data: id });
      downloadPdf(pdf.b64, pdf.filename);
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
        Aucun incident. Un exercice ci-dessus produit alerte, coupure et PDF.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{r.title}</p>
                {r.autoEjected ? <Badge tone="crit">Coupé</Badge> : null}
                {r.drill ? <Badge tone="warn">Exercice</Badge> : null}
                {r.acked ? <Badge>Consigné</Badge> : <Badge tone="crit">Ouvert</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {INCIDENT_LABEL[r.kind] ?? r.kind} · {r.actor} ·{" "}
                {formatDate(Date.parse(r.at) || Date.now())}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{r.detail}</p>
              {r.machineLabel ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  poste {r.machineLabel}
                </p>
              ) : null}
              {r.chainSha256 ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  chaîne {formatHash(r.chainSha256)}
                  {r.pdfSha256 ? ` · PDF ${formatHash(r.pdfSha256)}` : ""}
                </p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                {r.workRecap}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.pdfSha256 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === r.id}
                  onClick={() => void onPdf(r.id)}
                >
                  <FileText />
                  PDF
                </Button>
              ) : null}
              {!r.acked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void ackIncident({ data: { id: r.id } }).then(() => {
                      reload();
                      onChange();
                    });
                  }}
                >
                  Accuser
                </Button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DrillPanel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const run = async (kind: "software" | "folder" | "machine") => {
    setBusy(kind);
    setErr(null);
    try {
      const r = await drillExfil({ data: { kind } });
      setLast(
        `${r.actor} · session coupée · dossier ${r.incidentId.slice(0, 8)} · SHA ${r.pdfSha.slice(0, 8)}`,
      );
      useVigilair.setState((s) => ({
        alerts: [
          {
            id: `sec-${r.incidentId}`,
            trackId: "",
            at: Date.now(),
            level: "critique" as const,
            title: r.title,
            body: `Sentinelle · ${r.actor} déconnecté. Dossier hashé versé.`,
            acked: false,
          },
          ...s.alerts,
        ].slice(0, 40),
      }));
      onDone();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Exercice impossible");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-crit" />
        <h2 className="text-sm font-semibold">Exercice sentinelle</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Simule un agent qui pose sa clé puis copie. La session de l'agent est
        coupée, pas la vôtre. Alerte COP + PDF d'incident.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void run("software")}
        >
          <ShieldOff />
          Copie du logiciel
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void run("folder")}
        >
          <FolderLock />
          Copie d'un dossier
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void run("machine")}
        >
          <Laptop />
          Clé sur un autre poste
        </Button>
      </div>
      {busy ? (
        <p className="text-xs text-muted-foreground">Coupure en cours…</p>
      ) : null}
      {last ? (
        <p className="font-mono text-xs text-ok">{last}</p>
      ) : null}
      {err ? <p className="text-sm text-crit">{err}</p> : null}
    </section>
  );
}

function AttacksPanel() {
  const lock = useVigilair((s) => s.copLock);
  const setLock = useVigilair((s) => s.setCopLock);
  const [rows, setRows] = useState<AuthAttemptRow[]>([]);

  useEffect(() => {
    const load = () => {
      listAuthAttempts()
        .then(setRows)
        .catch(() => setRows([]));
    };
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, []);

  const fails = rows.filter((r) => !r.ok).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Journal d'accès</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            E-mail / clé masqués. Cinq refus = verrou. VIGILAIR ne riposte pas
            hors du poste : il coupe, consigne, alerte.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={fails ? "warn" : "ok"}>{fails} refus</Badge>
          {lock?.locked ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void withChefSeal(() =>
                  setCopLock({ data: { locked: false, reason: "" } }),
                ).then(setLock);
              }}
            >
              Lever le verrou
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void withChefSeal(() =>
                  setCopLock({
                    data: { locked: true, reason: "Verrou manuel chef de division" },
                  }),
                ).then(setLock);
              }}
            >
              Figer le COP
            </Button>
          )}
        </div>
      </div>
      <ul className="max-h-96 space-y-1 overflow-y-auto">
        {rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">Aucune tentative encore.</li>
        ) : (
          rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
            >
              <span className="text-sm">
                <span className={r.ok ? "text-ok" : "text-crit"}>
                  {r.ok ? "OK" : "REFUS"}
                </span>{" "}
                {r.kind === "va_key" ? "clé VA" : "chef"} · {r.identityShown}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDate(Date.parse(r.at) || Date.now())}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
