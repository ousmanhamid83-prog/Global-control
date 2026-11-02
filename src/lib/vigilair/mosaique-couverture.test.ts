import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { couvertureDepuisTuiles, couvre, type RectTuiles } from "./mosaique-couverture.ts";

type Tuile = { z: number; x: number; y: number };

function bloc(z: number, x0: number, x1: number, y0: number, y1: number): Tuile[] {
  const t: Tuile[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) t.push({ z, x, y });
  return t;
}

/** Toutes les tuiles revendiquées par la couverture (pour comparer à l'entrée, tuile par tuile). */
function deplier(rects: RectTuiles[]): Set<string> {
  const s = new Set<string>();
  for (const c of rects) {
    for (let x = c.x0; x <= c.x1; x++) for (let y = c.y0; y <= c.y1; y++) s.add(`${c.z}/${x}/${y}`);
  }
  return s;
}

const cles = (t: Tuile[]) => new Set(t.map(({ z, x, y }) => `${z}/${x}/${y}`));

describe("couverture de la mosaïque locale : exacte, tirée des fichiers présents", () => {
  it("UN BLOC PLEIN donne UN rectangle (l'ancien carré FTTJ en z12), bords compris", () => {
    const rects = couvertureDepuisTuiles(bloc(12, 2216, 2222, 1905, 1912));
    assert.deepEqual(rects, [{ z: 12, x0: 2216, x1: 2222, y0: 1905, y1: 1912 }]);
    for (const [x, y] of [
      [2216, 1905],
      [2222, 1912],
      [2216, 1912],
      [2222, 1905],
    ]) {
      assert.equal(couvre(rects, 12, x!, y!), true, `coin ${x},${y}`);
    }
    assert.equal(couvre(rects, 12, 2223, 1912), false, "juste à côté : non");
    assert.equal(couvre(rects, 11, 2216, 1905), false, "autre zoom : non");
  });

  it("UN TROU : la tuile absente n'est jamais revendiquée", () => {
    const tuiles = bloc(12, 10, 14, 20, 24).filter((t) => !(t.x === 12 && t.y === 22));
    const rects = couvertureDepuisTuiles(tuiles);
    assert.equal(couvre(rects, 12, 12, 22), false, "le trou reste un trou");
    assert.deepEqual(deplier(rects), cles(tuiles));
  });

  it("DEUX ZONES SUR DEUX CONTINENTS : rectangles séparés, rien entre les deux", () => {
    const tchad = bloc(10, 550, 552, 473, 475);
    const alpes = bloc(10, 530, 531, 360, 361);
    const rects = couvertureDepuisTuiles([...tchad, ...alpes]);
    assert.deepEqual(deplier(rects), cles([...tchad, ...alpes]));
    assert.equal(
      couvre(rects, 10, 540, 400),
      false,
      "l'espace entre les deux zones n'est pas couvert",
    );
  });

  it("PLUSIEURS ZOOMS : du plus fin au plus grossier", () => {
    const rects = couvertureDepuisTuiles([
      ...bloc(8, 1, 1, 1, 1),
      ...bloc(12, 5, 5, 5, 5),
      ...bloc(10, 3, 3, 3, 3),
    ]);
    assert.deepEqual(
      rects.map((r) => r.z),
      [12, 10, 8],
    );
  });

  it("DOUBLONS ignorés, ordre d'entrée sans importance", () => {
    const t = bloc(9, 0, 2, 0, 2);
    assert.deepEqual(couvertureDepuisTuiles([...t].reverse().concat(t)), couvertureDepuisTuiles(t));
  });

  it("FORMES QUELCONQUES : la couverture dépliée redonne exactement les tuiles, ni plus ni moins", () => {
    // Générateur déterministe : la même suite à chaque passage.
    let graine = 1234567;
    const hasard = () => (graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let essai = 0; essai < 50; essai++) {
      const tuiles: Tuile[] = [];
      for (let k = 0; k < 60; k++) {
        tuiles.push({
          z: 8 + Math.floor(hasard() * 3),
          x: Math.floor(hasard() * 12),
          y: Math.floor(hasard() * 12),
        });
      }
      assert.deepEqual(deplier(couvertureDepuisTuiles(tuiles)), cles(tuiles), `essai ${essai}`);
    }
  });

  it("RIEN SUR LE DISQUE : aucune couverture", () => {
    assert.deepEqual(couvertureDepuisTuiles([]), []);
  });
});
