import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { droneDeclare, libelleDrone } from "./drones-oaci.ts";

describe("drones déclarés sur 1090ES : catégorie B6, ou type OACI de drone", () => {
  it("la catégorie B6 suffit, quel que soit le type ; le modèle si le type est un drone", () => {
    assert.deepEqual(droneDeclare({ category: "B6", icaoType: null }), {
      par: "B6",
      type: null,
      modele: null,
    });
    assert.deepEqual(droneDeclare({ category: "B6", icaoType: "  " }), {
      par: "B6",
      type: null,
      modele: null,
    });
    assert.deepEqual(droneDeclare({ category: " b6 ", icaoType: "zzzz" }), {
      par: "B6",
      type: "ZZZZ",
      modele: null,
    });
    // Le drone réel du 23 novembre 2026 : catégorie B6 et type HRON (indicatif BOOSTER).
    assert.deepEqual(droneDeclare({ category: "B6", icaoType: "HRON" }), {
      par: "B6",
      type: "HRON",
      modele: "Heron / Harfang",
    });
  });

  it("sans B6 : les 17 types du Doc 8643 dont chaque modèle est sans pilote", () => {
    const types = {
      AKNC: "Bayraktar Akıncı",
      ANKA: "Anka",
      BTB2: "Bayraktar TB-2",
      BTB3: "Bayraktar TB-3",
      FLCO: "Falco",
      GJ11: "GJ-11 Sharp Sword",
      HRM9: "Hermes 900",
      HRON: "Heron / Harfang",
      KZLA: "Bayraktar Kızılelma",
      Q1: "MQ-1 Predator / Gray Eagle",
      Q25: "MQ-25 Stingray",
      Q28: "MQ-28 Ghost Bat",
      Q4: "RQ-4 Global Hawk / MQ-4 Triton",
      Q58: "XQ-58 Valkyrie",
      Q9: "MQ-9 Reaper / Predator B",
      S15U: "S-15 Patroller",
      X47B: "X-47B",
    };
    for (const [type, modele] of Object.entries(types)) {
      assert.deepEqual(droneDeclare({ category: "A1", icaoType: type }), {
        par: "type",
        type,
        modele,
      });
    }
    assert.equal(droneDeclare({ icaoType: " btb2 " })?.modele, "Bayraktar TB-2");
  });

  it("les homonymes pilotés et le trafic ordinaire ne sont pas des drones", () => {
    // HERN : le DH-114 Heron ; Q5 : l'avion d'attaque Q-5 ; S15S : le motoplaneur S-15 ; FRBD : le
    // Firebird, à pilote optionnel.
    for (const icaoType of ["HERN", "Q5", "S15S", "FRBD", "A320", "", "  "]) {
      assert.equal(droneDeclare({ category: "A3", icaoType }), null, icaoType);
    }
    assert.equal(droneDeclare({}), null);
    assert.equal(droneDeclare({ category: null, icaoType: null }), null);
    assert.equal(droneDeclare({ category: "B7", icaoType: "C172" }), null);
  });

  it("le libellé dit ce qui a fait le drone", () => {
    assert.equal(libelleDrone(droneDeclare({ category: "B6" })!), "catégorie B6");
    assert.equal(
      libelleDrone(droneDeclare({ category: "B6", icaoType: "zzzz" })!),
      "catégorie B6 · ZZZZ",
    );
    assert.equal(
      libelleDrone(droneDeclare({ category: "B6", icaoType: "HRON" })!),
      "catégorie B6 · HRON (Heron / Harfang)",
    );
    assert.equal(
      libelleDrone(droneDeclare({ category: "A2", icaoType: "BTB2" })!),
      "type BTB2 (Bayraktar TB-2)",
    );
  });
});
