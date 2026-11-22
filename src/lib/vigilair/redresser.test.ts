import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coinsDepuisDrone, refusCoins, type Coins, type PointGeo } from "./drones-fond.ts";
import { redresser, redressement, type Pixels, type Redressement } from "./redresser.ts";

// Web Mercator refait ici, à part du module : x vers l'est, y vers le sud, de 0 à 1.
const mx = (lon: number) => (lon + 180) / 360;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
type P = [number, number];
const merc = (p: PointGeo): P => [mx(p.lon), my(p.lat)];
/** Le point commun des droites (a, b) et (c, d). */
function croisement(a: P, b: P, c: P, d: P): P {
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
const vers = (a: P, b: P, f: number): P => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/**
 * La perspective qui porte quatre points sur quatre autres, trouvée à part du module : par le système
 * linéaire de ses huit coefficients, résolu par pivot de Gauss.
 */
function perspectiveDe(de: readonly P[], sur: readonly P[]): (x: number, y: number) => P {
  const A: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = de[k]!;
    const [u, v] = sur[k]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let l = c + 1; l < 8; l++) if (Math.abs(A[l]![c]!) > Math.abs(A[p]![c]!)) p = l;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const pivot = A[c]!;
    for (let l = 0; l < 8; l++) {
      if (l === c) continue;
      const ligne = A[l]!;
      const f = ligne[c]! / pivot[c]!;
      for (let k = c; k < 9; k++) ligne[k] = ligne[k]! - f * pivot[k]!;
    }
  }
  const h = A.map((ligne, i) => ligne[8]! / ligne[i]!);
  return (x, y) => {
    const w = h[6]! * x + h[7]! * y + 1;
    return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
  };
}

/** Une mire : chaque pixel dit où il est (rouge = colonne, vert = rangée), opaque. */
function mire(largeur: number, hauteur: number): Pixels {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const o = (y * largeur + x) * 4;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = 255;
      data[o + 3] = 255;
    }
  }
  return { largeur, hauteur, data };
}

/** Ce que porte l'image redressée en ce point de la carte (Mercator) : le point de l'image lu dans la mire, et son opacité. */
function lire(r: Redressement, out: Pixels, p: P): { x: number; y: number; a: number } {
  const [o, n] = merc(r.coins[0]);
  const [e, s] = merc(r.coins[2]);
  const i = Math.floor(((p[0] - o) / (e - o)) * r.largeur);
  const j = Math.floor(((p[1] - n) / (s - n)) * r.hauteur);
  const k = (j * r.largeur + i) * 4;
  // Le centre d'un pixel de la mire est en (n + 0,5).
  return { x: out.data[k]! + 0.5, y: out.data[k + 1]! + 0.5, a: out.data[k + 3]! };
}

// Ce que voit une caméra sur un mât : le loin (haut de l'image, au nord) large, le près étroit.
const TRAPEZE: Coins = [
  { lat: 12.138, lon: 15.05 },
  { lat: 12.138, lon: 15.056 },
  { lat: 12.135, lon: 15.0545 },
  { lat: 12.135, lon: 15.0515 },
];
/** Le même, réduit autour de son premier coin (f = 0,05 : une quinzaine de mètres). */
const reduit = (f: number): Coins =>
  TRAPEZE.map((c) => ({
    lat: TRAPEZE[0].lat + (c.lat - TRAPEZE[0].lat) * f,
    lon: TRAPEZE[0].lon + (c.lon - TRAPEZE[0].lon) * f,
  })) as Coins;
// Une caméra qui regarde de travers : aucun côté parallèle ni d'aplomb, le premier coin ni le plus
// au nord ni le plus à l'ouest (le trapèze, trop régulier, annule des termes entiers du calcul).
const QUELCONQUE: Coins = [
  { lat: 12.1384, lon: 15.0503 },
  { lat: 12.1391, lon: 15.0569 },
  { lat: 12.1352, lon: 15.0551 },
  { lat: 12.1359, lon: 15.0497 },
];

describe("redressement : quand MapLibre suffit, et sinon où redresser", () => {
  it("une image cadrée nord en haut se pose telle quelle", () => {
    const rect: Coins = [
      { lat: 12.138, lon: 15.05 },
      { lat: 12.138, lon: 15.056 },
      { lat: 12.135, lon: 15.056 },
      { lat: 12.135, lon: 15.05 },
    ];
    assert.equal(redressement(rect, 1920, 1080), null);
  });

  it("l'emprise d'un drone (caméra à la verticale, cap quelconque) se pose telle quelle", () => {
    for (const cap of [0, 37, 128, 301]) {
      const coins = coinsDepuisDrone({ lat: 12.134, lon: 15.068, hauteurM: 60, cap }, 70, 9 / 16)!;
      assert.equal(redressement(coins, 1920, 1080), null, `cap ${cap}`);
    }
  });

  it("le seuil est un demi-pixel de l'image : en deçà, posée telle quelle ; au-delà, redressée", () => {
    // Le côté près réduit de 2 × 0,003 δ degrés : le demi-pixel tombe à δ ≈ 0,0018 (mesuré).
    const presque = (d: number): Coins => [
      { lat: 12.138, lon: 15.05 },
      { lat: 12.138, lon: 15.056 },
      { lat: 12.135, lon: 15.056 - 0.003 * d },
      { lat: 12.135, lon: 15.05 + 0.003 * d },
    ];
    assert.equal(redressement(presque(0.001), 1000, 500), null);
    assert.ok(redressement(presque(0.003), 1000, 500));
    // Le même écart en degrés pèse moins sur une image moins fine.
    assert.equal(redressement(presque(0.003), 300, 150), null);
    // Tourné d'un quart (caméra qui regarde vers l'est) : l'écart est alors surtout nord-sud.
    const tourne = (d: number): Coins => [
      { lat: 12.141, lon: 15.05 },
      { lat: 12.141 - 0.003 * d, lon: 15.053 },
      { lat: 12.135 + 0.003 * d, lon: 15.053 },
      { lat: 12.135, lon: 15.05 },
    ];
    assert.equal(redressement(tourne(0.001), 500, 1000), null);
    assert.ok(redressement(tourne(0.003), 500, 1000));
  });

  it("un trapèze se redresse dans le rectangle qui l'englobe, nord en haut, à la finesse de l'image", () => {
    const r = redressement(TRAPEZE, 200, 100)!;
    assert.ok(r);
    const [hg, hd, bd, bg] = r.coins;
    assert.equal(hg.lat, hd.lat);
    assert.equal(bg.lat, bd.lat);
    assert.equal(hg.lon, bg.lon);
    assert.equal(hd.lon, bd.lon);
    // Collé au trapèze à l'ouest et au nord ; à l'est et au sud, à moins d'un pixel (arrondi au pixel entier).
    assert.ok(Math.abs(hg.lon - 15.05) < 1e-9);
    assert.ok(Math.abs(hg.lat - 12.138) < 1e-9);
    const pxLon = (hd.lon - hg.lon) / r.largeur;
    const pxLat = (hg.lat - bg.lat) / r.hauteur;
    assert.ok(hd.lon >= 15.056 && hd.lon - 15.056 < pxLon);
    assert.ok(bg.lat <= 12.135 && 12.135 - bg.lat < pxLat);
    // Le rectangle couvre 4/3 du trapèze : autant de pixels en plus, à l'arrondi près.
    const n = r.largeur * r.hauteur;
    assert.ok(Math.abs(n - (200 * 100 * 4) / 3) < 0.02 * n, `${r.largeur} × ${r.hauteur}`);
  });

  it("une image très fine est réduite à 2 Mpx environ", () => {
    const r = redressement(TRAPEZE, 8000, 6000)!;
    const n = r.largeur * r.hauteur;
    assert.ok(n <= 2_000_000 * 1.005 && n > 1_990_000, `${r.largeur} × ${r.hauteur}`);
  });
});

describe("redresser : chaque point de l'image tombe où la perspective le met", () => {
  it("au pixel près, sur tout le rectangle : la perspective calculée à part, la mire lue pixel par pixel", () => {
    assert.equal(refusCoins(QUELCONQUE), null);
    for (const coins of [TRAPEZE, reduit(0.05), QUELCONQUE]) {
      const r = redressement(coins, 200, 100)!;
      const out = redresser(mire(200, 100), r);
      const [o, n] = merc(r.coins[0]);
      const [e, s] = merc(r.coins[2]);
      // Les coins posés, en pixels du rectangle redressé.
      const dans = coins.map((c): P => {
        const [x, y] = merc(c);
        return [((x - o) / (e - o)) * r.largeur, ((y - n) / (s - n)) * r.hauteur];
      });
      const versImage = perspectiveDe(dans, [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
      ]);
      let pleins = 0;
      let pire = 0;
      for (let j = 0; j < r.hauteur; j++) {
        for (let i = 0; i < r.largeur; i++) {
          const [u, v] = versImage(i + 0.5, j + 0.5);
          const k = (j * r.largeur + i) * 4;
          const m = 1e-6;
          if (u > m && u < 200 - m && v > m && v < 100 - m) {
            pleins++;
            assert.equal(
              out.data[k + 3],
              255,
              `pixel ${i}, ${j} : dans l'image, il doit être plein`,
            );
            // Une couleur se range à l'entier près : ± 0,5 pixel au plus.
            pire = Math.max(
              pire,
              Math.abs(out.data[k]! + 0.5 - u),
              Math.abs(out.data[k + 1]! + 0.5 - v),
            );
          } else if (u < -m || u > 200 + m || v < -m || v > 100 + m) {
            assert.equal(
              out.data[k + 3],
              0,
              `pixel ${i}, ${j} : hors de l'image, il doit être vide`,
            );
          }
        }
      }
      assert.ok(pire <= 0.51, `écart ${pire} pixel`);
      // À la finesse de l'image : autant de pixels pleins qu'elle en a.
      assert.ok(Math.abs(pleins - 200 * 100) < 0.02 * 200 * 100, `${pleins} pleins`);
    }
  });

  for (const [nom, coins] of [
    ["sur 300 m", TRAPEZE],
    ["sur 15 m", reduit(0.05)],
    ["de travers", QUELCONQUE],
  ] as const) {
    it(`${nom} : le centre de l'image tombe à la croisée des diagonales, pas au milieu de la diagonale de MapLibre`, () => {
      const r = redressement(coins, 200, 100)!;
      const out = redresser(mire(200, 100), r);
      const [p0, p1, p2, p3] = coins.map(merc);
      const centre = lire(r, out, croisement(p0!, p2!, p1!, p3!));
      assert.ok(Math.hypot(centre.x - 100, centre.y - 50) < 1.2, JSON.stringify(centre));
      assert.equal(centre.a, 255);
      // Là où deux triangles plats mettraient le centre : un autre point de l'image.
      const plat = lire(r, out, vers(p1!, p3!, 0.5));
      assert.ok(Math.hypot(plat.x - 100, plat.y - 50) > 5, JSON.stringify(plat));
    });
  }

  it("le milieu des bords haut et bas tombe sur la droite du point de fuite au centre", () => {
    const r = redressement(TRAPEZE, 200, 100)!;
    const out = redresser(mire(200, 100), r);
    const [p0, p1, p2, p3] = TRAPEZE.map(merc);
    const fuite = croisement(p0!, p3!, p1!, p2!);
    const centre = croisement(p0!, p2!, p1!, p3!);
    const haut = croisement(fuite, centre, p0!, p1!);
    const bas = croisement(fuite, centre, p3!, p2!);
    // Juste en dedans des bords (2 % vers le centre).
    const h = lire(r, out, vers(haut, centre, 0.02));
    const b = lire(r, out, vers(bas, centre, 0.02));
    assert.ok(Math.abs(h.x - 100) < 1.2 && h.y < 4, JSON.stringify(h));
    assert.ok(Math.abs(b.x - 100) < 1.2 && b.y > 96, JSON.stringify(b));
  });

  it("chaque coin de l'image tombe sur le coin posé", () => {
    const r = redressement(TRAPEZE, 200, 100)!;
    const out = redresser(mire(200, 100), r);
    const q = TRAPEZE.map(merc);
    const centre = croisement(q[0]!, q[2]!, q[1]!, q[3]!);
    const attendu = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ];
    for (let i = 0; i < 4; i++) {
      const l = lire(r, out, vers(q[i]!, centre, 0.03));
      assert.ok(Math.abs(l.x - attendu[i]![0]!) < 8, `coin ${i} : ${JSON.stringify(l)}`);
      assert.ok(Math.abs(l.y - attendu[i]![1]!) < 5, `coin ${i} : ${JSON.stringify(l)}`);
      assert.equal(l.a, 255);
    }
  });

  it("hors de l'image, le rectangle reste transparent", () => {
    const r = redressement(TRAPEZE, 200, 100)!;
    const out = redresser(mire(200, 100), r);
    // Les coins sud du rectangle : à côté du côté près, plus étroit.
    const [o, n] = merc(r.coins[0]);
    const [e, s] = merc(r.coins[2]);
    for (const p of [
      [o + (e - o) * 0.01, n + (s - n) * 0.99],
      [o + (e - o) * 0.99, n + (s - n) * 0.99],
    ] as P[]) {
      assert.equal(lire(r, out, p).a, 0);
    }
    let vides = 0;
    for (let k = 3; k < out.data.length; k += 4) if (out.data[k] === 0) vides++;
    // Le trapèze couvre 3/4 du rectangle.
    assert.ok(Math.abs(vides / (out.data.length / 4) - 0.25) < 0.02, String(vides));
  });

  it("la couleur est celle de ses quatre voisins, pondérés par la distance (bilinéaire)", () => {
    // Un damier d'un pixel, noir et blanc, sur une vue de travers : chaque pixel redressé doit valoir
    // la moyenne pondérée des quatre pixels du damier autour du point que donne la perspective.
    const W = 200;
    const H = 100;
    const damier = mire(W, H);
    const case_ = (x: number, y: number) => ((x + y) % 2 ? 255 : 0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) damier.data[(y * W + x) * 4] = case_(x, y);
    const r = redressement(QUELCONQUE, W, H)!;
    const out = redresser(damier, r);
    const [o, n] = merc(r.coins[0]);
    const [e, s] = merc(r.coins[2]);
    const dans = QUELCONQUE.map((c): P => {
      const [x, y] = merc(c);
      return [((x - o) / (e - o)) * r.largeur, ((y - n) / (s - n)) * r.hauteur];
    });
    const versImage = perspectiveDe(dans, [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ]);
    let vus = 0;
    let gris = 0;
    for (let j = 0; j < r.hauteur; j++) {
      for (let i = 0; i < r.largeur; i++) {
        const [u, v] = versImage(i + 0.5, j + 0.5);
        // Loin des bords : les quatre voisins sont dans l'image.
        if (!(u > 0.5 && u < W - 0.5 && v > 0.5 && v < H - 0.5)) continue;
        const x0 = Math.floor(u - 0.5);
        const y0 = Math.floor(v - 0.5);
        const fx = u - 0.5 - x0;
        const fy = v - 0.5 - y0;
        const attendu =
          case_(x0, y0) * (1 - fx) * (1 - fy) +
          case_(x0 + 1, y0) * fx * (1 - fy) +
          case_(x0, y0 + 1) * (1 - fx) * fy +
          case_(x0 + 1, y0 + 1) * fx * fy;
        const lu = out.data[(j * r.largeur + i) * 4]!;
        assert.ok(Math.abs(lu - attendu) <= 1, `pixel ${i}, ${j} : ${lu} au lieu de ${attendu}`);
        vus++;
        if (lu > 20 && lu < 235) gris++;
      }
    }
    assert.ok(vus > 10_000, String(vus));
    // Au plus proche, il n'y aurait que du noir et du blanc.
    assert.ok(gris > 0.5 * vus, `${gris} gris sur ${vus}`);
  });
});
