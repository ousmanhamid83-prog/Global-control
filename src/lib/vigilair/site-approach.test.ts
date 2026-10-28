import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPROACH_CFG, silentAlarm, siteApproach } from "./site-approach.ts";
import { COAST_ALERT_S, FRESH_S } from "./coast.ts";

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

/* ── TRANSPONDEUR MUET : afficher n'est pas prévenir ─────────────────────────────────────────────
 * Mesuré sur 881 avions réels : 6,7 % des positions ont plus de 5 s d'âge, 3,1 % plus de 30 s.
 * Le scope doit le dire dès 5 s (le symbole n'est plus une mesure) ; l'alerte, non — sinon la
 * latence ordinaire de l'agrégateur devient un flot d'alertes de sûreté.
 */

test("MUET : silence franc, bas et près du site → on alerte", () => {
  const v = silentAlarm({ altM: 300, coast: { silentS: 40 } }, { distKm: 1.4 }, COAST_ALERT_S);
  assert.equal(v.relevant, true);
  assert.equal(v.reason, undefined);
});

test("MUET : la latence ordinaire de l'agrégateur ne doit PAS alerter", () => {
  // 7 s d'âge, c'est affiché (MÉM 7s) mais ce n'est pas un transpondeur coupé.
  const v = silentAlarm({ altM: 300, coast: { silentS: 7 } }, { distKm: 1.4 }, COAST_ALERT_S);
  assert.equal(v.relevant, false);
  assert.match(v.reason ?? "", /latence ordinaire/);
  assert.ok(7 >= FRESH_S, "ce cas est bien affiché au scope : c'est l'alerte qu'on retient");
});

test("MUET : seuil net — juste en dessous on se tait, au seuil on parle", () => {
  const avant = { altM: 300, coast: { silentS: COAST_ALERT_S - 1 } };
  const pile = { altM: 300, coast: { silentS: COAST_ALERT_S } };
  assert.equal(silentAlarm(avant, { distKm: 1.4 }, COAST_ALERT_S).relevant, false);
  assert.equal(silentAlarm(pile, { distKm: 1.4 }, COAST_ALERT_S).relevant, true);
});

test("MUET : une piste qui émet normalement n'est pas un transpondeur coupé", () => {
  const v = silentAlarm({ altM: 300 }, { distKm: 1.4 }, COAST_ALERT_S);
  assert.equal(v.relevant, false);
  assert.match(v.reason ?? "", /émet normalement/);
});

test("MUET : haut ou loin, un silence ne concerne pas le site", () => {
  const haut = silentAlarm({ altM: 11_000, coast: { silentS: 40 } }, { distKm: 0.2 }, COAST_ALERT_S);
  assert.equal(haut.relevant, false);
  assert.match(haut.reason ?? "", /survol/);
  const loin = silentAlarm(
    { altM: 300, coast: { silentS: 40 } },
    { distKm: DEFAULT_APPROACH_CFG.watchKm + 0.1 },
    COAST_ALERT_S,
  );
  assert.equal(loin.relevant, false);
  assert.match(loin.reason ?? "", /hors de portée/);
  assert.equal(silentAlarm({ altM: 300, coast: { silentS: 40 } }, null, COAST_ALERT_S).relevant, false);
});

test("MUET : on n'exige PAS que la piste se rapproche", () => {
  // Son rapprochement serait lui-même extrapolé. Une piste qui vient de se taire à 1 km d'un site
  // est précisément celle dont on ne sait plus où elle va : l'écarter serait l'angle mort.
  const v = silentAlarm({ altM: 250, coast: { silentS: 35 } }, { distKm: 1.0 }, COAST_ALERT_S);
  assert.equal(v.relevant, true);
});
