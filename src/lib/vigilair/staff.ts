import { requireCopOpen } from "./cop-lock";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { sanitizeMachineLabel, scrubSessionIps, stripIps } from "./privacy";
import { AGENT_SESSION_CAP, pruneOldSessions, requireChefSeal } from "./seal";

export type StaffRole = "superadmin" | "admin" | "operateur" | "analyste";
export type AssignableRole = Exclude<StaffRole, "superadmin">;
export type StaffTeam = "cop" | "ident" | "sigint" | "radar" | "division";

export type StaffProfile = {
  userId: string;
  role: StaffRole;
  label: string;
  team: StaffTeam;
  ejected: boolean;
  lastSeen: string | null;
  email: string | null;
  grade: string;
  phone: string;
  unit: string;
};

export type AccessKeyRow = {
  id: string;
  label: string;
  email: string;
  workEmail: string | null;
  role: StaffRole;
  team: StaffTeam;
  createdAt: string;
  usedAt: string | null;
  revoked: boolean;
  ejected: boolean;
  userId: string | null;
  grade: string;
  phone: string;
  unit: string;
};

export type BotPublicSettings = {
  telegramChatId: string;
  telegramConfigured: boolean;
  telegramHint: string;
  signalWebhook: string;
};

export const ASSIGNABLE_ROLES: AssignableRole[] = ["admin", "operateur", "analyste"];
export const STAFF_TEAMS: StaffTeam[] = ["cop", "ident", "sigint", "radar", "division"];

export const ROLE_LABEL: Record<StaffRole, string> = {
  superadmin: "Chef de division",
  admin: "Administrateur",
  operateur: "Opérateur",
  analyste: "Analyste",
};

export const TEAM_LABEL: Record<StaffTeam, string> = {
  cop: "Poste COP",
  ident: "Identification",
  sigint: "SIGINT",
  radar: "Radar",
  division: "État-major",
};

export const EJECTED_MSG =
  "Accès retiré par le chef de division. Toute reconnexion déclenche une alerte.";
export const PASSWORD_ONLY_CHEF =
  "Mot de passe réservé au chef de division. Les agents se connectent uniquement avec une clé VA-.";
export const KEY_ONLY_MSG =
  "Connexion par clé unique uniquement. Le mot de passe est réservé au chef de division.";
export const KEY_MOVED_MSG =
  "Cette clé est déjà liée à un autre poste. Session refusée. Le chef de division a été alerté.";

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function cryptoMod() {
  return import("node:crypto");
}

export async function hashKeyMaterial(key: string): Promise<string> {
  const { createHash } = await cryptoMod();
  return createHash("sha256").update(key).digest("hex");
}

export async function mintKey(): Promise<string> {
  const { randomBytes } = await cryptoMod();
  const b = randomBytes(12);
  const chars = Array.from(b, (n) => ALPH[n % ALPH.length]);
  return `VA-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

export async function mintId(): Promise<string> {
  const { randomBytes } = await cryptoMod();
  return randomBytes(12).toString("hex");
}

function normalizeKey(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function asRole(v: string | null | undefined): StaffRole {
  if (v === "superadmin" || v === "admin" || v === "operateur" || v === "analyste") {
    return v;
  }
  return "admin";
}

function asTeam(v: string | null | undefined): StaffTeam {
  if (v === "cop" || v === "ident" || v === "sigint" || v === "radar" || v === "division") {
    return v;
  }
  return "cop";
}

function asIdentity(row: {
  email?: string | null;
  grade?: string | null;
  phone?: string | null;
  unit?: string | null;
}): Pick<StaffProfile, "email" | "grade" | "phone" | "unit"> {
  const email = (row.email ?? "").trim();
  return {
    email: email.length > 0 ? email.toLowerCase() : null,
    grade: (row.grade ?? "").trim(),
    phone: (row.phone ?? "").trim(),
    unit: (row.unit ?? "").trim(),
  };
}

export async function loadStaff(userId: string): Promise<StaffProfile | null> {
  const sql = await getSql();
  const rows = await sql<{
    user_id: string;
    role: string;
    label: string;
    team: string;
    ejected: boolean;
    last_seen: string | null;
    email: string | null;
    grade: string | null;
    phone: string | null;
    unit: string | null;
  }>`
    select user_id, role, label, team, ejected, last_seen::text as last_seen,
           email, grade, phone, unit
    from staff where user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    role: asRole(row.role),
    label: row.label,
    team: asTeam(row.team),
    ejected: Boolean(row.ejected),
    lastSeen: row.last_seen,
    ...asIdentity(row),
  };
}

export async function touchLastSeen(userId: string): Promise<void> {
  const sql = await getSql();
  await sql`update staff set last_seen = now(), updated_at = now() where user_id = ${userId}`;
}

export async function killUserSessions(userId: string): Promise<void> {
  const sql = await getSql();
  try {
    await sql`delete from session where "userId" = ${userId}`;
  } catch {
    /* table absente en amont de l'auth */
  }
}

export type BindResult =
  | { ok: true; first: boolean; label: string }
  | { ok: false; reason: "moved"; label: string };

export async function bindOrRejectDevice(opts: {
  userId: string;
  keyId?: string | null;
  actor: string;
  role: string;
  team: string;
  fingerprint: string;
  machineLabel: string;
}): Promise<BindResult> {
  const fp = opts.fingerprint.replace(/[^a-f0-9]/gi, "").toLowerCase();
  const label = sanitizeMachineLabel(opts.machineLabel);
  if (fp.length !== 64) return { ok: true, first: false, label };
  const sql = await getSql();
  const existing = await sql<{
    id: string;
    fp_hash: string;
    label: string;
  }>`
    select id, fp_hash, label from device_bindings where user_id = ${opts.userId} limit 1
  `;
  const row = existing[0];
  if (!row) {
    const id = await mintId();
    await sql`
      insert into device_bindings (id, user_id, key_id, fp_hash, label)
      values (${id}, ${opts.userId}, ${opts.keyId ?? null}, ${fp}, ${label})
      on conflict (user_id) do nothing
    `;
    return { ok: true, first: true, label };
  }
  if (row.fp_hash === fp) {
    if (row.label !== label) {
      await sql`update device_bindings set label = ${label}, last_seen = now() where id = ${row.id}`;
    } else {
      await sql`update device_bindings set last_seen = now() where id = ${row.id}`;
    }
    return { ok: true, first: false, label };
  }
  const legacy = /windows|linux|mac|android|iphone|africa\/|×|\d{3,4}x\d{3,4}/i.test(row.label);
  if (legacy) {
    await sql`
      update device_bindings
      set fp_hash = ${fp}, label = ${label}, last_seen = now()
      where id = ${row.id}
    `;
    return { ok: true, first: false, label };
  }
  const recap = await buildWorkRecap(opts.userId);
  await sql`
    update staff
    set ejected = true,
        ejected_at = now(),
        ejected_reason = ${KEY_MOVED_MSG},
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
  const incident = await insertSecurityIncident({
    userId: opts.userId,
    actor: opts.actor,
    kind: "key_clone",
    title: `Clé VA- sur un autre poste · ${opts.actor}`,
    detail: `Poste scellé : ${row.label}. Poste présenté : ${label}. La clé ne voyage pas.`,
    workRecap: recap,
    machineLabel: label,
    fpHash: fp,
    autoEjected: true,
  });
  await insertOpsLog({
    userId: opts.userId,
    actor: opts.actor,
    role: opts.role,
    team: opts.team,
    kind: "copy",
    title: incident.title,
    detail: incident.detail,
    severity: "crit",
  });
  await dispatchChefAlert({
    id: incident.id,
    title: incident.title,
    body: `${incident.detail}\n\n${recap}`,
    level: "critique",
  });
  return { ok: false, reason: "moved", label: row.label };
}

export async function insertOpsLog(row: {
  userId: string;
  actor: string;
  role: string;
  team: string;
  kind: string;
  title: string;
  detail: string;
  trackId?: string | null;
  severity?: "info" | "warn" | "crit";
}): Promise<void> {
  const sql = await getSql();
  const id = await mintId();
  const title = stripIps(row.title);
  const detail = stripIps(row.detail);
  await sql`
    insert into ops_log (id, user_id, actor, role, team, kind, title, detail, track_id, severity)
    values (
      ${id}, ${row.userId}, ${row.actor}, ${row.role}, ${row.team},
      ${row.kind}, ${title}, ${detail}, ${row.trackId ?? null},
      ${row.severity ?? "info"}
    )
  `;
}

export async function insertSecurityIncident(row: {
  userId: string | null;
  actor: string;
  kind: string;
  title: string;
  detail: string;
  workRecap: string;
  machineLabel?: string | null;
  fpHash?: string | null;
  autoEjected?: boolean;
  drill?: boolean;
}): Promise<{ id: string; title: string; detail: string; contentSha: string; chainSha: string; pdfSha: string }> {
  const sql = await getSql();
  const id = await mintId();
  const machine = sanitizeMachineLabel(row.machineLabel);
  const detail = stripIps(row.detail);
  const title = stripIps(row.title);
  const recap = stripIps(row.workRecap);
  const prev = await sql<{ chain_sha256: string | null }>`
    select chain_sha256 from security_incidents
    where chain_sha256 is not null
    order by created_at desc limit 1
  `;
  const prevSha = prev[0]?.chain_sha256 ?? null;
  const canonical = JSON.stringify({
    id,
    kind: row.kind,
    actor: row.actor,
    title,
    detail,
    recap,
    machine,
    fp: row.fpHash ?? null,
  });
  const contentSha = await hashKeyMaterial(canonical);
  const chainSha = await hashKeyMaterial(`${contentSha}\n${prevSha ?? "GENESIS"}`);
  const { buildPdf, layoutEvidence } = await import("./evidence-pdf");
  const when = new Date().toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Ndjamena",
  });
  const lines = layoutEvidence([
    { kind: "h", text: "VIGILAIR — dossier d'incident sentinelle" },
    { kind: "p", text: "DIFFUSION RESTREINTE · COP N'Djamena · garde logiciel / dossier / clé" },
    { kind: "p", text: "Copie du logiciel ou d'un dossier = alerte, coupure, documentation. Une clé VA- ne voyage pas." },
    { kind: "gap" },
    { kind: "k", text: `Incident  ${id}` },
    { kind: "k", text: `Quand     ${when} WAT` },
    { kind: "k", text: `Agent     ${row.actor}` },
    { kind: "k", text: `Nature    ${row.kind}` },
    { kind: "k", text: `Coupure   ${row.autoEjected ? "OUI — session et clé mortes" : "non"}` },
    { kind: "k", text: `Exercice  ${row.drill ? "oui — formation chef de division" : "non — événement réel"}` },
    { kind: "gap" },
    { kind: "h", text: "Fait" },
    { kind: "p", text: title },
    { kind: "p", text: detail },
    { kind: "gap" },
    { kind: "h", text: "Poste" },
    { kind: "p", text: machine },
    { kind: "mono", text: `empreinte SHA-256 ${row.fpHash ?? "—"}` },
    { kind: "gap" },
    { kind: "h", text: "Chaine de custody" },
    { kind: "mono", text: `contenu   SHA-256 ${contentSha}` },
    { kind: "mono", text: `precedent SHA-256 ${prevSha ?? "GENESIS"}` },
    { kind: "mono", text: `chaine    SHA-256 ${chainSha}` },
    { kind: "gap" },
    { kind: "h", text: "Recapitulatif de l'agent" },
    { kind: "mono", text: recap },
    { kind: "gap" },
    { kind: "p", text: "Mandat : detection et identification. VIGILAIR n'emet pas. Ce dossier est append-only." },
  ]);
  const pdf = buildPdf(lines);
  const { createHash } = await cryptoMod();
  const pdfShaBytes = createHash("sha256").update(pdf).digest("hex");
  const pdfB64 = Buffer.from(pdf).toString("base64");
  await sql`
    insert into security_incidents (
      id, user_id, actor, kind, title, detail, work_recap,
      machine_label, fp_hash, content_sha256, prev_sha256, chain_sha256,
      pdf_sha256, pdf_b64, auto_ejected, drill
    )
    values (
      ${id}, ${row.userId}, ${row.actor}, ${row.kind}, ${title}, ${detail}, ${recap},
      ${machine}, ${row.fpHash ?? null}, ${contentSha}, ${prevSha}, ${chainSha},
      ${pdfShaBytes}, ${pdfB64}, ${Boolean(row.autoEjected)}, ${Boolean(row.drill)}
    )
  `;
  return { id, title, detail, contentSha, chainSha, pdfSha: pdfShaBytes };
}

export async function buildWorkRecap(userId: string): Promise<string> {
  const staff = await loadStaff(userId);
  const sql = await getSql();
  const counts = await sql<{ kind: string; n: number }>`
    select kind, count(*)::int as n from ops_log where user_id = ${userId} group by kind
  `;
  const last = await sql<{ title: string; created_at: string }>`
    select title, created_at::text as created_at
    from ops_log where user_id = ${userId}
    order by created_at desc limit 5
  `;
  const pick = (k: string) => counts.find((x) => x.kind === k)?.n ?? 0;
  const lines = [
    `Agent: ${staff?.label ?? userId} · ${ROLE_LABEL[staff?.role ?? "admin"]} · ${TEAM_LABEL[staff?.team ?? "cop"]}`,
    `Statut: ${staff?.ejected ? "ÉJECTÉ — reconnexion interdite" : "en poste"}`,
    `Travail: ${pick("ident")} ident · ${pick("bulletin")} bulletins · ${pick("m4")} Mode 4 · ${pick("lock")} verrous · ${pick("download")} extraits`,
  ];
  if (last.length > 0) {
    lines.push("Dernières actions:");
    for (const r of last) {
      lines.push(`- ${r.title}`);
    }
  } else {
    lines.push("Aucune action consignée.");
  }
  return lines.join("\n");
}

export async function dispatchChefAlert(data: {
  id: string;
  title: string;
  body: string;
  level: string;
}): Promise<string[]> {
  const sql = await getSql();
  const already = await sql<{ alert_id: string }>`
    select alert_id from alert_dispatch where alert_id = ${data.id}
  `;
  if (already[0]) return [];
  const chef = await sql<{ user_id: string }>`
    select user_id from staff where role = 'superadmin' limit 1
  `;
  const owner = chef[0]?.user_id;
  const channels: string[] = [];
  if (owner) {
    const bots = await sql<{
      telegram_token: string | null;
      telegram_chat_id: string | null;
      signal_webhook: string | null;
    }>`
      select telegram_token, telegram_chat_id, signal_webhook
      from bot_settings where user_id = ${owner}
    `;
    const cfg = bots[0];
    const text = `VIGILAIR · ${data.level.toUpperCase()}\n${data.title}\n${data.body}`;
    if (cfg?.telegram_token && cfg.telegram_chat_id) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${cfg.telegram_token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cfg.telegram_chat_id,
              text,
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(4000),
          },
        );
        if (res.ok) channels.push("telegram");
      } catch {
        /* canal muet */
      }
    }
    if (cfg?.signal_webhook) {
      try {
        const res = await fetch(cfg.signal_webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "VIGILAIR",
            id: data.id,
            level: data.level,
            title: data.title,
            body: data.body,
            at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) channels.push("signal");
      } catch {
        /* canal muet */
      }
    }
  }
  await sql`
    insert into alert_dispatch (alert_id, channels, user_id)
    values (${data.id}, ${channels.join(",") || "none"}, ${owner ?? "system"})
    on conflict (alert_id) do nothing
  `;
  return channels;
}

export async function ensureStaffRow(userId: string): Promise<StaffProfile> {
  await scrubSessionIps(userId);
  const existing = await loadStaff(userId);
  if (existing) {
    if (existing.ejected) throw new Error(EJECTED_MSG);
    if (existing.role === "superadmin" && existing.team !== "division") {
      const sql = await getSql();
      await sql`
        update staff set team = 'division', updated_at = now() where user_id = ${userId}
      `;
      return { ...existing, team: "division" };
    }
    return existing;
  }
  const sql = await getSql();
  const users = await sql<{ name: string | null; email: string | null }>`
    select name, email from "user" where id = ${userId}
  `;
  const u = users[0];
  const supers = await sql<{ user_id: string }>`
    select user_id from staff where role = 'superadmin' limit 1
  `;
  if (!supers[0]) {
    const label = u?.name?.trim() || "Chef de division";
    const mail = u?.email?.trim().toLowerCase() || null;
    await sql`
      insert into staff (user_id, role, label, team, email)
      values (${userId}, 'superadmin', ${label}, 'division', ${mail})
      on conflict (user_id) do nothing
    `;
    const created = await loadStaff(userId);
    if (created) return created;
    return {
      userId,
      role: "superadmin",
      label,
      team: "division",
      ejected: false,
      lastSeen: null,
      email: mail,
      grade: "",
      phone: "",
      unit: "",
    };
  }
  const email = u?.email ?? "";
  const keyed = email
    ? await sql<{ label: string; role: string; team: string; revoked: boolean; ejected: boolean }>`
        select label, role, team, revoked, ejected from access_keys where email = ${email} limit 1
      `
    : [];
  const key = keyed[0];
  if (!key || key.revoked || key.ejected) {
    throw new Error(KEY_ONLY_MSG);
  }
  const label = key.label || u?.name?.trim() || "Agent";
  const role = asRole(key.role);
  const team = asTeam(key.team);
  await sql`
    insert into staff (user_id, role, label, team)
    values (${userId}, ${role === "superadmin" ? "admin" : role}, ${label}, ${team})
    on conflict (user_id) do nothing
  `;
  const created = await loadStaff(userId);
  if (created) {
    if (created.ejected) throw new Error(EJECTED_MSG);
    return created;
  }
  return {
    userId,
    role: role === "superadmin" ? "admin" : role,
    label,
    team,
    ejected: false,
    lastSeen: null,
    email: u?.email?.trim().toLowerCase() || null,
    grade: "",
    phone: "",
    unit: "",
  };
}

export async function requireSuperadmin(userId: string): Promise<StaffProfile> {
  const staff = await ensureStaffRow(userId);
  if (staff.role !== "superadmin") {
    throw new Error("Réservé au chef de division");
  }
  return staff;
}

export const divisionStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ hasSuperadmin: boolean }> => {
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from staff where role = 'superadmin'
    `;
    return { hasSuperadmin: (rows[0]?.n ?? 0) > 0 };
  },
);

export const resolveAccessKey = createServerFn({ method: "POST" })
  .validator((raw: { key: string; email?: string; fingerprint?: string; machineLabel?: string }) => ({
    key: normalizeKey(raw.key ?? ""),
    email: String(raw.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 120),
    fingerprint: String(raw.fingerprint ?? "")
      .replace(/[^a-f0-9]/gi, "")
      .toLowerCase()
      .slice(0, 64),
    machineLabel: sanitizeMachineLabel(raw.machineLabel),
  }))
  .handler(async ({ data }): Promise<{ email: string; label: string }> => {
    if (data.key.length < 10) throw new Error("Identifiants refusés");
    if (!data.email || !data.email.includes("@")) {
      throw new Error("E-mail et clé VA- requis");
    }
    const sql = await getSql();
    const digest = await hashKeyMaterial(data.key);
    const rows = await sql<{
      email: string;
      label: string;
      revoked: boolean;
      ejected: boolean;
      id: string;
      user_id: string | null;
      role: string;
      team: string;
    }>`
      select email, label, revoked, ejected, id, user_id, role, team
      from access_keys where key_hash = ${digest} limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Identifiants refusés");

    if (row.revoked || row.ejected) {
      const recap = row.user_id
        ? await buildWorkRecap(row.user_id)
        : `Agent: ${row.label}\nStatut: ÉJECTÉ — reconnexion interdite`;
      const incident = await insertSecurityIncident({
        userId: row.user_id,
        actor: row.label,
        kind: "reconnect_ejected",
        title: `Reconnexion refusée · ${row.label}`,
        detail:
          "Agent éjecté. Clé révoquée. Impossible de se reconnecter ni d'extraire des données.",
        workRecap: recap,
        machineLabel: data.machineLabel,
        fpHash: data.fingerprint || null,
        autoEjected: true,
      });
      await dispatchChefAlert({
        id: incident.id,
        title: incident.title,
        body: `${incident.detail}\n\n${recap}`,
        level: "critique",
      });
      throw new Error(EJECTED_MSG);
    }

    if (row.user_id) {
      const staff = await loadStaff(row.user_id);
      if (staff?.ejected) {
        const recap = await buildWorkRecap(row.user_id);
        const incident = await insertSecurityIncident({
          userId: row.user_id,
          actor: row.label,
          kind: "reconnect_ejected",
          title: `Reconnexion refusée · ${row.label}`,
          detail: EJECTED_MSG,
          workRecap: recap,
          machineLabel: data.machineLabel,
          fpHash: data.fingerprint || null,
          autoEjected: true,
        });
        await dispatchChefAlert({
          id: incident.id,
          title: incident.title,
          body: `${incident.detail}\n\n${recap}`,
          level: "critique",
        });
        throw new Error(EJECTED_MSG);
      }
      const work = (staff?.email ?? "").toLowerCase();
      if (work && work !== data.email) {
        throw new Error("Identifiants refusés");
      }
      if (!work && data.email) {
        await sql`
          update staff set email = ${data.email}, updated_at = now()
          where user_id = ${row.user_id}
        `;
      }
      if (data.fingerprint.length === 64) {
        const bind = await bindOrRejectDevice({
          userId: row.user_id,
          keyId: row.id,
          actor: row.label,
          role: row.role,
          team: row.team,
          fingerprint: data.fingerprint,
          machineLabel: data.machineLabel,
        });
        if (!bind.ok) throw new Error(KEY_MOVED_MSG);
      }
    }

    await sql`update access_keys set used_at = now() where id = ${row.id}`;
    if (row.user_id) {
      await touchLastSeen(row.user_id);
      await pruneOldSessions(row.user_id, AGENT_SESSION_CAP);
      await insertOpsLog({
        userId: row.user_id,
        actor: row.label,
        role: row.role,
        team: row.team,
        kind: "login",
        title: "Session ouverte par clé VA",
        detail: "Identité vérifiée. Poste scellé. Aucune adresse IP conservée.",
        severity: "info",
      });
    }
    return { email: row.email, label: row.label };
  });

export const ensureMyStaff = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StaffProfile> => {
    const profile = await ensureStaffRow(context.userId);
    await touchLastSeen(context.userId);
    return profile;
  });

export const listAccessKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AccessKeyRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      label: string;
      email: string;
      role: string;
      team: string;
      created_at: string;
      used_at: string | null;
      revoked: boolean;
      ejected: boolean;
      user_id: string | null;
      work_email: string | null;
      grade: string | null;
      phone: string | null;
      unit: string | null;
    }>`
      select k.id, k.label, k.email, k.role, k.team, k.created_at::text as created_at,
             k.used_at::text as used_at, k.revoked, k.ejected, k.user_id,
             s.email as work_email, s.grade, s.phone, s.unit
      from access_keys k
      left join staff s on s.user_id = k.user_id
      where k.created_by = ${context.userId}
      order by k.created_at desc
    `;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      email: r.email,
      workEmail: r.work_email,
      role: asRole(r.role),
      team: asTeam(r.team),
      createdAt: r.created_at,
      usedAt: r.used_at,
      revoked: Boolean(r.revoked),
      ejected: Boolean(r.ejected),
      userId: r.user_id,
      grade: r.grade ?? "",
      phone: r.phone ?? "",
      unit: r.unit ?? "",
    }));
  });

export const generateAccessKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: {
    label: string;
    role?: string;
    team?: string;
    email?: string;
    grade?: string;
    phone?: string;
    unit?: string;
  }) => {
    const label = (raw.label ?? "").trim();
    if (label.length < 2 || label.length > 80) {
      throw new Error("Libellé: 2 à 80 caractères");
    }
    const email = String(raw.email ?? "").trim().toLowerCase();
    if (!email.includes("@") || email.length > 120) {
      throw new Error("E-mail professionnel requis");
    }
    const role = (raw.role ?? "operateur") as AssignableRole;
    if (!ASSIGNABLE_ROLES.includes(role)) throw new Error("Rôle invalide");
    const team = (raw.team ?? "cop") as StaffTeam;
    if (!STAFF_TEAMS.includes(team)) throw new Error("Équipe invalide");
    return {
      label,
      role,
      team,
      email,
      grade: String(raw.grade ?? "").trim().slice(0, 40),
      phone: String(raw.phone ?? "").trim().slice(0, 24),
      unit: String(raw.unit ?? "").trim().slice(0, 60),
    };
  })
  .handler(
    async ({
      context,
      data,
    }): Promise<{ key: string; id: string; label: string; role: string; team: string; email: string }> => {
      await requireSuperadmin(context.userId);
      await requireChefSeal(context.userId);
      await requireCopOpen();
      const { createKeyedAgent } = await import("./staff-ops.server");
      let row: { key: string; id: string; label: string };
      try {
        row = await createKeyedAgent({
          label: data.label,
          role: data.role,
          team: data.team,
          createdBy: context.userId,
          email: data.email,
          grade: data.grade,
          phone: data.phone,
          unit: data.unit,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/unique|duplicate/i.test(msg)) {
          throw new Error("Cet e-mail est déjà attribué à un agent");
        }
        throw e;
      }
      await insertOpsLog({
        userId: context.userId,
        actor: (await loadStaff(context.userId))?.label ?? "Chef",
        role: "superadmin",
        team: "division",
        kind: "role_change",
        title: `Clé émise · ${data.label}`,
        detail: `${ROLE_LABEL[data.role]} · ${TEAM_LABEL[data.team]} · ${data.email}`,
        severity: "info",
      });
      return {
        key: row.key,
        id: row.id,
        label: row.label,
        role: data.role,
        team: data.team,
        email: data.email,
      };
    },
  );

export const revokeAccessKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id: string }) => ({ id: String(raw.id ?? "") }))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await requireSuperadmin(context.userId);
    await requireChefSeal(context.userId);
    if (!data.id) throw new Error("Clé inconnue");
    const sql = await getSql();
    const keys = await sql<{ user_id: string | null; label: string }>`
      select user_id, label from access_keys
      where id = ${data.id} and created_by = ${context.userId}
      limit 1
    `;
    const key = keys[0];
    if (!key) throw new Error("Clé inconnue");
    await sql`
      update access_keys
      set revoked = true, ejected = true
      where id = ${data.id} and created_by = ${context.userId}
    `;
    if (key.user_id) {
      const recap = await buildWorkRecap(key.user_id);
      await sql`
        update staff
        set ejected = true, ejected_at = now(),
            ejected_reason = 'Clé révoquée par le chef de division',
            updated_at = now()
        where user_id = ${key.user_id} and role <> 'superadmin'
      `;
      const { scrambleCredentials } = await import("./staff-ops.server");
      await scrambleCredentials(key.user_id);
      await killUserSessions(key.user_id);
      const incident = await insertSecurityIncident({
        userId: key.user_id,
        actor: key.label,
        kind: "eject",
        title: `Clé révoquée · ${key.label}`,
        detail: "Éjection : reconnexion et extraction impossibles.",
        workRecap: recap,
      });
      await dispatchChefAlert({
        id: incident.id,
        title: incident.title,
        body: `${incident.detail}\n\n${recap}`,
        level: "critique",
      });
    }
    return { ok: true };
  });

export const saveMyIdentity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { grade?: string; phone?: string; unit?: string; label?: string; email?: string }) => ({
    grade: String(raw.grade ?? "").trim().slice(0, 40),
    phone: String(raw.phone ?? "").trim().slice(0, 24),
    unit: String(raw.unit ?? "").trim().slice(0, 60),
    label: String(raw.label ?? "").trim().slice(0, 80),
    email: String(raw.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 120),
  }))
  .handler(async ({ context, data }): Promise<StaffProfile> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    const label = data.label.length >= 2 ? data.label : staff.label;
    let email = staff.email;
    if (staff.role === "superadmin" && data.email) {
      if (!data.email.includes("@")) throw new Error("E-mail invalide");
      email = data.email;
    }
    const sql = await getSql();
    if (email) {
      const clash = await sql<{ user_id: string }>`
        select user_id from staff
        where email = ${email} and user_id <> ${context.userId}
        limit 1
      `;
      if (clash[0]) throw new Error("Cet e-mail est déjà attribué");
    }
    await sql`
      update staff
      set grade = ${data.grade},
          phone = ${data.phone},
          unit = ${data.unit},
          label = ${label},
          email = ${email},
          updated_at = now()
      where user_id = ${context.userId}
    `;
    const next = await loadStaff(context.userId);
    if (!next) throw new Error("Identité introuvable");
    return next;
  });

export const getBotSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BotPublicSettings> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      telegram_token: string | null;
      telegram_chat_id: string | null;
      signal_webhook: string | null;
    }>`
      select telegram_token, telegram_chat_id, signal_webhook
      from bot_settings where user_id = ${context.userId}
    `;
    const row = rows[0];
    const token = row?.telegram_token ?? "";
    return {
      telegramChatId: row?.telegram_chat_id ?? "",
      telegramConfigured: token.length > 0,
      telegramHint: token ? `••••${token.slice(-4)}` : "",
      signalWebhook: row?.signal_webhook ?? "",
    };
  });

export const saveBotSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (raw: {
      telegramToken?: string;
      telegramChatId?: string;
      signalWebhook?: string;
    }) => ({
      telegramToken: (raw.telegramToken ?? "").trim(),
      telegramChatId: (raw.telegramChatId ?? "").trim(),
      signalWebhook: (raw.signalWebhook ?? "").trim(),
    }),
  )
  .handler(async ({ context, data }): Promise<BotPublicSettings> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const prev = await sql<{ telegram_token: string | null }>`
      select telegram_token from bot_settings where user_id = ${context.userId}
    `;
    const token =
      data.telegramToken.length > 0
        ? data.telegramToken
        : (prev[0]?.telegram_token ?? "");
    await sql`
      insert into bot_settings (user_id, telegram_token, telegram_chat_id, signal_webhook, updated_at)
      values (${context.userId}, ${token || null}, ${data.telegramChatId || null}, ${data.signalWebhook || null}, now())
      on conflict (user_id) do update set
        telegram_token = excluded.telegram_token,
        telegram_chat_id = excluded.telegram_chat_id,
        signal_webhook = excluded.signal_webhook,
        updated_at = now()
    `;
    return {
      telegramChatId: data.telegramChatId,
      telegramConfigured: token.length > 0,
      telegramHint: token ? `••••${token.slice(-4)}` : "",
      signalWebhook: data.signalWebhook,
    };
  });

export const pushInstantAlert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (raw: { id: string; title: string; body: string; level: string }) => ({
      id: String(raw.id ?? "").slice(0, 80),
      title: String(raw.title ?? "").slice(0, 180),
      body: String(raw.body ?? "").slice(0, 400),
      level: String(raw.level ?? "").slice(0, 20),
    }),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ sent: boolean; channels: string[] }> => {
      if (!data.id || !data.title) return { sent: false, channels: [] };
      void context.userId;
      const channels = await dispatchChefAlert(data);
      return { sent: channels.length > 0, channels };
    },
  );
