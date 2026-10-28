/**
 * POURQUOI UNE TUILE MANQUE — cœur PUR, testable.
 *
 * Le proxy d'imagerie confondait trois situations très différentes sous un seul `null`, puis sous
 * un seul 404 :
 *
 *   1) le fournisseur a répondu et n'a RIEN à cet endroit ;
 *   2) le fournisseur a répondu une tuile grise « Map data not yet available » — il dit la même
 *      chose, autrement ;
 *   3) nous n'avons PAS PU le joindre (réseau coupé, délai dépassé, panne de son côté).
 *
 * Les deux premières sont un fait sur le terrain : il n'y a pas d'imagerie à ce zoom ici, et une
 * tuile vide est la réponse honnête. La troisième est une PANNE DE NOTRE CÔTÉ, et la peindre en
 * vide donnerait une carte proprement aveugle, indiscernable d'un désert — exactement le mensonge
 * que ce poste refuse ailleurs sur les capteurs.
 *
 * Mesuré en réel sur N'Djamena : le fournisseur répond HTTP 200 au zoom 19 avec 2 521 octets, et
 * 5 153 au zoom 18 — sa tuile grise. L'imagerie fine existe bien ailleurs (15 ko au même zoom sur
 * le centre-ville), donc ce n'était ni une panne ni un bug de zoom : juste l'absence de couverture,
 * annoncée par un 404 bruyant au lieu d'être dite.
 */

/** Pourquoi le fournisseur n'a pas donné de tuile exploitable. */
export type TileMiss =
  /** Il a répondu : il n'y a pas d'imagerie ici (ou pas à ce zoom). Fait du terrain. */
  | "absente"
  /** Nous n'avons pas pu le joindre, ou il est en panne. Fait sur NOUS. */
  | "injoignable";

/**
 * Taille en deçà de laquelle une réponse 200 est une tuile de remplissage, pas de l'imagerie :
 * le gris « Map data not yet available » d'ESRI pèse ~2,5 ko, et sa variante au zoom 18 ~5,2 ko.
 * Mesuré sur les tuiles qui échouaient réellement.
 */
export const TUILE_GRISE_MAX = 6000;

/**
 * Ce que dit un code HTTP d'un fournisseur de tuiles. Un 404 est une RÉPONSE : « je n'ai rien ».
 * Un 5xx, un 429 ou un 403 disent que nous n'avons pas pu regarder — trois choses à ne pas
 * confondre avec un terrain sans imagerie.
 */
export function missFromStatus(status: number): TileMiss {
  if (status === 404 || status === 204 || status === 410) return "absente";
  return "injoignable";
}

/** Une réponse 200 qui pèse si peu n'est pas de l'imagerie : c'est le gris du fournisseur. */
export function estTuileGrise(octets: number, seuil = TUILE_GRISE_MAX): boolean {
  return octets < seuil;
}

/**
 * Verdict d'ensemble quand AUCUN fournisseur n'a rendu de tuile. Il suffit qu'UN SEUL ait été
 * injoignable pour qu'on refuse de conclure au vide : on ne peut pas affirmer qu'il n'y a rien
 * à un endroit qu'on n'a pas pu regarder.
 */
export function verdictTuile(echecs: TileMiss[]): TileMiss {
  return echecs.some((e) => e === "injoignable") ? "injoignable" : "absente";
}

/**
 * Zoom maximal au-delà duquel plus aucun fournisseur d'imagerie fine ne sert quoi que ce soit.
 * Demander au-delà est garanti sans réponse : autant ne pas le demander.
 */
export const ZOOM_IMAGERIE_MAX = 19;

/** Zoom en deçà duquel on passe sur l'imagerie géostationnaire plutôt que sur la mosaïque fine. */
export const ZOOM_IMAGERIE_MIN = 11;

/** Ce zoom peut-il être servi par un fournisseur d'imagerie fine ? */
export function zoomFinServable(z: number): boolean {
  return z >= ZOOM_IMAGERIE_MIN && z <= ZOOM_IMAGERIE_MAX;
}
