/** Bulles C-UAS — persistance, armement, journal d'intrusion. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  dispatchChefAlert,
  insertOpsLog,
  insertSecurityIncident,
  loadStaff,
  mintId,
  requireSuperadmin,
} from "./staff";
import { DEFAULT_ZONES, type ZoneKind, type ZoneRow } from "./zones";

export type ZoneBreachRow = {
  id: string;
  zoneId: string;
  zoneName: string;
  trackId: string;
  callsign: string;
  distKm: number;
  kind: "inside" | "approach";
  uas: boolean;
  actor: string;
  at: string;
};

function asKind(v: string): ZoneKind {
  if (v === "aerodrome" || v === "palais" || v === "camp" || v === "pont" || v === "ministere") {
    return v;
  }
  return "ministere";
}

function mapZone(r: {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  radius_km: number;
  armed: boolean;
  note: string;
}): ZoneRow {
  return {
    id: r.id,
    name: r.name,
    kind: asKind(r.kind),
    lat: Number(r.lat),
    lon: Number(r.lon),
    radiusKm: Number(r.radius_km),
    armed: Boolean(r.armed),
    note: r.note ?? "",
  };
}

async function ensureSeed(): Promise<void> {
  const sql = await getSql();
  const n = await sql<{ n: number }>`select count(*)::int as n from protected_zone`;
  if ((n[0]?.n ?? 0) > 0) return;
  for (const z of DEFAULT_ZONES) {
    await sql`
      insert into protected_zone (id, name, kind, lat, lon, radius_km, armed, note)
      values (${z.id}, ${z.name}, ${z.kind}, ${z.lat}, ${z.lon}, ${z.radiusKm}, ${z.armed}, ${z.note})
      on conflict (id) do nothing
    `;
  }
}

export const listZones = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ZoneRow[]> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return DEFAULT_ZONES;
    await ensureSeed();
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      name: string;
      kind: string;
      lat: number;
      lon: number;
      radius_km: number;
      armed: boolean;
      note: string;
    }>`
      select id, name, kind, lat, lon, radius_km, armed, note
      from protected_zone
      order by name
    `;
    return rows.map(mapZone);
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
      kind: asKind(String(raw.kind ?? "ministere")),
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
    return mapZone(rows[0]!);
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
    return mapZone(row);
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
      actor: string;
      created_at: string;
    }>`
      select id, zone_id, zone_name, track_id, callsign, dist_km, kind, uas, actor,
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
  }) => ({
    zoneId: String(raw.zoneId ?? "").slice(0, 40),
    zoneName: String(raw.zoneName ?? "").slice(0, 80),
    trackId: String(raw.trackId ?? "").slice(0, 64),
    callsign: String(raw.callsign ?? "").slice(0, 24),
    distKm: Number(raw.distKm) || 0,
    kind: raw.kind === "approach" ? "approach" : "inside",
    uas: Boolean(raw.uas),
  }))
  .handler(async ({ context, data }): Promise<{ ok: true; fresh: boolean }> => {
    const staff = await loadStaff(context.userId);
    if (!staff || staff.ejected) return { ok: true, fresh: false };
    if (!data.zoneId || !data.trackId) return { ok: true, fresh: false };
    const sql = await getSql();
    const recent = await sql<{ id: string }>`
      select id from zone_breach
      where zone_id = ${data.zoneId}
        and track_id = ${data.trackId}
        and kind = ${data.kind}
        and created_at > now() - interval '20 minutes'
      limit 1
    `;
    if (recent[0]) return { ok: true, fresh: false };
    const id = await mintId();
    await sql`
      insert into zone_breach (id, zone_id, zone_name, track_id, callsign, dist_km, kind, uas, actor)
      values (
        ${id}, ${data.zoneId}, ${data.zoneName}, ${data.trackId}, ${data.callsign},
        ${data.distKm}, ${data.kind}, ${data.uas}, ${staff.label}
      )
    `;
    if (data.uas && data.kind === "inside") {
      const title = `Intrusion · ${data.zoneName} · ${data.callsign}`;
      const detail = `${data.callsign} dans la bulle ${data.zoneName} (${data.distKm.toFixed(2)} km du centre). VIGILAIR n'émet pas.`;
      const incident = await insertSecurityIncident({
        userId: staff.userId,
        actor: staff.label,
        kind: "zone_breach",
        title,
        detail,
        workRecap: `Bulle ${data.zoneName}. Piste ${data.callsign}. Lecture seule — aucun effet RF.`,
      });
      await dispatchChefAlert({
        id: incident.id,
        title,
        body: detail,
        level: "critique",
      });
      await insertOpsLog({
        userId: staff.userId,
        actor: staff.label,
        role: staff.role,
        team: staff.team,
        kind: "zone",
        title,
        detail,
        trackId: data.trackId,
        severity: "crit",
      });
    } else {
      await insertOpsLog({
        userId: staff.userId,
        actor: staff.label,
        role: staff.role,
        team: staff.team,
        kind: "zone",
        title: `${data.kind === "approach" ? "Approche" : "Trafic"} · ${data.zoneName} · ${data.callsign}`,
        detail: `${data.distKm.toFixed(2)} km`,
        trackId: data.trackId,
        severity: data.uas ? "warn" : "info",
      });
    }
    return { ok: true, fresh: true };
  });
