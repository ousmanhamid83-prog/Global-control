import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliquerMessage,
  avisAlarmeVue,
  avisEtat,
  avisRetour,
  DETAIL_MAX,
  etatCapteur,
  lireMessage,
  nettoyerDetail,
  normaliserCapteur,
  SILENCE_DEFAUT_S,
  SILENCE_MAX_S,
  SILENCE_MIN_S,
  silenceValide,
  vueCapteur,
  type GroundSensor,
} from "./ground-sensors-core.ts";

/** 23 novembre 2026, 09:00:00 Z. */
const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);

const capteur = (over: Partial<GroundSensor> = {}): GroundSensor => ({
  id: "sensor-b1",
  site: "Camp Nord",
  type: "barriere",
  name: "Barrière est",
  at: T0 - 3_600_000,
  empreinteCle: "a".repeat(64),
  silenceS: 60,
  recu: null,
  derniereAlarme: null,
  ...over,
});

const dit = (s: GroundSensor, etat: "ok" | "alarme" | "hs", t: number, detail = "") =>
  appliquerMessage(s, { etat, detail }, t);

describe("capteurs sol : l'état est celui que le capteur a dit, dans son délai", () => {
  it("jamais entendu, OK dans le délai, MUET une milliseconde après", () => {
    assert.deepEqual(etatCapteur(capteur(), T0), { code: "jamais", depuis: null });
    const s = dit(capteur(), "ok", T0);
    assert.deepEqual(etatCapteur(s, T0 + 60_000), { code: "ok", depuis: T0 });
    assert.deepEqual(etatCapteur(s, T0 + 60_001), { code: "muet", depuis: T0 });
    const a = dit(s, "alarme", T0 + 1000);
    assert.deepEqual(etatCapteur(a, T0 + 2000), { code: "alarme", depuis: T0 + 1000 });
    const h = dit(a, "hs", T0 + 3000);
    assert.deepEqual(etatCapteur(h, T0 + 3000), { code: "hs", depuis: T0 + 3000 });
  });

  it("un état redit garde son début ; après un silence, c'est un nouvel épisode", () => {
    let s = dit(capteur(), "ok", T0);
    s = dit(s, "ok", T0 + 30_000);
    assert.equal(s.recu!.depuis, T0);
    assert.equal(s.recu!.at, T0 + 30_000);
    s = dit(s, "alarme", T0 + 40_000, "zone 2");
    s = dit(s, "alarme", T0 + 50_000, "zone 3");
    assert.equal(s.recu!.depuis, T0 + 40_000);
    assert.equal(s.recu!.detail, "zone 3");
    assert.equal(s.derniereAlarme, T0 + 40_000, "une alarme redite reste la même");
    // Silence de 61 s, puis l'alarme est redite : nouvelle alarme.
    s = dit(s, "alarme", T0 + 111_001);
    assert.equal(s.recu!.depuis, T0 + 111_001);
    assert.equal(s.derniereAlarme, T0 + 111_001);
    // Une panne ne touche pas à la dernière alarme.
    s = dit(s, "hs", T0 + 112_000);
    assert.equal(s.derniereAlarme, T0 + 111_001);
  });

  it("délai de silence : entier, borné, sinon le défaut", () => {
    assert.equal(silenceValide(45), 45);
    assert.equal(silenceValide("90"), 90);
    assert.equal(silenceValide(30.6), 31);
    assert.equal(silenceValide(1), SILENCE_MIN_S);
    assert.equal(silenceValide(10_000_000), SILENCE_MAX_S);
    for (const v of [undefined, null, "", "  ", "abc", Number.NaN, Infinity, {}]) {
      assert.equal(silenceValide(v), SILENCE_DEFAUT_S, String(v));
    }
  });

  it("le texte du capteur : sans caractère invisible ni retournement, resserré, borné", () => {
    assert.equal(nettoyerDetail("  zone\t2\n porte  "), "zone 2 porte");
    assert.equal(nettoyerDetail("abc‮dcba"), "abc dcba");
    assert.equal(nettoyerDetail("a​b﻿c⁦d\u0085e"), "a b c d e");
    assert.equal(nettoyerDetail("x".repeat(500)).length, DETAIL_MAX);
    assert.equal(nettoyerDetail(42), "");
    assert.equal(nettoyerDetail(null), "");
  });

  it("message : id et état exigés, l'état en minuscules, le texte nettoyé", () => {
    assert.deepEqual(lireMessage({ id: " sensor-b1 ", etat: "ALARME", detail: "zone\u0007 2" }), {
      message: { id: "sensor-b1", etat: "alarme", detail: "zone 2" },
    });
    assert.deepEqual(lireMessage({ etat: "ok" }), { erreur: "id du capteur requis" });
    assert.deepEqual(lireMessage({ id: "x".repeat(81), etat: "ok" }), {
      erreur: "id du capteur requis",
    });
    for (const etat of [undefined, "", "on", "alarm", 1]) {
      assert.deepEqual(lireMessage({ id: "s", etat }), { erreur: "etat : ok, alarme ou hs" });
    }
    assert.deepEqual(lireMessage({ id: "x".repeat(80), etat: "hs" }), {
      message: { id: "x".repeat(80), etat: "hs", detail: "" },
    });
  });
});

describe("capteurs sol : ce que le poste en dit au chef", () => {
  it("alarme, panne, silence : un avis par épisode, à l'heure dite par le capteur", () => {
    const ok = dit(capteur(), "ok", T0);
    assert.equal(avisEtat(capteur(), T0), null);
    assert.equal(avisEtat(ok, T0 + 1000), null);
    const al = dit(ok, "alarme", T0 + 5000, "zone 2");
    assert.deepEqual(avisEtat(al, T0 + 6000), {
      id: `sol-sensor-b1-alarme-${T0 + 5000}`,
      niveau: "elevee",
      titre: "Capteur sol en alarme · Barrière est",
      corps: "Barrière · Camp Nord · « zone 2 ». Dit par le capteur à 09:00:05 Z.",
      relayer: true,
    });
    // Redite, l'alarme garde l'id de son début : le chef n'est pas relancé à chaque message.
    assert.equal(
      avisEtat(dit(al, "alarme", T0 + 6500), T0 + 6600)?.id,
      `sol-sensor-b1-alarme-${T0 + 5000}`,
    );
    const hs = dit(al, "hs", T0 + 7000, "alimentation");
    assert.deepEqual(avisEtat(hs, T0 + 7000), {
      id: `sol-sensor-b1-hs-${T0 + 7000}`,
      niveau: "moderee",
      titre: "Capteur sol hors service · Barrière est",
      corps: "Barrière · Camp Nord · « alimentation ». Le capteur se dit en panne (09:00:07 Z).",
      relayer: true,
    });
    assert.deepEqual(avisEtat(hs, T0 + 67_001), {
      id: `sol-sensor-b1-muet-${T0 + 7000}`,
      niveau: "elevee",
      titre: "Capteur sol muet · Barrière est",
      corps:
        "Barrière · Camp Nord. Rien reçu depuis 09:00:07 Z (délai de silence 60 s) : câble, " +
        "courant ou capteur, à voir sur place.",
      relayer: true,
    });
  });

  it("le retour à OK : au journal seulement, avec ce qui précédait", () => {
    const premier = dit(capteur(), "ok", T0);
    assert.equal(
      avisRetour(premier, "jamais", T0)?.corps,
      "Barrière · Camp Nord. Premier message reçu (09:00:00 Z).",
    );
    assert.equal(avisRetour(premier, "jamais", T0)?.relayer, false);
    assert.equal(avisRetour(premier, "jamais", T0)?.niveau, "info");
    assert.equal(avisRetour(premier, "jamais", T0)?.id, `sol-sensor-b1-ok-${T0}`);
    assert.match(avisRetour(premier, "muet", T0)!.corps, /Il reparle après un silence/);
    assert.match(avisRetour(premier, "alarme", T0)!.corps, /Fin d'alarme dite par le capteur/);
    assert.match(avisRetour(premier, "hs", T0)!.corps, /Le capteur se dit réparé/);
    assert.equal(avisRetour(premier, "ok", T0), null);
    assert.equal(avisRetour(dit(premier, "alarme", T0 + 1), "ok", T0 + 1), null);
    assert.equal(avisRetour(premier, "jamais", T0 + 60_001), null, "muet entre-temps");
  });

  it("la vue de la console : rien de la clé, l'avis du serveur ; une alarme vue après coup, même id", () => {
    const al = dit(dit(capteur(), "ok", T0), "alarme", T0 + 5000, "zone 2");
    const v = vueCapteur(al, T0 + 6000);
    assert.equal("empreinteCle" in v, false);
    assert.equal(v.aCle, true);
    assert.equal(vueCapteur(capteur({ empreinteCle: null }), T0).aCle, false);
    assert.deepEqual(v.etat, { code: "alarme", depuis: T0 + 5000 });
    assert.equal(v.dernier, T0 + 5000);
    assert.equal(v.detail, "zone 2");
    assert.deepEqual(v.avis, avisEtat(al, T0 + 6000));
    // Finie avant la lecture suivante : la console la dit avec l'id de l'avis du serveur.
    const fini = vueCapteur(dit(al, "ok", T0 + 6500), T0 + 7000);
    assert.equal(fini.avis, null);
    assert.equal(avisAlarmeVue(fini)?.id, v.avis!.id);
    assert.equal(avisAlarmeVue(fini)?.titre, "Capteur sol en alarme · Barrière est");
    assert.equal(
      avisAlarmeVue(fini)?.corps,
      "Barrière · Camp Nord. Alarme dite par le capteur à 09:00:05 Z.",
    );
    assert.equal(avisAlarmeVue(vueCapteur(capteur(), T0)), null);
  });

  it("une fiche relue : l'ancien état posé à la main ne vaut rien, une fiche abîmée non plus", () => {
    assert.deepEqual(
      normaliserCapteur({
        id: "sensor:k1",
        site: "Camp",
        type: "camera",
        name: "Cam",
        state: "alarme",
        at: 5,
      }),
      {
        id: "sensor:k1",
        site: "Camp",
        name: "Cam",
        type: "camera",
        at: 5,
        empreinteCle: null,
        silenceS: SILENCE_DEFAUT_S,
        recu: null,
        derniereAlarme: null,
      },
    );
    const bon = dit(capteur(), "alarme", T0, "z");
    assert.deepEqual(normaliserCapteur(JSON.parse(JSON.stringify(bon))), bon);
    for (const raw of [
      null,
      3,
      "x",
      {},
      { id: "a", site: "b" },
      { id: " ", site: "b", name: "c" },
    ]) {
      assert.equal(normaliserCapteur(raw), null, JSON.stringify(raw));
    }
    assert.equal(normaliserCapteur({ ...bon, type: "sonar" })!.type, "autre");
    assert.equal(normaliserCapteur({ ...bon, empreinteCle: "A".repeat(64) })!.empreinteCle, null);
    assert.equal(normaliserCapteur({ ...bon, empreinteCle: "a".repeat(63) })!.empreinteCle, null);
    assert.equal(normaliserCapteur({ ...bon, recu: { ...bon.recu, depuis: T0 + 1 } })!.recu, null);
    assert.equal(normaliserCapteur({ ...bon, recu: { ...bon.recu, etat: "on" } })!.recu, null);
    assert.equal(normaliserCapteur({ ...bon, recu: { ...bon.recu, at: "x" } })!.recu, null);
    assert.equal(normaliserCapteur({ ...bon, derniereAlarme: "x" })!.derniereAlarme, null);
    assert.equal(normaliserCapteur({ ...bon, at: "x" })!.at, 0);
  });
});
