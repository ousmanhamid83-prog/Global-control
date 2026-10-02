import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  KeyRound,
  Mail,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ackIncident,
  agentRecap,
  ejectAgent,
  listIncidents,
  listOpsLog,
  listRoster,
  provisionDemoTeam,
  setStaffRole,
  setStaffTeam,
  teamRecap,
  type AgentRecap,
  type IncidentRow,
  type OpsLogRow,
  type RosterRow,
  type TeamRecapRow,
} from "@/lib/vigilair/command";
import { formatDate } from "@/lib/vigilair/format";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  STAFF_TEAMS,
  TEAM_LABEL,
  generateAccessKey,
  getBotSettings,
  listAccessKeys,
  revokeAccessKey,
  saveBotSettings,
  saveMyIdentity,
  type AccessKeyRow,
  type AssignableRole,
  type BotPublicSettings,
  type StaffTeam,
} from "@/lib/vigilair/staff";
import { withChefSeal } from "@/lib/vigilair/seal-client";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import { InstallPoste } from "@/components/vigilair/install-poste";

const SELECT =
  "h-11 rounded-md border border-border bg-input px-3 text-sm text-fg";

export function DivisionView() {
  const { isSuperadmin, loading, profile } = useStaff();
  if (loading) {
    return <div className="h-full min-h-64 animate-pulse bg-secondary/40" />;
  }
  if (!isSuperadmin) {
    return <OwnDesk />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-4">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Commandement
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Chef de division · {profile?.label}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Vous voyez le travail de chaque agent et de chaque équipe. Vous
            changez les rôles, vous éjectez. Personne d'autre ne peut modifier
            ni effacer. Les agents n'ont pas de mot de passe — uniquement une
            clé VA- que vous émettez. Une clé se scelle au premier poste.
            Copie du logiciel ou d'un dossier = alerte, déconnexion, dossier
            hashé — voir Sentinelle. Installez VIGILAIR sur chaque PC de
            l'équipe (Chrome / Edge) : c'est le poste réel, pas un simulateur.
          </p>
        </header>
        <InstallPoste />
        <IdentityDesk />
        <IncidentsPanel />
        <div className="grid gap-8 grid-cols-2">
          <RosterPanel />
          <TeamRecapPanel />
        </div>
        <div className="grid gap-8 grid-cols-2">
          <OpsPanel />
          <KeysPanel chef={profile?.label ?? "Chef de division"} />
        </div>
        <BotsPanel />
      </div>
    </div>
  );
}

function OwnDesk() {
  const { profile } = useStaff();
  const [recap, setRecap] = useState<AgentRecap | null>(null);

  useEffect(() => {
    agentRecap({ data: {} })
      .then(setRecap)
      .catch(() => setRecap(null));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Poste agent
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {profile?.label ?? "Agent"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {profile ? ROLE_LABEL[profile.role] : "—"} ·{" "}
          {profile ? TEAM_LABEL[profile.team] : "—"}
        </p>
      </header>
      <p className="rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        Seul le chef de division peut changer un rôle, éjecter, modifier ou
        effacer. Vous vous reconnectez uniquement avec votre clé VA-. Toute
        copie, extraction ou tentative après éjection alerte le chef avec votre
        travail.
      </p>
      <InstallPoste />
      <IdentityDesk />
      {recap ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 hud">
          <p className="text-sm font-medium">Votre récapitulatif</p>
          <dl className="grid gap-2 text-sm grid-cols-4">
            <Stat k="Actions" v={String(recap.actions)} />
            <Stat k="Ident" v={String(recap.ident)} />
            <Stat k="Bulletins" v={String(recap.bulletin)} />
            <Stat k="Mode 4" v={String(recap.m4)} />
          </dl>
          <ul className="space-y-1">
            {recap.recent.length === 0 ? (
              <li className="text-sm text-muted-foreground">Aucune action encore.</li>
            ) : (
              recap.recent.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDate(Date.parse(r.at) || Date.now())}
                  </span>{" "}
                  {r.title}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <div className="h-32 animate-pulse rounded-lg bg-secondary/40" />
      )}
    </div>
  );
}

function IdentityDesk() {
  const { profile, applyProfile, isSuperadmin } = useStaff();
  const [label, setLabel] = useState(profile?.label ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [grade, setGrade] = useState(profile?.grade ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [unit, setUnit] = useState(profile?.unit ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLabel(profile?.label ?? "");
    setEmail(profile?.email ?? "");
    setGrade(profile?.grade ?? "");
    setPhone(profile?.phone ?? "");
    setUnit(profile?.unit ?? "");
  }, [profile?.userId, profile?.label, profile?.email, profile?.grade, profile?.phone, profile?.unit]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const next = await saveMyIdentity({ data: { label, email, grade, phone, unit } });
      applyProfile(next);
      setNote("Identité enregistrée.");
    } catch (ex) {
      setNote(ex instanceof Error ? ex.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4 hud">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Identité du poste
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        E-mail professionnel, grade, téléphone, unité. L'e-mail n'est pas un mot
        de passe : l'agent se connecte avec e-mail + clé VA-.
      </p>
      <dl className="grid gap-2 text-sm grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Rôle</dt>
          <dd>{profile ? ROLE_LABEL[profile.role] : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Équipe</dt>
          <dd>{profile ? TEAM_LABEL[profile.team] : "—"}</dd>
        </div>
      </dl>
      <form onSubmit={(e) => void onSave(e)} className="grid gap-2 grid-cols-2">
        <label className="block text-sm col-span-2">
          Nom
          <Input
            className="mt-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            minLength={2}
            aria-label="Nom"
          />
        </label>
        <label className="block text-sm col-span-2">
          E-mail professionnel
          <Input
            className="mt-1 font-mono"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!isSuperadmin}
            required={isSuperadmin}
            placeholder="prenom.nom@division.td"
            aria-label="E-mail professionnel"
          />
        </label>
        <label className="block text-sm">
          Grade
          <Input
            className="mt-1"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="Grade"
            aria-label="Grade"
          />
        </label>
        <label className="block text-sm">
          Téléphone
          <Input
            className="mt-1"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Téléphone"
            aria-label="Téléphone"
          />
        </label>
        <label className="block text-sm col-span-2">
          Unité / bureau
          <Input
            className="mt-1"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unité / bureau"
            aria-label="Unité"
          />
        </label>
        <Button type="submit" disabled={busy} className="col-span-2">
          Enregistrer l'identité
        </Button>
      </form>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="font-mono text-sm tabular-nums">{v}</dd>
    </div>
  );
}

function IncidentsPanel() {
  const [rows, setRows] = useState<IncidentRow[]>([]);

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

  const open = rows.filter((r) => !r.acked);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="size-4 text-crit" />
        <h2 className="text-lg font-semibold">Incidents de sécurité</h2>
        {open.length > 0 ? (
          <Badge tone="crit">{open.length} ouverts</Badge>
        ) : (
          <Badge tone="ok">Aucun ouvert</Badge>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Copie, extraction, impression, reconnexion après éjection — tout
          apparaît ici avec le récapitulatif de l'agent.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 8).map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-border bg-surface p-3 hud"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.actor} · {formatDate(Date.parse(r.at) || Date.now())}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {r.workRecap}
                  </p>
                </div>
                {r.acked ? (
                  <Badge>Consigné</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void ackIncident({ data: { id: r.id } }).then(reload);
                    }}
                  >
                    Accuser
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RosterPanel() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demoKeys, setDemoKeys] = useState<{ label: string; key: string; role: string }[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const reload = () => {
    listRoster()
      .then(setRows)
      .catch(() => setRows([]));
  };

  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 8000);
    return () => window.clearInterval(id);
  }, []);

  const agents = rows.filter((r) => r.role !== "superadmin");

  const onRole = async (userId: string, role: AssignableRole) => {
    setErr(null);
    try {
      await setStaffRole({ data: { userId, role } });
      reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Rôle refusé");
    }
  };

  const onTeam = async (userId: string, team: StaffTeam) => {
    setErr(null);
    try {
      await setStaffTeam({ data: { userId, team } });
      reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Équipe refusée");
    }
  };

  const onEject = async (userId: string, label: string) => {
    if (!window.confirm(`Éjecter ${label} ? Session coupée, clé morte, reconnexion = alerte.`)) {
      return;
    }
    setErr(null);
    try {
      await withChefSeal(() =>
        ejectAgent({ data: { userId, reason: "Éjection chef de division" } }),
      );
      reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Éjection impossible");
    }
  };

  const onDemo = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await withChefSeal(() => provisionDemoTeam());
      setDemoKeys(r.keys.length ? r.keys : null);
      reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Dotation impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Users className="size-4" />
            <h2 className="text-lg font-semibold">Effectif</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Changement de rôle immédiat. Éjection = plus de session, plus de
            clé, alerte si l'agent insiste.
          </p>
        </div>
        {agents.length === 0 ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void onDemo()}>
            Doter les équipes
          </Button>
        ) : null}
      </div>
      {err ? <p className="text-sm text-crit">{err}</p> : null}
      {demoKeys ? (
        <div className="rounded-md border border-ok/40 bg-ok/10 p-3">
          <p className="text-xs text-muted-foreground">
            Clés à transmettre une seule fois — elles ne seront plus affichées.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-sm">
            {demoKeys.map((k) => (
              <li key={k.key}>
                {k.label} · {k.key}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="rounded-md border border-border bg-surface p-3 hud"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() =>
                  setSelected(selected === r.userId ? null : r.userId)
                }
              >
                <p className="truncate text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABEL[r.role]} · {TEAM_LABEL[r.team]} · {r.actions}{" "}
                  actions
                  {r.email ? ` · ${r.email}` : ""}
                </p>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {r.ejected ? (
                  <Badge tone="crit">Éjecté</Badge>
                ) : r.online ? (
                  <Badge tone="ok">En poste</Badge>
                ) : (
                  <Badge>Hors ligne</Badge>
                )}
                {r.role !== "superadmin" && !r.ejected ? (
                  <>
                    <select
                      className={SELECT}
                      aria-label={`Rôle ${r.label}`}
                      value={r.role}
                      onChange={(e) =>
                        void onRole(r.userId, e.target.value as AssignableRole)
                      }
                    >
                      {ASSIGNABLE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                    <select
                      className={SELECT}
                      aria-label={`Équipe ${r.label}`}
                      value={r.team}
                      onChange={(e) =>
                        void onTeam(r.userId, e.target.value as StaffTeam)
                      }
                    >
                      {STAFF_TEAMS.map((team) => (
                        <option key={team} value={team}>
                          {TEAM_LABEL[team]}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onEject(r.userId, r.label)}
                    >
                      Éjecter
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {selected === r.userId ? <AgentDetail userId={r.userId} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentDetail({ userId }: { userId: string }) {
  const [recap, setRecap] = useState<AgentRecap | null>(null);
  useEffect(() => {
    agentRecap({ data: { userId } })
      .then(setRecap)
      .catch(() => setRecap(null));
  }, [userId]);
  if (!recap) {
    return <div className="mt-3 h-20 animate-pulse rounded-md bg-secondary/40" />;
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
        {recap.recap}
      </p>
      <ul className="space-y-1">
        {recap.recent.map((r) => (
          <li key={r.id} className="text-xs text-muted-foreground">
            {formatDate(Date.parse(r.at) || Date.now())} · {r.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamRecapPanel() {
  const [rows, setRows] = useState<TeamRecapRow[]>([]);
  useEffect(() => {
    const load = () => {
      teamRecap()
        .then(setRows)
        .catch(() => setRows([]));
    };
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Récapitulatif des équipes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Travail réel versé au journal — identifications, dossiers, Mode 4,
          verrous, incidents.
        </p>
      </div>
      <ul className="grid gap-2 grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.team}
            className="rounded-md border border-border bg-surface p-3 hud"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{TEAM_LABEL[r.team]}</p>
              <Badge tone={r.online > 0 ? "ok" : "default"}>
                {r.online}/{r.agents} en poste
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <div>Ident {r.ident}</div>
              <div>Bulletins {r.bulletin}</div>
              <div>Mode 4 {r.m4}</div>
              <div>Verrous {r.lock}</div>
              {r.ejected > 0 ? (
                <div className="text-crit">Éjectés {r.ejected}</div>
              ) : null}
              {r.incidents > 0 ? (
                <div className="text-crit">Incidents {r.incidents}</div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpsPanel() {
  const [rows, setRows] = useState<OpsLogRow[]>([]);
  useEffect(() => {
    const load = () => {
      listOpsLog()
        .then(setRows)
        .catch(() => setRows([]));
    };
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Travail en cours</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Journal d'activité de tout le personnel. Append-only — pas d'édition.
        </p>
      </div>
      <ul className="max-h-96 space-y-1 overflow-y-auto">
        {rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            Le journal se remplit dès qu'un agent travaille le COP.
          </li>
        ) : (
          rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
            >
              <span className="text-sm">
                <span className="font-medium">{r.actor}</span>{" "}
                <span className="text-muted-foreground">{r.title}</span>
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

function KeysPanel({ chef }: { chef: string }) {
  const copLock = useVigilair((s) => s.copLock);
  const frozen = Boolean(copLock?.locked);
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");
  const [phone, setPhone] = useState("");
  const [unit, setUnit] = useState("");
  const [role, setRole] = useState<AssignableRole>("operateur");
  const [team, setTeam] = useState<StaffTeam>("cop");
  const [keys, setKeys] = useState<AccessKeyRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    listAccessKeys()
      .then(setKeys)
      .catch(() => setKeys([]));
  };

  useEffect(() => {
    reload();
  }, []);

  const onGenerate = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const row = await withChefSeal(() =>
        generateAccessKey({
          data: { label, role, team, email, grade, phone, unit },
        }),
      );
      setFresh(row.key);
      setLabel("");
      setEmail("");
      setGrade("");
      setPhone("");
      setUnit("");
      reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Génération impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4" />
          <h2 className="text-lg font-semibold">Clés d'accès</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {chef} émet une identité (e-mail) et une clé VA- par agent. L'e-mail
          n'est pas un mot de passe. Révoquer = éjecter.
        </p>
      </div>
      {frozen ? (
        <p className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          COP figé — émission de clés suspendue jusqu'au déverrouillage.
        </p>
      ) : null}
      <form onSubmit={onGenerate} className="grid gap-2 grid-cols-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom de l'agent"
          aria-label="Nom de l'agent"
          required
          minLength={2}
          className="col-span-2"
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e-mail professionnel"
          aria-label="E-mail professionnel"
          required
          className="col-span-2"
        />
        <Input
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          placeholder="Grade"
          aria-label="Grade"
        />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Téléphone"
          aria-label="Téléphone"
        />
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unité"
          aria-label="Unité"
          className="col-span-2"
        />
        <select
          className={SELECT}
          aria-label="Rôle"
          value={role}
          onChange={(e) => setRole(e.target.value as AssignableRole)}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          aria-label="Équipe"
          value={team}
          onChange={(e) => setTeam(e.target.value as StaffTeam)}
        >
          {STAFF_TEAMS.map((t) => (
            <option key={t} value={t}>
              {TEAM_LABEL[t]}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          disabled={busy || frozen || label.trim().length < 2}
          className="col-span-2"
        >
          Générer une clé
        </Button>
      </form>
      {err ? <p className="text-sm text-crit">{err}</p> : null}
      {fresh ? (
        <div className="rounded-md border border-ok/40 bg-ok/10 p-3">
          <p className="text-xs text-muted-foreground">
            Clé à transmettre une seule fois — elle ne sera plus affichée.
          </p>
          <p className="mt-1 break-all font-mono text-sm">{fresh}</p>
        </div>
      ) : null}
      <ul className="space-y-2">
        {keys.length === 0 ? (
          <li className="text-sm text-muted-foreground">Aucune clé émise.</li>
        ) : (
          keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{k.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {k.workEmail ?? "sans e-mail"} · {ROLE_LABEL[k.role]} ·{" "}
                  {TEAM_LABEL[k.team]}
                  {k.grade ? ` · ${k.grade}` : ""}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatDate(Date.parse(k.createdAt) || Date.now())}
                  {k.usedAt ? " · utilisée" : " · jamais utilisée"}
                </p>
              </div>
              {k.revoked || k.ejected ? (
                <Badge tone="crit">Éjectée</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void withChefSeal(() => revokeAccessKey({ data: { id: k.id } })).then(reload);
                  }}
                >
                  Éjecter
                </Button>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function BotsPanel() {
  const [cfg, setCfg] = useState<BotPublicSettings | null>(null);
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const [hook, setHook] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBotSettings()
      .then((s) => {
        setCfg(s);
        setChat(s.telegramChatId);
        setHook(s.signalWebhook);
      })
      .catch(() => setCfg(null));
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const next = await saveBotSettings({
        data: {
          telegramToken: token,
          telegramChatId: chat,
          signalWebhook: hook,
        },
      });
      setCfg(next);
      setToken("");
      setMsg("Canaux enregistrés. Sabotage et éjection partent instantanément.");
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Alertes instantanées
        </p>
        <h2 className="text-lg font-semibold">Telegram et Signal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Identifications, CPA, effet RF — et désormais sabotage, copie,
          extraction, reconnexion d'un agent éjecté.
        </p>
      </div>
      <form onSubmit={onSave} className="grid gap-3 grid-cols-2">
        <label className="block text-sm col-span-2">
          Jeton bot Telegram
          <Input
            className="mt-1"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={cfg?.telegramHint || "123456:ABC…"}
          />
        </label>
        <label className="block text-sm">
          Chat ID Telegram
          <Input
            className="mt-1"
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="-100…"
          />
        </label>
        <label className="block text-sm">
          Webhook Signal
          <Input
            className="mt-1"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 col-span-2">
          <Button type="submit" disabled={busy}>
            Enregistrer les canaux
          </Button>
          {cfg?.telegramConfigured ? (
            <Badge tone="ok">Telegram configuré</Badge>
          ) : (
            <Badge>Telegram inactif</Badge>
          )}
        </div>
      </form>
      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Un logiciel web ne peut pas s'auto-détruire sur la machine d'un agent.
        VIGILAIR coupe la session, tue la clé, consigne le travail et alerte.
        Extraire un dump hors bande déclenche la même alerte.
      </p>
    </section>
  );
}
