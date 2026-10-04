/** Garde serveur : tentatives, verrouillage, spray. Auth requise sauf authGate. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  AUTH_FAIL_LIMIT,
  AUTH_FAIL_WINDOW_MS,
  AUTH_LOCK_MSG,
  AUTH_LOCK_MS,
  SPRAY_LIMIT,
  SPRAY_WINDOW_MS,
  type AuthAttemptRow,
  type CopLockState,
  maskEmail,
  maskKey,
} from "./guard";
import { cutAgentSessions, readCopLock, writeCopLock } from "./cop-lock";
import { requireChefSeal } from "./seal";
import {
  dispatchChefAlert,
  insertOpsLog,
  insertSecurityIncident,
  loadStaff,
  mintId,
  requireSuperadmin,
} from "./staff";

async function hashIdent(raw: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(raw.trim().toLowerCase()).digest("hex");
}

async function failCount(identityHash: string, sinceIso: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n
    from auth_guard
    where identity_hash = ${identityHash}
      and ok = false
      and created_at > ${sinceIso}::timestamptz
  `;
  return rows[0]?.n ?? 0;
}

async function sprayCount(sinceIso: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n
    from auth_guard
    where kind = 'va_key'
      and ok = false
      and created_at > ${sinceIso}::timestamptz
  `;
  return rows[0]?.n ?? 0;
}

async function raisePirate(opts: {
  kind: "brute_force" | "key_spray";
  title: string;
  detail: string;
  identityShown: string;
}): Promise<void> {
  const incident = await insertSecurityIncident({
    userId: null,
    actor: opts.identityShown || "inconnu",
    kind: opts.kind,
    title: opts.title,
    detail: opts.detail,
    workRecap: "Tentative hors session. Aucune donnée COP extraite. Sessions agents coupées.",
    autoEjected: false,
  });
  await dispatchChefAlert({
    id: incident.id,
    title: opts.title,
    body: opts.detail,
    level: "critique",
  });
  await writeCopLock({
    locked: true,
    reason: opts.title,
    byLabel: "Sentinelle",
  });
  await cutAgentSessions();
}

export const authGate = createServerFn({ method: "POST" })
  .validator((raw: { kind?: string; identity?: string; result?: string; fingerprint?: string }) => {
    const kind = raw.kind === "va_key" ? "va_key" : "chef_login";
    const result =
      raw.result === "ok" ? "ok" : raw.result === "fail" ? "fail" : "check";
    const identity = String(raw.identity ?? "").trim().slice(0, 180);
    return {
      kind: kind as "va_key" | "chef_login",
      identity,
      result: result as "check" | "ok" | "fail",
      fingerprint: String(raw.fingerprint ?? "")
        .replace(/[^a-f0-9]/gi, "")
        .toLowerCase()
        .slice(0, 64),
    };
  })
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; locked: boolean; waitSec: number } | { ok: false; locked: true; waitSec: number; error: string }> => {
      if (!data.identity) {
        return { ok: true, locked: false, waitSec: 0 };
      }
      const sql = await getSql();
      const identityHash = await hashIdent(
        data.kind === "va_key" ? `key:${data.identity}` : `mail:${data.identity}`,
      );
      const shown =
        data.kind === "va_key" ? maskKey(data.identity) : maskEmail(data.identity);
      const since = new Date(Date.now() - AUTH_FAIL_WINDOW_MS).toISOString();
      const n = await failCount(identityHash, since);
      if (n >= AUTH_FAIL_LIMIT && data.result !== "ok") {
        const last = await sql<{ created_at: string }>`
          select created_at::text as created_at
          from auth_guard
          where identity_hash = ${identityHash} and ok = false
          order by created_at desc
          limit 1
        `;
        const lastMs = Date.parse(last[0]?.created_at ?? "") || Date.now();
        const waitSec = Math.max(0, Math.ceil((lastMs + AUTH_LOCK_MS - Date.now()) / 1000));
        if (waitSec > 0) {
          if (data.result === "fail") {
            await raisePirate({
              kind: "brute_force",
              title: `Force brute · ${shown}`,
              detail: `${n + 1} échecs en 10 min. COP figé. Sessions agents coupées. Identité ${shown}. AfriControl n'émet pas.`,
              identityShown: shown,
            });
          }
          return { ok: false, locked: true, waitSec, error: AUTH_LOCK_MSG };
        }
      }

      if (data.result === "check") {
        return { ok: true, locked: false, waitSec: 0 };
      }

      const id = await mintId();
      await sql`
        insert into auth_guard (id, kind, identity_hash, identity_shown, fp_hash, ok, detail)
        values (
          ${id},
          ${data.kind},
          ${identityHash},
          ${shown},
          ${data.fingerprint || null},
          ${data.result === "ok"},
          ${data.result === "ok" ? "session" : "refus"}
        )
      `;

      if (data.result === "fail") {
        const fails = n + 1;
        if (fails >= AUTH_FAIL_LIMIT) {
          await raisePirate({
            kind: "brute_force",
            title: `Force brute · ${shown}`,
            detail: `${fails} échecs en 10 min. Session refusée. COP figé. Sessions agents coupées.`,
            identityShown: shown,
          });
          return { ok: false, locked: true, waitSec: AUTH_LOCK_MS / 1000, error: AUTH_LOCK_MSG };
        }
        const spraySince = new Date(Date.now() - SPRAY_WINDOW_MS).toISOString();
        const spray = await sprayCount(spraySince);
        if (data.kind === "va_key" && spray >= SPRAY_LIMIT) {
          await raisePirate({
            kind: "key_spray",
            title: `Spray de clés VA- · ${spray} refus`,
            detail: "Plusieurs clés fausses en 5 min. Possible attaque sur le poste. COP figé. Sessions agents coupées.",
            identityShown: shown,
          });
          return { ok: false, locked: true, waitSec: AUTH_LOCK_MS / 1000, error: AUTH_LOCK_MSG };
        }
      }

      return { ok: true, locked: false, waitSec: 0 };
    },
  );

export const copLockStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CopLockState> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return { locked: false, reason: "", byLabel: null, at: null };
    return readCopLock();
  });

export const setCopLock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { locked?: boolean; reason?: string }) => ({
    locked: Boolean(raw.locked),
    reason: String(raw.reason ?? "").slice(0, 240),
  }))
  .handler(async ({ context, data }): Promise<CopLockState> => {
    const chef = await requireSuperadmin(context.userId);
    await requireChefSeal(context.userId);
    if (data.locked) {
      await cutAgentSessions();
    }
    const lock = await writeCopLock({
      locked: data.locked,
      reason: data.locked
        ? data.reason || "Verrou chef de division"
        : "",
      byLabel: chef.label,
    });
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: data.locked ? "lock" : "bulletin",
      title: data.locked ? "COP figé — intrusion" : "Verrou COP levé",
      detail: lock.reason || "Sentinelle",
      severity: data.locked ? "crit" : "info",
    });
    return lock;
  });

export const listAuthAttempts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AuthAttemptRow[]> => {
    await requireSuperadmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      kind: string;
      identity_shown: string;
      ok: boolean;
      detail: string;
      created_at: string;
    }>`
      select id, kind, identity_shown, ok, detail, created_at::text as created_at
      from auth_guard
      order by created_at desc
      limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      identityShown: r.identity_shown,
      ok: Boolean(r.ok),
      detail: r.detail,
      at: r.created_at,
    }));
  });
