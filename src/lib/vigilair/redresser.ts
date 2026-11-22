/**
 * L'image d'une caméra qui regarde le sol de biais, posée sur la carte. MapLibre tend une image entre
 * ses quatre coins sur deux triangles plats, de part et d'autre de la diagonale haut-droit → bas-gauche :
 * c'est juste pour un parallélogramme (l'emprise d'une caméra à la verticale, une image cadrée nord en
 * haut), faux pour un trapèze — ce que voit une caméra de site posée sur un mât — : l'image s'y casse
 * le long de la diagonale et ses lignes droites s'y plient. Le poste redresse alors l'image lui-même,
 * en perspective, dans le rectangle qui l'englobe ; MapLibre n'a plus qu'à poser un rectangle, ce
 * qu'il fait exactement. Rien ici ne regarde ce que montre l'image : on la met à sa place, c'est tout.
 */
import type { Coins } from "./drones-fond.ts";

type P2 = readonly [number, number];
type Quad = readonly [P2, P2, P2, P2];
/** Une perspective du plan : matrice 3 × 3 rangée par lignes. */
type Perspective = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Des pixels RVBA rangée par rangée, comme ceux d'un canevas (ImageData). */
export type Pixels = { largeur: number; hauteur: number; data: Uint8ClampedArray<ArrayBuffer> };

/** Au-delà, l'image redressée est réduite : c'est un fond de carte, et il se refait à chaque image. */
const PIXELS_MAX = 2_000_000;
/** Sous cet écart (en pixels de l'image), les deux triangles de MapLibre suffisent. */
const ECART_TOLERE_PX = 0.5;

// Web Mercator, comme MapLibre : x de 0 à 1 vers l'est, y de 0 à 1 vers le sud.
const versX = (lon: number): number => (lon + 180) / 360;
function versY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
const lonDe = (x: number): number => x * 360 - 180;
const latDe = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * La perspective qui porte le carré unité (u, v de 0 à 1, origine en haut à gauche) sur le
 * quadrilatère q, pris dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche.
 */
function carreVers(q: Quad): Perspective {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  // Un parallélogramme (sx = sy = 0) donne g = h = 0 : la perspective est alors affine.
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/** La perspective inverse (sa comatrice : l'échelle ne compte pas en perspective). */
function inverse(m: Perspective): Perspective {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}

function appliquer(m: Perspective, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/**
 * Où MapLibre met le point (u, v) de l'image tendue sur q : deux triangles plats, haut-droit,
 * haut-gauche, bas-gauche d'une part ; haut-droit, bas-gauche, bas-droit de l'autre.
 */
function deuxTriangles(q: Quad, u: number, v: number): [number, number] {
  const [p0, p1, p2, p3] = q;
  if (u + v <= 1) {
    return [
      p0[0] + u * (p1[0] - p0[0]) + v * (p3[0] - p0[0]),
      p0[1] + u * (p1[1] - p0[1]) + v * (p3[1] - p0[1]),
    ];
  }
  return [
    p2[0] + (1 - u) * (p3[0] - p2[0]) + (1 - v) * (p1[0] - p2[0]),
    p2[1] + (1 - u) * (p3[1] - p2[1]) + (1 - v) * (p1[1] - p2[1]),
  ];
}

export type Redressement = {
  /** Le rectangle, nord en haut, où poser l'image redressée (haut-gauche, haut-droit, bas-droit, bas-gauche). */
  coins: Coins;
  largeur: number;
  hauteur: number;
  /** Du point (x, y) du rectangle, en pixels, au point de l'image d'origine qui y tombe. */
  versImage: Perspective;
};

/**
 * Comment poser une image de `largeur` × `hauteur` pixels entre ces coins. null : MapLibre la pose
 * juste telle quelle (ses deux triangles s'écartent de la perspective de moins d'un demi-pixel).
 * Sinon, le rectangle où la redresser, à la finesse moyenne de l'image (2 Mpx environ, au plus).
 */
export function redressement(coins: Coins, largeur: number, hauteur: number): Redressement | null {
  const m = coins.map((c) => [versX(c.lon), versY(c.lat)] as const);
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = m as unknown as Quad;
  // L'aire d'un quadrilatère : la moitié du produit en croix de ses diagonales.
  const aire = Math.abs((x2 - x0) * (y3 - y1) - (x3 - x1) * (y2 - y0)) / 2;
  // Le côté d'un pixel de l'image posée, en Mercator ; le quadrilatère compté en ces pixels.
  const pixel = Math.sqrt(aire / (largeur * hauteur));
  const q = m.map(([x, y]) => [x / pixel, y / pixel] as const) as unknown as Quad;
  const vue = carreVers(q);
  let ecart = 0;
  for (let i = 1; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const [px, py] = appliquer(vue, i / 8, j / 8);
      const [tx, ty] = deuxTriangles(q, i / 8, j / 8);
      ecart = Math.max(ecart, Math.hypot(px - tx, py - ty));
    }
  }
  if (!(ecart >= ECART_TOLERE_PX)) return null;
  const xs = m.map((p) => p[0]);
  const ys = m.map((p) => p[1]);
  const ouest = Math.min(...xs);
  const nord = Math.min(...ys);
  const etendueX = Math.max(...xs) - ouest;
  const etendueY = Math.max(...ys) - nord;
  // Pixels du rectangle par unité de Mercator : la finesse moyenne de l'image, bornée.
  const k = Math.min(1 / pixel, Math.sqrt(PIXELS_MAX / (etendueX * etendueY)));
  const L = Math.max(1, Math.ceil(etendueX * k));
  const H = Math.max(1, Math.ceil(etendueY * k));
  const est = ouest + L / k;
  const sud = nord + H / k;
  const dans = m.map(([x, y]) => [(x - ouest) * k, (y - nord) * k] as const) as unknown as Quad;
  const [a, b, c, d, e, f, g, h, i] = inverse(carreVers(dans));
  return {
    coins: [
      { lat: latDe(nord), lon: lonDe(ouest) },
      { lat: latDe(nord), lon: lonDe(est) },
      { lat: latDe(sud), lon: lonDe(est) },
      { lat: latDe(sud), lon: lonDe(ouest) },
    ],
    largeur: L,
    hauteur: H,
    // Du carré unité aux pixels de l'image d'origine.
    versImage: [
      a * largeur,
      b * largeur,
      c * largeur,
      d * hauteur,
      e * hauteur,
      f * hauteur,
      g,
      h,
      i,
    ],
  };
}

/**
 * L'image redressée : chaque pixel du rectangle prend la couleur du point de l'image qui y tombe
 * (moyenne de ses quatre voisins) ; hors de l'image, il reste transparent.
 */
export function redresser(image: Pixels, r: Redressement): Pixels {
  const { largeur: W, hauteur: H, data: src } = image;
  const out = new Uint8ClampedArray(r.largeur * r.hauteur * 4);
  const [a, b, c, d, e, f, g, h, i] = r.versImage;
  for (let y = 0; y < r.hauteur; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < r.largeur; x++) {
      const cx = x + 0.5;
      const w = g * cx + h * cy + i;
      const sx = (a * cx + b * cy + c) / w;
      const sy = (d * cx + e * cy + f) / w;
      // Écrit ainsi, un point à l'infini (NaN) reste dehors.
      if (!(sx >= 0 && sx < W && sy >= 0 && sy < H)) continue;
      // Les quatre pixels voisins, centres en (n + 0.5), et leurs poids.
      const fx = sx - 0.5;
      const fy = sy - 0.5;
      const gx = Math.floor(fx);
      const gy = Math.floor(fy);
      const ax = fx - gx;
      const ay = fy - gy;
      const xa = Math.max(gx, 0);
      const xb = Math.min(gx + 1, W - 1);
      const ya = Math.max(gy, 0);
      const yb = Math.min(gy + 1, H - 1);
      const p00 = (ya * W + xa) * 4;
      const p10 = (ya * W + xb) * 4;
      const p01 = (yb * W + xa) * 4;
      const p11 = (yb * W + xb) * 4;
      const o = (y * r.largeur + x) * 4;
      for (let k = 0; k < 4; k++) {
        const haut = src[p00 + k]! + (src[p10 + k]! - src[p00 + k]!) * ax;
        const bas = src[p01 + k]! + (src[p11 + k]! - src[p01 + k]!) * ax;
        out[o + k] = haut + (bas - haut) * ay;
      }
    }
  }
  return { largeur: r.largeur, hauteur: r.hauteur, data: out };
}
