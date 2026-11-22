/**
 * Les traces du balayage de pixels montrées sur la carte (« V détection », « H … », « P … »). Le
 * balayage lit chaque tuile de haut en bas : garder les premières trouvées, c'était ne montrer que le
 * haut des tuiles, et seulement celles du haut du bloc. On garde les plus CONTRASTÉES — les mieux
 * mesurées —, sous les mêmes plafonds. Les comptes (hommes, voitures, pirogues) restent les totaux :
 * seul l'échantillon montré change. Une trace est un contraste mesuré dans une image d'archive, de la
 * taille d'un gabarit : une classe, jamais une identité.
 */

/**
 * Les traces à garder : les plus contrastées d'abord (à contraste égal, l'ordre reçu), au plus
 * `parSorte` d'une même sorte et `total` en tout.
 */
export function garderTraces<T extends { id: string; force: number }>(
  candidates: readonly T[],
  plafonds: { total: number; parSorte?: number },
): T[] {
  const parSorte = plafonds.parSorte ?? plafonds.total;
  // Le tri de JavaScript est stable : à contraste égal, l'ordre reçu est gardé.
  const triees = [...candidates].sort((a, b) => b.force - a.force);
  const gardees: T[] = [];
  const deSorte = new Map<string, number>();
  for (const t of triees) {
    if (gardees.length >= plafonds.total) break;
    const n = deSorte.get(t.id) ?? 0;
    if (n >= parSorte) continue;
    deSorte.set(t.id, n + 1);
    gardees.push(t);
  }
  return gardees;
}
