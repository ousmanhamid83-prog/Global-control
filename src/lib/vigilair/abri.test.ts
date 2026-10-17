import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearAlert,
  counts,
  defaultConfig,
  normalSession,
  raiseAlert,
  resetStatuses,
  setWorkerStatus,
} from "./abri.ts";

describe("mise à l'abri", () => {
  it("le modèle par défaut a un site et une équipe tous présents", () => {
    const c = defaultConfig();
    assert.equal(c.sites.length, 1);
    assert.equal(c.workers.length, 6);
    assert.deepEqual(counts(c), { total: 6, present: 6, abri: 0, manque: 0, detresse: 0 });
  });

  it("déclencher l'alerte passe en « alerte » et consigne la raison", () => {
    const s = raiseAlert(normalSession(), { by: "Chef", siteId: "site-1", reason: "véhicules inconnus" });
    assert.equal(s.state, "alerte");
    assert.equal(s.drill, false);
    assert.equal(s.siteId, "site-1");
    assert.equal(s.log[0]!.kind, "alerte");
    assert.equal(s.log[0]!.note, "véhicules inconnus");
  });

  it("un exercice est marqué comme tel, pas comme une vraie alerte", () => {
    const s = raiseAlert(normalSession(), { by: "Chef", siteId: null, reason: "", drill: true });
    assert.equal(s.state, "alerte");
    assert.equal(s.drill, true);
    assert.equal(s.log[0]!.kind, "exercice");
  });

  it("pointer les employés met à jour le comptage, personne oublié", () => {
    const c0 = defaultConfig();
    const by = "Chef";
    let c = c0;
    c = setWorkerStatus(c, "w-1", "abri", by).config;
    c = setWorkerStatus(c, "w-2", "abri", by).config;
    c = setWorkerStatus(c, "w-3", "detresse", by).config;
    c = setWorkerStatus(c, "w-4", "manque", by).config;
    assert.deepEqual(counts(c), { total: 6, present: 2, abri: 2, manque: 1, detresse: 1 });
  });

  it("un statut inchangé ne crée pas d'événement en double", () => {
    const c = defaultConfig();
    const first = setWorkerStatus(c, "w-1", "abri", "Chef");
    assert.ok(first.event);
    const again = setWorkerStatus(first.config, "w-1", "abri", "Chef");
    assert.equal(again.event, null);
  });

  it("la levée repasse en normal et consigne « tout est clair »", () => {
    const alerte = raiseAlert(normalSession(), { by: "Chef", siteId: null, reason: "x" });
    const s = clearAlert(alerte, "Chef");
    assert.equal(s.state, "normal");
    assert.equal(s.discreet, false);
    assert.equal(s.log[0]!.kind, "levee");
  });

  it("réinitialiser remet toute l'équipe « présent »", () => {
    let c = defaultConfig();
    c = setWorkerStatus(c, "w-1", "abri", "Chef").config;
    c = resetStatuses(c);
    assert.deepEqual(counts(c), { total: 6, present: 6, abri: 0, manque: 0, detresse: 0 });
  });
});
