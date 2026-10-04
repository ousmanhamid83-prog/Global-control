import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { originLabel } from "./catalog";
import type { PdfBlock } from "./evidence-pdf";
import { formatCoord } from "./geo";
import { ensureStaffRow, insertOpsLog } from "./staff";
import type { JournalEntry, Origin, SensorKind } from "./types";

export type EvidenceDraft = {
  trackId: string;
  callsign: string;
  platformId: string;
  origin: Origin;
  platformName: string;
  manufacturer: string;
  confidence: number;
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  speedKmh: number;
  sensors: SensorKind[];
  method: string;
  launchLat: number | null;
  launchLon: number | null;
  launchAt: number | null;
  launchMethod: string | null;
  launchTile: string | null;
  c2Lat: number | null;
  c2Lon: number | null;
  c2Method: string | null;
  c2Tile: string | null;
  stopLat: number | null;
  stopLon: number | null;
  stopAt: number | null;
  stopMethod: string | null;
  stopTile: string | null;
  satCredit: string;
  sarNote: string;
  sceneNote: string;
  ewNote: string | null;
  corridor: string | null;
  injected: boolean;
  iffNote?: string | null;
};

export type BulletinRow = {
  id: string;
  trackId: string;
  callsign: string;
  platformId: string;
  origin: Origin;
  confidence: number;
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  speedKmh: number;
  sensors: SensorKind[];
  method: string;
  launchLat: number | null;
  launchLon: number | null;
  c2Lat: number | null;
  c2Lon: number | null;
  stopLat: number | null;
  stopLon: number | null;
  ewNote: string | null;
  corridor: string | null;
  injected: boolean;
  filedBy: string;
  role: string;
  contentSha256: string;
  prevSha256: string | null;
  chainSha256: string;
  pdfSha256: string;
  at: number;
  satCredit: string;
  sarNote: string;
  sceneNote: string;
};

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function clampStr(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function validateDraft(raw: EvidenceDraft): EvidenceDraft {
  const origin = raw.origin;
  if (!["CN", "TR", "RU", "IR", "XX"].includes(origin)) {
    throw new Error("Origine invalide");
  }
  if (!raw.trackId || !raw.callsign || !raw.platformId) {
    throw new Error("Piste incomplète");
  }
  return {
    ...raw,
    callsign: clampStr(raw.callsign, 24),
    platformId: clampStr(raw.platformId, 64),
    platformName: clampStr(raw.platformName, 80),
    manufacturer: clampStr(raw.manufacturer, 80),
    method: clampStr(raw.method, 400),
    satCredit: clampStr(raw.satCredit, 200),
    sarNote: clampStr(raw.sarNote, 400),
    sceneNote: clampStr(raw.sceneNote, 500),
    ewNote: raw.ewNote ? clampStr(raw.ewNote, 400) : null,
    corridor: raw.corridor ? clampStr(raw.corridor, 80) : null,
    iffNote: raw.iffNote ? clampStr(raw.iffNote, 500) : null,
    sensors: raw.sensors.slice(0, 8),
    lat: round5(raw.lat),
    lon: round5(raw.lon),
    launchLat: raw.launchLat == null ? null : round5(raw.launchLat),
    launchLon: raw.launchLon == null ? null : round5(raw.launchLon),
    c2Lat: raw.c2Lat == null ? null : round5(raw.c2Lat),
    c2Lon: raw.c2Lon == null ? null : round5(raw.c2Lon),
    stopLat: raw.stopLat == null ? null : round5(raw.stopLat),
    stopLon: raw.stopLon == null ? null : round5(raw.stopLon),
    launchAt: raw.launchAt == null ? null : Math.round(raw.launchAt),
    stopAt: raw.stopAt == null ? null : Math.round(raw.stopAt),
    confidence: Math.max(0, Math.min(100, Math.round(raw.confidence))),
    injected: Boolean(raw.injected),
  };
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  h.update(data);
  return h.digest("hex");
}

async function mintId(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(12).toString("hex");
}

function canonical(draft: EvidenceDraft): string {
  return JSON.stringify({
    trackId: draft.trackId,
    callsign: draft.callsign,
    platformId: draft.platformId,
    origin: draft.origin,
    confidence: draft.confidence,
    lat: draft.lat,
    lon: draft.lon,
    altM: Math.round(draft.altM * 10) / 10,
    heading: Math.round(draft.heading * 10) / 10,
    speedKmh: Math.round(draft.speedKmh * 10) / 10,
    sensors: draft.sensors,
    method: draft.method,
    launch: [draft.launchLat, draft.launchLon, draft.launchAt, draft.launchTile],
    c2: [draft.c2Lat, draft.c2Lon, draft.c2Tile],
    stop: [draft.stopLat, draft.stopLon, draft.stopAt, draft.stopTile],
    satCredit: draft.satCredit,
    sarNote: draft.sarNote,
    sceneNote: draft.sceneNote,
    ewNote: draft.ewNote,
    corridor: draft.corridor,
    injected: draft.injected,
    iffNote: draft.iffNote ?? null,
  });
}

function formatWhen(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Ndjamena",
  });
}

function pdfLines(
  draft: EvidenceDraft,
  meta: {
    id: string;
    filedBy: string;
    role: string;
    at: number;
    contentSha: string;
    prevSha: string | null;
    chainSha: string;
  },
  layout: (blocks: PdfBlock[]) => string[],
): string[] {
  const oLabel = originLabel(draft.origin);
  const src =
    draft.launchLat != null && draft.launchLon != null
      ? `${formatCoord(draft.launchLat, draft.launchLon)} · ${formatWhen(draft.launchAt)} · tuile ${draft.launchTile ?? "—"}`
      : "non fixé";
  const tel =
    draft.c2Lat != null && draft.c2Lon != null
      ? `${formatCoord(draft.c2Lat, draft.c2Lon)} · ${draft.c2Method ?? "gonio"} · tuile ${draft.c2Tile ?? "—"}`
      : "non géolocalisée";
  const arr =
    draft.stopLat != null && draft.stopLon != null
      ? `${formatCoord(draft.stopLat, draft.stopLon)} · ${formatWhen(draft.stopAt)} · tuile ${draft.stopTile ?? "—"}`
      : "non fixé";
  const blocks: PdfBlock[] = [
    { kind: "h", text: "AfriControl — dossier de preuve C-UAS" },
    { kind: "p", text: "DIFFUSION RESTREINTE · COP N'Djamena · detection / identification" },
    { kind: "p", text: "AfriControl n'emet pas. Pas de prise de controle. Pas d'injection C2." },
    { kind: "gap" },
    { kind: "k", text: `Bulletin  ${meta.id}` },
    { kind: "k", text: `Verse     ${formatWhen(meta.at)} WAT  ·  ${meta.filedBy} (${meta.role})` },
    { kind: "k", text: `Indicatif ${draft.callsign}  ·  couloir ${draft.corridor ?? "—"}` },
    { kind: "gap" },
    { kind: "h", text: "Chaine de custody" },
    { kind: "mono", text: `contenu   SHA-256 ${meta.contentSha}` },
    { kind: "mono", text: `precedent SHA-256 ${meta.prevSha ?? "GENESIS"}` },
    { kind: "mono", text: `chaine    SHA-256 ${meta.chainSha}` },
    { kind: "p", text: "Le hash document (octets PDF) est calcule apres generation et figure au journal." },
    { kind: "gap" },
    { kind: "h", text: "Identification" },
    {
      kind: "p",
      text: `${draft.manufacturer} ${draft.platformName} · ${oLabel} · confiance ${draft.confidence} %`,
    },
    {
      kind: "p",
      text: `Position ${formatCoord(draft.lat, draft.lon)} · ${Math.round(draft.altM)} m · ${Math.round(draft.speedKmh)} km/h · cap ${Math.round(draft.heading)} deg`,
    },
    { kind: "p", text: `Capteurs ${draft.sensors.join(", ") || "—"}` },
    { kind: "p", text: draft.method },
    { kind: "gap" },
    { kind: "h", text: "Tracabilite SRC / TEL / ARR" },
    { kind: "p", text: `SRC lancement  ${src}` },
    { kind: "p", text: `TEL source C2  ${tel}` },
    { kind: "p", text: `ARR arret      ${arr}` },
    { kind: "gap" },
    { kind: "h", text: "Appui satellite" },
    { kind: "p", text: draft.satCredit },
    { kind: "p", text: draft.sceneNote },
    { kind: "p", text: draft.sarNote },
    { kind: "gap" },
    { kind: "h", text: "IFF / Mode S / MLAT" },
    {
      kind: "p",
      text:
        draft.iffNote ??
        "Pas de transpondeur IFF corrélé. AfriControl n'émet pas le challenge Mode 4.",
    },
    { kind: "gap" },
    { kind: "h", text: "SIGINT / effecteur" },
    {
      kind: "p",
      text: draft.ewNote ?? "Ecoute passive seulement. Aucun effet RF consigne.",
    },
    {
      kind: "p",
      text: draft.injected
        ? "PISTE INJECTEE — formation / AAR. Ne pas traiter comme contact reel."
        : /1090ES live/.test(draft.method)
          ? "Piste 1090ES live (adsb.lol / readsb). Pas un UAS injecte. AfriControl n'emet pas."
          : "Piste issue d'un inject de formation. Ne pas traiter comme contact reel.",
    },
    { kind: "gap" },
    {
      kind: "p",
      text: "Mandat : detection et identification CN / TR / RU / IR. Hors mandat marque XX. Effecteur RF = demande a l'autorite, jamais une emission AfriControl.",
    },
  ];
  return layout(blocks);
}

function mapRow(r: {
  id: string;
  track_id: string;
  callsign: string;
  platform_id: string;
  origin: string;
  confidence: number;
  lat: number;
  lon: number;
  alt_m: number;
  heading: number;
  speed_kmh: number;
  sensors: string;
  method: string;
  launch_lat: number | null;
  launch_lon: number | null;
  c2_lat: number | null;
  c2_lon: number | null;
  stop_lat: number | null;
  stop_lon: number | null;
  ew_note: string | null;
  corridor: string | null;
  injected: boolean;
  filed_by: string;
  role: string;
  content_sha256: string;
  prev_sha256: string | null;
  chain_sha256: string;
  pdf_sha256: string;
  created_at: string;
  sat_credit: string;
  sar_note: string;
  scene_note: string;
}): BulletinRow {
  return {
    id: r.id,
    trackId: r.track_id,
    callsign: r.callsign,
    platformId: r.platform_id,
    origin: r.origin as Origin,
    confidence: r.confidence,
    lat: r.lat,
    lon: r.lon,
    altM: r.alt_m,
    heading: r.heading,
    speedKmh: r.speed_kmh,
    sensors: (r.sensors ? r.sensors.split(",") : []) as SensorKind[],
    method: r.method,
    launchLat: r.launch_lat,
    launchLon: r.launch_lon,
    c2Lat: r.c2_lat,
    c2Lon: r.c2_lon,
    stopLat: r.stop_lat,
    stopLon: r.stop_lon,
    ewNote: r.ew_note,
    corridor: r.corridor,
    injected: Boolean(r.injected),
    filedBy: r.filed_by,
    role: r.role,
    contentSha256: r.content_sha256,
    prevSha256: r.prev_sha256,
    chainSha256: r.chain_sha256,
    pdfSha256: r.pdf_sha256,
    at: Date.parse(r.created_at) || Date.now(),
    satCredit: r.sat_credit,
    sarNote: r.sar_note,
    sceneNote: r.scene_note,
  };
}

export function bulletinToJournal(row: BulletinRow): JournalEntry {
  return {
    id: row.id,
    at: row.at,
    trackId: row.trackId,
    callsign: row.callsign,
    platformId: row.platformId,
    origin: row.origin,
    confidence: row.confidence,
    lat: row.lat,
    lon: row.lon,
    altM: row.altM,
    sensors: row.sensors,
    method: row.method,
    launchLat: row.launchLat ?? undefined,
    launchLon: row.launchLon ?? undefined,
    c2Lat: row.c2Lat ?? undefined,
    c2Lon: row.c2Lon ?? undefined,
    stopLat: row.stopLat ?? undefined,
    stopLon: row.stopLon ?? undefined,
    ewNote: row.ewNote ?? undefined,
    filedBy: row.filedBy,
    contentSha256: row.contentSha256,
    prevSha256: row.prevSha256,
    chainSha256: row.chainSha256,
    pdfSha256: row.pdfSha256,
    injected: row.injected,
    pending: false,
  };
}

export const listBulletins = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BulletinRow[]> => {
    await ensureStaffRow(context.userId);
    const sql = await getSql();
    const rows = await sql<Parameters<typeof mapRow>[0]>`
      select
        id, track_id, callsign, platform_id, origin, confidence,
        lat, lon, alt_m, heading, speed_kmh, sensors, method,
        launch_lat, launch_lon, c2_lat, c2_lon, stop_lat, stop_lon,
        ew_note, corridor, injected, filed_by, role,
        content_sha256, prev_sha256, chain_sha256, pdf_sha256,
        created_at::text as created_at, sat_credit, sar_note, scene_note
      from bulletins
      order by created_at desc
      limit 200
    `;
    return rows.map(mapRow);
  });

export const fileEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: EvidenceDraft) => validateDraft(raw))
  .handler(async ({ context, data }): Promise<BulletinRow> => {
    try {
      return await sealBulletin(context.userId, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[vigilair] sealBulletin", err);
      throw new Error(msg || "Versement impossible");
    }
  });

async function sealBulletin(userId: string, data: EvidenceDraft): Promise<BulletinRow> {
  const staff = await ensureStaffRow(userId);
  const sql = await getSql();
  const id = await mintId();
  const now = Date.now();
  const payload = canonical(data);
  const contentSha = await sha256Hex(payload);
  const prev = await sql<{ chain_sha256: string }>`
    select chain_sha256 from bulletins order by created_at desc limit 1
  `;
  const prevSha = prev[0]?.chain_sha256 ?? null;
  const chainSha = await sha256Hex(`${contentSha}\n${prevSha ?? "GENESIS"}`);
  const { buildPdf, layoutEvidence } = await import("./evidence-pdf");
  const lines = pdfLines(
    data,
    {
      id,
      filedBy: staff.label,
      role: staff.role,
      at: now,
      contentSha,
      prevSha,
      chainSha,
    },
    layoutEvidence,
  );
  const pdf = buildPdf(lines);
  const pdfSha = await sha256Hex(pdf);
  const pdfB64 = Buffer.from(pdf).toString("base64");
  const sensors = data.sensors.join(",");
  await sql`
    insert into bulletins (
      id, user_id, filed_by, role, track_id, callsign, platform_id, origin,
      confidence, lat, lon, alt_m, heading, speed_kmh, sensors, method,
      launch_lat, launch_lon, launch_at, launch_method, launch_tile,
      c2_lat, c2_lon, c2_method, c2_tile,
      stop_lat, stop_lon, stop_at, stop_method, stop_tile,
      sat_credit, sar_note, scene_note, ew_note, corridor, injected,
      payload_json, content_sha256, prev_sha256, chain_sha256, pdf_sha256, pdf_b64
    ) values (
      ${id}, ${userId}, ${staff.label}, ${staff.role}, ${data.trackId},
      ${data.callsign}, ${data.platformId}, ${data.origin}, ${data.confidence},
      ${data.lat}, ${data.lon}, ${data.altM}, ${data.heading}, ${data.speedKmh},
      ${sensors}, ${data.method},
      ${data.launchLat}, ${data.launchLon}, ${data.launchAt}, ${data.launchMethod}, ${data.launchTile},
      ${data.c2Lat}, ${data.c2Lon}, ${data.c2Method}, ${data.c2Tile},
      ${data.stopLat}, ${data.stopLon}, ${data.stopAt}, ${data.stopMethod}, ${data.stopTile},
      ${data.satCredit}, ${data.sarNote}, ${data.sceneNote}, ${data.ewNote},
      ${data.corridor}, ${data.injected},
      ${payload}, ${contentSha}, ${prevSha}, ${chainSha}, ${pdfSha}, ${pdfB64}
    )
  `;
  return {
    id,
    trackId: data.trackId,
    callsign: data.callsign,
    platformId: data.platformId,
    origin: data.origin,
    confidence: data.confidence,
    lat: data.lat,
    lon: data.lon,
    altM: data.altM,
    heading: data.heading,
    speedKmh: data.speedKmh,
    sensors: data.sensors,
    method: data.method,
    launchLat: data.launchLat,
    launchLon: data.launchLon,
    c2Lat: data.c2Lat,
    c2Lon: data.c2Lon,
    stopLat: data.stopLat,
    stopLon: data.stopLon,
    ewNote: data.ewNote,
    corridor: data.corridor,
    injected: data.injected,
    filedBy: staff.label,
    role: staff.role,
    contentSha256: contentSha,
    prevSha256: prevSha,
    chainSha256: chainSha,
    pdfSha256: pdfSha,
    at: now,
    satCredit: data.satCredit,
    sarNote: data.sarNote,
    sceneNote: data.sceneNote,
  };
}

export const getEvidencePdf = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    const v = (id ?? "").trim();
    if (v.length < 8 || v.length > 64) throw new Error("Bulletin inconnu");
    return v;
  })
  .handler(
    async ({
      context,
      data: id,
    }): Promise<{ b64: string; sha256: string; filename: string; callsign: string }> => {
      const staff = await ensureStaffRow(context.userId);
      const sql = await getSql();
      const rows = await sql<{ pdf_b64: string; pdf_sha256: string; callsign: string }>`
        select pdf_b64, pdf_sha256, callsign from bulletins where id = ${id} limit 1
      `;
      const row = rows[0];
      if (!row) throw new Error("Bulletin introuvable");
      await insertOpsLog({
        userId: staff.userId,
        actor: staff.label,
        role: staff.role,
        team: staff.team,
        kind: "download",
        title: `Extrait PDF ${row.callsign}`,
        detail: `Bulletin ${id.slice(0, 8)}`,
        severity: "warn",
      });
      return {
        b64: row.pdf_b64,
        sha256: row.pdf_sha256,
        callsign: row.callsign,
        filename: `AfriControl-${row.callsign}-${id.slice(0, 8)}.pdf`,
      };
    },
  );
