import { test } from "node:test";
import assert from "node:assert/strict";
import { rappelPrise, rappelPriseTexte } from "./watch.ts";

/* Le tableau de quart affichait la valeur GELÉE à la prise comme si c'était l'état courant :
 * « 1090 au gel · 205 » restait à 205 des heures durant pendant que le ciel changeait. Il montre
 * désormais le vivant, et le relevé d'ouverture devient un REPÈRE — ce que ces fonctions formulent.
 */

test("REPÈRE : la valeur d'ouverture est rappelée, avec la hausse depuis", () => {
  assert.equal(rappelPrise(205, 231), "prise 205 · +26");
});

test("REPÈRE : une baisse est dite comme telle", () => {
  assert.equal(rappelPrise(205, 180), "prise 205 · -25");
});

test("REPÈRE : sans mouvement, on dit « stable », pas « +0 »", () => {
  // « +0 » se lit comme un changement nul mais mesuré ; « stable » est ce que l'opérateur attend.
  assert.equal(rappelPrise(205, 205), "prise 205 · stable");
});

test("REPÈRE : le départ à zéro reste lisible", () => {
  assert.equal(rappelPrise(0, 0), "prise 0 · stable");
  assert.equal(rappelPrise(0, 7), "prise 0 · +7");
});

test("REPÈRE TEXTE : une catégorie METAR inchangée est signalée", () => {
  assert.equal(rappelPriseTexte("VFR", "VFR"), "prise VFR · inchangé");
});

test("REPÈRE TEXTE : une catégorie qui a changé ne prétend pas l'inverse", () => {
  assert.equal(rappelPriseTexte("VFR", "IFR"), "prise VFR");
});

test("REPÈRE TEXTE : l'absence de METAR ne devient pas une valeur inventée", () => {
  assert.equal(rappelPriseTexte(null, null), "prise — · inchangé");
  assert.equal(rappelPriseTexte(null, "VFR"), "prise —");
  assert.equal(rappelPriseTexte("VFR", null), "prise VFR");
});
