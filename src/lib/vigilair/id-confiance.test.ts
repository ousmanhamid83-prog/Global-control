import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIANCE_DRONE,
  CONFIANCE_TYPE_DECLARE,
  CONFIANCE_TYPE_INCONNU,
  idConfiance,
  PLAFOND_DOUBLON,
  typeConnuDe,
} from "./id-confiance.ts";

const SEUIL = 3;
const sain = (type: "declare" | "inconnu" | "drone") => ({ type, incoherences: 0, seuilDoublon: SEUIL });

test("PLUS DE 99 % EN DUR : un type inconnu n'est pas aussi bien identifié qu'un type déclaré", () => {
  // Le défaut mesuré : 131 pistes réelles toutes à 99 %, types inconnus compris.
  const connu = idConfiance(sain("declare"));
  const inconnu = idConfiance(sain("inconnu"));
  assert.ok(connu.score > inconnu.score, `${connu.score} doit dépasser ${inconnu.score}`);
  assert.equal(connu.score, CONFIANCE_TYPE_DECLARE);
  assert.equal(inconnu.score, CONFIANCE_TYPE_INCONNU);
  assert.match(inconnu.motif, /type inconnu/);
});

test("DRONE COOPÉRATIF : la nature est déclarée, pas le modèle", () => {
  const d = idConfiance(sain("drone"));
  assert.equal(d.score, CONFIANCE_DRONE);
  assert.match(d.motif, /drone/);
});

test("DOUBLON ICAO : l'identité tirée de l'adresse s'effondre, même avec un type déclaré", () => {
  // Deux émetteurs sur une adresse : on ne sait plus lequel on regarde. Afficher 95 % serait mentir.
  const v = idConfiance({ type: "declare", incoherences: SEUIL, seuilDoublon: SEUIL });
  assert.ok(v.score <= PLAFOND_DOUBLON, `obtenu ${v.score}`);
  assert.match(v.motif, /adresse ICAO douteuse/);
});

test("RELEVÉ INCOHÉRENT ISOLÉ : une pénalité, pas un effondrement", () => {
  const v = idConfiance({ type: "declare", incoherences: 1, seuilDoublon: SEUIL });
  assert.ok(v.score < CONFIANCE_TYPE_DECLARE && v.score > PLAFOND_DOUBLON, `obtenu ${v.score}`);
  assert.match(v.motif, /1 relevé incohérent/);
});

test("LA CONFIANCE BOUGE AVEC LA PREUVE : elle chute puis se rétablit", () => {
  // C'est tout l'enjeu : un chiffre qui réagit, pas une constante.
  const avant = idConfiance(sain("declare")).score;
  const pendant = idConfiance({ type: "declare", incoherences: SEUIL, seuilDoublon: SEUIL }).score;
  const apres = idConfiance(sain("declare")).score;
  assert.ok(pendant < avant);
  assert.equal(apres, avant, "l'épisode refermé, la confiance revient");
});

test("BORNES : jamais 100 (rien d'un signal reçu n'est certain), jamais 0", () => {
  for (const type of ["declare", "inconnu", "drone"] as const) {
    for (let n = 0; n <= 10; n++) {
      const v = idConfiance({ type, incoherences: n, seuilDoublon: SEUIL }).score;
      assert.ok(v >= 5 && v <= 99, `${type}/${n} → ${v}`);
    }
  }
});

test("CATÉGORIE : déduite de la plate-forme retenue pour la piste", () => {
  assert.equal(typeConnuDe("asecna-unk"), "inconnu");
  assert.equal(typeConnuDe("adsb-uav"), "drone");
  assert.equal(typeConnuDe("asecna-wide"), "declare");
  assert.equal(typeConnuDe("asecna-biz"), "declare");
});
