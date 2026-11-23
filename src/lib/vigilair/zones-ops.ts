/** Bulles C-UAS — persistance, armement, journal d'intrusion. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  insertOpsLog,
  loadStaff,
  mintId,
  requireSuperadmin,
} from "./staff";
import { bulleDeLigne, DEFAULT_ZONES, sorteDeBulle, type ZoneRow } from "./zones";

export type ZoneBreachRow = {
  id: string;
  zoneId: string;
  zoneName: string;
  trackId: string;
  callsign: string;
  distKm: number;
  kind: "inside" | "approach";
  uas: boolean;
  /** Intrusion d'une piste d'exercice : un vrai vol de notre drone, joué comme intrus. */
  exercice: boolean;
  actor: string;
  at: string;
};

export const listZones = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ZoneRow[]> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return DEFAULT_ZONES;
    const { lireBulles } = await import("./zones-veille.server");
    return lireBulles();
  });

export const saveZone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: {
    id?: string;
    name?: string;
    kind?: string;
    lat?: number;
    lon?: number;
    radiusKm?: number;
    note?: string;
    armed?: boolean;
  }) => {
    const name = String(raw.name ?? "").trim();
    if (name.length < 2 || name.length > 80) throw new Error("Nom : 2 à 80 caractères");
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || lat < 7 || lat > 24) {
      throw new Error("Latitude hors Tchad / AO");
    }
    if (!Number.isFinite(lon) || lon < 13 || lon > 24) {
      throw new Error("Longitude hors Tchad / AO");
    }
    const radiusKm = Number(raw.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm < 0.3 || radiusKm > 25) {
      throw new Error("Rayon : 0,3 à 25 km");
    }
    return {
      id: String(raw.id ?? "").trim(),
      name,
      kind: sorteDeBulle(String(raw.kind ?? "ministere")),
      lat,
      lon,
      radiusKm,
      note: String(raw.note ?? "").trim().slice(0, 160),
      armed: raw.armed !== false,
    };
  })
  .handler(async ({ context, data }): Promise<ZoneRow> => {
    const chef = await requireSuperadmin(context.userId);
    const sql = await getSql();
    const id = data.id || (await mintId());
    await sql`
      insert into protected_zone (id, name, kind, lat, lon, radius_km, armed, note, created_by, updated_at)
      values (
        ${id}, ${data.name}, ${data.kind}, ${data.lat}, ${data.lon},
        ${data.radiusKm}, ${data.armed}, ${data.note}, ${chef.userId}, now()
      )
      on conflict (id) do update set
        name = excluded.name,
        kind = excluded.kind,
        lat = excluded.lat,
        lon = excluded.lon,
        radius_km = excluded.radius_km,
        armed = excluded.armed,
        note = excluded.note,
        updated_at = now()
    `;
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "zone",
      title: `Bulle ${data.name}`,
      detail: `${data.kind} · ${data.radiusKm.toFixed(1)} km · ${data.armed ? "armée" : "désarmée"}`,
      severity: "info",
    });
    const rows = await sql<{
      id: string;
      name: string;
      kind: string;
      lat: number;
      lon: number;
      radius_km: number;
      armed: boolean;
      note: string;
    }>`select id, name, kind, lat, lon, radius_km, armed, note from protected_zone where id = ${id}`;
    return bulleDeLigne(rows[0]!);
  });

export const setZoneArmed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; armed?: boolean }) => ({
    id: String(raw.id ?? ""),
    armed: Boolean(raw.armed),
  }))
  .handler(async ({ context, data }): Promise<ZoneRow> => {
    const chef = await requireSuperadmin(context.userId);
    if (!data.id) throw new Error("Bulle inconnue");
    const sql = await getSql();
    await sql`
      update protected_zone set armed = ${data.armed}, updated_at = now()
      where id = ${data.id}
    `;
    const rows = await sql<{
      id: string;
      name: string;
      kind: string;
      lat: number;
      lon: number;
      radius_km: number;
      armed: boolean;
      note: string;
    }>`select id, name, kind, lat, lon, radius_km, armed, note from protected_zone where id = ${data.id}`;
    const row = rows[0];
    if (!row) throw new Error("Bulle inconnue");
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "zone",
      title: `${data.armed ? "Armée" : "Désarmée"} · ${row.name}`,
      detail: `${row.radius_km} km`,
      severity: data.armed ? "warn" : "info",
    });
    return bulleDeLigne(row);
  });

export const listZoneBreaches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ZoneBreachRow[]> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return [];
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      zone_id: string;
      zone_name: string;
      track_id: string;
      callsign: string;
      dist_km: number;
      kind: string;
      uas: boolean;
      exercice: boolean;
      actor: string;
      created_at: string;
    }>`
      select id, zone_id, zone_name, track_id, callsign, dist_km, kind, uas, exercice, actor,
             created_at::text as created_at
      from zone_breach
      order by created_at desc
      limit 60
    `;
    return rows.map((r) => ({
      id: r.id,
      zoneId: r.zone_id,
      zoneName: r.zone_name,
      trackId: r.track_id,
      callsign: r.callsign,
      distKm: Number(r.dist_km),
      kind: r.kind === "approach" ? "approach" : "inside",
      uas: Boolean(r.uas),
      exercice: Boolean(r.exercice),
      actor: r.actor,
      at: r.created_at,
    }));
  });

export const reportZoneBreach = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: {
    zoneId?: string;
    zoneName?: string;
    trackId?: string;
    callsign?: string;
    distKm?: number;
    kind?: string;
    uas?: boolean;
    exercice?: boolean;
  }) => ({
    zoneId: String(raw.zoneId ?? "").slice(0, 40),
    zoneName: String(raw.zoneName ?? "").slice(0, 80),
    trackId: String(raw.trackId ?? "").slice(0, 64),
    callsign: String(raw.callsign ?? "").slice(0, 24),
    distKm: Number(raw.distKm) || 0,
    kind: raw.kind === "approach" ? "approach" : "inside",
    uas: Boolean(raw.uas),
    exercice: raw.exercice === true,
  }))
  .handler(async ({ context, data }): Promise<{ ok: true; fresh: boolean }> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return { ok: true, fresh: false };
    if (!data.zoneId || !data.trackId || !data.uas) return { ok: true, fresh: false };
    const { consignerPassage } = await import("./zones-veille.server");
    const { fresh } = await consignerPassage(
      { ...data, kind: data.kind === "approach" ? "approach" : "inside", uas: true },
      { userId: staff.userId, actor: staff.label, role: staff.role, team: staff.team },
    );
    return { ok: true, fresh };
  });
