/** Verrou COP — lecture / écriture partagée. AfriControl n'émet pas. */

import { getSql } from "@/lib/db";
import { COP_LOCK_MSG, type CopLockState } from "./guard";

function asLock(row: {
  locked: boolean;
  reason: string;
  by_label: string | null;
  at: string | null;
} | null): CopLockState {
  if (!row) return { locked: false, reason: "", byLabel: null, at: null };
  return {
    locked: Boolean(row.locked),
    reason: row.reason ?? "",
    byLabel: row.by_label,
    at: row.at,
  };
}

export async function readCopLock(): Promise<CopLockState> {
  const sql = await getSql();
  const rows = await sql<{
    locked: boolean;
    reason: string;
    by_label: string | null;
    at: string | null;
  }>`
    select locked, reason, by_label, at::text as at from cop_lock where id = 'global' limit 1
  `;
  return asLock(rows[0] ?? null);
}

export async function writeCopLock(opts: {
  locked: boolean;
  reason: string;
  byLabel: string | null;
}): Promise<CopLockState> {
  const sql = await getSql();
  await sql`
    insert into cop_lock (id, locked, reason, by_label, at)
    values ('global', ${opts.locked}, ${opts.reason}, ${opts.byLabel}, now())
    on conflict (id) do update
      set locked = excluded.locked,
          reason = excluded.reason,
          by_label = excluded.by_label,
          at = now()
  `;
  return readCopLock();
}

export async function requireCopOpen(): Promise<void> {
  const lock = await readCopLock();
  if (lock.locked) throw new Error(COP_LOCK_MSG);
}

/** Coupe les sessions agents. Le chef reste pour lever le verrou. */
export async function cutAgentSessions(): Promise<void> {
  const sql = await getSql();
  try {
    await sql`
      delete from session
      where "userId" not in (select user_id from staff where role = 'superadmin')
    `;
  } catch {
    /* table session absente */
  }
}
