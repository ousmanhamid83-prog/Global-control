import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estTuileGrise,
  missFromStatus,
  TUILE_GRISE_MAX,
  verdictTuile,
  ZOOM_IMAGERIE_MAX,
  ZOOM_IMAGERIE_MIN,
  zoomFinServable,
} from "./tile-verdict.ts";

test("UN 404 EST UNE RÉPONSE : le fournisseur dit qu'il n'a rien", () => {
  assert.equal(missFromStatus(404), "absente");
  assert.equal(missFromStatus(204), "absente");
  assert.equal(missFromStatus(410), "absente");
});

test("UNE PANNE N'EST PAS UN TERRAIN VIDE", () => {
  // Les peindre en vide donnerait une carte proprement aveugle : on ne peut pas affirmer qu'il n'y
  // a rien à un endroit qu'on n'a pas pu regarder.
  for (const s of [500, 502, 503, 504, 429, 403, 0]) {
    assert.equal(missFromStatus(s), "injoignable", `HTTP ${s} doit rester une panne`);
  }
});

test("TUILE GRISE : les tailles réellement mesurées sont reconnues", () => {
  // Relevé sur les tuiles qui échouaient : 2521 octets au zoom 19, 5153 au zoom 18. Et de la vraie
  // imagerie au même zoom sur le centre de N'Djamena : 15237 octets.
  assert.equal(estTuileGrise(2521), true, "gris zoom 19");
  assert.equal(estTuileGrise(5153), true, "gris zoom 18");
  assert.equal(estTuileGrise(15237), false, "vraie imagerie 30 cm");
  assert.equal(estTuileGrise(23149), false);
  // Le seuil lui-même : juste en dessous c'est gris, au seuil c'est de l'imagerie.
  assert.equal(estTuileGrise(TUILE_GRISE_MAX - 1), true);
  assert.equal(estTuileGrise(TUILE_GRISE_MAX), false);
});

test("VERDICT : tous les fournisseurs ont répondu « rien » → c'est bien vide", () => {
  assert.equal(verdictTuile(["absente", "absente"]), "absente");
  assert.equal(verdictTuile(["absente"]), "absente");
});

test("VERDICT : UN SEUL fournisseur injoignable suffit à refuser de conclure au vide", () => {
  // Le piège : le premier fournisseur est tombé, le second n'a rien — conclure « vide » cacherait
  // la panne du premier derrière l'absence du second.
  assert.equal(verdictTuile(["injoignable", "absente"]), "injoignable");
  assert.equal(verdictTuile(["absente", "injoignable"]), "injoignable");
  assert.equal(verdictTuile(["injoignable", "injoignable"]), "injoignable");
});

test("VERDICT : aucun échec listé ne vaut pas panne", () => {
  assert.equal(verdictTuile([]), "absente");
});

test("ZOOM : la plage réellement servie par l'imagerie fine", () => {
  assert.equal(zoomFinServable(ZOOM_IMAGERIE_MIN), true);
  assert.equal(zoomFinServable(ZOOM_IMAGERIE_MAX), true);
  assert.equal(zoomFinServable(ZOOM_IMAGERIE_MIN - 1), false, "en dessous : géostationnaire");
  assert.equal(zoomFinServable(ZOOM_IMAGERIE_MAX + 1), false, "au-delà : personne ne sert");
  // Les zooms du cas réel sont bien dans la plage : le 404 ne venait PAS d'un zoom hors limites,
  // mais de l'absence de couverture à cet endroit-là.
  assert.equal(zoomFinServable(18), true);
  assert.equal(zoomFinServable(19), true);
});
