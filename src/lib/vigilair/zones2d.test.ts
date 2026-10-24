import assert from "node:assert/strict";
import { test } from "node:test";
import { inArmWindow, pointInPolygon } from "./zones2d.ts";

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test("pointInPolygon : dedans / dehors", () => {
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
  assert.equal(pointInPolygon({ x: 5, y: 20 }, square), false);
  assert.equal(pointInPolygon({ x: 2, y: 8 }, square), true);
});

test("pointInPolygon : polygone concave (en L)", () => {
  const L = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 },
    { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 2, y: 2 }, L), true); // dans la barre basse
  assert.equal(pointInPolygon({ x: 8, y: 8 }, L), false); // dans le creux du L
});

test("pointInPolygon : moins de 3 sommets = faux", () => {
  assert.equal(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }]), false);
});

test("inArmWindow : fenêtre de jour [8,18)", () => {
  assert.equal(inArmWindow(10, 8, 18), true);
  assert.equal(inArmWindow(7, 8, 18), false);
  assert.equal(inArmWindow(18, 8, 18), false); // borne haute exclue
});

test("inArmWindow : fenêtre de NUIT 19→6 (passe minuit)", () => {
  assert.equal(inArmWindow(22, 19, 6), true);
  assert.equal(inArmWindow(3, 19, 6), true);
  assert.equal(inArmWindow(12, 19, 6), false);
  assert.equal(inArmWindow(6, 19, 6), false);
  assert.equal(inArmWindow(19, 19, 6), true);
});

test("inArmWindow : from === to → toujours armé", () => {
  assert.equal(inArmWindow(3, 0, 0), true);
  assert.equal(inArmWindow(15, 12, 12), true);
});
