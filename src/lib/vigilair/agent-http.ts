/**
 * En-tête User-Agent de toutes les requêtes du poste vers les sources publiques (relevés, tuiles,
 * altitudes). Il nomme le logiciel, rien de plus : ni la mission, ni le lieu, ni l'opérateur.
 * Ces services voient déjà l'adresse IP du poste ; l'en-tête ne doit pas leur apprendre en plus à
 * quoi elle sert ni où elle se trouve. Avant, chaque relevé annonçait « C-UAS detection N'Djamena ».
 */
export const UA_POSTE = "AfriControl/1";
