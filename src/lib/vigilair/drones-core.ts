/**
 * Cœur PUR du registre drones : type + appariement identifiant. Aucune dépendance (ni réseau, ni
 * server fn) pour rester testable sous `node --test`. Le client et le serveur s'appuient dessus.
 */

/** Une SOURCE du poste : un de nos drones, ou une de nos caméras fixes de site. Mêmes paramètres. */
export type SourceKind = "drone" | "camera";

export type OwnDrone = {
  id: string;
  /** drone (par défaut) ou caméra fixe. */
  kind?: SourceKind;
  name: string;
  /** hex ICAO / indicatif (drone) ; pour une caméra, un repère libre (sert à l'affichage). */
  ident: string;
  site: string;
  /** Flux direct (snapshot JPEG ou MJPEG). Prioritaire sur hôte/port si fourni. */
  snapshotUrl?: string;
  /** Paramètres de liaison de la caméra/station : hôte, port, chemin du flux. */
  host?: string;
  port?: number;
  path?: string;
  /** Zone d'intérêt (polygone, coords NORMALISÉES 0..1) : on n'arme que DEDANS (ignore la route). */
  roi?: { x: number; y: number }[];
  at: number;
};

/** MAJUSCULES, sans séparateurs : apparie hex ICAO 24 bits ou indicatif de façon tolérante. */
export function normIdent(s: string): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * URL EFFECTIVE d'une source : le flux direct s'il est donné, sinon reconstruit depuis hôte + port
 * (+ chemin). Renvoie undefined si on ne peut rien construire. Pur : testable, et unique source de
 * vérité partagée par le client, le serveur (garde du proxy) et la veille.
 */
export function effectiveUrl(d: { snapshotUrl?: string; host?: string; port?: number; path?: string }): string | undefined {
  const direct = (d.snapshotUrl ?? "").trim();
  if (direct) return direct;
  const host = (d.host ?? "").trim();
  if (!host) return undefined;
  const scheme = host.startsWith("http://") || host.startsWith("https://") ? "" : "http://";
  const base = `${scheme}${host}`.replace(/\/+$/, "");
  const port = d.port && d.port > 0 && d.port <= 65535 ? `:${d.port}` : "";
  let path = (d.path ?? "").trim();
  if (path && !path.startsWith("/")) path = `/${path}`;
  return `${base}${port}${path}`;
}

/**
 * Extrait la PREMIÈRE trame JPEG d'un flux (ex. MJPEG multipart/x-mixed-replace) : cherche le marqueur
 * de début d'image (FF D8) puis la fin (FF D9) et renvoie la tranche, ou null si incomplète. Pur :
 * c'est de la découpe d'octets, pas du décodage. Permet d'accepter un flux vidéo via le proxy.
 */
export function extractFirstJpeg(bytes: Uint8Array): Uint8Array | null {
  let start = -1;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let j = start + 2; j + 1 < bytes.length; j++) {
    if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
      return bytes.subarray(start, j + 2);
    }
  }
  return null;
}

/**
 * Apparie une piste live (hex ICAO et/ou indicatif) à un drone inscrit. Renvoie le drone ami ou null.
 */
export function matchOwnDrone(
  drones: OwnDrone[],
  hex?: string | null,
  callsign?: string | null,
): OwnDrone | null {
  const h = normIdent(hex ?? "");
  const c = normIdent(callsign ?? "");
  for (const d of drones) {
    if (d.kind === "camera") continue; // une caméra fixe ne s'apparie pas à une piste aérienne
    const id = normIdent(d.ident);
    if (!id) continue;
    if ((h && id === h) || (c && id === c)) return d;
  }
  return null;
}
