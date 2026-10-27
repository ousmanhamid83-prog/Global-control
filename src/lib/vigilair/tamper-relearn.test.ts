import { test } from "node:test";
import assert from "node:assert/strict";
import { relearnPending, requestRelearn, takeRelearn } from "./tamper-relearn.ts";

test("relearn : une demande se consomme UNE seule fois", () => {
  assert.equal(relearnPending("cam-1"), false);
  assert.equal(takeRelearn("cam-1"), false); // rien demandé
  requestRelearn("cam-1");
  assert.equal(relearnPending("cam-1"), true);
  assert.equal(takeRelearn("cam-1"), true);
  assert.equal(takeRelearn("cam-1"), false); // déjà consommée
  assert.equal(relearnPending("cam-1"), false);
});

test("relearn : les sources ne se mélangent pas", () => {
  requestRelearn("cam-nord");
  assert.equal(takeRelearn("cam-sud"), false);
  assert.equal(takeRelearn("cam-nord"), true);
});
