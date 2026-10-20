import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestFrom, validateSite, type NearWatch } from "./watch-sites-core.ts";

test("validateSite accepte une saisie correcte", () => {
  const r = validateSite({ name: " Camp Nord ", lat: 12.1, lon: 15.0, radiusKm: 8 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.site.name, "Camp Nord"); // trim
    assert.ok(r.site.id.startsWith("custom:"));
    assert.equal(r.site.radiusKm, 8);
  }
});

test("validateSite refuse nom vide et coordonnées hors plage", () => {
  assert.equal(validateSite({ name: "  ", lat: 0, lon: 0, radiusKm: 5 }).ok, false);
  assert.equal(validateSite({ name: "X", lat: 99, lon: 0, radiusKm: 5 }).ok, false);
  assert.equal(validateSite({ name: "X", lat: 0, lon: 200, radiusKm: 5 }).ok, false);
  assert.equal(validateSite({ name: "X", lat: 0, lon: 0, radiusKm: 0 }).ok, false);
  assert.equal(validateSite({ name: "X", lat: 0, lon: 0, radiusKm: 999 }).ok, false);
  assert.equal(validateSite({ name: "X", lat: Number.NaN, lon: 0, radiusKm: 5 }).ok, false);
});

test("nearestFrom renvoie le site le plus proche", () => {
  const sites: NearWatch[] = [
    { id: "a", name: "A", short: "A", custom: false, lat: 0, lon: 0 },
    { id: "b", name: "B", short: "B", custom: true, lat: 10, lon: 10 },
  ];
  const near = nearestFrom(sites, 9.9, 9.9);
  assert.ok(near);
  assert.equal(near?.site.id, "b");
  assert.ok((near?.distKm ?? 1e9) < 50);
});

test("nearestFrom sur liste vide = null", () => {
  assert.equal(nearestFrom([], 0, 0), null);
});
