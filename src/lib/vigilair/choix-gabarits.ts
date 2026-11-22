/**
 * QUELS OBJETS MESURÉS LA CARTE MONTRE — cœur PUR, testable.
 *
 * L'analyse des pixels (tiles.ts, measureTile) cherche sur l'image d'archive les taches de
 * contraste au gabarit d'un homme, d'une voiture ou d'une pirogue. Elle les compte toutes ; la
 * carte n'en pose qu'une poignée : 4 par classe et 8 par tuile, 12 sur le bloc de 3 × 3 tuiles.
 *
 * Ce choix suivait l'ordre du balayage, ligne par ligne dans la tuile et les tuiles du haut
 * d'abord : on gardait les premières taches trouvées, en haut de chaque tuile, et la rangée de
 * tuiles du haut remplissait les 12 places. À l'essai sur N'Djamena (échelle 1,2 m, imagerie
 * Esri), trois « V détection » s'alignaient sur le bord haut du bloc, une tuile d'écart : on
 * aurait dit des défauts de bord, alors que les taches qui touchent le bord sont déjà écartées.
 *
 * On garde maintenant les taches les plus contrastées (écart moyen de leur luminance à la moyenne
 * de leur voisinage), et à contraste égal les plus proches du centre regardé ; les plafonds
 * s'appliquent dans cet ordre. Les plus contrastées sortent en tête : quand deux noms se
 * chevauchent, la carte pose celui de la plus contrastée. Les comptes restent entiers, seul le
 * choix des repères change. Un repère reste une tache de contraste mesurée sur une image réelle :
 * une classe, pas une identité.
 */

/** Une tache mesurée, candidate à un repère sur la carte. */
export type CandidatGabarit = {
  /** Classe du gabarit : homme, voiture ou pirogue. */
  id: string;
  /** Tuile où la tache a été mesurée : les plafonds de 4 et de 8 se comptent par tuile. */
  tuile: string;
  /** Centre de la tache, en tuiles au zoom du balayage (x vers l'est, y vers le sud). */
  x: number;
  y: number;
  /** Écart moyen |luminance − moyenne 5 × 5| sur les pixels de la tache (0 à 255). */
  force: number;
};

/** 4 repères par classe et par tuile, 8 par tuile, 12 en tout. */
const PLAFONDS = { parClasse: 4, parTuile: 8, total: 12 } as const;

/**
 * Les repères à poser : les plus contrastés d'abord, à contraste égal les plus proches du centre
 * (même repère que x et y), sous les plafonds. Rend les candidats gardés eux-mêmes, du plus
 * contrasté au moins contrasté, sans toucher la liste reçue.
 */
export function choisirGabarits<T extends CandidatGabarit>(
  candidats: readonly T[],
  centre: { x: number; y: number },
): T[] {
  const loin = (c: T) => (c.x - centre.x) ** 2 + (c.y - centre.y) ** 2;
  const ordre = [...candidats].sort((a, b) => b.force - a.force || loin(a) - loin(b));
  const parTuile = new Map<string, number>();
  const parClasse = new Map<string, number>();
  const gardes: T[] = [];
  for (const c of ordre) {
    if (gardes.length >= PLAFONDS.total) break;
    const classe = `${c.tuile}|${c.id}`;
    const dansTuile = parTuile.get(c.tuile) ?? 0;
    const deClasse = parClasse.get(classe) ?? 0;
    if (dansTuile >= PLAFONDS.parTuile || deClasse >= PLAFONDS.parClasse) continue;
    parTuile.set(c.tuile, dansTuile + 1);
    parClasse.set(classe, deClasse + 1);
    gardes.push(c);
  }
  return gardes;
}
