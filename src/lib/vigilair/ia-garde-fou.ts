/**
 * Garde-fou de l'IA du poste. Un petit modèle local peut inventer une piste ; le prompt le lui
 * interdit, mais un interdit n'est pas une preuve. Ici, chaque élément vérifiable que la réponse cite
 * — indicatif (AFR123), adresse ICAO 24 bits (3C6589), immatriculation (TT-ABC), groupe de
 * message (FEW040) — est recherché dans les données réellement fournies au modèle. Ce qui n'y est
 * pas est signalé en clair sous la réponse : l'opérateur voit ce qui vient des capteurs et ce qui
 * peut avoir été inventé. Rien n'est retiré de la réponse : on montre, on ne maquille pas.
 */

// Indicatif ou groupe codé : 2–3 lettres, 1–4 chiffres, 0–2 lettres (AFR123, ETH900A, FEW040).
const INDICATIF = /\b[A-Z]{2,3}\d{1,4}[A-Z]{0,2}\b/g;
// Adresse ICAO 24 bits : 6 caractères hexadécimaux (filtrée plus bas : chiffres ET lettres).
const HEX = /\b[0-9A-Fa-f]{6}\b/g;
// Immatriculation : préfixe pays, tiret, suffixe (TT-ABC, F-GKXA, 5H-TCA).
const IMMAT = /\b[A-Z0-9]{1,2}-[A-Z0-9]{2,5}\b/g;

// Formes voisines qui ne désignent rien de vérifiable dans les données : niveau de vol ou piste
// d'aéroport déduits par le modèle, réglages, unités, termes du poste.
const NEUTRE = /^(?:FL|RWY|QNH|QFE|NIC|NAC|SIL|KT|MPS|UTC|WAT)\d*[A-Z]{0,2}$|^C-UAS$/;

function estHexCredible(jeton: string): boolean {
  return /\d/.test(jeton) && /[A-Fa-f]/.test(jeton);
}

// Une immatriculation porte des lettres ; « 11-02 » (une date) n'en est pas une.
function estImmatCredible(jeton: string): boolean {
  return /[A-Z]/.test(jeton.split("-")[1] ?? "");
}

/** Éléments vérifiables cités dans un texte, dans l'ordre d'apparition, sans doublon. */
export function elementsCites(texte: string): string[] {
  const trouves: { at: number; jeton: string }[] = [];
  for (const m of texte.matchAll(INDICATIF)) trouves.push({ at: m.index ?? 0, jeton: m[0] });
  for (const m of texte.matchAll(HEX)) {
    if (estHexCredible(m[0])) trouves.push({ at: m.index ?? 0, jeton: m[0].toUpperCase() });
  }
  for (const m of texte.matchAll(IMMAT)) {
    if (estImmatCredible(m[0])) trouves.push({ at: m.index ?? 0, jeton: m[0] });
  }
  const vus = new Set<string>();
  const ordre: string[] = [];
  for (const { jeton } of trouves.sort((a, b) => a.at - b.at)) {
    if (NEUTRE.test(jeton) || vus.has(jeton)) continue;
    vus.add(jeton);
    ordre.push(jeton);
  }
  return ordre;
}

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Éléments cités par la réponse qu'on ne retrouve pas, mot entier, dans les données fournies. */
export function nonVerifies(reponse: string, donnees: string): string[] {
  return elementsCites(reponse).filter(
    (jeton) =>
      !new RegExp(`(?<![0-9A-Za-z-])${echapper(jeton)}(?![0-9A-Za-z-])`, "i").test(donnees),
  );
}

/** La réponse, suivie d'un avertissement en clair si elle cite ce que les données ne contiennent pas. */
export function annoterReponse(reponse: string, donnees: string): string {
  const inconnus = nonVerifies(reponse, donnees);
  if (inconnus.length === 0) return reponse;
  return (
    `${reponse.trimEnd()}\n\n` +
    `⚠ Non retrouvé dans les données fournies à l'IA : ${inconnus.join(", ")}. ` +
    "Possible invention du modèle : ne pas s'y fier sans contrôle sur les capteurs."
  );
}
