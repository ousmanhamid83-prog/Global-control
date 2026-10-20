import assert from "node:assert/strict";
import { test } from "node:test";
import { axisHazards, bearingDeg, cardinal, distanceKm, relativeTurn, solve } from "./nav.ts";

test("cap : plein est ≈ 90°, plein nord ≈ 0°", () => {
  // à l'équateur, aller vers l'est = cap 90
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 0.5);
  // aller plein nord = cap 0
  assert.ok(Math.abs(bearingDeg(0, 0, 1, 0) - 0) < 0.5);
  // plein ouest = 270
  assert.ok(Math.abs(bearingDeg(0, 0, 0, -1) - 270) < 0.5);
});

test("distance : 1° de latitude ≈ 111 km", () => {
  const d = distanceKm(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111.2) < 1);
});

test("cardinal et ETA", () => {
  assert.equal(cardinal(0), "N");
  assert.equal(cardinal(90), "E");
  assert.equal(cardinal(270), "O");
  const s = solve(12.1, 15.0, 16.027, 22.634, 60); // N'Djamena -> Amdjarass à 60 km/h
  assert.ok(s.distanceKm > 700 && s.distanceKm < 1100);
  assert.ok(s.bearingDeg > 45 && s.bearingDeg < 90); // vers le nord-est
  assert.ok(s.etaMin && s.etaMin > 700); // plusieurs heures
});

test("relativeTurn signe : droite positif, gauche négatif", () => {
  assert.equal(relativeTurn(0, 90), 90); // tourner 90° à droite
  assert.equal(relativeTurn(0, 270), -90); // 90° à gauche
  assert.equal(relativeTurn(350, 10), 20); // passage 360°
});

test("axisHazards : un danger sur l'axe est retenu, un danger loin est ignoré", () => {
  // axe plein est de (0,0) à (0,4) ; danger à mi-chemin, 10 km au nord -> retenu
  const near = { id: "n", kind: "feu", lat: 0.09, lon: 2, title: "foyer" }; // ~10 km au nord
  const far = { id: "f", kind: "inondation", lat: 5, lon: 2, title: "crue loin" }; // ~555 km au nord
  const haz = axisHazards(0, 0, 0, 4, [near, far], 25, 5);
  assert.equal(haz.length, 1);
  assert.equal(haz[0]!.id, "n");
  assert.ok(haz[0]!.offsetKm < 25 && haz[0]!.offsetKm > 5);
  assert.ok(haz[0]!.alongKm > 150 && haz[0]!.alongKm < 300); // ~ moitié de ~445 km
  assert.equal(haz[0]!.side, "gauche"); // nord de l'axe est→ sur un cap est, le nord est à gauche
});
