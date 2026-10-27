import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendSignature,
  DEFAULT_TAMPER_CFG,
  EMPTY_TAMPER,
  framesNearlyIdentical,
  isClearFrame,
  luminanceStats,
  sceneSignature,
  signatureDistance,
  stepTamper,
  type TamperTrack,
} from "./tamper.ts";

function fill(n: number, v: number): Uint8Array {
  const a = new Uint8Array(n);
  a.fill(v);
  return a;
}

test("luminanceStats : moyenne et variance", () => {
  const s = luminanceStats(Uint8Array.from([0, 0, 255, 255]));
  assert.equal(s.mean, 127.5);
  assert.ok(s.variance > 16000); // forte variance (contraste)
  assert.deepEqual(luminanceStats(fill(10, 50)), { mean: 50, variance: 0 }); // uniforme
  assert.deepEqual(luminanceStats(new Uint8Array()), { mean: 0, variance: 0 });
});

test("framesNearlyIdentical : identiques vs bruitées", () => {
  const a = fill(100, 80);
  const b = fill(100, 80);
  assert.equal(framesNearlyIdentical(a, b), true);
  // bruit réaliste : écart moyen > tolérance
  const noisy = Uint8Array.from(a, (v, i) => (v + (i % 5) * 3) & 0xff);
  assert.equal(framesNearlyIdentical(a, noisy), false);
  assert.equal(framesNearlyIdentical(a, fill(50, 80)), false); // tailles différentes
});

test("stepTamper : image noire tenue → masquée", () => {
  let t: TamperTrack = EMPTY_TAMPER;
  let verdict = null;
  for (let i = 0; i < DEFAULT_TAMPER_CFG.grace; i++) {
    const r = stepTamper(t, { mean: 5, variance: 2, sameAsPrev: false });
    t = r.track;
    verdict = r.verdict;
  }
  assert.equal(verdict, "masquee");
});

test("stepTamper : image uniforme claire tenue → masquée (bâche/peinture)", () => {
  const t: TamperTrack = EMPTY_TAMPER;
  let r = stepTamper(t, { mean: 200, variance: 1, sameAsPrev: false });
  for (let i = 1; i < DEFAULT_TAMPER_CFG.grace; i++) r = stepTamper(r.track, { mean: 200, variance: 1, sameAsPrev: false });
  assert.equal(r.verdict, "masquee");
});

test("stepTamper : trames identiques (non noires) tenues → figée", () => {
  let r = stepTamper(EMPTY_TAMPER, { mean: 120, variance: 500, sameAsPrev: true });
  for (let i = 1; i < DEFAULT_TAMPER_CFG.grace; i++) r = stepTamper(r.track, { mean: 120, variance: 500, sameAsPrev: true });
  assert.equal(r.verdict, "figee");
});

test("stepTamper : scène normale vivante → aucun verdict", () => {
  const r = stepTamper(EMPTY_TAMPER, { mean: 120, variance: 800, sameAsPrev: false });
  assert.equal(r.verdict, null);
  // une seule trame sombre ne suffit pas (grace)
  const once = stepTamper(EMPTY_TAMPER, { mean: 3, variance: 1, sameAsPrev: false });
  assert.equal(once.verdict, null);
});

test("stepTamper : les compteurs se remettent à zéro quand ça redevient normal", () => {
  let r = stepTamper(EMPTY_TAMPER, { mean: 5, variance: 2, sameAsPrev: true, sigFar: true });
  r = stepTamper(r.track, { mean: 120, variance: 800, sameAsPrev: false }); // revenu normal
  assert.deepEqual(r.track, { dark: 0, uniform: 0, frozen: 0, moved: 0 });
  assert.equal(r.verdict, null);
});

test("isClearFrame : seule une trame exploitable sert de preuve", () => {
  assert.equal(isClearFrame({ mean: 120, variance: 800 }), true);
  assert.equal(isClearFrame({ mean: 4, variance: 2 }), false); // noire
  assert.equal(isClearFrame({ mean: 200, variance: 1 }), false); // uniforme (bâche claire)
  // juste au-dessus du seuil « noir » mais dans la marge : pas encore exploitable.
  assert.equal(isClearFrame({ mean: DEFAULT_TAMPER_CFG.darkMean + 1, variance: 800 }), false);
});

test("sceneSignature : grille de luminances moyennes", () => {
  // Trame 4x4 en quatre quadrants nets → signature 2x2 = la moyenne de chaque quadrant.
  const luma = Uint8Array.from([
    0, 0, 10, 10,
    0, 0, 10, 10,
    20, 20, 30, 30,
    20, 20, 30, 30,
  ]);
  assert.deepEqual(sceneSignature(luma, 4, 2), [0, 10, 20, 30]);
  assert.equal(sceneSignature(new Uint8Array(16 * 16), 16, 4).length, 16);
});

test("signatureDistance : INSENSIBLE à l'éclairage, sensible au motif", () => {
  const vue = [10, 90, 20, 80, 15, 85, 25, 75];
  assert.equal(signatureDistance(vue, vue), 0);
  // Le jour qui tombe / un nuage / un phare : TOUTES les cases bougent ensemble → même vue.
  const plusSombre = vue.map((v) => v - 40);
  assert.equal(signatureDistance(vue, plusSombre), 0);
  const plusClair = vue.map((v) => v * 1 + 60);
  assert.equal(signatureDistance(vue, plusClair), 0);
  // Caméra détournée : le motif lui-même change → écart franc, au-delà du seuil.
  const autreVue = [90, 10, 80, 20, 85, 15, 75, 25];
  assert.ok(signatureDistance(vue, autreVue) > DEFAULT_TAMPER_CFG.movedDist);
  assert.equal(signatureDistance(vue, [1, 2]), 0); // tailles différentes : on ne conclut rien
});

test("blendSignature : dérive lente de la référence", () => {
  assert.deepEqual(blendSignature([0, 0], [100, 100], 0.1), [10, 10]);
  assert.deepEqual(blendSignature([50, 50], [50, 50], 0.5), [50, 50]);
  assert.deepEqual(blendSignature([0, 0], [10, 10], 0), [0, 0]); // alpha 0 : rien ne bouge
  assert.deepEqual(blendSignature([1], [7, 7], 0.5), [7, 7]); // incohérent → on repart de la vue
});

test("stepTamper : vue qui ne colle plus à la référence, tenue → déplacée", () => {
  let r = stepTamper(EMPTY_TAMPER, { mean: 120, variance: 800, sameAsPrev: false, sigFar: true });
  assert.equal(r.verdict, null); // patience : un camion qui se gare ne suffit pas
  for (let i = 1; i < DEFAULT_TAMPER_CFG.movedGrace; i++) {
    r = stepTamper(r.track, { mean: 120, variance: 800, sameAsPrev: false, sigFar: true });
  }
  assert.equal(r.verdict, "deplacee");
  assert.match(r.reason ?? "", /champ de vue/);
});

test("stepTamper : un masquage l'emporte sur un déplacement (image inexploitable d'abord)", () => {
  let r = stepTamper(EMPTY_TAMPER, { mean: 5, variance: 2, sameAsPrev: false, sigFar: true });
  for (let i = 1; i < DEFAULT_TAMPER_CFG.movedGrace; i++) {
    r = stepTamper(r.track, { mean: 5, variance: 2, sameAsPrev: false, sigFar: true });
  }
  assert.equal(r.verdict, "masquee");
});
