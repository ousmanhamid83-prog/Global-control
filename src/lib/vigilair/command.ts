import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  ASSIGNABLE_ROLES,
  EJECTED_MSG,
  PASSWORD_ONLY_CHEF,
  STAFF_TEAMS,
  bindOrRejectDevice,
  buildWorkRecap,
  dispatchChefAlert,
  ensureStaffRow,
  insertOpsLog,
  insertSecurityIncident,
  killUserSessions,
  loadStaff,
  mintId,
  requireSuperadmin,
  touchLastSeen,
  type AssignableRole,
  type StaffProfile,
  type StaffRole,
  type StaffTeam,
} from "./staff";
import { requireCopOpen } from "./cop-lock";
import { POSTE_ETRANGER, POSTE_EXERCICE, POSTE_LABEL, sanitizeMachineLabel, scrubSessionIps } from "./privacy";
import { CHEF_SESSION_CAP, pruneOldSessions, requireChefSeal } from "./seal";
export type OpsKind =
  | "login"
  | "logout"
  | "lock"
  | "ident"
  | "m4"
  | "bulletin"
  | "ew"
  | "clip"
  | "download"
  | "copy"
  | "print"
  | "delete_denied"
  | "replay"
  | "role_change"
  | "eject"
  | "prise_poste"
  | "releve"
  | "fin_poste"
  | "aar"
  | "zone";

export type IncidentKind =
  | "sabotage_copy"
  | "sabotage_extract"
  | "sabotage_print"
  | "sabotage_software"
  | "sabotage_folder"
  | "key_clone"
  | "reconnect_ejected"
  | "password_denied"
  | "delete_denied"
  | "eject"
  | "brute_force"
  | "key_spray"
  | "cop_intrusion"
  | "zone_breach";
export type RosterRow = {
  userId: string;
  label: string;
  role: StaffRole;
  team: StaffTeam;
  ejected: boolean;
  ejectedAt: string | null;
  ejectedReason: string | null;
  lastSeen: string | null;
  createdAt: string;
  email: string | null;
  grade: string;
  unit: string;
  keyId: string | null;
  keyUsedAt: string | null;
  keyRevoked: boolean;
  online: boolean;
  actions: number;
};

export type OpsLogRow = {
  id: string;
  userId: string;
  actor: string;
  role: string;
  team: string;
  kind: string;
  title: string;
  detail: string;
  trackId: string | null;
  severity: string;
  at: string;
};

export type IncidentRow = {
  id: string;
  userId: string | null;
  actor: string;
  kind: string;
  title: string;
  detail: string;
  workRecap: string;
  acked: boolean;
  at: string;
  machineLabel: string | null;
  fpHash: string | null;
  contentSha256: string | null;
  chainSha256: string | null;
  pdfSha256: string | null;
  autoEjected: boolean;
  drill: boolean;
};

export type TeamRecapRow = {
  team: StaffTeam;
  agents: number;
  online: number;
  ejected: number;
  ident: number;
  bulletin: number;
  m4: number;
  lock: number;
  incidents: number;
};

export type AgentRecap = {
  profile: StaffProfile;
  actions: number;
  ident: number;
  bulletin: number;
  m4: number;
  lock: number;
  download: number;
  incidents: number;
  recap: string;
  recent: OpsLogRow[];
};

export type DeviceBindingRow = {
  id: string;
  userId: string;
  actor: string;
  role: StaffRole;
  ejected: boolean;
  fpHash: string;
  label: string;
  firstSeen: string;
  lastSeen: string;
};

export const INCIDENT_LABEL: Record<string, string> = {
  sabotage_copy: "Copie presse-papiers",
  sabotage_extract: "Extraction massive",
  sabotage_print: "Impression",
  sabotage_software: "Copie du logiciel",
  sabotage_folder: "Copie de dossier",
  key_clone: "Clé sur un autre poste",
  reconnect_ejected: "Reconnexion après éjection",
  password_denied: "Mot de passe hors chef",
  delete_denied: "Effacement refusé",
  eject: "Éjection",
  brute_force: "Force brute",
  key_spray: "Spray de clés VA-",
  cop_intrusion: "Intrusion poste",
  zone_breach: "Intrusion bulle C-UAS",
};

const DUTY_KINDS = new Set<string>([
  "lock",
  "ident",
  "m4",
  "bulletin",
  "ew",
  "clip",
  "download",
  "copy",
  "print",
  "delete_denied",
  "replay",
  "logout",
]);

const SABOTAGE_KINDS = new Set<string>([
  "sabotage_copy",
  "sabotage_extract",
  "sabotage_print",
  "sabotage_software",
  "sabotage_folder",
  "key_clone",
  "delete_denied",
]);
const ONLINE_MS = 45_000;

function isOnline(lastSeen: string | null, now = Date.now()): boolean {
  if (!lastSeen) return false;
  const t = Date.parse(lastSeen);
  return Number.isFinite(t) && now - t < ONLINE_MS;
}

function asRole(v: string): StaffRole {
  if (v === "superadmin" || v === "admin" || v === "operateur" || v === "analyste") {
    return v;
  }
  return "admin";
}

function asTeam(v: string): StaffTeam {
  if (v === "cop" || v === "ident" || v === "sigint" || v === "radar" || v === "division") {
    return v;
  }
  return "cop";
}

export const guardMyAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{
      ok: boolean;
      ejected: boolean;
      profile: StaffProfile | null;
    }> => {
      const staff = await loadStaff(context.userId);
      if (!staff) {
        return { ok: false, ejected: false, profile: null };
      }
      if (staff.ejected) {
        return { ok: false, ejected: true, profile: staff };
      }
      await touchLastSeen(context.userId);
      return { ok: true, ejected: false, profile: staff };
    },
  );

export const confirmChefLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StaffProfile> => {
    await scrubSessionIps(context.userId);
    const sql = await getSql();
    const existing = await loadStaff(context.userId);
    const supers = await sql<{ n: number }>`
      select count(*)::int as n from staff where role = 'superadmin'
    `;
    const hasChef = (supers[0]?.n ?? 0) > 0;

    if (!existing && !hasChef) {
      const created = await ensureStaffRow(context.userId);
      await pruneOldSessions(created.userId, CHEF_SESSION_CAP);
      await insertOpsLog({
        userId: created.userId,
        actor: created.label,
        role: created.role,
        team: created.team,
        kind: "login",
        title: "Prise de poste chef de division",
        detail: "Premier compte — super-administrateur du contrat.",
        severity: "info",
      });
      return created;
    }

    if (!existing || existing.role !== "superadmin") {
      const actor = existing?.label ?? "compte inconnu";
      const recap = await buildWorkRecap(context.userId);
      await insertSecurityIncident({
        userId: context.userId,
        actor,
        kind: "password_denied",
        title: "Tentative de mot de passe hors chef",
        detail: PASSWORD_ONLY_CHEF,
        workRecap: recap,
      });
      await killUserSessions(context.userId);
      throw new Error(PASSWORD_ONLY_CHEF);
    }

    if (existing.ejected) {
      await killUserSessions(context.userId);
      throw new Error(EJECTED_MSG);
    }

    await touchLastSeen(context.userId);
    await pruneOldSessions(context.userId, CHEF_SESSION_CAP);
    await insertOpsLog({
      userId: existing.userId,
      actor: existing.label,
      role: existing.role,
      team: existing.team,
      kind: "login",
      title: "Session chef ouverte",
      detail: "Authentification mot de passe chef de division.",
      severity: "info",
    });
    return existing;
  });

export const listRoster = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RosterRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      user_id: string;
      role: string;
      label: string;
      team: string;
      ejected: boolean;
      ejected_at: string | null;
      ejected_reason: string | null;
      last_seen: string | null;
      created_at: string;
      email: string | null;
      grade: string | null;
      unit: string | null;
      key_id: string | null;
      key_used_at: string | null;
      key_revoked: boolean | null;
      actions: number;
    }>`
      select
        s.user_id,
        s.role,
        s.label,
        s.team,
        s.ejected,
        s.ejected_at::text as ejected_at,
        s.ejected_reason,
        s.last_seen::text as last_seen,
        s.created_at::text as created_at,
        s.email,
        s.grade,
        s.unit,
        k.id as key_id,
        k.used_at::text as key_used_at,
        k.revoked as key_revoked,
        coalesce(o.n, 0)::int as actions
      from staff s
      left join access_keys k on k.user_id = s.user_id
      left join (
        select user_id, count(*)::int as n from ops_log group by user_id
      ) o on o.user_id = s.user_id
      order by (s.role = 'superadmin') desc, s.label asc
    `;
    const now = Date.now();
    return rows.map((r) => ({
      userId: r.user_id,
      label: r.label,
      role: asRole(r.role),
      team: asTeam(r.team),
      ejected: Boolean(r.ejected),
      ejectedAt: r.ejected_at,
      ejectedReason: r.ejected_reason,
      lastSeen: r.last_seen,
      createdAt: r.created_at,
      email: r.email,
      grade: r.grade ?? "",
      unit: r.unit ?? "",
      keyId: r.key_id,
      keyUsedAt: r.key_used_at,
      keyRevoked: Boolean(r.key_revoked),
      online: !r.ejected && isOnline(r.last_seen, now),
      actions: r.actions,
    }));
  });

export const setStaffRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { userId: string; role: string }) => {
    const userId = String(raw.userId ?? "");
    const role = String(raw.role ?? "") as AssignableRole;
    if (!userId) throw new Error("Agent inconnu");
    if (!ASSIGNABLE_ROLES.includes(role)) throw new Error("Rôle invalide");
    return { userId, role };
  })
  .handler(async ({ context, data }): Promise<StaffProfile> => {
    const chef = await requireSuperadmin(context.userId);
    await requireCopOpen();
    if (data.userId === context.userId) {
      throw new Error("Le chef ne peut pas modifier son propre rôle");
    }
    const target = await loadStaff(data.userId);
    if (!target) throw new Error("Agent inconnu");
    if (target.role === "superadmin") {
      throw new Error("Impossible de modifier le chef de division");
    }
    if (target.ejected) throw new Error("Agent éjecté — réintégrer d'abord");
    const sql = await getSql();
    await sql`
      update staff
      set role = ${data.role}, updated_at = now()
      where user_id = ${data.userId}
    `;
    await sql`
      update access_keys set role = ${data.role} where user_id = ${data.userId}
    `;
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "role_change",
      title: `Rôle ${target.label} → ${data.role}`,
      detail: `${target.role} devient ${data.role}`,
      severity: "warn",
    });
    const next = await loadStaff(data.userId);
    if (!next) throw new Error("Agent inconnu");
    return next;
  });

export const setStaffTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { userId: string; team: string }) => {
    const userId = String(raw.userId ?? "");
    const team = String(raw.team ?? "") as StaffTeam;
    if (!userId) throw new Error("Agent inconnu");
    if (!STAFF_TEAMS.includes(team)) throw new Error("Équipe invalide");
    return { userId, team };
  })
  .handler(async ({ context, data }): Promise<StaffProfile> => {
    const chef = await requireSuperadmin(context.userId);
    await requireCopOpen();
    if (data.userId === context.userId) {
      throw new Error("Le chef reste à l'état-major");
    }
    const target = await loadStaff(data.userId);
    if (!target) throw new Error("Agent inconnu");
    if (target.role === "superadmin") {
      throw new Error("Impossible de déplacer le chef de division");
    }
    const sql = await getSql();
    await sql`
      update staff
      set team = ${data.team}, updated_at = now()
      where user_id = ${data.userId}
    `;
    await sql`
      update access_keys set team = ${data.team} where user_id = ${data.userId}
    `;
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "role_change",
      title: `Équipe ${target.label} → ${data.team}`,
      detail: `${target.team} devient ${data.team}`,
      severity: "info",
    });
    const next = await loadStaff(data.userId);
    if (!next) throw new Error("Agent inconnu");
    return next;
  });

export const ejectAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { userId: string; reason?: string }) => ({
    userId: String(raw.userId ?? ""),
    reason: String(raw.reason ?? "Éjection chef de division").slice(0, 240),
  }))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const chef = await requireSuperadmin(context.userId);
    await requireChefSeal(context.userId);
    if (!data.userId) throw new Error("Agent inconnu");
    if (data.userId === context.userId) {
      throw new Error("Le chef ne peut pas s'éjecter");
    }
    const target = await loadStaff(data.userId);
    if (!target) throw new Error("Agent inconnu");
    if (target.role === "superadmin") {
      throw new Error("Impossible d'éjecter le chef de division");
    }
    const sql = await getSql();
    await sql`
      update staff
      set ejected = true,
          ejected_at = now(),
          ejected_reason = ${data.reason},
          updated_at = now()
      where user_id = ${data.userId}
    `;
    await sql`
      update access_keys
      set revoked = true, ejected = true
      where user_id = ${data.userId}
    `;
    const { scrambleCredentials } = await import("./staff-ops.server");
    await scrambleCredentials(data.userId);
    await killUserSessions(data.userId);
    const recap = await buildWorkRecap(data.userId);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "eject",
      title: `Éjection ${target.label}`,
      detail: data.reason,
      severity: "crit",
    });
    const incident = await insertSecurityIncident({
      userId: data.userId,
      actor: target.label,
      kind: "eject",
      title: `Agent éjecté · ${target.label}`,
      detail: `${data.reason} Reconnexion et copie impossibles — toute tentative alerte le chef.`,
      workRecap: recap,
    });
    await dispatchChefAlert({
      id: incident.id,
      title: incident.title,
      body: `${incident.detail}\n\n${recap}`,
      level: "critique",
    });
    return { ok: true };
  });

export const logOp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: {
    kind: string;
    title: string;
    detail?: string;
    trackId?: string;
    severity?: string;
  }) => {
    const kind = String(raw.kind ?? "");
    if (!DUTY_KINDS.has(kind)) throw new Error("Action inconnue");
    return {
      kind: kind as OpsKind,
      title: String(raw.title ?? "").slice(0, 180),
      detail: String(raw.detail ?? "").slice(0, 400),
      trackId: raw.trackId ? String(raw.trackId).slice(0, 64) : null,
      severity: (raw.severity === "warn" || raw.severity === "crit"
        ? raw.severity
        : "info") as "info" | "warn" | "crit",
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    await touchLastSeen(context.userId);
    if (data.kind === "copy" || data.kind === "print" || data.kind === "delete_denied") {
      return { ok: true };
    }
    await insertOpsLog({
      userId: staff.userId,
      actor: staff.label,
      role: staff.role,
      team: staff.team,
      kind: data.kind,
      title: data.title,
      detail: data.detail,
      trackId: data.trackId,
      severity: data.severity,
    });
    return { ok: true };
  });

export const reportIncident = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { kind: string; title: string; detail?: string; fingerprint?: string; machineLabel?: string }) => {
    const kind = String(raw.kind ?? "");
    if (!SABOTAGE_KINDS.has(kind)) throw new Error("Incident inconnu");
    return {
      kind: kind as IncidentKind,
      title: String(raw.title ?? "").slice(0, 180),
      detail: String(raw.detail ?? "").slice(0, 400),
      fingerprint: String(raw.fingerprint ?? "")
        .replace(/[^a-f0-9]/gi, "")
        .toLowerCase()
        .slice(0, 64),
      machineLabel: sanitizeMachineLabel(raw.machineLabel),
    };
  })
  .handler(
    async ({
      context,
      data,
    }): Promise<{ ok: true; ejected: boolean; incidentId: string }> => {
      const staff = await loadStaff(context.userId);
      if (!staff) throw new Error("Session inconnue");
      if (staff.role === "superadmin") {
        await insertOpsLog({
          userId: staff.userId,
          actor: staff.label,
          role: staff.role,
          team: staff.team,
          kind: "copy",
          title: data.title,
          detail: data.detail,
          severity: "warn",
        });
        return { ok: true, ejected: false, incidentId: "" };
      }
      const result = await punishSabotage({
        userId: staff.userId,
        actor: staff.label,
        role: staff.role,
        team: staff.team,
        kind: data.kind,
        title: data.title,
        detail: data.detail || data.title,
        machineLabel: data.machineLabel || null,
        fpHash: data.fingerprint || null,
        drill: false,
      });
      return { ok: true, ejected: result.ejected, incidentId: result.incidentId };
    },
  );

async function punishSabotage(opts: {
  userId: string;
  actor: string;
  role: string;
  team: string;
  kind: IncidentKind;
  title: string;
  detail: string;
  machineLabel: string | null;
  fpHash: string | null;
  drill: boolean;
}): Promise<{ incidentId: string; ejected: boolean; pdfSha: string; chainSha: string }> {
  const sql = await getSql();
  const target = await loadStaff(opts.userId);
  const canEject = Boolean(target && target.role !== "superadmin");
  if (canEject && target && !target.ejected) {
    await sql`
      update staff
      set ejected = true,
          ejected_at = now(),
          ejected_reason = ${opts.title},
          updated_at = now()
      where user_id = ${opts.userId} and role <> 'superadmin'
    `;
    await sql`
      update access_keys set revoked = true, ejected = true where user_id = ${opts.userId}
    `;
    try {
      const { scrambleCredentials } = await import("./staff-ops.server");
      await scrambleCredentials(opts.userId);
    } catch {
      /* compte absent */
    }
    await killUserSessions(opts.userId);
  } else if (canEject) {
    await killUserSessions(opts.userId);
  }
  const recap = await buildWorkRecap(opts.userId);
  const row = await insertSecurityIncident({
    userId: opts.userId,
    actor: opts.actor,
    kind: opts.kind,
    title: opts.title,
    detail: opts.detail,
    workRecap: recap,
    machineLabel: opts.machineLabel,
    fpHash: opts.fpHash,
    autoEjected: canEject,
    drill: opts.drill,
  });
  await insertOpsLog({
    userId: opts.userId,
    actor: opts.actor,
    role: opts.role,
    team: opts.team,
    kind: opts.kind === "delete_denied" ? "delete_denied" : "copy",
    title: opts.title,
    detail: opts.detail,
    severity: "crit",
  });
  await dispatchChefAlert({
    id: row.id,
    title: `SÉCURITÉ · ${opts.actor}`,
    body: `${opts.title}\n${opts.detail}\n\n${recap}`,
    level: "critique",
  });
  return {
    incidentId: row.id,
    ejected: canEject,
    pdfSha: row.pdfSha,
    chainSha: row.chainSha,
  };
}

export const listOpsLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OpsLogRow[]> => {
    const staff = await ensureStaffRow(context.userId);
    const sql = await getSql();
    const rows =
      staff.role === "superadmin"
        ? await sql<{
            id: string;
            user_id: string;
            actor: string;
            role: string;
            team: string;
            kind: string;
            title: string;
            detail: string;
            track_id: string | null;
            severity: string;
            created_at: string;
          }>`
            select id, user_id, actor, role, team, kind, title, detail, track_id, severity,
                   created_at::text as created_at
            from ops_log
            order by created_at desc
            limit 120
          `
        : await sql<{
            id: string;
            user_id: string;
            actor: string;
            role: string;
            team: string;
            kind: string;
            title: string;
            detail: string;
            track_id: string | null;
            severity: string;
            created_at: string;
          }>`
            select id, user_id, actor, role, team, kind, title, detail, track_id, severity,
                   created_at::text as created_at
            from ops_log
            where user_id = ${context.userId}
            order by created_at desc
            limit 60
          `;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      actor: r.actor,
      role: r.role,
      team: r.team,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      trackId: r.track_id,
      severity: r.severity,
      at: r.created_at,
    }));
  });

export const listIncidents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<IncidentRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      user_id: string | null;
      actor: string;
      kind: string;
      title: string;
      detail: string;
      work_recap: string;
      acked: boolean;
      created_at: string;
      machine_label: string | null;
      fp_hash: string | null;
      content_sha256: string | null;
      chain_sha256: string | null;
      pdf_sha256: string | null;
      auto_ejected: boolean | null;
      drill: boolean | null;
    }>`
      select id, user_id, actor, kind, title, detail, work_recap, acked,
             created_at::text as created_at,
             machine_label, fp_hash, content_sha256, chain_sha256, pdf_sha256,
             auto_ejected, drill
      from security_incidents
      order by created_at desc
      limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      actor: r.actor,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      workRecap: r.work_recap,
      acked: Boolean(r.acked),
      at: r.created_at,
      machineLabel: r.machine_label,
      fpHash: r.fp_hash,
      contentSha256: r.content_sha256,
      chainSha256: r.chain_sha256,
      pdfSha256: r.pdf_sha256,
      autoEjected: Boolean(r.auto_ejected),
      drill: Boolean(r.drill),
    }));  });

export const ackIncident = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id: string }) => ({ id: String(raw.id ?? "") }))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await requireSuperadmin(context.userId);
    if (!data.id) throw new Error("Incident inconnu");
    const sql = await getSql();
    await sql`update security_incidents set acked = true where id = ${data.id}`;
    return { ok: true };
  });

export const teamRecap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TeamRecapRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const staffRows = await sql<{
      team: string;
      agents: number;
      ejected: number;
      last_seen: string | null;
    }>`
      select team,
             count(*)::int as agents,
             count(*) filter (where ejected)::int as ejected,
             max(last_seen)::text as last_seen
      from staff
      group by team
    `;
    const onlineRows = await sql<{ team: string; last_seen: string | null }>`
      select team, last_seen::text as last_seen from staff where ejected = false
    `;
    const now = Date.now();
    const onlineByTeam: Record<string, number> = {};
    for (const r of onlineRows) {
      if (isOnline(r.last_seen, now)) {
        onlineByTeam[r.team] = (onlineByTeam[r.team] ?? 0) + 1;
      }
    }
    const ops = await sql<{ team: string; kind: string; n: number }>`
      select team, kind, count(*)::int as n from ops_log group by team, kind
    `;
    const inc = await sql<{ team: string; n: number }>`
      select s.team, count(*)::int as n
      from security_incidents i
      join staff s on s.user_id = i.user_id
      group by s.team
    `;
    const teams = new Set<StaffTeam>(STAFF_TEAMS);
    for (const r of staffRows) teams.add(asTeam(r.team));
    return [...teams].map((team) => {
      const st = staffRows.find((x) => x.team === team);
      const kinds = ops.filter((o) => o.team === team);
      const pick = (k: string) => kinds.find((x) => x.kind === k)?.n ?? 0;
      return {
        team,
        agents: st?.agents ?? 0,
        online: onlineByTeam[team] ?? 0,
        ejected: st?.ejected ?? 0,
        ident: pick("ident") + pick("lock"),
        bulletin: pick("bulletin"),
        m4: pick("m4"),
        lock: pick("lock"),
        incidents: inc.find((x) => x.team === team)?.n ?? 0,
      };
    });
  });

export const agentRecap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw?: { userId?: string }) => ({
    userId: raw?.userId ? String(raw.userId) : "",
  }))
  .handler(async ({ context, data }): Promise<AgentRecap> => {
    const me = await ensureStaffRow(context.userId);
    const targetId =
      me.role === "superadmin" && data.userId ? data.userId : context.userId;
    if (targetId !== context.userId && me.role !== "superadmin") {
      throw new Error("Réservé au chef de division");
    }
    const profile = await loadStaff(targetId);
    if (!profile) throw new Error("Agent inconnu");
    const sql = await getSql();
    const counts = await sql<{ kind: string; n: number }>`
      select kind, count(*)::int as n from ops_log where user_id = ${targetId} group by kind
    `;
    const pick = (k: string) => counts.find((x) => x.kind === k)?.n ?? 0;
    const recent = await sql<{
      id: string;
      user_id: string;
      actor: string;
      role: string;
      team: string;
      kind: string;
      title: string;
      detail: string;
      track_id: string | null;
      severity: string;
      created_at: string;
    }>`
      select id, user_id, actor, role, team, kind, title, detail, track_id, severity,
             created_at::text as created_at
      from ops_log
      where user_id = ${targetId}
      order by created_at desc
      limit 12
    `;
    const inc = await sql<{ n: number }>`
      select count(*)::int as n from security_incidents where user_id = ${targetId}
    `;
    const recap = await buildWorkRecap(targetId);
    return {
      profile,
      actions: counts.reduce((s, r) => s + r.n, 0),
      ident: pick("ident"),
      bulletin: pick("bulletin"),
      m4: pick("m4"),
      lock: pick("lock"),
      download: pick("download"),
      incidents: inc[0]?.n ?? 0,
      recap,
      recent: recent.map((r) => ({
        id: r.id,
        userId: r.user_id,
        actor: r.actor,
        role: r.role,
        team: r.team,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        trackId: r.track_id,
        severity: r.severity,
        at: r.created_at,
      })),
    };
  });

export const provisionDemoTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{ created: number; keys: { label: string; key: string; role: string }[] }> => {
      const chef = await requireSuperadmin(context.userId);
      await requireChefSeal(context.userId);
      await requireCopOpen();
      const sql = await getSql();
      const existing = await sql<{ n: number }>`
        select count(*)::int as n from staff where role <> 'superadmin'
      `;
      if ((existing[0]?.n ?? 0) >= 3) {
        return { created: 0, keys: [] };
      }
      const specs: { label: string; role: AssignableRole; team: StaffTeam; email: string; grade: string; unit: string }[] = [
        { label: "Sgt. Haroun Moussa", role: "operateur", team: "cop", email: "haroun.moussa@division.td", grade: "Sergent", unit: "COP FTTJ" },
        { label: "Adj. Amina Hassan", role: "analyste", team: "ident", email: "amina.hassan@division.td", grade: "Adjudant", unit: "Ident IFF" },
        { label: "Cne. Issa Padacké", role: "admin", team: "radar", email: "issa.padacke@division.td", grade: "Capitaine", unit: "Radar AES" },
      ];
      const keys: { label: string; key: string; role: string }[] = [];
      for (const spec of specs) {
        const already = await sql<{ user_id: string }>`
          select user_id from staff where label = ${spec.label} limit 1
        `;
        if (already[0]) continue;
        const { createKeyedAgent } = await import("./staff-ops.server");
        const row = await createKeyedAgent({
          label: spec.label,
          role: spec.role,
          team: spec.team,
          createdBy: chef.userId,
          email: spec.email,
          grade: spec.grade,
          unit: spec.unit,
        });
        keys.push({ label: spec.label, key: row.key, role: spec.role });
        const seeds: { kind: OpsKind; title: string; detail: string; agoMin: number }[] = [
          {
            kind: "prise_poste",
            title: "Prise de poste",
            detail: `Clé VA émise par ${chef.label}`,
            agoMin: 180,
          },
          {
            kind: "lock",
            title: "Verrou piste T-014",
            detail: "Piste confirmée, origine CN.",
            agoMin: 95,
          },
          {
            kind: "ident",
            title: "Identification CH-4B",
            detail: "Corrélation FATL / Mode 4.",
            agoMin: 80,
          },
          {
            kind: "m4",
            title: "Demande Mode 4",
            detail: "Interrogateur secondaire, AfriControl n'émet pas.",
            agoMin: 70,
          },
          {
            kind: "bulletin",
            title: "Dossier de preuve versé",
            detail: "SHA-256 scellé, chaîne de custody.",
            agoMin: 40,
          },
        ];
        if (spec.role === "analyste") {
          seeds.push({
            kind: "clip",
            title: "Clip SIGINT 8 s",
            detail: "Écoute passive, pas de contrôle.",
            agoMin: 25,
          });
        }
        for (const s of seeds) {
          const id = await mintId();
          await sql`
            insert into ops_log (id, user_id, actor, role, team, kind, title, detail, severity, created_at)
            values (
              ${id}, ${row.userId}, ${spec.label}, ${spec.role}, ${spec.team},
              ${s.kind}, ${s.title}, ${s.detail}, 'info',
              now() - (${s.agoMin}::text || ' minutes')::interval
            )
          `;
        }
      }
      return { created: keys.length, keys };
    },
  );

export const bindMyMachine = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { fingerprint?: string; machineLabel?: string }) => ({
    fingerprint: String(raw.fingerprint ?? "")
      .replace(/[^a-f0-9]/gi, "")
      .toLowerCase()
      .slice(0, 64),
    machineLabel: sanitizeMachineLabel(raw.machineLabel),
  }))
  .handler(
    async ({
      context,
      data,
    }): Promise<{ ok: boolean; ejected: boolean; first: boolean; reason?: string }> => {
      const staff = await loadStaff(context.userId);
      if (!staff) return { ok: false, ejected: false, first: false };
      if (staff.ejected) {
        await killUserSessions(context.userId);
        return { ok: false, ejected: true, first: false, reason: "eject" };
      }
      if (staff.role === "superadmin" || data.fingerprint.length !== 64) {
        await touchLastSeen(context.userId);
        return { ok: true, ejected: false, first: false };
      }
      const sql = await getSql();
      const keys = await sql<{ id: string }>`
        select id from access_keys where user_id = ${context.userId} limit 1
      `;
      const bind = await bindOrRejectDevice({
        userId: staff.userId,
        keyId: keys[0]?.id ?? null,
        actor: staff.label,
        role: staff.role,
        team: staff.team,
        fingerprint: data.fingerprint,
        machineLabel: data.machineLabel || POSTE_LABEL,
      });
      if (!bind.ok) {
        return { ok: false, ejected: true, first: false, reason: "machine" };
      }
      await touchLastSeen(context.userId);
      return { ok: true, ejected: false, first: bind.first };
    },
  );

export const listDeviceBindings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DeviceBindingRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      user_id: string;
      label: string;
      actor: string;
      role: string;
      ejected: boolean;
      fp_hash: string;
      first_seen: string;
      last_seen: string;
    }>`
      select b.id, b.user_id, b.label, s.label as actor, s.role, s.ejected,
             b.fp_hash, b.first_seen::text as first_seen, b.last_seen::text as last_seen
      from device_bindings b
      join staff s on s.user_id = b.user_id
      order by b.last_seen desc
    `;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      actor: r.actor,
      role: asRole(r.role),
      ejected: Boolean(r.ejected),
      fpHash: r.fp_hash,
      label: r.label,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    }));
  });

export const sentinelStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{ open: number; ejected: number; bindings: number; auto: number }> => {
      const staff = await ensureStaffRow(context.userId);
      if (staff.role !== "superadmin") {
        return { open: 0, ejected: 0, bindings: 0, auto: 0 };
      }
      const sql = await getSql();
      const open = await sql<{ n: number }>`
        select count(*)::int as n from security_incidents where acked = false
      `;
      const ejected = await sql<{ n: number }>`
        select count(*)::int as n from staff where ejected = true
      `;
      const bindings = await sql<{ n: number }>`
        select count(*)::int as n from device_bindings
      `;
      const auto = await sql<{ n: number }>`
        select count(*)::int as n from security_incidents where auto_ejected = true
      `;
      return {
        open: open[0]?.n ?? 0,
        ejected: ejected[0]?.n ?? 0,
        bindings: bindings[0]?.n ?? 0,
        auto: auto[0]?.n ?? 0,
      };
    },
  );

export const getSentinelPdf = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    const v = (id ?? "").trim();
    if (v.length < 8 || v.length > 64) throw new Error("Dossier inconnu");
    return v;
  })
  .handler(
    async ({
      context,
      data: id,
    }): Promise<{ b64: string; sha256: string; filename: string; title: string }> => {
      await requireSuperadmin(context.userId);
      const sql = await getSql();
      const rows = await sql<{
        pdf_b64: string | null;
        pdf_sha256: string | null;
        title: string;
        actor: string;
      }>`
        select pdf_b64, pdf_sha256, title, actor from security_incidents where id = ${id} limit 1
      `;
      const row = rows[0];
      if (!row?.pdf_b64) throw new Error("Dossier introuvable");
      const chef = await loadStaff(context.userId);
      if (chef) {
        await insertOpsLog({
          userId: chef.userId,
          actor: chef.label,
          role: chef.role,
          team: chef.team,
          kind: "download",
          title: `Dossier sentinelle ${row.actor}`,
          detail: `Incident ${id.slice(0, 8)}`,
          severity: "info",
        });
      }
      return {
        b64: row.pdf_b64,
        sha256: row.pdf_sha256 ?? "",
        title: row.title,
        filename: `AfriControl-SENTINELLE-${row.actor.replace(/\s+/g, "_")}-${id.slice(0, 8)}.pdf`,
      };
    },
  );

export const drillExfil = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { kind: string }) => {
    const kind = String(raw.kind ?? "");
    if (kind !== "software" && kind !== "folder" && kind !== "machine") {
      throw new Error("Exercice inconnu");
    }
    return { kind: kind as "software" | "folder" | "machine" };
  })
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      incidentId: string;
      ejected: boolean;
      actor: string;
      pdfSha: string;
      chainSha: string;
      title: string;
    }> => {
      const chef = await requireSuperadmin(context.userId);
      await requireCopOpen();
      const sql = await getSql();
      let agents = await sql<{
        user_id: string;
        label: string;
        role: string;
        team: string;
        ejected: boolean;
      }>`
        select user_id, label, role, team, ejected
        from staff
        where role <> 'superadmin'
        order by ejected asc, created_at asc
      `;
      if (agents.length === 0) {
        const { createKeyedAgent } = await import("./staff-ops.server");
        const row = await createKeyedAgent({
          label: "Sgt. Haroun Moussa",
          role: "operateur",
          team: "cop",
          createdBy: chef.userId,
          email: "haroun.moussa@division.td",
          grade: "Sergent",
          unit: "COP FTTJ",
        });
        agents = [
          {
            user_id: row.userId,
            label: row.label,
            role: "operateur",
            team: "cop",
            ejected: false,
          },
        ];
      }
      const target = agents.find((a) => !a.ejected) ?? agents[0]!;
      const specs = {
        software: {
          kind: "sabotage_software" as IncidentKind,
          title: `Copie du logiciel AfriControl · ${target.label}`,
          detail:
            "Ctrl+S / inspection : tentative d'emporter le COP hors du poste scellé. Exercice chef de division.",
          machineLabel: POSTE_EXERCICE,
        },
        folder: {
          kind: "sabotage_folder" as IncidentKind,
          title: `Copie d'un dossier de preuve · ${target.label}`,
          detail:
            "Glisser-déposer / extraction PDF en rafale d'un dossier SRC-TEL-ARR. Exercice chef de division.",
          machineLabel: POSTE_EXERCICE,
        },
        machine: {
          kind: "key_clone" as IncidentKind,
          title: `Clé VA- présentée sur un autre poste · ${target.label}`,
          detail:
            "Même clé, empreinte différente. Le poste scellé reste à Farcha ; tentative depuis un portable personnel.",
          machineLabel: POSTE_ETRANGER,
        },
      }[data.kind];
      const fakeFp =
        data.kind === "machine"
          ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          : null;
      if (data.kind === "machine") {
        const existing = await sql<{ n: number }>`
          select count(*)::int as n from device_bindings where user_id = ${target.user_id}
        `;
        if ((existing[0]?.n ?? 0) === 0) {
          const id = await mintId();
          await sql`
            insert into device_bindings (id, user_id, fp_hash, label)
            values (
              ${id}, ${target.user_id},
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              ${POSTE_LABEL}
            )
            on conflict (user_id) do nothing
          `;
        }
        const bind = await bindOrRejectDevice({
          userId: target.user_id,
          actor: target.label,
          role: target.role,
          team: target.team,
          fingerprint: fakeFp!,
          machineLabel: specs.machineLabel,
        });
        if (!bind.ok) {
          const last = await sql<{
            id: string;
            chain_sha256: string | null;
            pdf_sha256: string | null;
            title: string;
          }>`
            select id, chain_sha256, pdf_sha256, title
            from security_incidents
            where user_id = ${target.user_id}
            order by created_at desc limit 1
          `;
          return {
            incidentId: last[0]?.id ?? "",
            ejected: true,
            actor: target.label,
            pdfSha: last[0]?.pdf_sha256 ?? "",
            chainSha: last[0]?.chain_sha256 ?? "",
            title: last[0]?.title ?? specs.title,
          };
        }
      }
      const result = await punishSabotage({
        userId: target.user_id,
        actor: target.label,
        role: target.role,
        team: target.team,
        kind: specs.kind,
        title: specs.title,
        detail: specs.detail,
        machineLabel: specs.machineLabel,
        fpHash: fakeFp,
        drill: true,
      });
      return {
        incidentId: result.incidentId,
        ejected: result.ejected,
        actor: target.label,
        pdfSha: result.pdfSha,
        chainSha: result.chainSha,
        title: specs.title,
      };
    },
  );
