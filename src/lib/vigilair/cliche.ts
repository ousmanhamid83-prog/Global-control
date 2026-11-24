/**
 * Le CLICHÉ d'une capture en appui : l'imagerie du lieu où vole le drone, à l'heure de sa capture,
 * en 3 × 3 tuiles du zoom 14 (9,6 m par pixel à l'équateur, 2,4 km par tuile, 7 km de côté), le
 * drone marqué à sa position. C'est le LIEU, pas le drone : une mosaïque d'archive, pas une prise
 * du jour — le dossier le dit.
 */

/**
 * Zooms essayés, du plus fin au plus large : le 14, la capture « ≤ 10 m » de la console ; un lieu
 * sans imagerie au 14 en a souvent au 12 ou au 11. Pas plus large : sous le zoom 11, la couche
 * visible du poste sert l'image géostationnaire du moment, plus la mosaïque d'archive.
 */
export const ZOOMS_CLICHE = [14, 12, 11] as const;
/** Les fournisseurs de la mosaïque, d'après l'en-tête X-AfriControl-Tile (tile-proxy.server.ts). */
export const SOURCES_CLICHE: Record<string, string> = {
  ESRI: "Esri World Imagery",
  CLARITY: "Esri Clarity",
};
/** Tuiles par côté : le drone au centre, une tuile autour. */
export const COTE_CLICHE = 3;
/** Côté d'une tuile, en pixels. */
export const TUILE_PX = 256;

export type PlanCliche = {
  z: number;
  /** Les tuiles, ligne par ligne du nord au sud, colonne par colonne d'ouest en est. */
  tuiles: { x: number; y: number; col: number; lig: number }[];
  /** Le drone dans l'image assemblée, en pixels depuis son coin nord-ouest. */
  marque: { px: number; py: number };
  /** Côté de l'image assemblée, en pixels. */
  cotePx: number;
};

/** Les tuiles autour du drone, et où il tombe dans leur assemblage. */
export function planCliche(
  lat: number,
  lon: number,
  z: number = ZOOMS_CLICHE[0],
  n = COTE_CLICHE,
): PlanCliche {
  const largeur = 2 ** z;
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * largeur;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * largeur;
  const x0 = Math.floor(fx) - Math.floor(n / 2);
  const y0 = Math.floor(fy) - Math.floor(n / 2);
  const tuiles: PlanCliche["tuiles"] = [];
  for (let lig = 0; lig < n; lig++) {
    for (let col = 0; col < n; col++) {
      // L'antiméridien se traverse : la tuile d'à côté est de l'autre côté du monde.
      tuiles.push({ x: (((x0 + col) % largeur) + largeur) % largeur, y: y0 + lig, col, lig });
    }
  }
  return {
    z,
    tuiles,
    marque: { px: (fx - x0) * TUILE_PX, py: (fy - y0) * TUILE_PX },
    cotePx: n * TUILE_PX,
  };
}
