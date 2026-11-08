/**
 * Filtre de souveraineté de la recherche en ligne : ce qu'une requête n'a pas le droit d'emporter
 * hors du poste. Une recherche part sur Internet (par le moteur SearXNG du poste, mais les moteurs
 * publics la reçoivent) : elle ne doit trahir ni la position du poste ni ce qu'il suit.
 *
 * Refusée, la requête ne part pas, et l'opérateur sait pourquoi — on ne la réécrit pas en douce :
 *   - un indicatif, une adresse ICAO ou une immatriculation d'un contact du relevé ;
 *   - des coordonnées (degrés décimaux, degrés-minutes, carré MGRS).
 *
 * Module pur, testable sous node.
 */
import type { LivePicture } from "./live-adsb.ts";

/** Longueur maximale d'une requête envoyée en ligne, en caractères. */
export const REQUETE_MAX = 200;

/**
 * `filtre` : refusée par le filtre de souveraineté (contact du relevé, coordonnées) — le chef de
 * division peut alors la faire sortir à la console. `contourne` : le refus auquel son ordre passe
 * outre, pour le journal.
 */
export type Verdict =
  | { ok: true; requete: string; contourne?: string }
  | { ok: false; raison: string; filtre?: true };

// 12.13, 15.03 · 12,13 15,03 · -4.5/19.2 : deux nombres décimaux qui se suivent.
const DECIMAUX = /-?\d{1,3}[.,]\d{2,}\s*[,;/ ]\s*-?\d{1,3}[.,]\d{2,}/;
// 12°08'N · 15° 02′ E
const DEGRES = /\d{1,3}\s*°/;
// Carré MGRS : 33P XL 12345 67890, 33PXL1234567890.
const MGRS = /\b\d{1,2}[C-HJ-NP-X]\s?[A-HJ-NP-Z]{2}\s?\d{4,10}\b/i;

/** Les identifiants du relevé qu'un mot de la requête reprend : indicatif, adresse, immat. */
function identifiantsCites(requete: string, pic: LivePicture | null): string[] {
  if (!pic) return [];
  const mots = new Set(requete.toUpperCase().split(/[^A-Z0-9-]+/));
  const cites = new Set<string>();
  for (const a of pic.aircraft) {
    const indicatif = a.flight.trim().toUpperCase();
    if (indicatif.length >= 3 && mots.has(indicatif)) cites.add(indicatif);
    if (mots.has(a.hex.toUpperCase())) cites.add(a.hex);
    const immat = a.reg?.trim().toUpperCase();
    if (immat && mots.has(immat)) cites.add(immat);
  }
  return [...cites];
}

/**
 * La requête peut-elle partir ? Sinon, la raison, à montrer telle quelle à l'opérateur. `forcer` :
 * ordre du chef — le filtre de souveraineté ne retient plus la requête, mais son refus est rendu
 * dans `contourne` ; une requête vide ou trop longue reste refusée.
 */
export function verifierRequete(texte: string, pic: LivePicture | null, forcer = false): Verdict {
  const requete = texte.trim().replace(/\s+/g, " ");
  if (!requete) return { ok: false, raison: "Requête vide : rien à chercher." };
  if (requete.length > REQUETE_MAX) {
    return {
      ok: false,
      raison: `Requête de ${requete.length} caractères : ${REQUETE_MAX} au plus. Rien n'est sorti du poste.`,
    };
  }
  const cites = identifiantsCites(requete, pic);
  const motif =
    cites.length > 0
      ? `elle nomme ${cites.join(", ")}, contact du relevé`
      : DECIMAUX.test(requete) || DEGRES.test(requete) || MGRS.test(requete)
        ? "elle contient des coordonnées"
        : null;
  if (motif == null) return { ok: true, requete };
  if (forcer) return { ok: true, requete, contourne: motif };
  return { ok: false, raison: `Requête refusée : ${motif}. Rien n'est sorti du poste.`, filtre: true };
}
