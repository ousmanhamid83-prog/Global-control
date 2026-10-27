import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPROACH_CFG, siteApproach } from "./site-approach.ts";

/** Un hélicoptère bas et lent qui converge sur la mine : le cas qui DOIT alerter. */
const BAS = { altM: 400, speedKmh: 180 };
const PROCHE = { distKm: 2.0, closing: true };

test("approche réelle : bas, en mouvement, proche et en rapprochement → on alerte", () => {
  const v = siteApproach(BAS, PROCHE);
  assert.equal(v.relevant, true);
  assert.equal(v.reason, undefined);
});

test("SURVOL HAUTE ALTITUDE : un avion de ligne à la verticale ne doit PAS alerter", () => {
  // Distance horizontale nulle, « en rapprochement » : sans plafond, c'était une alerte à chaque
  // survol de mine. C'est le faux positif que ce module existe pour empêcher.
  const v = siteApproach({ altM: 10_000, speedKmh: 850 }, { distKm: 0.1, closing: true });
  assert.equal(v.relevant, false);
  assert.match(v.reason ?? "", /survol/);
});

test("plafond : juste en dessous ça compte, juste au-dessus c'est du survol", () => {
  const dessous = siteApproach({ altM: DEFAULT_APPROACH_CFG.ceilingM, speedKmh: 200 }, PROCHE);
  assert.equal(dessous.relevant, true);
  const dessus = siteApproach({ altM: DEFAULT_APPROACH_CFG.ceilingM + 1, speedKmh: 200 }, PROCHE);
  assert.equal(dessus.relevant, false);
});

test("qui s'éloigne ou qui est loin ne concerne pas le site", () => {
  assert.equal(siteApproach(BAS, { distKm: 2.0, closing: false }).relevant, false);
  assert.match(siteApproach(BAS, { distKm: 2.0, closing: false }).reason ?? "", /rapproche/);
  const loin = siteApproach(BAS, { distKm: DEFAULT_APPROACH_CFG.watchKm + 0.1, closing: true });
  assert.equal(loin.relevant, false);
  assert.match(loin.reason ?? "", /hors de portée/);
});

test("au sol ou à l'arrêt : ce n'est pas une approche aérienne", () => {
  const v = siteApproach({ altM: 320, speedKmh: 4 }, PROCHE);
  assert.equal(v.relevant, false);
  assert.match(v.reason ?? "", /arrêt/);
});

test("pas de site à portée : rien à dire", () => {
  const v = siteApproach(BAS, null);
  assert.equal(v.relevant, false);
  assert.match(v.reason ?? "", /pas de site/);
});

test("un drone lent et très bas reste une approche", () => {
  // Le cas qui compte pour un site isolé : petit, lent, bas — il ne faut surtout pas le filtrer.
  const v = siteApproach({ altM: 90, speedKmh: 45 }, { distKm: 1.1, closing: true });
  assert.equal(v.relevant, true);
});
