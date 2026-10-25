/**
 * Cœur PUR des « sites distants » — réseaux de caméras à surveiller au bout des liaisons antenne.
 * On mémorise la PLAGE d'adresses de chaque site et la dernière liste de caméras vues, pour re-scanner
 * d'un clic et SIGNALER un changement de PRÉSENCE RÉSEAU : une caméra tombée (disparue) ou une nouvelle
 * apparue sur le périmètre. C'est de la présence d'ÉQUIPEMENT (quelle caméra répond), jamais d'identité.
 * Aucune dépendance → testable sous `node --test`.
 */

export type SiteNet = {
  id: string;
  /** Nom du site distant (ex. « Poste Est », « Portail Sud »). */
  name: string;
  /** Spécification de plage : CIDR / a.b.c.x-y / préfixe a.b.c. / IP seule. */
  range: string;
  at: number;
  /** Dernier balayage : horodatage. */
  lastScanAt?: number;
  /** Dernières adresses caméra vues « host:port » (pour détecter tombée / nouvelle). */
  cams?: string[];
};

/** Clé stable d'une caméra pour comparer les présences : « host:port ». */
export function camKey(c: { host: string; port: number }): string {
  return `${c.host}:${c.port}`;
}

/**
 * Compare deux relevés de caméras (par clé « host:port ») : ce qui est APPARU (added) et ce qui a
 * DISPARU (removed) entre le relevé précédent et le courant. Pur, insensible à l'ordre et aux doublons.
 */
export function diffCameras(prev: string[] | undefined, cur: string[] | undefined): { added: string[]; removed: string[] } {
  const p = new Set(prev ?? []);
  const c = new Set(cur ?? []);
  const added = [...c].filter((x) => !p.has(x));
  const removed = [...p].filter((x) => !c.has(x));
  return { added, removed };
}
