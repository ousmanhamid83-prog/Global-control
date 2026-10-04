/** Sceau chef + plafond de sessions. AfriControl n'émet pas. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { AUTH_FAIL_MSG } from "./guard";

export const SEAL_REQUIRED = "Sceau chef requis — retapez le mot de passe.";
export const SEAL_MS = 5 * 60_000;
export const IDLE_MS = 8 * 60_000;
export const CHEF_SESSION_CAP = 2;
export const AGENT_SESSION_CAP = 1;

const g = globalThis as typeof globalThis & {
  __vigilairChefSeal__?: Map<string, number>;
};

function seals(): Map<string, number> {
  return (g.__vigilairChefSeal__ ??= new Map());
}

export async function pruneOldSessions(userId: string, keep: number): Promise<void> {
  try {
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      select id from "session" where "userId" = ${userId} order by "createdAt" desc
    `;
    const drop = rows.slice(Math.max(0, keep));
    for (const r of drop) {
      await sql`delete from "session" where id = ${r.id}`;
    }
  } catch {
    /* table absente */
  }
}

export async function requireChefSeal(userId: string): Promise<void> {
  const until = seals().get(userId) ?? 0;
  if (until < Date.now()) throw new Error(SEAL_REQUIRED);
}

async function verifyChefPassword(userId: string, password: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ password: string | null }>`
    select password from "account"
    where "userId" = ${userId} and "providerId" = 'credential'
    limit 1
  `;
  const hash = rows[0]?.password;
  if (!hash || !password) return false;
  try {
    const { verifyPassword } = await import("better-auth/crypto");
    return await verifyPassword({ hash, password });
  } catch {
    return false;
  }
}

export const confirmChefSeal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { password?: string }) => ({
    password: String(raw.password ?? ""),
  }))
  .handler(async ({ context, data }): Promise<{ until: number }> => {
    const { requireSuperadmin } = await import("./staff");
    await requireSuperadmin(context.userId);
    if (data.password.length < 8) throw new Error(AUTH_FAIL_MSG);
    const ok = await verifyChefPassword(context.userId, data.password);
    if (!ok) throw new Error(AUTH_FAIL_MSG);
    const until = Date.now() + SEAL_MS;
    seals().set(context.userId, until);
    return { until };
  });

export const revalidatePoste = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { password?: string; key?: string }) => ({
    password: String(raw.password ?? ""),
    key: String(raw.key ?? "")
      .replace(/\s+/g, "")
      .toUpperCase(),
  }))
  .handler(async ({ context, data }): Promise<{ ok: true; role: string }> => {
    const { hashKeyMaterial, loadStaff } = await import("./staff");
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error("Session refusée");
    if (staff.role === "superadmin") {
      if (data.password.length < 8) throw new Error(AUTH_FAIL_MSG);
      const ok = await verifyChefPassword(context.userId, data.password);
      if (!ok) throw new Error(AUTH_FAIL_MSG);
      const until = Date.now() + SEAL_MS;
      seals().set(context.userId, until);
      return { ok: true, role: staff.role };
    }
    if (data.key.length < 10) throw new Error(AUTH_FAIL_MSG);
    const digest = await hashKeyMaterial(data.key);
    const sql = await getSql();
    const keys = await sql<{ n: number }>`
      select count(*)::int as n
      from access_keys
      where user_id = ${context.userId}
        and key_hash = ${digest}
        and revoked = false
        and ejected = false
    `;
    if ((keys[0]?.n ?? 0) < 1) throw new Error(AUTH_FAIL_MSG);
    return { ok: true, role: staff.role };
  });
