/**
 * File des tuiles distantes de la carte : au plus `max` en vol, les suivantes attendent leur tour,
 * la plus récente d'abord (la vue que l'opérateur regarde maintenant).
 *
 * Le navigateur n'ouvre que six connexions vers le poste, et une tuile qui attend une source lente
 * ou coupée en tient une jusqu'au délai plein. Sans plafond, les tuiles prenaient les six : chaque
 * appel de la console — commandes, image live — faisait la queue derrière. Mesuré, poste hors
 * ligne, première minute : 99 ms d'attente médiane dans le navigateur (457 ms au pire) pour une
 * commande que le serveur traite en 1,3 ms.
 *
 * Module pur, testable sous node.
 */
export type FileTuiles = {
  /** Lance `depart` tout de suite s'il reste une place, sinon dès qu'une tuile finit. */
  lancer: (depart: () => void) => void;
  /** Une tuile en vol a fini (chargée ou en échec) : la plus récente en attente part. */
  finie: () => void;
};

export function creerFile(max: number): FileTuiles {
  let enVol = 0;
  const attente: (() => void)[] = [];
  return {
    lancer(depart) {
      if (enVol < max) {
        enVol += 1;
        depart();
      } else attente.push(depart);
    },
    finie() {
      const suivante = attente.pop();
      if (suivante) suivante();
      else enVol -= 1;
    },
  };
}
