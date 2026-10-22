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
