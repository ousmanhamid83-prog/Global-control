import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { obsAge, tafValidity } from "./taf.ts";

const NOW = Date.UTC(2026, 9, 4, 17, 0); // 4 octobre 2026, 17:00 Z

describe("validité TAF", () => {
  it("le TAF FTTJ réel du 3 (0306/0412) est périmé le 4 à 17 Z", () => {
    const v = tafValidity("TAF FTTJ 030500Z 0306/0412 22006KT 8000 FEW026", NOW);
    assert.ok(v);
    assert.equal(v!.expired, true);
    assert.equal(v!.label, "périmé depuis 5 h");
  });

  it("un TAF qui court encore dit jusqu'à quand", () => {
    const v = tafValidity("TAF FTTJ 041100Z 0412/0518 VRB03KT 9999", NOW);
    assert.equal(v!.expired, false);
    assert.equal(v!.label, "valide jusqu'au 05 à 18 Z");
  });

  it("traverse la fin du mois", () => {
    const v = tafValidity("TAF FTTJ 301700Z 3018/0124 VRB03KT 9999", Date.UTC(2026, 9, 31, 6));
    assert.equal(v!.expired, false);
  });

  it("texte sans période : rien", () => {
    assert.equal(tafValidity("TAF FTTJ NIL"), null);
  });
});

describe("âge METAR", () => {
  it("METAR FTTJ de 16:00 Z lu à 17:00 Z : frais", () => {
    const a = obsAge("2026-10-04T16:00:00.000Z", NOW);
    assert.deepEqual(a, { stale: false, label: "il y a 1 h 00" });
  });
  it("METAR Kano du 1er à 17:00 Z lu le 4 : périmé", () => {
    const a = obsAge("2026-10-01T17:00:00.000Z", NOW);
    assert.deepEqual(a, { stale: true, label: "périmé · 3 j" });
  });
});
