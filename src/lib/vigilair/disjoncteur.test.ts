import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creerDisjoncteur } from "./disjoncteur.ts";

describe("disjoncteur par source d'imagerie", () => {
  it("FERMÉ AU DÉPART : on peut appeler une source jamais vue", () => {
    const d = creerDisjoncteur();
    assert.equal(d.passe("eum"), true);
    assert.equal(d.etat("eum"), "fermé");
  });

  it("OUVRE APRÈS LE SEUIL D'ÉCHECS D'AFFILÉE", () => {
    const t = 0;
    const d = creerDisjoncteur({ seuil: 3, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    assert.equal(d.passe("eum"), true, "2 < seuil : encore fermé");
    d.echec("eum");
    assert.equal(d.passe("eum"), false, "3 = seuil : ouvert");
    assert.equal(d.etat("eum"), "ouvert");
  });

  it("UN SUCCÈS REFERME ET REMET LE COMPTEUR À ZÉRO", () => {
    const t = 0;
    const d = creerDisjoncteur({ seuil: 3, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    d.succes("eum"); // la source a répondu
    d.echec("eum");
    d.echec("eum");
    assert.equal(d.passe("eum"), true, "le compteur est reparti de zéro après le succès");
  });

  it("LA PAUSE ÉCOULÉE, IL LAISSE REPASSER (MI-OUVERT)", () => {
    let t = 1000;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    assert.equal(d.passe("eum"), false);
    t += 44_999;
    assert.equal(d.passe("eum"), false, "encore dans la pause");
    t += 2;
    assert.equal(d.passe("eum"), true, "pause écoulée : on retente");
  });

  it("UN ÉCHEC EN MI-OUVERT ROUVRE AUSSITÔT POUR UNE PAUSE COMPLÈTE", () => {
    let t = 0;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum"); // ouvert jusqu'à 45 000
    t = 46_000; // pause écoulée, on retente…
    assert.equal(d.passe("eum"), true);
    d.echec("eum"); // …et ça rate encore
    assert.equal(d.passe("eum"), false, "rouvert");
    t = 46_000 + 44_999;
    assert.equal(d.passe("eum"), false, "pour une pause pleine à partir du nouvel échec");
    t = 46_000 + 45_001;
    assert.equal(d.passe("eum"), true);
  });

  it("UN « RIEN ICI » (404 = succès de connexion) NE FAIT JAMAIS OUVRIR", () => {
    const t = 0;
    const d = creerDisjoncteur({ seuil: 3, maintenant: () => t });
    for (let i = 0; i < 10; i++) {
      d.echec("eum");
      d.succes("eum"); // le fournisseur répond « pas d'image ici » : joignable
    }
    assert.equal(d.passe("eum"), true);
    assert.equal(d.etat("eum"), "fermé");
  });

  it("UN SUCCÈS REFERME UN DISJONCTEUR OUVERT TOUT DE SUITE (la source est revenue)", () => {
    const t = 0;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    assert.equal(d.etat("eum"), "ouvert");
    d.succes("eum"); // une réponse arrive : inutile d'attendre la fin de la pause
    assert.equal(d.etat("eum"), "fermé");
    assert.equal(d.passe("eum"), true);
  });

  it("SOURCES INDÉPENDANTES : ouvrir EUMETSAT ne coupe pas GIBS", () => {
    const t = 0;
    const d = creerDisjoncteur({ seuil: 2, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    assert.equal(d.passe("eum"), false);
    assert.equal(d.passe("gibs"), true);
  });
});
