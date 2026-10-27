/**
 * Demandes de RÉ-APPRENTISSAGE de la vue de référence d'une caméra, posées par l'opérateur depuis
 * l'interface et consommées par la veille. Sert au cas légitime : on a VOLONTAIREMENT re-visé une
 * caméra (nouveau chantier, nouvel angle) — sans ça elle resterait signalée « déplacée » indéfiniment,
 * puisque la veille n'apprend JAMAIS d'elle-même une vue sabotée comme étant la nouvelle normale.
 * Boîte aux lettres minimale : poser la demande, la retirer en la lisant.
 */

const pending = new Set<string>();

/** L'opérateur déclare que la vue actuelle de cette source est la bonne. */
export function requestRelearn(id: string): void {
  pending.add(id);
}

/** La veille consomme la demande (vrai une seule fois par demande). */
export function takeRelearn(id: string): boolean {
  return pending.delete(id);
}

/** Une demande est-elle en attente ? (affichage seulement, ne consomme pas) */
export function relearnPending(id: string): boolean {
  return pending.has(id);
}
