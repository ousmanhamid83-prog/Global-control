import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creerFile } from "./file-tuiles.ts";

describe("file des tuiles distantes : la console garde toujours des connexions", () => {
  it("PLAFOND : au plus `max` tuiles en vol, les autres attendent", () => {
    const f = creerFile(4);
    const parties: number[] = [];
    for (let i = 0; i < 10; i++) f.lancer(() => parties.push(i));
    assert.deepEqual(parties, [0, 1, 2, 3]);
  });

  it("UNE FINIT, UNE PART : la plus récente d'abord (la vue regardée maintenant)", () => {
    const f = creerFile(2);
    const parties: number[] = [];
    for (let i = 0; i < 6; i++) f.lancer(() => parties.push(i));
    f.finie();
    assert.deepEqual(parties, [0, 1, 5]);
    f.finie();
    f.finie();
    assert.deepEqual(parties, [0, 1, 5, 4, 3]);
  });

  it("FILE VIDE : une place se libère pour la tuile suivante", () => {
    const f = creerFile(1);
    const parties: string[] = [];
    f.lancer(() => parties.push("a"));
    f.finie();
    f.lancer(() => parties.push("b"));
    assert.deepEqual(parties, ["a", "b"], "la place libérée resservie aussitôt");
    f.lancer(() => parties.push("c"));
    assert.deepEqual(parties, ["a", "b"], "« b » en vol : « c » attend");
    f.finie();
    assert.deepEqual(parties, ["a", "b", "c"]);
  });
});
