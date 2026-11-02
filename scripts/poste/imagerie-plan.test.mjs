import assert from "node:assert/strict";
import { test } from "node:test";
import { lireZone, planMosaique, tuilesDeZone, xDeLon, yDeLat } from "./imagerie-plan.mjs";

test("zone : S,N,O,E en degrés décimaux, négatifs compris", () => {
  assert.deepEqual(lireZone("11.6,12.7,14.5,15.6"), { s: 11.6, n: 12.7, o: 14.5, e: 15.6 });
  assert.deepEqual(lireZone(" -34.2, -33.5 , 18.3,18.9 "), {
    s: -34.2,
    n: -33.5,
    o: 18.3,
    e: 18.9,
  });
});

test("zone mal écrite : l'erreur dit quoi corriger", () => {
  assert.throws(() => lireZone("12,11,14,15"), /S < N et O < E/);
  assert.throws(() => lireZone("11,12,15,14"), /S < N et O < E/);
  assert.throws(() => lireZone("11,12,14"), /quatre nombres S,N,O,E/);
  assert.throws(() => lireZone("11,12,14,abc"), /quatre nombres S,N,O,E/);
  assert.throws(() => lireZone("80,89,14,15"), /hors de la carte/);
  assert.throws(() => lireZone("11,12,170,181"), /hors de la carte/);
});

test("tuile de FTTJ : 12/2219/1908, celle des packs livrés", () => {
  assert.equal(xDeLon(15.0557, 12), 2219);
  assert.equal(yDeLat(12.1348, 12), 1908);
  assert.equal(xDeLon(-180, 3), 0);
  assert.equal(yDeLat(0, 1), 1, "l'équateur ouvre la moitié sud");
});

test("tuiles d'une zone : le rectangle complet, coins compris", () => {
  const t = tuilesDeZone(lireZone("11.6,12.7,14.5,15.6"), 12);
  const xs = new Set(t.map((u) => u.x));
  const ys = new Set(t.map((u) => u.y));
  assert.equal(t.length, xs.size * ys.size, "un rectangle plein");
  assert.ok(xs.has(xDeLon(14.5, 12)) && xs.has(xDeLon(15.6, 12)));
  assert.ok(ys.has(yDeLat(12.7, 12)) && ys.has(yDeLat(11.6, 12)));
  assert.equal(t.length, 14 * 14);
});

test("plan : de zmin à zmax, sans doublon entre zones qui se chevauchent, du large au fin", () => {
  const a = lireZone("11.6,12.7,14.5,15.6");
  const b = lireZone("12.0,13.0,15.0,16.0");
  const seul = planMosaique([a], 10, 12).length;
  const deux = planMosaique([a, b], 10, 12);
  const cles = deux.map((t) => `${t.z}/${t.x}/${t.y}`);
  assert.equal(new Set(cles).size, cles.length, "aucune tuile en double");
  assert.ok(
    deux.length < seul + planMosaique([b], 10, 12).length,
    "le recouvrement compte une fois",
  );
  assert.deepEqual([...new Set(deux.map((t) => t.z))], [10, 11, 12]);
  for (let i = 1; i < deux.length; i++) {
    const p = deux[i - 1];
    const t = deux[i];
    assert.ok(p.z < t.z || (p.z === t.z && (p.x < t.x || (p.x === t.x && p.y < t.y))));
  }
});

test("plan : un zoom de plus coûte environ quatre fois plus", () => {
  const zone = lireZone("11.6,12.7,14.5,15.6");
  const z12 = planMosaique([zone], 12, 12).length;
  const z13 = planMosaique([zone], 13, 13).length;
  assert.ok(z13 >= 3.5 * z12 && z13 <= 4.5 * z12, `${z12} → ${z13}`);
});

test("plan : les bords du monde ne débordent pas de la grille", () => {
  const t = planMosaique([lireZone("-85,85,-180,180")], 2, 2);
  assert.equal(t.length, 16);
  assert.ok(t.every((u) => u.x >= 0 && u.x < 4 && u.y >= 0 && u.y < 4));
});
