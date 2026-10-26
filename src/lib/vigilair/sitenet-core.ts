/**
 * Cœur PUR des « sites distants » — réseaux de caméras à surveiller au bout des liaisons antenne.
 * On mémorise la PLAGE d'adresses de chaque site et la dernière liste de caméras vues, pour re-scanner
 * d'un clic et SIGNALER un changement de PRÉSENCE RÉSEAU : une caméra tombée (disparue) ou une nouvelle
 * apparue sur le périmètre. C'est de la présence d'ÉQUIPEMENT (quelle caméra répond), jamais d'identité.
 * Aucune dépendance → testable sous `node --test`.
 */

/** Une entrée du journal d'un site : un balayage qui a vu un CHANGEMENT (apparition / disparition). */
export type SiteNetEvent = { at: number; up: string[]; down: string[] };

export type SiteNet = {
  id: string;
  /** Nom du site distant (ex. « Poste Est », « Portail Sud »). */
  name: string;
  /** Secteur de rattachement (ex. « Secteur Est ») — pour re-scanner tout un groupe d'un bouton. */
  group?: string;
  /** Spécification de plage : CIDR / a.b.c.x-y / préfixe a.b.c. / IP seule. */
  range: string;
  at: number;
  /** Dernier balayage : horodatage. */
  lastScanAt?: number;
  /** Dernières adresses caméra vues « host:port » (pour détecter tombée / nouvelle). */
  cams?: string[];
  /** Journal (main courante) : derniers changements horodatés, le plus récent d'abord. */
  history?: SiteNetEvent[];
};

/** Regroupe les sites par SECTEUR (group), en conservant l'ordre d'apparition des secteurs. Les sites
 *  sans secteur tombent dans le groupe « » (sans secteur). Pur : l'UI s'en sert pour l'affichage. */
export function groupSites(sites: SiteNet[]): { group: string; sites: SiteNet[] }[] {
  const order: string[] = [];
  const by = new Map<string, SiteNet[]>();
  for (const s of sites) {
    const g = (s.group ?? "").trim();
    if (!by.has(g)) {
      by.set(g, []);
      order.push(g);
    }
    by.get(g)!.push(s);
  }
  return order.map((g) => ({ group: g, sites: by.get(g)! }));
}

/**
 * Lignes « état du périmètre réseau » (pour un PDF / un dossier) : par site, le nombre de caméras EN
 * LIGNE au dernier relevé et les dernières tombées. Pur, sans formatage de date (l'appelant ajoute
 * l'horodatage). Des adresses d'ÉQUIPEMENT, jamais d'identité.
 */
export function perimeterSummaryLines(sites: SiteNet[]): string[] {
  if (!sites.length) return ["Perimetre reseau : aucun site distant memorise."];
  const out: string[] = [`Perimetre reseau : ${sites.length} site(s) distant(s)`];
  for (const g of groupSites(sites)) {
    if (g.group) out.push(`[${g.group}]`);
    for (const s of g.sites) {
      const n = (s.cams ?? []).length;
      out.push(`  ${s.name} (${s.range}) : ${n} camera(s) en ligne`);
      const down = (s.history ?? []).flatMap((e) => e.down).slice(0, 4);
      if (down.length) out.push(`    tombees recentes : ${down.join(", ")}`);
    }
  }
  return out;
}

/** Ajoute un événement en tête du journal (le plus récent d'abord), borné à `max` entrées. */
export function appendHistory(hist: SiteNetEvent[] | undefined, entry: SiteNetEvent, max = 20): SiteNetEvent[] {
  return [entry, ...(hist ?? [])].slice(0, max);
}

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
