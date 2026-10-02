/** Quart de veille — prise de poste, relève, AAR. Auth requise. Données capteurs du cache ingest. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { peekLiveCache } from "./live-feeds";
import {
  EJECTED_MSG,
  insertOpsLog,
  loadStaff,
  mintId,
  touchLastSeen,
} from "./staff";
import { requireCopOpen } from "./cop-lock";
import {
  composeAar,
  parseSnap,
  snapFromPicture,
  snapLine,
  type WatchCop,
  type WatchShiftRow,
  type WatchSnap,
} from "./watch";

type DbWatch = {
  id: string;
  opened_by: string;
  opened_label: string;
  opened_role: string;
  opened_team: string;
  opened_at: string;
  closed_by: string | null;
  closed_label: string | null;
  closed_at: string | null;
  status: string;
  snap_in: string;
  snap_out: string | null;
  aar: string | null;
  note_in: string;
  note_out: string;
};

function asCop(raw: {
  instruction?: boolean;
  tracks?: number;
  unacked?: number;
  locked?: number;
}): WatchCop {
  const n = (v: unknown, max: number) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.min(max, Math.round(x));
  };
  return {
    instruction: Boolean(raw.instruction),
    tracks: n(raw.tracks, 9999),
    unacked: n(raw.unacked, 999),
    locked: n(raw.locked, 99),
  };
}

function mapWatch(row: DbWatch): WatchShiftRow {
  return {
    id: row.id,
    openedBy: row.opened_by,
    openedLabel: row.opened_label,
    openedRole: row.opened_role,
    openedTeam: row.opened_team,
    openedAt: row.opened_at,
    closedBy: row.closed_by,
    closedLabel: row.closed_label,
    closedAt: row.closed_at,
    status: row.status === "closed" ? "closed" : "open",
    snapIn: parseSnap(row.snap_in) ?? snapFromPicture(null, asCop({})),
    snapOut: parseSnap(row.snap_out),
    aar: row.aar,
    noteIn: row.note_in ?? "",
    noteOut: row.note_out ?? "",
  };
}

async function loadOpen(): Promise<DbWatch | null> {
  const sql = await getSql();
  const rows = await sql<DbWatch>`
    select id, opened_by, opened_label, opened_role, opened_team,
           opened_at::text as opened_at,
           closed_by, closed_label, closed_at::text as closed_at,
           status, snap_in, snap_out, aar, note_in, note_out
    from watch_shift
    where status = 'open'
    order by opened_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

type WatchPayload = WatchCop & { note?: string; snap?: WatchSnap | null };

function asPayload(raw: WatchPayload): WatchCop & { note: string; snap: WatchSnap | null } {
  return {
    ...asCop(raw),
    note: String(raw.note ?? "").slice(0, 800),
    snap: parseSnap(JSON.stringify(raw.snap ?? null)),
  };
}

function freezeSnap(cop: WatchCop, client: WatchSnap | null): WatchSnap {
  const live = peekLiveCache();
  if (live) return snapFromPicture(live, cop);
  if (client && (client.fluxN > 0 || client.ac > 0 || client.metarFttj || client.rwy)) {
    return {
      ...client,
      instruction: cop.instruction,
      tracks: cop.tracks,
      unacked: cop.unacked,
      locked: cop.locked,
    };
  }
  return snapFromPicture(null, cop);
}

async function writeOp(opts: {
  userId: string;
  actor: string;
  role: string;
  team: string;
  kind: "prise_poste" | "releve" | "fin_poste" | "aar";
  title: string;
  detail: string;
}): Promise<void> {
  await insertOpsLog({
    userId: opts.userId,
    actor: opts.actor,
    role: opts.role,
    team: opts.team,
    kind: opts.kind,
    title: opts.title,
    detail: opts.detail.slice(0, 800),
    severity: "info",
  });
}

async function insertOpen(opts: {
  staff: { userId: string; label: string; role: string; team: string };
  snap: WatchSnap;
  note: string;
}): Promise<DbWatch> {
  const id = await mintId();
  const sql = await getSql();
  await sql`
    insert into watch_shift (
      id, opened_by, opened_label, opened_role, opened_team,
      status, snap_in, note_in
    ) values (
      ${id}, ${opts.staff.userId}, ${opts.staff.label}, ${opts.staff.role}, ${opts.staff.team},
      'open', ${JSON.stringify(opts.snap)}, ${opts.note}
    )
  `;
  const opens = await sql<{ id: string }>`
    select id from watch_shift where status = 'open' order by opened_at asc
  `;
  if (opens.length > 1) {
    const keep = opens[0]!.id;
    await sql`
      update watch_shift
      set status = 'closed',
          closed_at = now(),
          closed_by = ${opts.staff.userId},
          closed_label = ${opts.staff.label},
          aar = coalesce(aar, 'Clôture automatique — un seul quart à la fois')
      where status = 'open' and id <> ${keep}
    `;
    if (keep !== id) {
      throw new Error("Un quart vient d'être ouvert sur un autre poste. Actualisez.");
    }
  }
  await writeOp({
    userId: opts.staff.userId,
    actor: opts.staff.label,
    role: opts.staff.role,
    team: opts.staff.team,
    kind: "prise_poste",
    title: `Prise de poste · ${opts.staff.label}`,
    detail: snapLine(opts.snap),
  });
  const row = await loadOpen();
  if (!row) throw new Error("Quart non enregistré");
  return row;
}

export const currentWatch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WatchShiftRow | null> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return null;
    await touchLastSeen(context.userId);
    const row = await loadOpen();
    return row ? mapWatch(row) : null;
  });

export const listWatches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WatchShiftRow[]> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    const sql = await getSql();
    const rows = await sql<DbWatch>`
      select id, opened_by, opened_label, opened_role, opened_team,
             opened_at::text as opened_at,
             closed_by, closed_label, closed_at::text as closed_at,
             status, snap_in, snap_out, aar, note_in, note_out
      from watch_shift
      order by opened_at desc
      limit 24
    `;
    return rows.map(mapWatch);
  });

export const openWatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: WatchPayload) => asPayload(raw))
  .handler(async ({ context, data }): Promise<WatchShiftRow> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    await requireCopOpen();
    await touchLastSeen(context.userId);
    const open = await loadOpen();
    if (open) {
      if (open.opened_by === staff.userId) return mapWatch(open);
      throw new Error(
        `Quart déjà tenu par ${open.opened_label}. Faire la relève, ne pas ouvrir un second quart.`,
      );
    }
    const snap = freezeSnap(data, data.snap);
    const row = await insertOpen({ staff, snap, note: data.note });
    return mapWatch(row);
  });

export const handoverWatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: WatchPayload) => asPayload(raw))
  .handler(async ({ context, data }): Promise<WatchShiftRow> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    await requireCopOpen();
    await touchLastSeen(context.userId);
    const open = await loadOpen();
    const snap = freezeSnap(data, data.snap);
    if (!open) {
      const row = await insertOpen({ staff, snap, note: data.note });
      return mapWatch(row);
    }
    if (open.opened_by === staff.userId) {
      throw new Error("Vous tenez déjà le quart. Clôturez ou mettez à jour la consigne.");
    }
    const snapIn = parseSnap(open.snap_in) ?? snapFromPicture(null, asCop({}));
    const openedAtMs = Date.parse(open.opened_at) || Date.now();
    const aar = composeAar({
      openedLabel: open.opened_label,
      openedRole: open.opened_role,
      openedTeam: open.opened_team,
      openedAt: open.opened_at,
      closedLabel: staff.label,
      closedAt: new Date().toISOString(),
      durationMs: Date.now() - openedAtMs,
      snapIn,
      snapOut: snap,
      noteIn: open.note_in ?? "",
      noteOut: data.note,
    });
    const sql = await getSql();
    await sql`
      update watch_shift
      set status = 'closed',
          closed_by = ${staff.userId},
          closed_label = ${staff.label},
          closed_at = now(),
          snap_out = ${JSON.stringify(snap)},
          note_out = ${data.note},
          aar = ${aar}
      where id = ${open.id} and status = 'open'
    `;
    await writeOp({
      userId: staff.userId,
      actor: staff.label,
      role: staff.role,
      team: staff.team,
      kind: "releve",
      title: `Relève · ${open.opened_label} → ${staff.label}`,
      detail: snapLine(snap),
    });
    const row = await insertOpen({ staff, snap, note: data.note });
    return mapWatch(row);
  });

export const closeWatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: WatchPayload) => asPayload(raw))
  .handler(async ({ context, data }): Promise<WatchShiftRow> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    await requireCopOpen();
    await touchLastSeen(context.userId);
    const open = await loadOpen();
    if (!open) throw new Error("Aucun quart ouvert.");
    if (open.opened_by !== staff.userId && staff.role !== "superadmin") {
      throw new Error("Seul le titulaire ou le chef de division clôture sans relève.");
    }
    const snap = freezeSnap(data, data.snap);
    const snapIn = parseSnap(open.snap_in) ?? snapFromPicture(null, asCop({}));
    const openedAtMs = Date.parse(open.opened_at) || Date.now();
    const aar = composeAar({
      openedLabel: open.opened_label,
      openedRole: open.opened_role,
      openedTeam: open.opened_team,
      openedAt: open.opened_at,
      closedLabel: staff.label,
      closedAt: new Date().toISOString(),
      durationMs: Date.now() - openedAtMs,
      snapIn,
      snapOut: snap,
      noteIn: open.note_in ?? "",
      noteOut: data.note,
    });
    const sql = await getSql();
    await sql`
      update watch_shift
      set status = 'closed',
          closed_by = ${staff.userId},
          closed_label = ${staff.label},
          closed_at = now(),
          snap_out = ${JSON.stringify(snap)},
          note_out = ${data.note},
          aar = ${aar}
      where id = ${open.id} and status = 'open'
    `;
    await writeOp({
      userId: staff.userId,
      actor: staff.label,
      role: staff.role,
      team: staff.team,
      kind: "fin_poste",
      title: `Fin de quart · ${open.opened_label}`,
      detail: snapLine(snap),
    });
    const rows = await sql<DbWatch>`
      select id, opened_by, opened_label, opened_role, opened_team,
             opened_at::text as opened_at,
             closed_by, closed_label, closed_at::text as closed_at,
             status, snap_in, snap_out, aar, note_in, note_out
      from watch_shift where id = ${open.id} limit 1
    `;
    if (!rows[0]) throw new Error("Clôture non enregistrée");
    return mapWatch(rows[0]);
  });

export const updateWatchNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { note?: string }) => ({
    note: String(raw.note ?? "").slice(0, 800),
  }))
  .handler(async ({ context, data }): Promise<WatchShiftRow> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) throw new Error(EJECTED_MSG);
    const open = await loadOpen();
    if (!open) throw new Error("Aucun quart ouvert.");
    if (open.opened_by !== staff.userId && staff.role !== "superadmin") {
      throw new Error("Seul le titulaire met à jour la consigne.");
    }
    const sql = await getSql();
    await sql`
      update watch_shift set note_in = ${data.note} where id = ${open.id} and status = 'open'
    `;
    const row = await loadOpen();
    if (!row) throw new Error("Consigne non enregistrée");
    return mapWatch(row);
  });
