import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  affineTriangle,
  coinsDepuisDrone,
  lireCalage,
  refusCoins,
  versQuadrilatere,
  type Coins,
  type Point2,
} from "./drones-fond.ts";
import { haversineKm } from "./geo.ts";

/** Un carré de 200 m de côté près de FTTJ, pris dans l'ordre de l'image. */
const CARRE: Coins = [
  { lat: 12.136, lon: 15.054 },
  { lat: 12.136, lon: 15.05584 },
  { lat: 12.13419, lon: 15.05584 },
  { lat: 12.13419, lon: 15.054 },
];
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
// Distances au sol : à 1 % près (la carte et la mesure n'ont pas tout à fait le même rayon de Terre).
const proche = (vu: number, attendu: number, tolerance: number) =>
  assert.ok(Math.abs(vu - attendu) <= tolerance, `${vu} au lieu de ${attendu} (± ${tolerance})`);

describe("fond de carte : quatre coins posés à la main", () => {
  it("un quadrilatère convexe pris dans l'ordre est accepté, dans un sens comme dans l'autre", () => {
    assert.equal(refusCoins(CARRE), null);
    assert.equal(refusCoins([CARRE[3], CARRE[2], CARRE[1], CARRE[0]]), null);
    // Une image vue de biais : un trapèze reste convexe.
    assert.equal(
      refusCoins([
        CARRE[0],
        CARRE[1],
        { lat: 12.1335, lon: 15.057 },
        { lat: 12.1335, lon: 15.053 },
      ]),
      null,
    );
  });

  it("coins croisés, confondus, alignés, illisibles, trop loin, ou pas quatre : refusés avec la raison", () => {
    assert.match(refusCoins([CARRE[0], CARRE[2], CARRE[1], CARRE[3]])!, /croisés/);
    assert.match(refusCoins([CARRE[0], CARRE[0], CARRE[2], CARRE[3]])!, /confondus ou alignés/);
    assert.match(
      refusCoins([CARRE[0], { lat: 12.136, lon: 15.055 }, CARRE[1], CARRE[2]])!,
      /confondus ou alignés/,
    );
    assert.match(refusCoins([CARRE[0], CARRE[1], CARRE[2]])!, /quatre coins/);
    assert.match(refusCoins([CARRE[0], CARRE[1], CARRE[2], { lat: 91, lon: 15 }])!, /illisible/);
    assert.match(refusCoins([CARRE[0], CARRE[1], CARRE[2], { lat: 12, lon: 181 }])!, /illisible/);
    assert.match(
      refusCoins([CARRE[0], CARRE[1], CARRE[2], { lat: Number.NaN, lon: 15 }])!,
      /illisible/,
    );
    assert.match(
      refusCoins([CARRE[0], CARRE[1], CARRE[2], { lat: "12", lon: 15 } as never])!,
      /illisible/,
    );
    // Reçu de la console : un coin nul est refusé, pas une erreur.
    assert.match(refusCoins([CARRE[0], CARRE[1], CARRE[2], null as never])!, /illisible/);
    assert.match(refusCoins([CARRE[0], CARRE[1], CARRE[2], { lat: 12 } as never])!, /illisible/);
    // 0,2° de latitude : 22 km.
    assert.match(
      refusCoins([
        { lat: 12.3, lon: 15.05 },
        { lat: 12.3, lon: 15.06 },
        { lat: 12.1, lon: 15.06 },
        { lat: 12.1, lon: 15.05 },
      ])!,
      /plus de 20 km/,
    );
  });

  it("un calage reçu est rendu propre : rien d'autre que le mode et ses valeurs", () => {
    assert.deepEqual(
      lireCalage({ mode: "coins", coins: CARRE.map((c) => ({ ...c, autre: 1 })), x: 2 }),
      { mode: "coins", coins: CARRE },
    );
    assert.deepEqual(lireCalage({ mode: "drone", champDeg: 84, coins: CARRE }), {
      mode: "drone",
      champDeg: 84,
    });
    assert.deepEqual(lireCalage({ mode: "drone", champDeg: 10 }), { mode: "drone", champDeg: 10 });
    assert.deepEqual(lireCalage({ mode: "drone", champDeg: 150 }), {
      mode: "drone",
      champDeg: 150,
    });
  });

  it("champ hors bornes ou illisible, coins refusés, mode inconnu : une erreur dite", () => {
    for (const champDeg of [9.9, 150.1, Number.NaN, "70", undefined]) {
      assert.match(
        (lireCalage({ mode: "drone", champDeg }) as { erreur: string }).erreur,
        /champ de la caméra hors bornes \(10 à 150°\)/,
      );
    }
    assert.match(
      (
        lireCalage({ mode: "coins", coins: [CARRE[0], CARRE[2], CARRE[1], CARRE[3]] }) as {
          erreur: string;
        }
      ).erreur,
      /croisés/,
    );
    assert.match((lireCalage({ mode: "coins" }) as { erreur: string }).erreur, /quatre coins/);
    for (const brut of [null, undefined, "coins", {}, { mode: "satellite" }]) {
      assert.match((lireCalage(brut) as { erreur: string }).erreur, /calage inconnu/);
    }
  });
});

describe("fond de carte : emprise calculée depuis le drone (caméra à la verticale)", () => {
  const DRONE = { lat: 12.1348, lon: 15.0557, hauteurM: 100, cap: 0 };

  it("à 100 m, champ de 90° : 200 m de large ; image 4/3 : 150 m de haut ; le haut vers le cap (nord)", () => {
    const c = coinsDepuisDrone(DRONE, 90, 0.75)!;
    proche(metres(c[0], c[1]), 200, 2);
    proche(metres(c[1], c[2]), 150, 1.5);
    proche(metres(c[2], c[3]), 200, 2);
    // Haut-gauche : au nord-ouest du drone. Bas-droit : au sud-est.
    assert.ok(c[0].lat > DRONE.lat && c[0].lon < DRONE.lon);
    assert.ok(c[1].lat > DRONE.lat && c[1].lon > DRONE.lon);
    assert.ok(c[2].lat < DRONE.lat && c[2].lon > DRONE.lon);
    assert.ok(c[3].lat < DRONE.lat && c[3].lon < DRONE.lon);
    // Le drone est au centre.
    proche((c[0].lat + c[2].lat) / 2, DRONE.lat, 1e-9);
    proche((c[0].lon + c[2].lon) / 2, DRONE.lon, 1e-9);
    assert.equal(refusCoins(c), null);
  });

  it("cap à l'est : le haut de l'image part vers l'est, sa gauche est au nord", () => {
    const c = coinsDepuisDrone({ ...DRONE, cap: 90 }, 90, 0.75)!;
    // Haut-gauche : à l'est (75 m devant) et au nord (100 m à gauche).
    proche(metres({ lat: DRONE.lat, lon: c[0].lon }, DRONE), 75, 0.75);
    proche(metres({ lat: c[0].lat, lon: DRONE.lon }, DRONE), 100, 1);
    assert.ok(c[0].lon > DRONE.lon && c[0].lat > DRONE.lat);
    // Haut-droit : à l'est et au sud.
    assert.ok(c[1].lon > DRONE.lon && c[1].lat < DRONE.lat);
    // Bas : à l'ouest.
    assert.ok(c[2].lon < DRONE.lon && c[3].lon < DRONE.lon);
  });

  it("la largeur suit la hauteur et le champ : 50 m et 60° donnent 57,7 m", () => {
    const c = coinsDepuisDrone({ ...DRONE, hauteurM: 50, cap: 217 }, 60, 1)!;
    proche(metres(c[0], c[1]), 2 * 50 * Math.tan(Math.PI / 6), 0.6);
    proche(metres(c[1], c[2]), 2 * 50 * Math.tan(Math.PI / 6), 0.6);
  });

  it("sans cap, au sol (moins de 2 m), ou sans rapport d'image : pas d'emprise", () => {
    assert.equal(coinsDepuisDrone({ ...DRONE, cap: null }, 90, 0.75), null);
    assert.equal(coinsDepuisDrone({ ...DRONE, hauteurM: 1.9 }, 90, 0.75), null);
    assert.notEqual(coinsDepuisDrone({ ...DRONE, hauteurM: 2 }, 90, 0.75), null);
    assert.equal(coinsDepuisDrone(DRONE, 90, 0), null);
    assert.equal(coinsDepuisDrone(DRONE, 90, Number.NaN), null);
  });
});

describe("fond de carte : tendre l'image entre ses quatre coins", () => {
  const TRAPEZE: [Point2, Point2, Point2, Point2] = [
    [100, 50],
    [300, 60],
    [380, 240],
    [40, 220],
  ];

  it("les coins de l'image tombent sur les coins donnés", () => {
    const f = versQuadrilatere(TRAPEZE);
    const vers = [f(0, 0), f(1, 0), f(1, 1), f(0, 1)];
    vers.forEach(([x, y], i) => {
      proche(x, TRAPEZE[i]![0], 1e-9);
      proche(y, TRAPEZE[i]![1], 1e-9);
    });
  });

  it("vue en perspective : le centre de l'image tombe au croisement des diagonales, pas à la moyenne", () => {
    const [x, y] = versQuadrilatere(TRAPEZE)(0.5, 0.5);
    // Croisement de (100,50)–(380,240) et (300,60)–(40,220), calculé à part.
    const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = TRAPEZE;
    const t =
      ((bx - ax) * (dy - by) - (by - ay) * (dx - bx)) /
      ((cx - ax) * (dy - by) - (cy - ay) * (dx - bx));
    proche(x, ax + t * (cx - ax), 1e-9);
    proche(y, ay + t * (cy - ay), 1e-9);
    assert.ok(Math.abs(x - (ax + bx + cx + dx) / 4) > 1);
  });

  it("une droite de l'image reste une droite à l'écran", () => {
    const f = versQuadrilatere(TRAPEZE);
    const [a, b, c] = [f(0.1, 0.8), f(0.4, 0.5), f(0.9, 0)];
    proche((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), 0, 1e-6);
  });

  it("un parallélogramme : la transformation est affine, le centre tombe à la moyenne", () => {
    const [x, y] = versQuadrilatere([
      [10, 10],
      [110, 30],
      [140, 130],
      [40, 110],
    ])(0.5, 0.5);
    proche(x, 75, 1e-9);
    proche(y, 70, 1e-9);
  });

  it("le triangle de l'image est porté sur celui de l'écran", () => {
    const s: [Point2, Point2, Point2] = [
      [0, 0],
      [640, 0],
      [0, 480],
    ];
    const t: [Point2, Point2, Point2] = [
      [100, 50],
      [300, 60],
      [40, 220],
    ];
    const [a, b, c, d, e, f] = affineTriangle(s, t);
    s.forEach(([x, y], i) => {
      proche(a * x + c * y + e, t[i]![0], 1e-9);
      proche(b * x + d * y + f, t[i]![1], 1e-9);
    });
    // Un triangle quelconque, sans sommet à l'origine.
    const s2: [Point2, Point2, Point2] = [
      [80, 60],
      [160, 60],
      [160, 120],
    ];
    const m = affineTriangle(s2, t);
    s2.forEach(([x, y], i) => {
      proche(m[0] * x + m[2] * y + m[4], t[i]![0], 1e-9);
      proche(m[1] * x + m[3] * y + m[5], t[i]![1], 1e-9);
    });
  });
});
