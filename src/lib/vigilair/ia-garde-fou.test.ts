import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annoterReponse, elementsCites, nonVerifies } from "./ia-garde-fou.ts";

// Données comme celles qu'on fournit vraiment au modèle pour un briefing : ingest, METAR, pistes.
const DONNEES = [
  "Heure ingest: 2026-11-02T05:49:00.000Z",
  "METAR FTTJ: FTTJ 020530Z VRB03KT 9999 FEW040 33/12 Q1009 NOSIG",
  "Échantillon 1090 proche FTTJ:",
  "AFR123 3c6589 A332 F-GZCA FL350 nic=8",
  "ETH900 040b2f B788 ET-AOR FL370 nic=7 MIL",
  "TCH01 06a1f0 C130 TT-PAF FL120 nic=6",
].join("\n");

describe("garde-fou de l'IA : ce que la réponse cite doit venir des données", () => {
  it("INDICATIF INVENTÉ : signalé", () => {
    assert.deepEqual(nonVerifies("Le contact AFR999 se rapproche de FTTJ.", DONNEES), ["AFR999"]);
  });

  it("INDICATIF RÉEL : rien à signaler, réponse inchangée", () => {
    const r = "AFR123 en croisière FL350 vers le nord, ETH900 militaire FL370.";
    assert.equal(annoterReponse(r, DONNEES), r);
  });

  it("ADRESSE ICAO : vérifiée sans tenir compte de la casse (3c6589 → 3C6589)", () => {
    assert.deepEqual(nonVerifies("Adresse 3C6589 confirmée.", DONNEES), []);
  });

  it("ADRESSE ICAO INVENTÉE : signalée", () => {
    assert.deepEqual(nonVerifies("Nouvelle cible 4D2A11 au sud.", DONNEES), ["4D2A11"]);
  });

  it("IMMATRICULATION : réelle vérifiée, inventée signalée ; C-UAS et une date ne sont pas des immatriculations", () => {
    assert.deepEqual(nonVerifies("TT-PAF au départ, puis TT-XYZ.", DONNEES), ["TT-XYZ"]);
    assert.deepEqual(nonVerifies("Posture C-UAS le 2026-11-02.", DONNEES), []);
  });

  it("FAUX-AMIS : niveau, piste, QNH déduits par le modèle ne sont jamais signalés", () => {
    assert.deepEqual(nonVerifies("Descente FL240, RWY05 en service, QNH1013.", DONNEES), []);
  });

  it("MOT ENTIER : AFR12 inventé n'est pas « vérifié » par AFR123", () => {
    assert.deepEqual(nonVerifies("AFR12 et AFR123.", DONNEES), ["AFR12"]);
  });

  it("GROUPE METAR : repris du message, vérifié ; inventé, signalé", () => {
    assert.deepEqual(nonVerifies("Vent VRB03KT, nuages FEW040.", DONNEES), []);
    assert.deepEqual(nonVerifies("Orage SCT020CB en approche.", DONNEES), ["SCT020CB"]);
  });

  it("PLUSIEURS INVENTÉS : chacun une fois, dans l'ordre d'apparition dans la réponse", () => {
    assert.deepEqual(nonVerifies("TT-XYZ puis 4D2A11, encore TT-XYZ, puis RAM202.", DONNEES), [
      "TT-XYZ",
      "4D2A11",
      "RAM202",
    ]);
  });

  it("UN NOMBRE N'EST PAS UNE ADRESSE ICAO : heure ou total à 6 chiffres jamais signalé", () => {
    assert.deepEqual(nonVerifies("Fenêtre 120000 à 130000, 254320 contacts cumulés.", DONNEES), []);
  });

  it("AVERTISSEMENT EN CLAIR sous la réponse, réponse d'origine conservée", () => {
    const r = annoterReponse("Le contact AFR999 se rapproche.", DONNEES);
    assert.ok(r.startsWith("Le contact AFR999 se rapproche."), "la réponse n'est pas retouchée");
    assert.match(r, /⚠ Non retrouvé dans les données fournies à l'IA : AFR999\./);
  });

  it("RIEN À VÉRIFIER : une réponse sans identifiant passe telle quelle", () => {
    const r = "Situation calme, aucune urgence, posture normale.";
    assert.equal(annoterReponse(r, DONNEES), r);
    assert.deepEqual(elementsCites(r), []);
  });
});
