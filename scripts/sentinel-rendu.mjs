// Ce que le poste demande à l'API Process de Copernicus (Sentinel Hub) pour une image Sentinel-2.
// Partagé par la console (src/lib/vigilair/sentinelhub.server.ts) et par le script qui construit
// la mosaïque hors ligne (scripts/poste/imagerie-poste.mjs) : les deux envoient la même requête et
// rendent la même image. JavaScript simple pour que le script tourne avec Node seul.

/** Compte gratuit Copernicus Data Space Ecosystem : jeton OAuth, puis API Process. */
export const CDSE_JETON =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
export const CDSE_PROCESS = "https://sh.dataspace.copernicus.eu/api/v1/process";

const ORIGINE_3857 = 20037508.342789244;

/**
 * Vraies couleurs Sentinel-2 L2A : le script « true color » de référence de Sentinel Hub (gain 2,5
 * sur B04, B03, B02), sans la bande d'opacité (le JPEG n'en a pas). Les valeurs rendues vont de 0 à
 * 1 : en mode de sortie AUTO, Sentinel Hub les étire vers 0–255 et ramène à 255 tout ce qui dépasse
 * 1. L'ancien script de la console rendait Math.round(v × 255), soit déjà 0–255 : presque chaque
 * pixel dépassait 1 et l'image sortait blanche.
 */
export const RENDU_VRAIES_COULEURS = `//VERSION=3
function setup(){return {input:["B02","B03","B04"],output:{bands:3}};}
function evaluatePixel(s){return [2.5*s.B04,2.5*s.B03,2.5*s.B02];}`;

/**
 * Emprise d'une tuile z/x/y en mètres Web Mercator (EPSG:3857) : [minX, minY, maxX, maxY].
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {[number, number, number, number]}
 */
export function tuile3857(z, x, y) {
  const cote = (2 * ORIGINE_3857) / 2 ** z;
  const minX = -ORIGINE_3857 + x * cote;
  const maxY = ORIGINE_3857 - y * cote;
  return [minX, maxY - cote, minX + cote, maxY];
}

/**
 * Corps d'une requête Process : composite « moins nuageux » Sentinel-2 L2A sur la fenêtre de dates,
 * pour une emprise 3857, rendu en vraies couleurs. Rien n'est ajouté à l'image : trois bandes réelles.
 * @param {{ bbox: number[], largeur: number, hauteur: number, du: Date, au: Date, nuagesMax: number, format: "image/png" | "image/jpeg" }} p
 */
export function corpsProcess(p) {
  return {
    input: {
      bounds: { bbox: p.bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" } },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: p.du.toISOString(), to: p.au.toISOString() },
            maxCloudCoverage: p.nuagesMax,
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    output: {
      width: p.largeur,
      height: p.hauteur,
      responses: [{ identifier: "default", format: { type: p.format } }],
    },
    evalscript: RENDU_VRAIES_COULEURS,
  };
}
