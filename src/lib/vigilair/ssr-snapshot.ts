/**
 * INSTANTANÉ SERVEUR DES REGISTRES — cœur PUR.
 *
 * Les registres du poste (drones et caméras, sites de veille, capteurs sol, routes, secteurs
 * réseau) gardent un miroir dans `localStorage` et le LISENT au premier appel de leur instantané.
 * Or ce même instantané servait aussi de « getServerSnapshot » à React — la fonction que React
 * appelle au rendu serveur ET pendant l'hydratation du client.
 *
 * Conséquence du motif : sur un poste configuré, le serveur rend une liste vide (il n'a pas accès
 * au `localStorage` de l'opérateur) pendant que le client, lui, lit le miroir déjà peuplé et rend
 * une liste pleine. React jette alors tout l'arbre et le refabrique.
 *
 * ÉTAT MESURÉ, à dire franchement : ce défaut ne se manifeste nulle part aujourd'hui. Vérifié sur
 * un poste configuré (drones, caméras, sites, routes, secteurs inscrits), 0 désynchronisation sur
 * 8 rechargements — parce que les composants qui lisent ces registres rendent `null` (ce sont des
 * moteurs, pas des vues) ou vivent derrière un onglet inactif, donc ne sont jamais rendus par le
 * serveur. C'est une correction de PIÈGE, pas de panne : le jour où l'un de ces composants passe
 * dans la coque permanente de l'application, la désynchronisation devient certaine à chaque
 * chargement. Le même motif avait déjà produit ce bug, lui bien réel, sur la télémétrie.
 */

/**
 * Liste vide partagée, GELÉE et de référence STABLE. React exige que l'instantané serveur rende la
 * même référence à chaque appel : un tableau neuf à chaque fois le ferait boucler. Le gel empêche
 * qu'un appelant la modifie par mégarde et contamine tous les registres d'un coup.
 */
const VIDE: readonly unknown[] = Object.freeze([]);

/**
 * L'instantané que le rendu serveur doit voir d'un registre miroité : rien. Le contenu réel arrive
 * juste après l'hydratation, par l'abonnement normal.
 */
export function registreVideServeur<T>(): T[] {
  return VIDE as T[];
}
