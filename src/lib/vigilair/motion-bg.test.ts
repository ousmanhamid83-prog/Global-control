import assert from "node:assert/strict";
import { test } from "node:test";
import { createRing, medianBackground, pushLuma } from "./motion-bg.ts";

/** Trame RGBA où chaque pixel i est un gris values[i] (luminance = valeur). */
function frame(values: number[]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    a[i * 4] = values[i]!;
    a[i * 4 + 1] = values[i]!;
    a[i * 4 + 2] = values[i]!;
    a[i * 4 + 3] = 255;
  }
  return a;
}

test("médiane d'une scène statique = la scène", () => {
  const r = createRing(1, 5);
  for (let k = 0; k < 5; k++) pushLuma(r, frame([100]));
  assert.ok(Math.abs(medianBackground(r)[0]! - 100) < 1e-6);
});

test("médiane : un pic d'une trame (éclair/bruit) est rejeté", () => {
  const r = createRing(1, 5);
  for (const v of [100, 100, 100, 100, 235]) pushLuma(r, frame([v]));
  assert.ok(Math.abs(medianBackground(r)[0]! - 100) < 1e-6); // le 235 isolé ne passe pas
});

test("médiane : un objet présent sur la MAJORITÉ de la fenêtre finit par entrer", () => {
  const r = createRing(1, 5);
  for (const v of [100, 100, 235, 235, 235]) pushLuma(r, frame([v]));
  assert.ok(Math.abs(medianBackground(r)[0]! - 235) < 1e-6);
});

test("médiane paire = moyenne des deux valeurs centrales", () => {
  const r = createRing(1, 4);
  for (const v of [10, 20, 30, 40]) pushLuma(r, frame([v]));
  assert.ok(Math.abs(medianBackground(r)[0]! - 25) < 1e-6);
});

test("push GELÉ : un objet sous une zone gelée n'entre jamais dans le fond", () => {
  const r = createRing(1, 5);
  const baseline = new Float32Array([50]);
  const freeze = new Uint8Array([1]);
  for (let k = 0; k < 10; k++) pushLuma(r, frame([235]), baseline, freeze); // objet clair, mais gelé
  assert.ok(Math.abs(medianBackground(r)[0]! - 50) < 1e-6); // le fond reste la base, pas l'objet
});

test("les premières trames (fenêtre non pleine) donnent déjà une médiane", () => {
  const r = createRing(1, 5);
  pushLuma(r, frame([80]));
  pushLuma(r, frame([120]));
  pushLuma(r, frame([100]));
  assert.ok(Math.abs(medianBackground(r)[0]! - 100) < 1e-6); // médiane de [80,100,120]
});
