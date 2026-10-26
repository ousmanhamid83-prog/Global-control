import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAMPER_CFG,
  EMPTY_TAMPER,
  framesNearlyIdentical,
  luminanceStats,
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
  let r = stepTamper(EMPTY_TAMPER, { mean: 5, variance: 2, sameAsPrev: true });
  r = stepTamper(r.track, { mean: 120, variance: 800, sameAsPrev: false }); // revenu normal
  assert.deepEqual(r.track, { dark: 0, uniform: 0, frozen: 0 });
  assert.equal(r.verdict, null);
});
