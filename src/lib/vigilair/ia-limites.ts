/**
 * Limites de l'IA du poste. Le serveur les applique et la console les affiche telles quelles : une
 * seule source, pour que l'écran ne promette jamais autre chose que ce que fait le serveur.
 */

/** Au-delà, la question est abandonnée (un modèle local sur processeur peut être lent). */
export const IA_DELAI_S = 120;

/** Longueur maximale d'une question de l'opérateur, en caractères. */
export const IA_QUESTION_MAX = 1000;

/** Extraits de la notice du poste (LIREMOI) joints à une question, en caractères. */
export const IA_NOTICE_BUDGET = 1800;

/** Contacts 1090 les plus proches du poste décrits à l'assistant, un par ligne. */
export const IA_CONTACTS_VUS = 10;
