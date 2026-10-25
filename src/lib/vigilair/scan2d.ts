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
export function parseHost(raw: string): { host: string; port?: number } {
  let s = (raw ?? "").trim();
  if (!s) return { host: "" };
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // schéma
  s = s.split(/[/?#]/)[0] ?? ""; // chemin / query / fragment
  if (!s) return { host: "" };
  const okPort = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= 65535;
  // IPv6 littéral : [::1]:8080
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const port = v6[2] ? Number(v6[2]) : NaN;
    return okPort(port) ? { host: v6[1]!, port } : { host: v6[1]! };
  }
  const idx = s.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
    const port = Number(s.slice(idx + 1));
    if (okPort(port)) return { host: s.slice(0, idx), port };
    return { host: s.slice(0, idx) };
  }
  return { host: s };
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
  opts?: { port?: number; ports?: readonly number[]; paths?: readonly string[]; max?: number },
): ProbeTarget[] {
  const h = (host ?? "").trim();
  if (!h) return [];
  const paths = opts?.paths ?? SNAPSHOT_PATHS;
  const ports =
    opts?.port && opts.port > 0 && opts.port <= 65535
      ? [opts.port]
      : opts?.ports ?? CAMERA_HTTP_PORTS;
  const max = opts?.max ?? MAX_PROBE_TARGETS;
  const out: ProbeTarget[] = [];
  for (const port of ports) {
    for (const path of paths) {
      if (out.length >= max) return out;
      const p = path.startsWith("/") ? path : `/${path}`;
      const portSeg = port === 80 ? "" : `:${port}`;
      out.push({ port, path: p, url: `http://${h}${portSeg}${p}` });
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
