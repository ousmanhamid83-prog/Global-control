/**
 * Registre de NOS drones — partagé par le poste (data/drones.json). AfriControl SUIT et ANALYSE ;
 * il ne pilote rien, ne commande rien, n'arme rien. Un drone inscrit ici est reconnu AMI : sa piste
 * 1090ES (si le drone émet) n'est plus comptée comme intrusion, et son imagerie (image fixe de la
 * station sol / nacelle) devient une SOURCE D'ANALYSE de mouvement — pas un fond de carte, pas de
 * l'identification de personnes.
 *
 * `ident` = hex ICAO 24 bits (ex. 3C6DD2) OU indicatif, en MAJUSCULES, pour apparier la piste live.
 * `snapshotUrl` = URL d'une image fixe rafraîchie à chaque GET (caméra IP / station sol). Réception seule.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFirstJpeg, normIdent, type OwnDrone } from "./drones-core";

export type { OwnDrone } from "./drones-core";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "drones.json");
const MAX = 200;

const g = globalThis as unknown as { __afriDrones?: OwnDrone[] };

async function load(): Promise<OwnDrone[]> {
  if (g.__afriDrones) return g.__afriDrones;
  try {
    const raw = await readFile(FILE, "utf8");
    const arr: unknown = JSON.parse(raw);
    g.__afriDrones = Array.isArray(arr) ? (arr as OwnDrone[]) : [];
  } catch {
    g.__afriDrones = [];
  }
  return g.__afriDrones;
}

async function persist(list: OwnDrone[]): Promise<void> {
  g.__afriDrones = list;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list));
}

function cleanUrl(raw: string): string | undefined {
  const u = (raw ?? "").trim();
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function listDronesServer(): Promise<OwnDrone[]> {
  return [...(await load())];
}

export async function addDroneServer(input: {
  name?: string;
  ident?: string;
  site?: string;
  snapshotUrl?: string;
}): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> {
  const name = (input?.name ?? "").trim();
  const ident = normIdent(input?.ident ?? "");
  const site = (input?.site ?? "").trim();
  const snapshotUrl = cleanUrl(input?.snapshotUrl ?? "");
  if (!name) return { ok: false, error: "nom requis" };
  if (!ident) return { ok: false, error: "identifiant requis (hex ICAO ou indicatif)" };
  if ((input?.snapshotUrl ?? "").trim() && !snapshotUrl) {
    return { ok: false, error: "URL image invalide (http/https attendu)" };
  }
  const list = await load();
  if (list.length >= MAX) return { ok: false, error: `maximum ${MAX} drones` };
  if (list.some((d) => normIdent(d.ident) === ident)) {
    return { ok: false, error: "identifiant déjà inscrit" };
  }
  const drone: OwnDrone = {
    id: `drone:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 60),
    ident: ident.slice(0, 24),
    site: site.slice(0, 60),
    snapshotUrl,
    at: Date.now(),
  };
  const next = [drone, ...list];
  await persist(next);
  return { ok: true, drones: next };
}

export async function removeDroneServer(id: string): Promise<OwnDrone[]> {
  const next = (await load()).filter((d) => d.id !== id);
  await persist(next);
  return next;
}

/**
 * Récupère une image fixe d'un drone inscrit, côté serveur, et la renvoie en data URL (le canvas
 * client peut alors lire ses pixels sans être « taché »). Gardes anti-abus : l'URL doit être CELLE
 * d'un drone du registre (pas un proxy ouvert), ce doit être une image, et la taille est plafonnée.
 */
export async function fetchDroneFrameServer(
  url: string,
): Promise<{ ok: boolean; dataUrl?: string; at?: number; error?: string }> {
  const want = cleanUrl(url);
  if (!want) return { ok: false, error: "URL invalide" };
  const list = await load();
  if (!list.some((d) => d.snapshotUrl && d.snapshotUrl === want)) {
    return { ok: false, error: "URL non inscrite (doit être le flux d'un drone du registre)" };
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  const CAP = 8 * 1024 * 1024;
  try {
    const res = await fetch(want, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, error: `station sol : HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";

    // Image fixe (caméra snapshot, drone still) : le cas courant.
    if (ct.startsWith("image/")) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 6 * 1024 * 1024) return { ok: false, error: "image trop lourde (>6 Mo)" };
      return { ok: true, dataUrl: `data:${ct};base64,${buf.toString("base64")}`, at: Date.now() };
    }

    // Flux vidéo MJPEG (multipart/x-mixed-replace) : on lit jusqu'à la PREMIÈRE trame JPEG complète.
    if (ct.includes("multipart/") && res.body) {
      const reader = res.body.getReader();
      let acc = new Uint8Array(0);
      try {
        while (acc.length < CAP) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) {
            const next = new Uint8Array(acc.length + value.length);
            next.set(acc, 0);
            next.set(value, acc.length);
            acc = next;
            const jpeg = extractFirstJpeg(acc);
            if (jpeg) {
              const b64 = Buffer.from(jpeg).toString("base64");
              return { ok: true, dataUrl: `data:image/jpeg;base64,${b64}`, at: Date.now() };
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return { ok: false, error: "flux MJPEG : aucune trame JPEG complète reçue" };
    }

    return { ok: false, error: "le flux ne renvoie ni image fixe ni MJPEG (RTSP non pris en charge)" };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "délai station sol dépassé" : "station sol injoignable";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(to);
  }
}
