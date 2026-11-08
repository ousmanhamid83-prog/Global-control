/** Anonymat chef / COP — aucune IP poste vers un tiers, aucune IP en base. */

export const POSTE_LABEL = "poste";
export const POSTE_ETRANGER = "poste-étranger";
export const POSTE_EXERCICE = "poste-exercice";

const IPV4 =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
// Une IPv6 a huit groupes, ou une compression « :: » ; une heure (18:10:22) n'a ni l'un ni
// l'autre et reste telle quelle. L'ancien motif effaçait les heures — jusque dans le récapitulatif
// des incidents — et laissait passer fe80::1 ou ::1.
const H = "[0-9a-f]{1,4}";
const IPV6 = new RegExp(
  `(?<![0-9a-z:])(?:(?:${H}:){7}${H}|${H}(?::${H}){0,6}::(?:${H}(?::${H}){0,6})?|::${H}(?::${H}){0,6})(?![0-9a-z:])`,
  "gi",
);
const MAC = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const IP_HEADERS = /\b(?:x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|forwarded)\b/gi;

export function sanitizeMachineLabel(raw?: string | null): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return POSTE_LABEL;
  if (s.includes("étranger") || s.includes("etranger") || s.includes("foreign")) {
    return POSTE_ETRANGER;
  }
  if (s.includes("exercice") || s.includes("drill")) return POSTE_EXERCICE;
  return POSTE_LABEL;
}

export function stripIps(text: string): string {
  return String(text ?? "")
    .replace(IPV4, "[ip]")
    .replace(IPV6, "[ip]")
    .replace(MAC, "[mac]")
    .replace(IP_HEADERS, "x-hdr");
}

export async function scrubSessionIps(userId?: string): Promise<void> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (userId) {
      await sql`
        update "session"
        set "ipAddress" = null, "userAgent" = null
        where "userId" = ${userId}
          and ("ipAddress" is not null or "userAgent" is not null)
      `;
      return;
    }
    await sql`
      update "session"
      set "ipAddress" = null, "userAgent" = null
      where "ipAddress" is not null or "userAgent" is not null
    `;
  } catch {
    /* table session absente au boot */
  }
}

export async function countSessionTraces(): Promise<{
  withIp: number;
  withUa: number;
  total: number;
}> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const ip = await sql<{ n: number }>`
      select count(*)::int as n from "session" where "ipAddress" is not null
    `;
    const ua = await sql<{ n: number }>`
      select count(*)::int as n from "session" where "userAgent" is not null
    `;
    const all = await sql<{ n: number }>`
      select count(*)::int as n from "session"
    `;
    return {
      withIp: ip[0]?.n ?? 0,
      withUa: ua[0]?.n ?? 0,
      total: all[0]?.n ?? 0,
    };
  } catch {
    return { withIp: 0, withUa: 0, total: 0 };
  }
}
