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

import net from "node:net";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { effectiveUrl, extractFirstJpeg, normIdent, type OwnDrone, type SourceKind } from "./drones-core";
import {
  CAMERA_HTTP_PORTS,
  CAMERA_HTTPS_PORTS,
  CAMERA_RTSP_PORTS,
  classifyProbe,
  expandRange,
  isPlausibleHost,
  parseHost,
  probeTargets,
} from "./scan2d";
import {
  buildProbe,
  parseProbeMatches,
  WS_DISCOVERY_ADDR,
  WS_DISCOVERY_PORT,
  type OnvifDevice,
} from "./onvif";

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
  kind?: string;
  name?: string;
  ident?: string;
  site?: string;
  snapshotUrl?: string;
  host?: string;
  port?: number | string;
  path?: string;
}): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> {
  const kind: SourceKind = input?.kind === "camera" ? "camera" : "drone";
  const name = (input?.name ?? "").trim();
  let ident = normIdent(input?.ident ?? "");
  const site = (input?.site ?? "").trim();
  const snapshotUrl = cleanUrl(input?.snapshotUrl ?? "");
  const host = (input?.host ?? "").trim().slice(0, 120);
  const portNum = Number(input?.port);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? Math.round(portNum) : undefined;
  const pathStr = (input?.path ?? "").trim().slice(0, 200);
  if (!name) return { ok: false, error: "nom requis" };
  // Drone : identifiant requis (apparie la piste 1090ES). Caméra : repère libre, sinon dérivé du nom.
  if (kind === "drone" && !ident) return { ok: false, error: "identifiant requis (hex ICAO ou indicatif)" };
  if (!ident) ident = normIdent(name) || `CAM${Date.now().toString(36).toUpperCase()}`;
  if ((input?.snapshotUrl ?? "").trim() && !snapshotUrl) {
    return { ok: false, error: "URL flux invalide (http/https attendu)" };
  }
  const eff = effectiveUrl({ snapshotUrl, host, port, path: pathStr });
  if (eff && !cleanUrl(eff)) return { ok: false, error: "hôte/port invalides" };
  if (kind === "camera" && !eff) return { ok: false, error: "caméra : flux requis (URL, ou hôte:port)" };
  const list = await load();
  if (list.length >= MAX) return { ok: false, error: `maximum ${MAX} sources` };
  if (list.some((d) => normIdent(d.ident) === ident)) {
    return { ok: false, error: "identifiant déjà inscrit" };
  }
  const drone: OwnDrone = {
    id: `${kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    name: name.slice(0, 60),
    ident: ident.slice(0, 24),
    site: site.slice(0, 60),
    snapshotUrl,
    host: host || undefined,
    port,
    path: pathStr || undefined,
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

/** Définit (ou efface) la zone d'intérêt polygonale d'une source. Points normalisés 0..1, max 24. */
export async function setDroneRoiServer(id: string, roi: unknown): Promise<OwnDrone[]> {
  const pts = Array.isArray(roi)
    ? roi
        .filter((p): p is { x: number; y: number } => !!p && Number.isFinite((p as { x?: number }).x) && Number.isFinite((p as { y?: number }).y))
        .slice(0, 24)
        .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }))
    : [];
  const next = (await load()).map((d) => (d.id === id ? { ...d, roi: pts.length >= 3 ? pts : undefined } : d));
  await persist(next);
  return next;
}

/** Nettoie un polygone : points finis, bornés 0..1, max 24 sommets. */
function cleanPolygon(raw: unknown): { x: number; y: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { x: number; y: number } => !!p && Number.isFinite((p as { x?: number }).x) && Number.isFinite((p as { y?: number }).y))
    .slice(0, 24)
    .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
}

/**
 * Définit (ou efface) les zones d'intérêt d'une source — PLUSIEURS polygones (un secteur par zone).
 * Chaque zone : ≥ 3 sommets normalisés 0..1 ; max 8 zones. Vide → surveille toute l'image. Efface la
 * `roi` héritée (remplacée par `zones`) pour ne pas compter deux fois.
 */
export async function setDroneZonesServer(id: string, zones: unknown): Promise<OwnDrone[]> {
  const polys = Array.isArray(zones)
    ? zones.map(cleanPolygon).filter((p) => p.length >= 3).slice(0, 8)
    : [];
  const next = (await load()).map((d) =>
    d.id === id ? { ...d, zones: polys.length ? polys : undefined, roi: undefined } : d,
  );
  await persist(next);
  return next;
}

/**
 * Règle d'armement PROPRE à une source (règle par emplacement). `rule` null/absente → efface la règle
 * (la source hérite du réglage global). Sinon on stocke nightOnly + fenêtre [armFrom, armTo) bornée 0..23.
 */
export async function setDroneRuleServer(
  id: string,
  rule: { nightOnly?: unknown; armFrom?: unknown; armTo?: unknown } | null,
): Promise<OwnDrone[]> {
  const clampH = (v: unknown, dflt: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : dflt;
  };
  const patch =
    rule && typeof rule === "object"
      ? { nightOnly: !!rule.nightOnly, armFrom: clampH(rule.armFrom, 19), armTo: clampH(rule.armTo, 6) }
      : { nightOnly: undefined, armFrom: undefined, armTo: undefined };
  const next = (await load()).map((d) => (d.id === id ? { ...d, ...patch } : d));
  await persist(next);
  return next;
}

// ───────────────────────── Scan auto d'une source (découverte de liaison) ─────────────────────────
//
// Assistant pour NOS propres caméras / stations sol : à partir de l'hôte, retrouver le port + le chemin
// qui servent l'image (snapshot/MJPEG), pour pré-remplir la fiche sans saisie manuelle. C'est de la
// DÉCOUVERTE DE LIAISON, opérateur-initiée, sur SON matériel ; la liste de ports/chemins est FIGÉE
// (scan2d) et le nombre de sondes est plafonné — ce n'est pas un scanner réseau généraliste. Rien ici
// ne lit un visage ni une plaque : on ne fait que vérifier « ce port/chemin renvoie-t-il une image ? ».

export type ScanFinding = { port: number; path: string; url: string; kind: "image" | "mjpeg"; status: number };
export type ScanResult = {
  ok: boolean;
  host?: string;
  suggested?: { url: string; host: string; port: number; path: string; kind: "image" | "mjpeg" };
  found: ScanFinding[];
  openHttpPorts: number[];
  rtsp: { port: number; open: boolean }[];
  scanned: number;
  error?: string;
};

/** Test d'ouverture TCP (connexion acceptée ?) avec délai court. Jamais d'exception : true/false. */
function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    try {
      sock.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/** Sonde HTTP une URL : lit le content-type et quelques octets de tête, classe image/MJPEG/autre. */
async function probeHttp(
  url: string,
  timeoutMs: number,
): Promise<{ kind: "image" | "mjpeg" | "other"; status: number } | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    const ct = res.headers.get("content-type") ?? "";
    let head = new Uint8Array(0);
    if (!ct.includes("multipart/") && res.body) {
      // Lit au plus ~1 Ko pour renifler la magie (JPEG/PNG), puis coupe.
      const reader = res.body.getReader();
      try {
        const { value } = await reader.read();
        if (value) head = value.subarray(0, 1024);
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    return { kind: classifyProbe(ct, head), status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export async function scanSourceServer(rawHost: string): Promise<ScanResult> {
  const { host, port, secure } = parseHost(rawHost ?? "");
  const empty: ScanResult = { ok: false, found: [], openHttpPorts: [], rtsp: [], scanned: 0 };
  if (!host) return { ...empty, error: "hôte requis (ex. 10.0.0.9, cam.local ou cam.ddns.net)" };
  if (!isPlausibleHost(host)) return { ...empty, error: "hôte invalide" };

  // 1) Ports RTSP : simple test d'ouverture (le navigateur ne lit pas le RTSP → passerelle requise).
  const rtspPorts = port && CAMERA_RTSP_PORTS.includes(port) ? [port] : CAMERA_RTSP_PORTS;
  const rtsp = await Promise.all(
    rtspPorts.map(async (p) => ({ port: p, open: await tcpOpen(host, p, 1200) })),
  );

  // 2) Cibles HTTP/HTTPS : chaque port porte son schéma. Un port explicite est testé seul ; sinon on
  //    balaie HTTP et HTTPS (caméra Internet en TLS). « https:// » saisi → on ne teste que HTTPS.
  type HttpTarget = { port: number; scheme: "http" | "https" };
  const explicit = port && !CAMERA_RTSP_PORTS.includes(port) ? port : undefined;
  let httpTargets: HttpTarget[];
  if (explicit) {
    const scheme: "http" | "https" = secure || CAMERA_HTTPS_PORTS.includes(explicit) ? "https" : "http";
    httpTargets = [{ port: explicit, scheme }];
  } else if (secure) {
    httpTargets = CAMERA_HTTPS_PORTS.map((p) => ({ port: p, scheme: "https" as const }));
  } else {
    httpTargets = [
      ...CAMERA_HTTP_PORTS.map((p) => ({ port: p, scheme: "http" as const })),
      ...CAMERA_HTTPS_PORTS.map((p) => ({ port: p, scheme: "https" as const })),
    ];
  }
  const openChecks = await Promise.all(
    httpTargets.map(async (t) => ({ ...t, open: await tcpOpen(host, t.port, 900) })),
  );
  const openTargets = openChecks.filter((c) => c.open);
  const openHttpPorts = openTargets.map((c) => c.port);

  // 3) Sur chaque port ouvert, on cherche le 1er chemin qui renvoie une image/MJPEG (borné).
  const found: ScanFinding[] = [];
  let suggested: ScanResult["suggested"];
  let scanned = httpTargets.length + rtspPorts.length;
  const deadline = Date.now() + 22_000;
  const MAX_HTTP = 48;
  let httpProbes = 0;
  outer: for (const t0 of openTargets) {
    for (const t of probeTargets(host, { port: t0.port, scheme: t0.scheme })) {
      if (Date.now() > deadline || httpProbes >= MAX_HTTP) break outer;
      httpProbes++;
      scanned++;
      const r = await probeHttp(t.url, 1500);
      if (r && (r.kind === "image" || r.kind === "mjpeg")) {
        found.push({ port: t0.port, path: t.path, url: t.url, kind: r.kind, status: r.status });
        if (!suggested) suggested = { url: t.url, host, port: t0.port, path: t.path, kind: r.kind };
        break; // un flux par port suffit — on passe au port suivant
      }
    }
  }

  return {
    ok: !!suggested || found.length > 0 || rtsp.some((r) => r.open),
    host,
    suggested,
    found,
    openHttpPorts,
    rtsp,
    scanned,
  };
}

// ───────────────────────── Découverte ONVIF / WS-Discovery (réseau) ─────────────────────────
//
// Trouve les caméras ONVIF du LAN SANS taper d'IP : une sonde multicast (Probe) est envoyée, les
// caméras répondent (ProbeMatch) avec l'URL de leur service et leurs métadonnées d'équipement (nom,
// modèle, emplacement). Opérateur-initié, lecture seule (« qui est là ? »), aucune identité de
// personne. Si le réseau ne route pas le multicast (certains conteneurs/VLAN), la liste revient vide
// sans erreur bloquante.

export type OnvifResult = { ok: boolean; devices: OnvifDevice[]; error?: string };

export async function discoverOnvifServer(timeoutMs = 3000): Promise<OnvifResult> {
  const budget = Math.max(1000, Math.min(8000, Math.round(timeoutMs) || 3000));
  return new Promise<OnvifResult>((resolve) => {
    const devices = new Map<string, OnvifDevice>();
    let settled = false;
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        /* déjà fermé */
      }
      resolve({ ok: !error, devices: [...devices.values()], error });
    };
    sock.on("error", (e) => finish(e instanceof Error ? e.message : "socket ONVIF"));
    sock.on("message", (msg) => {
      try {
        for (const d of parseProbeMatches(msg.toString("utf8"))) {
          if (!devices.has(d.xaddr)) devices.set(d.xaddr, d);
        }
      } catch {
        /* réponse illisible : ignorée */
      }
    });
    sock.bind(() => {
      const probe = Buffer.from(buildProbe(randomUUID()));
      const send = () => sock.send(probe, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR, () => undefined);
      try {
        try { sock.setMulticastTTL(2); } catch { /* non supporté */ }
        try { sock.setBroadcast(true); } catch { /* non supporté */ }
        send();
        setTimeout(() => { if (!settled) send(); }, 250); // 2e sonde : l'UDP peut se perdre
      } catch (e) {
        finish(e instanceof Error ? e.message : "sonde ONVIF impossible");
        return;
      }
      setTimeout(() => finish(), budget);
    });
  });
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
  // Garde : l'URL doit être l'URL EFFECTIVE d'une source inscrite (drone ou caméra) — pas un proxy ouvert.
  if (!list.some((d) => { const e = effectiveUrl(d); return e != null && cleanUrl(e) === want; })) {
    return { ok: false, error: "URL non inscrite (doit être le flux d'une source du registre)" };
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

// ───────────────── Scan « longue distance » : sous-réseau d'un site distant ─────────────────
//
// Le multicast ONVIF s'arrête au segment local. Pour atteindre les caméras d'un poste DISTANT, au
// bout d'une liaison antenne (sous-réseau routé jusqu'ici), on balaie une PLAGE d'adresses : connexion
// TCP sur quelques ports caméra, puis recherche du flux sur les hôtes vivants, et enrichissement du nom
// par une sonde ONVIF unicast (qui, elle, traverse les routeurs). Balayage de VOTRE réseau de sites,
// opérateur-initié, borné (un /24 max) ; jamais d'identité de personnes.

/** Sonde ONVIF UNICAST d'un hôte précis (WS-Discovery envoyé en point à point : traverse les routeurs). */
function onvifProbeUnicast(host: string, timeoutMs = 1200): Promise<OnvifDevice[]> {
  return new Promise((resolve) => {
    const devices = new Map<string, OnvifDevice>();
    let settled = false;
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* déjà fermé */ }
      resolve([...devices.values()]);
    };
    sock.on("error", () => finish());
    sock.on("message", (msg) => {
      try {
        for (const d of parseProbeMatches(msg.toString("utf8"))) if (!devices.has(d.xaddr)) devices.set(d.xaddr, d);
      } catch { /* illisible */ }
    });
    sock.bind(() => {
      try {
        sock.send(Buffer.from(buildProbe(randomUUID())), WS_DISCOVERY_PORT, host, () => undefined);
      } catch {
        finish();
        return;
      }
      setTimeout(finish, Math.max(400, Math.min(4000, timeoutMs)));
    });
  });
}

/** Exécute `fn` sur `items` avec une concurrence bornée (pool simple). */
async function runPool<T>(items: T[], concurrency: number, fn: (it: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

export type RangeCamera = { host: string; port: number; path: string; url: string; kind: "image" | "mjpeg"; name?: string };
export type RangeResult = {
  ok: boolean;
  cameras: RangeCamera[];
  openHosts: string[];
  hosts: number;
  scanned: number;
  error?: string;
};

export async function scanRangeServer(spec: string): Promise<RangeResult> {
  const hosts = expandRange(spec ?? "");
  if (hosts.length === 0) {
    return { ok: false, cameras: [], openHosts: [], hosts: 0, scanned: 0, error: "plage invalide ou trop large (un /24 max, ex. 10.20.0.0/24)" };
  }
  const deadline = Date.now() + 35_000;
  const SWEEP_PORTS = [80, 8080, 8000, 443, 554]; // HTTP courants + HTTPS (Internet/TLS) + rtsp : « un équipement ? »
  const openHosts: string[] = [];
  type HttpTarget = { port: number; scheme: "http" | "https" };
  const openHttp = new Map<string, HttpTarget[]>();
  const schemeOf = (p: number): "http" | "https" => (CAMERA_HTTPS_PORTS.includes(p) ? "https" : "http");

  // 1) balayage de présence : connexion TCP sur quelques ports, concurrence bornée.
  await runPool(hosts, 32, async (h) => {
    if (Date.now() > deadline) return;
    const checks = await Promise.all(SWEEP_PORTS.map(async (p) => ({ p, open: await tcpOpen(h, p, 700) })));
    const open = checks.filter((c) => c.open);
    if (open.length) {
      openHosts.push(h);
      openHttp.set(
        h,
        open
          .filter((c) => CAMERA_HTTP_PORTS.includes(c.p) || CAMERA_HTTPS_PORTS.includes(c.p))
          .map((c) => ({ port: c.p, scheme: schemeOf(c.p) })),
      );
    }
  });

  // 2) sur chaque hôte vivant à port HTTP/HTTPS, chercher le flux puis enrichir le nom (ONVIF unicast).
  const cameras: RangeCamera[] = [];
  let scanned = hosts.length * SWEEP_PORTS.length;
  for (const h of openHosts) {
    if (Date.now() > deadline) break;
    let found: RangeCamera | undefined;
    outer: for (const t0 of openHttp.get(h) ?? []) {
      for (const t of probeTargets(h, { port: t0.port, scheme: t0.scheme })) {
        if (Date.now() > deadline) break outer;
        scanned++;
        const r = await probeHttp(t.url, 1200);
        if (r && (r.kind === "image" || r.kind === "mjpeg")) {
          found = { host: h, port: t0.port, path: t.path, url: t.url, kind: r.kind };
          break outer;
        }
      }
    }
    if (found) {
      const devs = await onvifProbeUnicast(h, 1000).catch(() => []);
      found.name = devs[0]?.name;
      cameras.push(found);
    }
  }
  return { ok: true, cameras, openHosts, hosts: hosts.length, scanned };
}

// ───────────────────────── Enregistrement de caméras EN LOT ─────────────────────────
//
// Inscrit plusieurs caméras d'un coup (après découverte ONVIF ou scan de plage). `scan: true` →
// pour une caméra sans chemin connu, on cherche d'abord son flux. Identifiant dérivé de l'hôte pour
// garder chaque source unique. Toujours type « caméra », sans identité.

export type CameraInput = { host?: string; port?: number | string; path?: string; name?: string; site?: string; url?: string };

export async function registerCamerasServer(
  list: CameraInput[],
  scan = false,
): Promise<{ added: number; withStream: number; skipped: number; drones: OwnDrone[] }> {
  const items = Array.isArray(list) ? list.slice(0, 64) : [];
  let added = 0;
  let withStream = 0;
  let skipped = 0;
  for (const it of items) {
    const host = (it?.host ?? "").trim();
    // URL COMPLÈTE prioritaire (préserve le schéma http/https — caméra Internet en TLS).
    let url = (it?.url ?? "").trim() || undefined;
    let port = it?.port != null && it.port !== "" ? Number(it.port) : undefined;
    let pathStr = (it?.path ?? "").trim() || undefined;
    if (!url) {
      if (!host || !isPlausibleHost(host)) {
        skipped++;
        continue;
      }
      if (scan && !pathStr) {
        const r = await scanSourceServer(host);
        if (r.suggested) {
          url = r.suggested.url; // URL complète avec le bon schéma
          port = r.suggested.port;
          pathStr = r.suggested.path;
        }
      }
    }
    if (url || pathStr) withStream++;
    const ident = url ? url.slice(0, 48) : `${host}${port ? `:${port}` : ""}`;
    const res = await addDroneServer({
      kind: "camera",
      name: (it?.name ?? "").trim() || `Cam ${host || url}`,
      ident,
      site: it?.site ?? "",
      snapshotUrl: url,
      host: url ? undefined : host,
      port: url ? undefined : port,
      path: url ? undefined : pathStr,
    });
    if (res.ok) added++;
    else skipped++;
  }
  return { added, withStream, skipped, drones: await listDronesServer() };
}
