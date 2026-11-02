import assert from "node:assert/strict";
import { test } from "node:test";
import { corpsProcess, RENDU_VRAIES_COULEURS, tuile3857 } from "./sentinel-rendu.mjs";

/** Exécute un evalscript V3 comme le ferait Sentinel Hub : setup() et evaluatePixel(). */
function charger(script) {
  return new Function(`${script}\nreturn { setup, evaluatePixel };`)();
}

/**
 * Sortie AUTO (le défaut quand setup() ne précise pas sampleType), d'après la documentation de
 * Sentinel Hub : les valeurs de 0 à 1 sont étirées vers 0–255, ce qui dépasse 1 vaut 255.
 */
const auto = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

// Réflectances typiques d'un sol sahélien en saison sèche (B02 bleu, B03 vert, B04 rouge).
const SAHEL = { B02: 0.12, B03: 0.18, B04: 0.25 };

// L'ancien script de la console, gardé ici comme contre-exemple : il rendait déjà du 0–255.
const ANCIEN = `//VERSION=3
function setup(){return {input:["B02","B03","B04"],output:{bands:3}};}
function evaluatePixel(s){const g=1.0/0.4;return [Math.min(1,s.B04*2.5)**g,Math.min(1,s.B03*2.5)**g,Math.min(1,s.B02*2.5)**g].map(v=>Math.round(v*255));}`;

test("rendu : sortie AUTO, trois bandes, valeurs de 0 à 1 (le script de référence, gain 2,5)", () => {
  const { setup, evaluatePixel } = charger(RENDU_VRAIES_COULEURS);
  const s = setup();
  assert.deepEqual(s.input, ["B02", "B03", "B04"]);
  assert.equal(s.output.bands, 3, "trois bandes : le JPEG n'a pas de canal d'opacité");
  assert.equal(s.output.sampleType, undefined, "AUTO : les valeurs attendues vont de 0 à 1");
  assert.deepEqual(
    evaluatePixel(SAHEL).map((v) => Math.round(v * 1e6) / 1e6),
    [0.625, 0.45, 0.3],
  );
});

test("rendu : un sol sahélien sort en tons moyens, pas en blanc (l'ancien script sortait blanc)", () => {
  const neuf = charger(RENDU_VRAIES_COULEURS).evaluatePixel(SAHEL).map(auto);
  assert.deepEqual(neuf, [159, 115, 77]);
  const ancien = charger(ANCIEN).evaluatePixel(SAHEL).map(auto);
  assert.deepEqual(ancien, [255, 255, 255], "le contre-exemple montre bien le défaut corrigé");
  // Une végétation sombre reste lisible, une surface très claire sature seulement au-delà de 0,4.
  const { evaluatePixel } = charger(RENDU_VRAIES_COULEURS);
  assert.deepEqual(evaluatePixel({ B02: 0.03, B03: 0.05, B04: 0.04 }).map(auto), [26, 32, 19]);
  assert.deepEqual(evaluatePixel({ B02: 0.45, B03: 0.5, B04: 0.55 }).map(auto), [255, 255, 255]);
});

test("tuile3857 : z0 couvre le monde, z1 coupe en quatre, FTTJ tombe dans sa tuile z12", () => {
  const O = 20037508.342789244;
  assert.deepEqual(tuile3857(0, 0, 0), [-O, -O, O, O]);
  assert.deepEqual(tuile3857(1, 0, 0), [-O, 0, 0, O]);
  assert.deepEqual(tuile3857(1, 1, 1), [0, -O, O, 0]);
  // FTTJ (15,0557 E, 12,1348 N) en mètres Web Mercator, dans la tuile 12/2219/1908 des packs livrés.
  const x = (15.0557 / 180) * O;
  const y = (Math.log(Math.tan(((90 + 12.1348) * Math.PI) / 360)) / Math.PI) * O;
  const [minX, minY, maxX, maxY] = tuile3857(12, 2219, 1908);
  assert.ok(minX <= x && x < maxX && minY <= y && y < maxY);
});

test("corpsProcess : Sentinel-2 L2A, moins nuageux d'abord, emprise 3857, format demandé", () => {
  const du = new Date("2025-11-02T00:00:00Z");
  const au = new Date("2026-11-02T00:00:00Z");
  const c = corpsProcess({
    bbox: [1, 2, 3, 4],
    largeur: 256,
    hauteur: 256,
    du,
    au,
    nuagesMax: 20,
    format: "image/jpeg",
  });
  assert.deepEqual(c.input.bounds, {
    bbox: [1, 2, 3, 4],
    properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" },
  });
  assert.deepEqual(c.input.data, [
    {
      type: "sentinel-2-l2a",
      dataFilter: {
        timeRange: { from: "2025-11-02T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" },
        maxCloudCoverage: 20,
        mosaickingOrder: "leastCC",
      },
    },
  ]);
  assert.deepEqual(c.output, {
    width: 256,
    height: 256,
    responses: [{ identifier: "default", format: { type: "image/jpeg" } }],
  });
  assert.equal(c.evalscript, RENDU_VRAIES_COULEURS);
});
