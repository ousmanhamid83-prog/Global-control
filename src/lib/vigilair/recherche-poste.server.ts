/**
 * Recherche en ligne du poste, SUR DEMANDE — CÔTÉ SERVEUR. Elle passe par un moteur SearXNG du
 * réseau du poste, jamais par un moteur public appelé directement :
 *
 *   AFRICONTROL_RECHERCHE=http://127.0.0.1:8888   (scripts/poste/preparer-poste --recherche)
 *
 * SearXNG interroge les moteurs publics sans cookie ni profil : ils reçoivent la requête, pas
 * l'opérateur. La commande /recherche est désactivée à la livraison, pour la console comme pour
 * le bot : le chef de division l'active. Avant tout envoi, la requête passe le filtre de
 * souveraineté (recherche-sure) ; chaque recherche partie est écrite au journal.
 */
import { env } from "../env.server.ts";
import type { LivePicture } from "./live-adsb.ts";
import { verifierRequete } from "./recherche-sure.ts";
import { RESEAU_POSTE_EXEMPLES, serveurPoste } from "./reseau-poste.ts";

/** Écrit une action au journal des opérations (titre, détail). */
export type Journal = (titre: string, detail: string) => Promise<void>;

/** Trouvailles gardées par recherche. */
export const RECHERCHE_TROUVAILLES = 5;
/** Au-delà, la recherche est abandonnée. */
export const RECHERCHE_DELAI_MS = 12_000;

export type Trouvaille = { titre: string; url: string; extrait: string };

export type Recherche =
  { ok: true; requete: string; trouvailles: Trouvaille[] } | { ok: false; erreur: string };

/** Pourquoi la recherche ne peut pas partir (moteur non réglé, ou hors du poste) ; null si prête. */
export function rechercheIndisponible(): string | null {
  const s = serveurPoste(env("AFRICONTROL_RECHERCHE"));
  if ("base" in s) return null;
  return s.refus === "absente"
    ? "Recherche en ligne non réglée : AFRICONTROL_RECHERCHE (moteur SearXNG du poste)."
    : `AFRICONTROL_RECHERCHE refusée : le moteur doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}). Rien n'a été envoyé.`;
}

/** Une requête, déjà passée au filtre de souveraineté, envoyée au moteur du poste. */
async function rechercher(requete: string): Promise<Recherche> {
  const s = serveurPoste(env("AFRICONTROL_RECHERCHE"));
  if (!("base" in s)) return { ok: false, erreur: rechercheIndisponible() ?? "" };
  const url = `${s.base}/search?q=${encodeURIComponent(requete)}&format=json&language=fr&safesearch=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(RECHERCHE_DELAI_MS),
    });
    if (res.status === 403) {
      return {
        ok: false,
        erreur:
          "Le moteur du poste refuse le format JSON : ajouter « json » à search.formats dans son settings.yml.",
      };
    }
    if (!res.ok) return { ok: false, erreur: `Moteur du poste : HTTP ${res.status}.` };
    const corps = (await res.json()) as {
      results?: { title?: unknown; url?: unknown; content?: unknown }[];
    };
    const trouvailles = (corps.results ?? [])
      .filter((r) => typeof r.title === "string" && typeof r.url === "string")
      .slice(0, RECHERCHE_TROUVAILLES)
      .map((r) => ({
        titre: String(r.title).replace(/\s+/g, " ").trim().slice(0, 160),
        url: String(r.url).slice(0, 300),
        extrait:
          typeof r.content === "string" ? r.content.replace(/\s+/g, " ").trim().slice(0, 300) : "",
      }));
    return { ok: true, requete, trouvailles };
  } catch (e) {
    const raison =
      e instanceof Error && e.name === "TimeoutError"
        ? `pas de réponse en ${RECHERCHE_DELAI_MS / 1000} s`
        : e instanceof Error
          ? e.message
          : "échec";
    return { ok: false, erreur: `Moteur du poste injoignable (${raison}).` };
  }
}

/**
 * Une question de l'opérateur, cherchée en ligne : filtre de souveraineté (le relevé `pic` dit ce
 * qui ne doit pas sortir), envoi au moteur du poste, journal. Rien ne part si le moteur n'est pas
 * réglé ; une requête refusée est journalisée aussi.
 */
export async function chercherEnLigne(
  question: string,
  pic: LivePicture | null,
  journal: Journal,
): Promise<Recherche> {
  const indispo = rechercheIndisponible();
  if (indispo) return { ok: false, erreur: indispo };
  const verdict = verifierRequete(question, pic);
  if (!verdict.ok) {
    await journal("Recherche en ligne refusée", verdict.raison);
    return { ok: false, erreur: verdict.raison };
  }
  const r = await rechercher(verdict.requete);
  await journal(
    "Recherche en ligne",
    `« ${verdict.requete} » · ${r.ok ? `${r.trouvailles.length} trouvaille(s)` : r.erreur}`,
  );
  return r;
}

/** Les trouvailles en lignes, marquées pour ce qu'elles sont : Internet, pas les capteurs. */
export function lignesRecherche(r: Recherche): string[] {
  if (!r.ok) return [r.erreur];
  return [
    `Requête envoyée au moteur du poste : « ${r.requete} »`,
    r.trouvailles.length === 0
      ? "Aucune trouvaille."
      : `${r.trouvailles.length} trouvaille(s) — Internet, non vérifié, pas des données capteurs :`,
    ...r.trouvailles.flatMap((t, i) => [
      `${i + 1}. ${t.titre}`,
      `   ${t.url}`,
      ...(t.extrait ? [`   ${t.extrait}`] : []),
    ]),
  ];
}
