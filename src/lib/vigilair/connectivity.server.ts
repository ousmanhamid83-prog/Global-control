/**
 * Liaison Internet du poste — CÔTÉ SERVEUR. Teste en direct si le poste atteint les sources dont
 * AfriControl a besoin (imagerie, réseau 1090ES, météo). Le site isolé peut passer par le wifi
 * opérateur, Starlink ou Thuraya : ces liens sont gérés par l'OS, AfriControl utilise celui qui est
 * actif. Ici on ne fait que CONSTATER l'état — lecture seule, rien n'est émis.
 *
 * Une réponse HTTP (même 403/404) = l'hôte est joignable = EN LIGNE. Seules une erreur réseau ou une
 * expiration comptent comme HORS LIGNE (pas d'Internet, ou ce domaine bloqué par un pare-feu).
 */

const PROBES: { id: string; label: string; url: string }[] = [
  { id: "img", label: "Imagerie (Esri World Imagery)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json" },
  { id: "adsb", label: "Réseau 1090ES (adsb.lol)", url: "https://api.adsb.lol/v2/point/12.13/15.03/5" },
  { id: "meteo", label: "Météo aéronautique (AWC)", url: "https://aviationweather.gov/api/data/metar?ids=FTTJ&format=json" },
];

export type LinkProbe = { id: string; label: string; ok: boolean; status: number | null; ms: number | null; error: string | null };
export type LinkStatus = { at: number; online: boolean; reachable: number; total: number; probes: LinkProbe[] };

async function probe(p: { id: string; label: string; url: string }): Promise<LinkProbe> {
  const t0 = Date.now();
  try {
    const res = await fetch(p.url, { method: "GET", signal: AbortSignal.timeout(6000), redirect: "manual" });
    // N'importe quelle réponse HTTP = hôte joignable. On ne lit pas le corps (coût minimal).
    return { id: p.id, label: p.label, ok: true, status: res.status, ms: Date.now() - t0, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "échec";
    // AbortError = délai dépassé ; sinon erreur réseau (pas de route / DNS / pare-feu).
    return { id: p.id, label: p.label, ok: false, status: null, ms: Date.now() - t0, error: /abort|timeout/i.test(msg) ? "délai dépassé" : msg };
  }
}

export async function linkStatus(): Promise<LinkStatus> {
  const probes = await Promise.all(PROBES.map(probe));
  const reachable = probes.filter((p) => p.ok).length;
  return { at: Date.now(), online: reachable > 0, reachable, total: probes.length, probes };
}
