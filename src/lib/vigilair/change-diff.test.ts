import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHeatmap } from "./change-diff.ts";

/** Fabrique une image RGBA pleine d'une couleur. */
function fill(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a[i * 4] = r;
    a[i * 4 + 1] = g;
    a[i * 4 + 2] = b;
    a[i * 4 + 3] = 255;
  }
  return a;
}

test("images identiques : aucun changement", () => {
  const w = 8;
  const h = 8;
  const img = fill(w, h, 120, 110, 90);
  const res = diffHeatmap(img, fill(w, h, 120, 110, 90), w, h);
  assert.equal(res.changedFrac, 0);
  assert.equal(res.compared, w * h);
  assert.ok(res.overlay.every((v) => v === 0));
});

test("un bloc modifié est allumé, le reste non", () => {
  const w = 10;
  const h = 10;
  const before = fill(w, h, 100, 100, 100);
  const after = fill(w, h, 100, 100, 100);
  // modifie un carré 3×3 en haut à gauche (piste/engin apparu)
  let touched = 0;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const p = (y * w + x) * 4;
      after[p] = 220;
      after[p + 1] = 210;
      after[p + 2] = 190;
      touched++;
    }
  }
  const res = diffHeatmap(before, after, w, h, { threshold: 30 });
  assert.equal(res.compared, w * h);
  // exactement les 9 pixels du bloc sont marqués
  let lit = 0;
  for (let i = 0; i < w * h; i++) if (res.overlay[i * 4 + 3] > 0) lit++;
  assert.equal(lit, touched);
  assert.ok(Math.abs(res.changedFrac - 9 / 100) < 1e-9);
  // le pixel (0,0) est teinté, un pixel du fond (9,9) ne l'est pas
  assert.ok(res.overlay[3] > 0);
  assert.equal(res.overlay[(99 * 4) + 3], 0);
});

test("zone sans donnée (quasi-noir) jamais comptée comme changement", () => {
  const w = 4;
  const h = 4;
  // before tout noir (pas de passage), after lumineux → ce n'est PAS un changement, c'est une absence de donnée
  const before = fill(w, h, 0, 0, 0);
  const after = fill(w, h, 200, 200, 200);
  const res = diffHeatmap(before, after, w, h);
  assert.equal(res.compared, 0);
  assert.equal(res.changedFrac, 0);
  assert.ok(res.overlay.every((v) => v === 0));
});

test("différence sous le seuil ignorée (bruit d'illumination)", () => {
  const w = 6;
  const h = 6;
  const before = fill(w, h, 100, 100, 100);
  const after = fill(w, h, 110, 108, 112); // ~ +8/canal, sous le seuil 30
  const res = diffHeatmap(before, after, w, h, { threshold: 30 });
  assert.equal(res.changedFrac, 0);
});
