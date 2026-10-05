/**
 * Imagerie Sentinel-2 fraîche via Sentinel Hub — réel, gratuit, daté honnêtement. Le poste ne
 * possède pas de satellite : il interroge l'API Copernicus avec le compte GRATUIT de l'opérateur
 * (Copernicus Data Space Ecosystem, CDSE). Résolution native 10 m : on lit une piste, un bâtiment,
 * un convoi — pas une voiture isolée. Aucune imagerie n'est inventée ; le crédit dit la source.
 *
 *   AFRICONTROL_SENTINEL_ID=<client id>       identifiants OAuth du compte CDSE gratuit
 *   AFRICONTROL_SENTINEL_SECRET=<client secret>
 *   (optionnel, pour un compte Sentinel Hub commercial au lieu du CDSE gratuit :)
 *   AFRICONTROL_SENTINEL_TOKEN=<url token>  AFRICONTROL_SENTINEL_API=<url process>
 *
 * Réception / lecture seule : le poste lit des images publiques, il ne commande aucun satellite.
 */

import { env } from "@/lib/env.server";

const CDSE_TOKEN = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_API = "https://sh.dataspace.copernicus.eu/api/v1/process";

const ORIGIN_3857 = 20037508.342789244;

function creds(): { id: string; secret: string } | null {
  const id = env("AFRICONTROL_SENTINEL_ID");
  const secret = env("AFRICONTROL_SENTINEL_SECRET");
  return id && secret ? { id, secret } : null;
}

export function sentinelConfigured(): boolean {
  return creds() != null;
}

function tokenUrl(): string {
  return env("AFRICONTROL_SENTINEL_TOKEN") ?? CDSE_TOKEN;
}
function apiUrl(): string {
  return env("AFRICONTROL_SENTINEL_API") ?? CDSE_API;
}

const g = globalThis as unknown as { __afriSHToken?: { token: string; exp: number } };

async function token(): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  const cached = g.__afriSHToken;
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: c.id,
    client_secret: c.secret,
  });
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("OAuth sans jeton");
  g.__afriSHToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

/** Vérifie que la clé de l'opérateur obtient bien un jeton (bouton « Tester la clé »). */
export async function sentinelCheck(): Promise<{ configured: boolean; ok: boolean; error: string | null }> {
  if (!sentinelConfigured()) return { configured: false, ok: false, error: null };
  try {
    const t = await token();
    return { configured: true, ok: Boolean(t), error: t ? null : "jeton vide" };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : "échec" };
  }
}

function tileBbox3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * ORIGIN_3857) / 2 ** z;
  const minX = -ORIGIN_3857 + x * size;
  const maxX = minX + size;
  const maxY = ORIGIN_3857 - y * size;
  const minY = maxY - size;
  return [minX, minY, maxX, maxY];
}

// True color Sentinel-2 L2A, étirement doux. Rien n'est ajouté à l'image : trois bandes réelles.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["B02","B03","B04"],output:{bands:3}};}
function evaluatePixel(s){const g=1.0/0.4;return [Math.min(1,s.B04*2.5)**g,Math.min(1,s.B03*2.5)**g,Math.min(1,s.B02*2.5)**g].map(v=>Math.round(v*255));}`;

const WINDOW_DAYS = 20;

export type S2Tile = { bytes: Uint8Array; src: string } | null;

/**
 * Une tuile Sentinel-2 (256×256 PNG) pour z/x/y. Composite « moins nuageux » sur les 20 derniers
 * jours : honnête sur la fraîcheur (fenêtre, pas une date truquée). null si non configuré ou vide.
 */
export async function sentinelTile(z: number, x: number, y: number): Promise<S2Tile> {
  const t = await token();
  if (!t) return null;
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
  const payload = {
    input: {
      bounds: {
        bbox: tileBbox3857(z, x, y),
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: from.toISOString(), to: to.toISOString() },
            maxCloudCoverage: 40,
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    output: {
      width: 256,
      height: 256,
      responses: [{ identifier: "default", format: { type: "image/png" } }],
    },
    evalscript: EVALSCRIPT,
  };
  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("429");
    throw new Error(`Process ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 400) return null;
  return {
    bytes: buf,
    src: `Sentinel-2 L2A · Copernicus · 10 m · composite moins nuageux ≤ ${WINDOW_DAYS} j`,
  };
}
