/**
 * Cœur PUR du registre drones : type + appariement identifiant. Aucune dépendance (ni réseau, ni
 * server fn) pour rester testable sous `node --test`. Le client et le serveur s'appuient dessus.
 */

export type OwnDrone = {
  id: string;
  name: string;
  ident: string;
  site: string;
  snapshotUrl?: string;
  at: number;
};

/** MAJUSCULES, sans séparateurs : apparie hex ICAO 24 bits ou indicatif de façon tolérante. */
export function normIdent(s: string): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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
    const id = normIdent(d.ident);
    if (!id) continue;
    if ((h && id === h) || (c && id === c)) return d;
  }
  return null;
}
