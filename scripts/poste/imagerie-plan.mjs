// Plan de la mosaïque hors ligne : les tuiles z/x/y qui couvrent les zones demandées, sans doublon,
// et ce qu'elles coûtent sur le compte Copernicus. Aucun réseau ici : de la géométrie de tuiles.

/** Une requête de 256 × 256 px sur trois bandes : (256 × 256) / (512 × 512) unité de traitement. */
export const UNITES_PAR_TUILE = 0.25;

/**
 * « S,N,O,E » en degrés décimaux → zone. Lève une erreur qui dit quoi corriger.
 * @param {string} texte
 * @returns {{ s: number, n: number, o: number, e: number }}
 */
export function lireZone(texte) {
  const v = String(texte)
    .split(",")
    .map((x) => x.trim());
  if (v.length !== 4 || v.some((x) => !/^-?\d+(\.\d+)?$/.test(x))) {
    throw new Error(
      `zone « ${texte} » : quatre nombres S,N,O,E attendus (ex. 11.6,12.7,14.5,15.6)`,
    );
  }
  const [s, n, o, e] = v.map(Number);
  if (!(s < n && o < e)) throw new Error(`zone « ${texte} » : S < N et O < E attendus`);
  if (s < -85 || n > 85 || o < -180 || e > 180) {
    throw new Error(`zone « ${texte} » : hors de la carte (latitudes ±85, longitudes ±180)`);
  }
  return { s, n, o, e };
}

/** Colonne de la tuile qui contient la longitude, au zoom z. */
export function xDeLon(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

/** Rangée de la tuile qui contient la latitude, au zoom z (Web Mercator). */
export function yDeLat(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/**
 * Tuiles qui couvrent une zone au zoom z.
 * @param {{ s: number, n: number, o: number, e: number }} zone
 * @param {number} z
 */
export function tuilesDeZone(zone, z) {
  const borne = (v) => Math.min(Math.max(v, 0), 2 ** z - 1);
  const x0 = borne(xDeLon(zone.o, z));
  const x1 = borne(xDeLon(zone.e, z));
  const y0 = borne(yDeLat(zone.n, z));
  const y1 = borne(yDeLat(zone.s, z));
  const tuiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tuiles.push({ z, x, y });
  return tuiles;
}

/**
 * Toutes les tuiles des zones, de zmin à zmax, sans doublon (deux zones qui se chevauchent ne
 * demandent pas deux fois la même tuile), du zoom le plus large au plus fin.
 * @param {{ s: number, n: number, o: number, e: number }[]} zones
 * @param {number} zmin
 * @param {number} zmax
 */
export function planMosaique(zones, zmin, zmax) {
  const vues = new Map();
  for (let z = zmin; z <= zmax; z++) {
    for (const zone of zones) {
      for (const t of tuilesDeZone(zone, z)) vues.set(`${t.z}/${t.x}/${t.y}`, t);
    }
  }
  return [...vues.values()].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}
