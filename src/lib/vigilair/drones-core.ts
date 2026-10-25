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
  /** Zone d'intérêt (polygone, coords NORMALISÉES 0..1) : on n'arme que DEDANS (ignore la route).
   *  Hérité — une seule zone. Remplacé par `zones` (plusieurs) ; gardé pour compat / migration. */
  roi?: { x: number; y: number }[];
  /** Plusieurs zones d'intérêt (chacune un polygone normalisé ≥ 3 sommets). Prioritaire sur `roi` :
   *  on n'arme que si la présence est DANS L'UNE d'elles. Permet plusieurs secteurs par caméra. */
  zones?: { x: number; y: number }[][];
  /** Règle d'armement PROPRE à cette source (règle par emplacement). Si absente → hérite du global.
   *  nightOnly : n'alerter que dans la fenêtre [armFrom, armTo) (ex. la nuit). */
  nightOnly?: boolean;
  armFrom?: number;
  armTo?: number;
  at: number;
};

/** Les zones effectives d'une source : `zones` si présentes (≥ 3 sommets), sinon l'ancienne `roi`,
 *  sinon aucune (toute l'image est surveillée). Pur : partagé par la veille et l'UI. */
export function sourceZones(d: { zones?: { x: number; y: number }[][]; roi?: { x: number; y: number }[] }): { x: number; y: number }[][] {
  if (Array.isArray(d.zones)) {
    const z = d.zones.filter((p) => Array.isArray(p) && p.length >= 3);
    if (z.length) return z;
  }
  if (Array.isArray(d.roi) && d.roi.length >= 3) return [d.roi];
  return [];
}

export type ArmRule = { nightOnly: boolean; from: number; to: number };

/** Règle d'armement effective d'une source : la sienne si définie (par emplacement), sinon le global
 *  fourni en repli. Pur : la veille l'évalue pour décider d'alerter ou non à l'heure courante. */
export function sourceArmRule(
  d: { nightOnly?: boolean; armFrom?: number; armTo?: number },
  fallback: ArmRule,
): ArmRule {
  return {
    nightOnly: typeof d.nightOnly === "boolean" ? d.nightOnly : fallback.nightOnly,
    from: Number.isFinite(d.armFrom as number) ? (d.armFrom as number) : fallback.from,
    to: Number.isFinite(d.armTo as number) ? (d.armTo as number) : fallback.to,
  };
}

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
  const hasScheme = host.startsWith("http://") || host.startsWith("https://");
  // Caméra exposée sur Internet : un port HTTPS (443 / 8443) implique le schéma https.
  const secure = d.port === 443 || d.port === 8443;
  const scheme = hasScheme ? "" : secure ? "https://" : "http://";
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
