/**
 * /registre — CÔTÉ SERVEUR : les deux requêtes en ligne, en parallèle, chacune bornée. Elles nomment
 * l'avion : seul le chef les lance (voir commandes-poste.server et lookupAircraft), et chacune va
 * au journal. Le reste — choix de l'avion, lecture des réponses, lignes — est dans registre-poste.
 */
import { UA_POSTE } from "./agent-http";
import { lireAdsbLol, lireAdsbdb, type Cible, type Registre } from "./registre-poste";

/** Chaque source a ce délai : mesuré 0,4 à 0,7 s à travers le proxy du poste d'essai. */
const REGISTRE_DELAI_MS = 6000;

/** La réponse JSON, null pour un 404 (avion inconnu), une erreur lisible sinon. */
async function lire(url: string): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA_POSTE },
      signal: AbortSignal.timeout(REGISTRE_DELAI_MS),
    });
  } catch (err) {
    const x = err as { name?: unknown; cause?: { code?: unknown } };
    throw new Error(
      x.name === "TimeoutError"
        ? `injoignable (pas de réponse en ${REGISTRE_DELAI_MS / 1000} s)`
        : `injoignable (${typeof x.cause?.code === "string" ? x.cause.code : "réseau"})`,
    );
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`en erreur (HTTP ${r.status})`);
  return (await r.json()) as unknown;
}

export async function consulterRegistre(cible: Cible): Promise<Registre> {
  const [db, lol] = await Promise.allSettled([
    lire(`https://api.adsbdb.com/v0/aircraft/${cible.hex}`),
    lire(`https://api.adsb.lol/v2/hex/${cible.hex}`),
  ]);
  const erreur = (r: PromiseRejectedResult) => ({
    erreur: r.reason instanceof Error ? r.reason.message : "en erreur",
  });
  return {
    cible,
    adsbdb: db.status === "fulfilled" ? lireAdsbdb(db.value) : erreur(db),
    adsblol: lol.status === "fulfilled" ? lireAdsbLol(lol.value, cible.hex) : erreur(lol),
  };
}
