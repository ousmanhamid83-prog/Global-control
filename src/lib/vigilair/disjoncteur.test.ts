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

  it("MI-OUVERT : UNE SEULE TUILE D'ESSAI À LA FOIS, les autres reviennent vides sans attendre", () => {
    let t = 0;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    t = 46_000;
    assert.equal(d.passe("eum"), true, "la tuile d'essai part");
    assert.equal(d.passe("eum"), false, "pendant l'essai, pas de vague");
    assert.equal(d.passe("eum"), false);
    assert.equal(d.passe("gibs"), true, "une autre source n'est pas concernée");
    d.succes("eum"); // l'essai a abouti : la source est revenue
    assert.equal(d.passe("eum"), true);
    assert.equal(d.passe("eum"), true, "refermé : toutes les tuiles passent de nouveau");
  });

  it("MI-OUVERT, ESSAI RATÉ : rouvert, puis un nouvel essai après la pause", () => {
    let t = 0;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    t = 46_000;
    assert.equal(d.passe("eum"), true);
    d.echec("eum");
    t = 46_000 + 45_001;
    assert.equal(d.passe("eum"), true, "l'essai raté n'empêche pas le suivant");
    assert.equal(d.passe("eum"), false);
  });

  it("ESSAI RÉUSSI PUIS NOUVELLE PANNE : l'essai suivant part (pas de drapeau périmé)", () => {
    let t = 0;
    const d = creerDisjoncteur({ seuil: 2, pauseMs: 45_000, maintenant: () => t });
    d.echec("eum");
    d.echec("eum");
    t = 46_000;
    assert.equal(d.passe("eum"), true);
    d.succes("eum");
    d.echec("eum");
    d.echec("eum");
    t = 46_000 + 45_001;
    assert.equal(d.passe("eum"), true, "la source retombée a droit à son essai");
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
