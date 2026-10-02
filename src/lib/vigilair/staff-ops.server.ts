import { getSql } from "@/lib/db";
import {
  hashKeyMaterial,
  mintId,
  mintKey,
  type AssignableRole,
  type StaffTeam,
} from "./staff";

export async function scrambleCredentials(userId: string): Promise<void> {
  try {
    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(await mintKey());
    const sql = await getSql();
    await sql`
      update account
      set password = ${hashed}, "updatedAt" = now()
      where "userId" = ${userId} and "providerId" = 'credential'
    `;
  } catch {
    /* compte credential absent */
  }
}

export async function createKeyedAgent(opts: {
  label: string;
  role: AssignableRole;
  team: StaffTeam;
  createdBy: string;
  email?: string;
  grade?: string;
  phone?: string;
  unit?: string;
}): Promise<{ key: string; id: string; userId: string; label: string }> {
  const id = await mintId();
  const key = await mintKey();
  const email = `va-${id}@keys.vigilair.td`;
  const work = (opts.email ?? "").trim().toLowerCase() || null;
  const { auth } = await import("@/lib/auth/server");
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser({
    email,
    name: opts.label,
    emailVerified: true,
  });
  const userId = created?.id;
  if (!userId) throw new Error("Création du compte agent impossible");
  const hashed = await ctx.password.hash(key);
  await ctx.internalAdapter.linkAccount({
    accountId: userId,
    providerId: "credential",
    password: hashed,
    userId,
  });
  const sql = await getSql();
  await sql`
    insert into access_keys (id, key_hash, email, label, created_by, user_id, role, team)
    values (${id}, ${await hashKeyMaterial(key)}, ${email}, ${opts.label}, ${opts.createdBy}, ${userId}, ${opts.role}, ${opts.team})
  `;
  await sql`
    insert into staff (user_id, role, label, team, email, grade, phone, unit)
    values (
      ${userId}, ${opts.role}, ${opts.label}, ${opts.team},
      ${work}, ${opts.grade ?? ""}, ${opts.phone ?? ""}, ${opts.unit ?? ""}
    )
    on conflict (user_id) do update set
      label = excluded.label,
      role = excluded.role,
      team = excluded.team,
      email = excluded.email,
      grade = excluded.grade,
      phone = excluded.phone,
      unit = excluded.unit
  `;
  return { key, id, userId, label: opts.label };
}
