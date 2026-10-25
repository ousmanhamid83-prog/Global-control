/**
 * Découverte de flux — cœur PUR, testable. Sert au « scan auto » : à partir de l'hôte d'UNE de NOS
 * caméras / stations sol, retrouver le port et le chemin qui servent le snapshot ou le flux MJPEG,
 * pour pré-remplir la fiche sans saisie manuelle. C'est de la DÉCOUVERTE DE LIAISON (quel port, quel
 * chemin répond une image), PAS une analyse d'identité : rien ici ne lit un visage ni une plaque.
 *
 * Ce module ne fait AUCUN réseau : il ne produit que la liste bornée des cibles à sonder et classe un
 * résultat. Le sondage réel (TCP/HTTP) est côté serveur (drones.server). La liste de ports/chemins est
 * FIGÉE (pas de port arbitraire fourni par l'opérateur au-delà d'un indice) pour rester un assistant de
 * découverte caméra, pas un scanner réseau généraliste.
 */

/** Ports HTTP couramment exposés par une caméra IP / station sol pour un snapshot ou un flux MJPEG. */
export const CAMERA_HTTP_PORTS: readonly number[] = [80, 8080, 8000, 8081, 81, 88, 8008, 9000];

/** Ports HTTPS courants — caméras exposées sur Internet (IP publique / DDNS), souvent en TLS. */
export const CAMERA_HTTPS_PORTS: readonly number[] = [443, 8443];

/** Ports RTSP : illisibles par le navigateur — on ne fait qu'un test d'ouverture (passerelle requise). */
export const CAMERA_RTSP_PORTS: readonly number[] = [554, 8554];

/** Chemins snapshot/MJPEG les plus répandus (Axis, Hikvision, Dahua, Foscam, ONVIF, génériques). */
export const SNAPSHOT_PATHS: readonly string[] = [
  "/snapshot.jpg",
  "/snapshot.cgi",
  "/jpg/image.jpg",
  "/image/jpeg.cgi",
  "/axis-cgi/jpg/image.cgi",
  "/cgi-bin/snapshot.cgi",
  "/onvif-http/snapshot",
  "/video.mjpg",
  "/mjpg/video.mjpg",
  "/videostream.cgi",
  "/cam/realmonitor",
  "/",
];

/** Plafond dur du nombre de cibles HTTP sondées : borne le scan, assistant de découverte ≠ scanner. */
export const MAX_PROBE_TARGETS = 48;

export type ProbeTarget = { port: number; path: string; url: string };

/**
 * Normalise un hôte saisi : retire le schéma (http(s)://) et tout ce qui suit le premier « / »,
 * isole l'hôte et un port explicite éventuel. « http://10.0.0.9:8080/x » → { host:"10.0.0.9", port:8080 }.
 * Gère un littéral IPv6 entre crochets. Renvoie host="" si rien d'exploitable.
 */
export function parseHost(raw: string): { host: string; port?: number; secure?: boolean } {
  let s = (raw ?? "").trim();
  if (!s) return { host: "" };
  const secure = /^https:\/\//i.test(s);
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // schéma
  s = s.split(/[/?#]/)[0] ?? ""; // chemin / query / fragment
  if (!s) return { host: "" };
  const sec = secure ? { secure: true } : {};
  const okPort = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= 65535;
  // IPv6 littéral : [::1]:8080
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const port = v6[2] ? Number(v6[2]) : NaN;
    return okPort(port) ? { host: v6[1]!, port, ...sec } : { host: v6[1]!, ...sec };
  }
  const idx = s.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
    const port = Number(s.slice(idx + 1));
    if (okPort(port)) return { host: s.slice(0, idx), port, ...sec };
    return { host: s.slice(0, idx), ...sec };
  }
  return { host: s, ...sec };
}

/** L'hôte a-t-il une forme plausible (nom d'hôte ou IPv4/IPv6 littéral) ? Garde-fou de saisie. */
export function isPlausibleHost(host: string): boolean {
  const h = (host ?? "").trim();
  if (!h || h.length > 120) return false;
  if (/\s/.test(h)) return false;
  return /^[a-zA-Z0-9.:_-]+$/.test(h);
}

/**
 * Cibles HTTP à sonder pour un hôte, bornées à MAX_PROBE_TARGETS. Si un port est fourni (indice de
 * l'opérateur), on le teste SEUL, avec tous les chemins. Sinon on balaie les ports caméra connus,
 * port le plus probable d'abord (80, 8080…), chemins snapshot les plus répandus d'abord.
 */
export function probeTargets(
  host: string,
  opts?: { port?: number; ports?: readonly number[]; paths?: readonly string[]; max?: number; scheme?: "http" | "https" },
): ProbeTarget[] {
  const h = (host ?? "").trim();
  if (!h) return [];
  const paths = opts?.paths ?? SNAPSHOT_PATHS;
  const ports =
    opts?.port && opts.port > 0 && opts.port <= 65535
      ? [opts.port]
      : opts?.ports ?? CAMERA_HTTP_PORTS;
  const max = opts?.max ?? MAX_PROBE_TARGETS;
  const scheme = opts?.scheme === "https" ? "https" : "http";
  const defPort = scheme === "https" ? 443 : 80; // port implicite du schéma → pas de :port dans l'URL
  const out: ProbeTarget[] = [];
  for (const port of ports) {
    for (const path of paths) {
      if (out.length >= max) return out;
      const p = path.startsWith("/") ? path : `/${path}`;
      const portSeg = port === defPort ? "" : `:${port}`;
      out.push({ port, path: p, url: `${scheme}://${h}${portSeg}${p}` });
    }
  }
  return out;
}

/** Les premiers octets ressemblent-ils à une image JPEG (FF D8 FF) ? */
export function isJpegMagic(head: Uint8Array): boolean {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/** Les premiers octets ressemblent-ils à une image PNG (89 50 4E 47) ? */
export function isPngMagic(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
}

/**
 * Classe une réponse à partir du content-type et des 1ers octets : flux MJPEG (multipart), image fixe
 * (content-type image/* OU magie JPEG/PNG), sinon « autre » (page HTML, redirection, auth…).
 */
export function classifyProbe(contentType: string, head: Uint8Array): "image" | "mjpeg" | "other" {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("multipart/")) return "mjpeg";
  if (ct.startsWith("image/")) return "image";
  if (isJpegMagic(head) || isPngMagic(head)) return "image";
  return "other";
}

// ───────────────────────── Scan « longue distance » : plage d'adresses ─────────────────────────
//
// Le multicast ONVIF ne traverse pas les routeurs / liens radio : pour atteindre les caméras d'un
// poste DISTANT (au bout de la liaison antenne), on balaie une PLAGE d'adresses (le sous-réseau du
// site distant, routé jusqu'au poste). Expansion PURE et BORNÉE de la plage ; le balayage réseau est
// côté serveur. Ce reste un balayage de VOTRE réseau de sites, pas un scanner d'Internet.

/** Plafond dur du nombre d'hôtes d'une plage (un /24). Au-delà → refus : on scanne par tranches. */
export const MAX_RANGE_HOSTS = 256;

function octetsOk(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

const ipToInt = (o: number[]): number => ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;
const intToIp = (n: number): string => `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;

/**
 * Développe une spécification de plage en liste d'hôtes (bornée à MAX_RANGE_HOSTS). Formes acceptées :
 *  - CIDR : « 10.20.0.0/24 » (préfixe 24..32) — réseau et broadcast exclus pour un bloc ≥ /31.
 *  - dernier octet : « 10.20.0.10-40 »
 *  - préfixe : « 10.20.0. »  → .1 à .254
 *  - IP seule : « 10.20.0.9 »
 * Renvoie [] si la forme est invalide ou la plage trop large (le serveur traduit ça en message).
 */
export function expandRange(spec: string): string[] {
  const s = (spec ?? "").trim();
  if (!s) return [];

  // CIDR
  const cidr = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    const base = octetsOk(cidr[1]!);
    const bits = Number(cidr[2]);
    if (!base || bits < 24 || bits > 32) return [];
    const size = 2 ** (32 - bits);
    if (size > MAX_RANGE_HOSTS) return [];
    const net = ipToInt(base) & (0xffffffff << (32 - bits)) >>> 0;
    const out: string[] = [];
    for (let i = 0; i < size; i++) {
      // pour un vrai sous-réseau (≥ /31 → ≥ 4 hôtes), on saute réseau et broadcast
      if (size >= 4 && (i === 0 || i === size - 1)) continue;
      out.push(intToIp((net + i) >>> 0));
    }
    return out;
  }

  // dernier octet : a.b.c.x-y  (ou a.b.c.x-a.b.c.y)
  const dash = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.)?)(\d{1,3})$/);
  if (dash) {
    const prefix = dash[1]!;
    const a = Number(dash[2]);
    const b = Number(dash[3]);
    if (![a, b].every((n) => n >= 0 && n <= 255) || b < a || b - a + 1 > MAX_RANGE_HOSTS) return [];
    if (!octetsOk(`${prefix}.${a}`)) return [];
    const out: string[] = [];
    for (let i = a; i <= b; i++) out.push(`${prefix}.${i}`);
    return out;
  }

  // préfixe : a.b.c.  → .1 à .254
  const pfx = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.$/);
  if (pfx) {
    if (!octetsOk(`${pfx[1]}.0`)) return [];
    const out: string[] = [];
    for (let i = 1; i <= 254; i++) out.push(`${pfx[1]}.${i}`);
    return out;
  }

  // IP seule
  if (octetsOk(s)) return [s];
  return [];
}
