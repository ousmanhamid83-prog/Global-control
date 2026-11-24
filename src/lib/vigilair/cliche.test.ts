import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCliche, TUILE_PX } from "./cliche.ts";
import { latToTileY, lonToTileX } from "./geo.ts";

describe("le cliché d'une capture de drone : les tuiles autour de lui", () => {
  it("3 × 3 tuiles du zoom 14, la sienne au centre, rangées du nord-ouest au sud-est", () => {
    // MNSTR31, un MQ-9 réel (catégorie B6) au-dessus d'Akrotiri, le 24 novembre 2026.
    const p = planCliche(34.54, 33.01);
    const x = lonToTileX(33.01, 14);
    const y = latToTileY(34.54, 14);
    assert.equal(p.z, 14);
    assert.equal(p.cotePx, 3 * TUILE_PX);
    assert.deepEqual(
      p.tuiles.map((t) => [t.x - x, t.y - y, t.col, t.lig]),
      [
        [-1, -1, 0, 0],
        [0, -1, 1, 0],
        [1, -1, 2, 0],
        [-1, 0, 0, 1],
        [0, 0, 1, 1],
        [1, 0, 2, 1],
        [-1, 1, 0, 2],
        [0, 1, 1, 2],
        [1, 1, 2, 2],
      ],
    );
  });

  it("le drone tombe dans la tuile du centre, au pixel près de sa position", () => {
    const p = planCliche(34.54, 33.01);
    assert.ok(p.marque.px >= TUILE_PX && p.marque.px < 2 * TUILE_PX, String(p.marque.px));
    assert.ok(p.marque.py >= TUILE_PX && p.marque.py < 2 * TUILE_PX, String(p.marque.py));
    // 9,6 m par pixel à l'équateur (× cos 34,54° ici) : 0,01° plus à l'est, c'est 116 m plus loin.
    const est = planCliche(34.54, 33.02);
    const m = 111_195 * 0.01 * Math.cos((34.54 * Math.PI) / 180);
    const mParPx = (40_075_016.686 * Math.cos((34.54 * Math.PI) / 180)) / (2 ** 14 * TUILE_PX);
    const decale = est.marque.px - p.marque.px + (est.tuiles[0]!.x - p.tuiles[0]!.x) * TUILE_PX;
    assert.ok(Math.abs(decale - m / mParPx) < 0.5, `${decale} px pour ${(m / mParPx).toFixed(1)}`);
    // Au nord, la tuile du dessus a un y plus petit, et le drone remonte dans l'image.
    const nord = planCliche(34.55, 33.01);
    assert.ok(nord.marque.py + (nord.tuiles[0]!.y - p.tuiles[0]!.y) * TUILE_PX < p.marque.py);
  });

  it("à l'antiméridien, la tuile d'à côté est de l'autre côté du monde", () => {
    const p = planCliche(-17.5, 179.999);
    assert.deepEqual(
      p.tuiles.filter((t) => t.lig === 0).map((t) => t.x),
      [2 ** 14 - 2, 2 ** 14 - 1, 0],
    );
    const q = planCliche(-17.5, -179.999);
    assert.deepEqual(
      q.tuiles.filter((t) => t.lig === 0).map((t) => t.x),
      [2 ** 14 - 1, 0, 1],
    );
  });

  it("au-delà de 85° de latitude, la carte s'arrête : des tuiles qui existent", () => {
    for (const lat of [89.9, -89.9]) {
      for (const t of planCliche(lat, 0).tuiles) {
        assert.ok(t.y >= 0 && t.y < 2 ** 14, `${lat}° : y = ${t.y}`);
      }
    }
  });
});
