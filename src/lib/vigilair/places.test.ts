import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestPlace, PLACES, searchPlaces } from "./places.ts";

test("searchPlaces : villes du Darfour intérieur trouvées", () => {
  for (const name of ["Zalingei", "Ed Daein", "Kutum", "Kabkabiya", "Mellit", "Gereida"]) {
    const hit = searchPlaces(name, 5).some((p) => p.name === name);
    assert.ok(hit, `manque : ${name}`);
  }
});

test("searchPlaces : capitales du Darfour (via SAHEL_CITIES) accessibles", () => {
  for (const name of ["Nyala", "El Fasher", "Geneina"]) {
    assert.ok(searchPlaces(name, 8).some((p) => p.name === name), `manque : ${name}`);
  }
});

test("searchPlaces : trous Sahara/Sahel comblés (Ténéré, Adrar des Ifoghas)", () => {
  for (const name of ["Dirkou", "Séguédine", "Madama", "Ménaka", "Tessalit"]) {
    assert.ok(searchPlaces(name, 5).some((p) => p.name === name), `manque : ${name}`);
  }
});

test("searchPlaces : tolérance accents/casse (sans accent = avec accent)", () => {
  assert.ok(searchPlaces("seguedine", 5).some((p) => p.name === "Séguédine"));
  assert.ok(searchPlaces("MENAKA", 5).some((p) => p.name === "Ménaka"));
  assert.ok(searchPlaces("zalingei", 5).some((p) => p.name === "Zalingei"));
});

test("nearestPlace : un point au cœur du Darfour tombe sur une localité du Darfour", () => {
  // près de Zalingei (12.9, 23.5)
  const r = nearestPlace(12.9, 23.5);
  assert.ok(r);
  assert.ok(/Darfour/.test(r!.place.region) || r!.place.name === "Zalingei", `trouvé : ${r!.place.name} (${r!.place.region})`);
  assert.ok(r!.distKm < 60, `trop loin : ${r!.distKm} km`);
});

test("PLACES : pas de doublon de nom+coords, coords plausibles", () => {
  const seen = new Set<string>();
  for (const p of PLACES) {
    assert.ok(p.lat >= -40 && p.lat <= 40, `lat hors plage : ${p.name}`);
    assert.ok(p.lon >= -30 && p.lon <= 60, `lon hors plage : ${p.name}`);
    const key = `${p.name}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    assert.ok(!seen.has(key), `doublon : ${key}`);
    seen.add(key);
  }
});
