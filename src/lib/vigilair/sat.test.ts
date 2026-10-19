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
  // visIsLive = true : vue large (géostationnaire, noir la nuit).
  it("vue large + nuit + Visible → passe en Nuit, mémorise l'origine", () => {
    assert.deepEqual(nightLayerSwitch("vis", null, true, true, true), { satLayer: "nv", satAutoFrom: "vis" });
  });

  it("retour du jour après une bascule auto → rend Visible", () => {
    assert.deepEqual(nightLayerSwitch("nv", "vis", true, false, true), { satLayer: "vis", satAutoFrom: null });
  });

  it("vue DÉTAIL (archive nette) la nuit → ne bascule PAS, garde Visible", () => {
    assert.equal(nightLayerSwitch("vis", null, true, true, false), null);
  });

  it("on passe de la vue large (Nuit auto) au détail la nuit → rend Visible (archive nette)", () => {
    assert.deepEqual(nightLayerSwitch("nv", "vis", true, true, false), { satLayer: "vis", satAutoFrom: null });
  });

  it("jour + Visible → ne touche à rien", () => {
    assert.equal(nightLayerSwitch("vis", null, true, false, true), null);
  });

  it("nuit mais déjà en Nuit → ne touche à rien", () => {
    assert.equal(nightLayerSwitch("nv", "vis", true, true, true), null);
  });

  it("ne touche pas un choix opérateur non-Visible (IR la nuit reste IR)", () => {
    assert.equal(nightLayerSwitch("ir", null, true, true, true), null);
  });

  it("ne rend PAS Visible au jour si l'opérateur a choisi Nuit lui-même (pas d'origine auto)", () => {
    assert.equal(nightLayerSwitch("nv", null, true, false, true), null);
  });

  it("auto coupé → aucune bascule, dans les deux sens", () => {
    assert.equal(nightLayerSwitch("vis", null, false, true, true), null);
    assert.equal(nightLayerSwitch("nv", "vis", false, false, true), null);
  });

  it("jour/nuit inconnu (null) → aucune bascule", () => {
    assert.equal(nightLayerSwitch("vis", null, true, null, true), null);
  });
});
