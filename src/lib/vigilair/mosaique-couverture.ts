/**
 * Couverture de la mosaïque locale (imagerie hors ligne du poste), calculée à partir des tuiles
 * RÉELLEMENT présentes sur le disque, et non plus d'un rectangle figé autour de FTTJ. Le poste peut
 * ainsi afficher hors ligne toute tuile installée, sur n'importe quelle zone.
 *
 * La couverture est EXACTE : par zoom, chaque colonne x devient des suites contiguës de y, et des
 * colonnes voisines aux suites identiques fusionnent en un rectangle. Aucune tuile absente n'est
 * revendiquée : le navigateur ne demande jamais une tuile qui n'existe pas.
 */
export type RectTuiles = { z: number; x0: number; x1: number; y0: number; y1: number };

type Tuile = { z: number; x: number; y: number };

function suitesContigues(ys: number[]): [number, number][] {
  const suites: [number, number][] = [];
  for (const y of [...new Set(ys)].sort((a, b) => a - b)) {
    const derniere = suites[suites.length - 1];
    if (derniere && y === derniere[1] + 1) derniere[1] = y;
    else suites.push([y, y]);
  }
  return suites;
}

/** Rectangles couvrant exactement les tuiles données, du zoom le plus fin au plus grossier. */
export function couvertureDepuisTuiles(tuiles: Tuile[]): RectTuiles[] {
  const parZoom = new Map<number, Map<number, number[]>>();
  for (const { z, x, y } of tuiles) {
    const colonnes = parZoom.get(z) ?? new Map<number, number[]>();
    parZoom.set(z, colonnes);
    colonnes.set(x, [...(colonnes.get(x) ?? []), y]);
  }
  const rects: RectTuiles[] = [];
  // Du plus fin au plus grossier : en vue large, la carte réduit d'abord l'imagerie la plus nette.
  for (const z of [...parZoom.keys()].sort((a, b) => b - a)) {
    const colonnes = parZoom.get(z)!;
    const suites = new Map<number, [number, number][]>();
    for (const [x, ys] of colonnes) suites.set(x, suitesContigues(ys));
    const xs = [...suites.keys()].sort((a, b) => a - b);
    let i = 0;
    while (i < xs.length) {
      const cle = JSON.stringify(suites.get(xs[i]!));
      let j = i;
      while (
        j + 1 < xs.length &&
        xs[j + 1] === xs[j]! + 1 &&
        JSON.stringify(suites.get(xs[j + 1]!)) === cle
      ) {
        j++;
      }
      for (const [y0, y1] of suites.get(xs[i]!)!) rects.push({ z, x0: xs[i]!, x1: xs[j]!, y0, y1 });
      i = j + 1;
    }
  }
  return rects;
}

/** La tuile est-elle dans la couverture ? */
export function couvre(rects: RectTuiles[], z: number, x: number, y: number): boolean {
  return rects.some((c) => c.z === z && x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
}
