import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveAc, LivePicture } from "./live-adsb.ts";
import { REQUETE_MAX, verifierRequete } from "./recherche-sure.ts";

const PIC = {
  aircraft: [
    { hex: "06a1f0", flight: "AFR123 ", reg: "F-GKXA" },
    { hex: "0a0b07", flight: "", reg: null },
  ] as unknown as LiveAc[],
} as LivePicture;

const refus = (q: string, pic: LivePicture | null = PIC) => {
  const v = verifierRequete(q, pic);
  return v.ok ? null : v.raison;
};

describe("recherche en ligne : ce qu'une requête n'a pas le droit d'emporter hors du poste", () => {
  it("REQUÊTE ORDINAIRE : elle part, espaces resserrés", () => {
    assert.deepEqual(verifierRequete("  portée   d'un drone DJI Mavic 3 ", PIC), {
      ok: true,
      requete: "portée d'un drone DJI Mavic 3",
    });
    assert.equal(refus("vent de sable Sahel novembre"), null);
  });

  it("CONTACT DU RELEVÉ : indicatif, adresse ICAO, immatriculation — refusée, et dit pourquoi", () => {
    assert.equal(
      refus("route habituelle de afr123"),
      "Requête refusée : elle nomme AFR123, contact du relevé. Rien n'est sorti du poste.",
    );
    assert.match(refus("06A1F0 propriétaire")!, /nomme 06a1f0,/);
    assert.match(refus("F-GKXA historique")!, /nomme F-GKXA,/);
    assert.equal(
      refus("AFR123 est-il un vol régulier ?", null),
      null,
      "sans relevé, rien à cacher",
    );
  });

  it("CONTACT SANS INDICATIF : jamais pris pour un mot de la requête", () => {
    assert.equal(refus("météo à N'Djamena ?"), null, "le « ? » final laisse un mot vide");
  });

  it("COORDONNÉES : décimales, degrés-minutes, carré MGRS — refusées", () => {
    const motif = /contient des coordonnées/;
    assert.match(refus("que se passe-t-il à 12.13, 15.03")!, motif);
    assert.match(refus("terrain 12,1331 15,0339")!, motif);
    assert.match(refus("piste à -4.32/15.31")!, motif);
    assert.match(refus("village vers 12°08'N 15°02'E")!, motif);
    assert.match(refus("point 33P XL 12345 67890")!, motif);
    assert.match(refus("point 33PXL1234567890")!, motif);
  });

  it("NOMBRES ORDINAIRES : une année, une version, un prix ne sont pas des coordonnées", () => {
    assert.equal(refus("Mavic 3 sorti en 2021, version 1.5"), null);
    assert.equal(refus("prix 1,5 million FCFA"), null);
    assert.equal(refus("A320 vitesse de croisière 840 km/h"), null);
    // Une paire à une décimale (versions, indices) passe ; une coordonnée copiée en a deux et plus.
    assert.equal(refus("firmware versions 1.5, 2.0 du Mavic"), null);
  });

  it("VIDE OU TROP LONGUE : rien ne part", () => {
    assert.equal(refus("   "), "Requête vide : rien à chercher.");
    assert.match(refus("x".repeat(REQUETE_MAX + 1))!, /^Requête de 201 caractères : 200 au plus\./);
    assert.equal(refus("x".repeat(REQUETE_MAX)), null);
  });
});
