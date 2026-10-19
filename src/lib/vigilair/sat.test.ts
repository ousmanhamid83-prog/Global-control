import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoLayerSwitch, parseSatLayer } from "./sat.ts";

const opts = (o: Partial<Parameters<typeof autoLayerSwitch>[2]> = {}) => ({
  autoWideIr: false,
  autoNight: false,
  night: null as boolean | null,
  visIsLive: true,
  ...o,
});

describe("parseSatLayer", () => {
  it("accepte les couches connues, retombe sur vis sinon", () => {
    assert.equal(parseSatLayer("ir"), "ir");
    assert.equal(parseSatLayer("nv"), "nv");
    assert.equal(parseSatLayer("inconnu"), "vis");
    assert.equal(parseSatLayer(null), "vis");
  });
});

describe("autoLayerSwitch — bascule auto d'imagerie", () => {
  it("vue large + auto-IR + Visible → passe en IR (couverture monde)", () => {
    assert.deepEqual(autoLayerSwitch("vis", null, opts({ autoWideIr: true })), { satLayer: "ir", satAutoFrom: "vis" });
  });

  it("vue large de nuit, auto-IR coupé + auto jour/nuit → passe en Nuit", () => {
    assert.deepEqual(autoLayerSwitch("vis", null, opts({ autoNight: true, night: true })), { satLayer: "nv", satAutoFrom: "vis" });
  });

  it("auto-IR prime sur auto jour/nuit la nuit → IR, pas Nuit", () => {
    assert.deepEqual(autoLayerSwitch("vis", null, opts({ autoWideIr: true, autoNight: true, night: true })), { satLayer: "ir", satAutoFrom: "vis" });
  });

  it("vue DÉTAIL (archive nette) → garde toujours Visible, quelle que soit l'heure", () => {
    assert.equal(autoLayerSwitch("vis", null, opts({ autoWideIr: true, autoNight: true, night: true, visIsLive: false })), null);
  });

  it("passer de la vue large (IR auto) au détail → rend Visible (archive nette)", () => {
    assert.deepEqual(autoLayerSwitch("ir", "vis", opts({ autoWideIr: true, visIsLive: false })), { satLayer: "vis", satAutoFrom: null });
  });

  it("auto-IR coupé en vue large de jour → rend Visible", () => {
    assert.deepEqual(autoLayerSwitch("ir", "vis", opts({ autoWideIr: false, night: false })), { satLayer: "vis", satAutoFrom: null });
  });

  it("IR auto, puis auto-IR coupé la nuit → bascule sur Nuit (pas de noir)", () => {
    assert.deepEqual(autoLayerSwitch("ir", "vis", opts({ autoWideIr: false, autoNight: true, night: true })), { satLayer: "nv", satAutoFrom: "vis" });
  });

  it("déjà en IR (auto) et auto-IR actif → ne touche à rien", () => {
    assert.equal(autoLayerSwitch("ir", "vis", opts({ autoWideIr: true })), null);
  });

  it("ne touche PAS un choix opérateur (IR posé à la main en détail)", () => {
    assert.equal(autoLayerSwitch("ir", null, opts({ autoWideIr: true, visIsLive: false })), null);
  });

  it("tout auto coupé en vue large → garde Visible", () => {
    assert.equal(autoLayerSwitch("vis", null, opts({ autoWideIr: false, autoNight: false })), null);
  });

  it("auto jour/nuit mais jour/nuit inconnu → pas de bascule Nuit", () => {
    assert.equal(autoLayerSwitch("vis", null, opts({ autoNight: true, night: null })), null);
  });
});
