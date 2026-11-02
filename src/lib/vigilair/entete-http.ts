/**
 * Valeur d'en-tête HTTP sûre. Un en-tête ne porte que des caractères Latin-1 (≤ 255) : avec un
 * seul caractère au-delà, la construction de la réponse lève une exception. C'est ainsi que chaque
 * tuile Sentinel-2 fraîche finissait en 502 : son crédit, posé en en-tête, disait « ≤ 20 j »
 * (U+2264). Les accents français (é, ï, ·) sont Latin-1 et restent tels quels ; le reste est
 * remplacé par son équivalent ASCII, ou « ? » — un saut de ligne ou un autre caractère de contrôle
 * aussi, qui ferait lever la réponse de la même façon.
 */
const EQUIVALENTS: Record<string, string> = {
  "≤": "<=",
  "≥": ">=",
  "—": "-",
  "–": "-",
  "→": "->",
  "←": "<-",
  "…": "...",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "€": "EUR",
};

export function enTeteSur(texte: string): string {
  return texte.replace(/[^\t\u0020-\u00ff]/gu, (c) => EQUIVALENTS[c] ?? "?");
}
