import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { originLabel, sensorLabel } from "./catalog";
import { COTE_CLICHE, ZOOMS_CLICHE } from "./cliche";
import type { Cliche } from "./cliche.server";
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
  corridor: string | null;
  injected: boolean;
  iffNote?: string | null;
  /**
   * Demande le cliché du lieu (cliche.server.ts) : l'imagerie à la position, le drone marqué, en
   * tête du PDF ; l'empreinte de ses tuiles entre dans le contenu scellé, donc dans la chaîne.
   */
  cliche?: boolean;
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
  /** Lu en base : un ancien bulletin peut porter des valeurs d'avant la version réelle. */
  sensors: string[];
  method: string;
  launchLat: number | null;
  launchLon: number | null;
  corridor: string | null;
  injected: boolean;
  filedBy: string;
  role: string;
  contentSha256: string;
  prevSha256: string | null;
  chainSha256: string;
  pdfSha256: string;
  at: number;
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
    corridor: raw.corridor ? clampStr(raw.corridor, 80) : null,
    iffNote: raw.iffNote ? clampStr(raw.iffNote, 500) : null,
    sensors: raw.sensors.slice(0, 8),
    lat: round5(raw.lat),
    lon: round5(raw.lon),
    launchLat: raw.launchLat == null ? null : round5(raw.launchLat),
    launchLon: raw.launchLon == null ? null : round5(raw.launchLon),
    launchAt: raw.launchAt == null ? null : Math.round(raw.launchAt),
    confidence: Math.max(0, Math.min(100, Math.round(raw.confidence))),
    injected: Boolean(raw.injected),
    cliche: Boolean(raw.cliche),
  };
}

/** Ce que le contenu scellé retient du cliché : son zoom, ses tuiles, leur empreinte ; null s'il
 *  a été demandé sans qu'aucune imagerie du lieu réponde. */
type ClicheScelle = { z: number; tuiles: number; sha256: string } | null;

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

/** Sans cliché demandé, le contenu est celui d'avant : les dossiers déjà versés se revérifient. */
function canonical(draft: EvidenceDraft, cliche?: ClicheScelle): string {
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
    corridor: draft.corridor,
    injected: draft.injected,
    iffNote: draft.iffNote ?? null,
    ...(cliche === undefined ? {} : { cliche }),
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
  cliche?: Cliche | null,
): string[] {
  const oLabel = originLabel(draft.origin);
  const premier =
    draft.launchLat != null && draft.launchLon != null
      ? `${formatCoord(draft.launchLat, draft.launchLon)} · ${formatWhen(draft.launchAt)} · ${draft.launchMethod ?? "1090ES"} · tuile ${draft.launchTile ?? "—"}`
      : "non fixé";
  const blocks: PdfBlock[] = [
    { kind: "h", text: "AfriControl — dossier de preuve C-UAS" },
    { kind: "p", text: "DIFFUSION RESTREINTE · COP N'Djamena · détection / identification" },
    { kind: "p", text: "AfriControl n'émet pas. Réception seule : 1090 MHz (ADS-B / Mode S)." },
    { kind: "gap" },
    { kind: "k", text: `Bulletin  ${meta.id}` },
    { kind: "k", text: `Versé     ${formatWhen(meta.at)} WAT  ·  ${meta.filedBy} (${meta.role})` },
    { kind: "k", text: `Indicatif ${draft.callsign}  ·  couloir ${draft.corridor ?? "—"}` },
    { kind: "gap" },
    { kind: "h", text: "Chaîne de custody" },
    { kind: "mono", text: `contenu   SHA-256 ${meta.contentSha}` },
    { kind: "mono", text: `precedent SHA-256 ${meta.prevSha ?? "GENESIS"}` },
    { kind: "mono", text: `chaine    SHA-256 ${meta.chainSha}` },
    { kind: "p", text: "Le hash document (octets PDF) est calculé après génération et figure au journal." },
    { kind: "gap" },
    { kind: "h", text: "Identification" },
    {
      kind: "p",
      text: `${draft.manufacturer} ${draft.platformName} · ${oLabel} · confiance ${draft.confidence} %`,
    },
    {
      kind: "p",
      text: `Position ${formatCoord(draft.lat, draft.lon)} · ${Math.round(draft.altM)} m · ${Math.round(draft.speedKmh)} km/h · cap ${Math.round(draft.heading)}°`,
    },
    { kind: "p", text: `Entendu par ${draft.sensors.map(sensorLabel).join(", ") || "—"}` },
    { kind: "p", text: draft.method },
    { kind: "gap" },
    { kind: "h", text: "Premier relevé" },
    { kind: "p", text: premier },
    { kind: "gap" },
    { kind: "h", text: "Transpondeur" },
    { kind: "p", text: draft.iffNote ?? "Pas de transpondeur entendu." },
    { kind: "gap" },
    ...(cliche === undefined ? [] : blocsCliche(cliche)),
    {
      kind: "p",
      text: draft.injected
        ? "EXERCICE OU REJEU — données réelles rejouées ou vol d'exercice. Ne pas traiter comme contact réel."
        : "Piste reçue en direct. AfriControl n'émet pas.",
    },
  ];
  return layout(blocks);
}

/** La section du cliché demandé ; l'image elle-même fait la première page. */
function blocsCliche(cliche: Cliche | null): PdfBlock[] {
  const zooms = `${ZOOMS_CLICHE.slice(0, -1).join(", ")} et ${ZOOMS_CLICHE.at(-1)}`;
  return [
    { kind: "h", text: "Cliché du lieu" },
    cliche
      ? {
          kind: "p",
          text: `En page 1 : ${cliche.sources.join(", ")} · zoom ${cliche.z} · ${cliche.tuiles.length} tuiles sur ${COTE_CLICHE ** 2}. Mosaïque d'archive : c'est le lieu, pas le drone ni l'heure de la prise.`,
        }
      : { kind: "p", text: `Demandé : aucune imagerie du lieu aux zooms ${zooms}.` },
    ...(cliche ? [{ kind: "mono" as const, text: `tuiles    SHA-256 ${cliche.sha256}` }] : []),
    { kind: "gap" },
  ];
}

/** La légende sous l'image : ce qu'elle montre, et ce qu'elle ne montre pas. */
function legendeCliche(draft: EvidenceDraft, cliche: Cliche): string[] {
  return [
    `Cliché du lieu — ${draft.callsign} à ${formatCoord(draft.lat, draft.lon)}`,
    `${cliche.sources.join(", ")} · zoom ${cliche.z} · ${cliche.tuiles.length} tuiles sur ${COTE_CLICHE ** 2} · le drone sous la croix rouge`,
    `Mosaïque d'archive : c'est le lieu, pas le drone ni l'heure de la prise.${cliche.tuiles.length < COTE_CLICHE ** 2 ? " Cases grises : sans imagerie." : ""}`,
    `Empreinte des tuiles SHA-256 ${cliche.sha256}`,
  ];
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
  corridor: string | null;
  injected: boolean;
  filed_by: string;
  role: string;
  content_sha256: string;
  prev_sha256: string | null;
  chain_sha256: string;
  pdf_sha256: string;
  created_at: string;
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
    sensors: r.sensors ? r.sensors.split(",") : [],
    method: r.method,
    launchLat: r.launch_lat,
    launchLon: r.launch_lon,
    corridor: r.corridor,
    injected: Boolean(r.injected),
    filedBy: r.filed_by,
    role: r.role,
    contentSha256: r.content_sha256,
    prevSha256: r.prev_sha256,
    chainSha256: r.chain_sha256,
    pdfSha256: r.pdf_sha256,
    at: Date.parse(r.created_at) || Date.now(),
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
        launch_lat, launch_lon, corridor, injected, filed_by, role,
        content_sha256, prev_sha256, chain_sha256, pdf_sha256,
        created_at::text as created_at
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
  // Le cliché avant de lire le dernier maillon : sa composition (jusqu'à 27 tuiles) ne doit pas
  // tenir ouvert l'écart entre cette lecture et l'insertion.
  const cliche = data.cliche
    ? await (await import("./cliche.server")).composerCliche(data.lat, data.lon)
    : undefined;
  const payload = canonical(
    data,
    cliche === undefined
      ? undefined
      : cliche && { z: cliche.z, tuiles: cliche.tuiles.length, sha256: cliche.sha256 },
  );
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
    cliche,
  );
  const pdf = buildPdf(lines, cliche ? { ...cliche, legende: legendeCliche(data, cliche) } : undefined);
  const pdfSha = await sha256Hex(pdf);
  const pdfB64 = Buffer.from(pdf).toString("base64");
  const sensors = data.sensors.join(",");
  await sql`
    insert into bulletins (
      id, user_id, filed_by, role, track_id, callsign, platform_id, origin,
      confidence, lat, lon, alt_m, heading, speed_kmh, sensors, method,
      launch_lat, launch_lon, launch_at, launch_method, launch_tile,
      corridor, injected,
      payload_json, content_sha256, prev_sha256, chain_sha256, pdf_sha256, pdf_b64
    ) values (
      ${id}, ${userId}, ${staff.label}, ${staff.role}, ${data.trackId},
      ${data.callsign}, ${data.platformId}, ${data.origin}, ${data.confidence},
      ${data.lat}, ${data.lon}, ${data.altM}, ${data.heading}, ${data.speedKmh},
      ${sensors}, ${data.method},
      ${data.launchLat}, ${data.launchLon}, ${data.launchAt}, ${data.launchMethod}, ${data.launchTile},
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
    corridor: data.corridor,
    injected: data.injected,
    filedBy: staff.label,
    role: staff.role,
    contentSha256: contentSha,
    prevSha256: prevSha,
    chainSha256: chainSha,
    pdfSha256: pdfSha,
    at: now,
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
