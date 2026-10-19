import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nightLayerSwitch, parseSatLayer } from "./sat.ts";

describe("parseSatLayer", () => {
  it("accepte les couches connues, retombe sur vis sinon", () => {
    assert.equal(parseSatLayer("ir"), "ir");
    assert.equal(parseSatLayer("nv"), "nv");
    assert.equal(parseSatLayer("inconnu"), "vis");
    assert.equal(parseSatLayer(null), "vis");
  });
});

describe("nightLayerSwitch — bascule auto jour/nuit", () => {
  it("nuit + Visible → passe en Nuit, mémorise l'origine", () => {
    assert.deepEqual(nightLayerSwitch("vis", null, true, true), { satLayer: "nv", satAutoFrom: "vis" });
  });

  it("retour du jour après une bascule auto → rend Visible", () => {
    assert.deepEqual(nightLayerSwitch("nv", "vis", true, false), { satLayer: "vis", satAutoFrom: null });
  });

  it("jour + Visible → ne touche à rien", () => {
    assert.equal(nightLayerSwitch("vis", null, true, false), null);
  });

  it("nuit mais déjà en Nuit → ne touche à rien", () => {
    assert.equal(nightLayerSwitch("nv", "vis", true, true), null);
  });

  it("ne touche pas un choix opérateur non-Visible (IR la nuit reste IR)", () => {
    assert.equal(nightLayerSwitch("ir", null, true, true), null);
  });

  it("ne rend PAS Visible au jour si l'opérateur a choisi Nuit lui-même (pas d'origine auto)", () => {
    assert.equal(nightLayerSwitch("nv", null, true, false), null);
  });

  it("auto coupé → aucune bascule, dans les deux sens", () => {
    assert.equal(nightLayerSwitch("vis", null, false, true), null);
    assert.equal(nightLayerSwitch("nv", "vis", false, false), null);
  });

  it("jour/nuit inconnu (null) → aucune bascule", () => {
    assert.equal(nightLayerSwitch("vis", null, true, null), null);
  });
});
