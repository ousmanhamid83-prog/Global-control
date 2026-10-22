import assert from "node:assert/strict";
import { test } from "node:test";
import { matchOwnDrone, normIdent, type OwnDrone } from "./drones-core.ts";

const drone = (ident: string, name = "Aile-01"): OwnDrone => ({
  id: `drone:${name}`,
  name,
  ident,
  site: "Camp Nord",
  at: 0,
});

test("normIdent met en majuscules et retire les séparateurs", () => {
  assert.equal(normIdent("3c6d-d2"), "3C6DD2");
  assert.equal(normIdent(" fatl 07 "), "FATL07");
  assert.equal(normIdent(""), "");
});

test("matchOwnDrone apparie par hex ICAO (tolérant à la casse et aux séparateurs)", () => {
  const list = [drone("3C6DD2")];
  assert.equal(matchOwnDrone(list, "3c6dd2", "AILE07")?.name, "Aile-01");
  assert.equal(matchOwnDrone(list, "3C6D-D2", null)?.name, "Aile-01");
});

test("matchOwnDrone apparie par indicatif quand le hex ne correspond pas", () => {
  const list = [drone("AILE07", "Aile-07")];
  assert.equal(matchOwnDrone(list, "ABCDEF", "aile 07")?.name, "Aile-07");
});

test("matchOwnDrone renvoie null sans correspondance", () => {
  const list = [drone("3C6DD2")];
  assert.equal(matchOwnDrone(list, "ABCDEF", "UNKNOWN"), null);
  assert.equal(matchOwnDrone([], "3C6DD2", "AILE07"), null);
});

test("matchOwnDrone ignore une entrée à identifiant vide", () => {
  const list = [drone("", "Sans-id"), drone("3C6DD2", "Bon")];
  assert.equal(matchOwnDrone(list, "", "")?.name ?? null, null);
  assert.equal(matchOwnDrone(list, "3C6DD2", "")?.name, "Bon");
});
