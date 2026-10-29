import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_TYPE_DECLARE,
  CONFIRMATION_OBS,
  idStatut,
  MATURITE_OBS,
  MEME_RAPPORT_MS,
  observationNouvelle,
  PLAFOND_DOUBLON,
  typeConnuDe,
  type IdPreuves,
} from "./id-confiance.ts";

const P = (o: Partial<IdPreuves> = {}): IdPreuves => ({
  type: "declare",
  immatriculation: false,
  indicatif: false,
  observations: MATURITE_OBS,
  incoherences: 0,
  seuilDoublon: 3,
  ...o,
});

/* ── STATUT : plus de « confirmé » d'office ─────────────────────────────────────────────────────── */

test("STATUT : une piste vue UNE fois n'est pas confirmée — ce peut être un fantôme de décodage", () => {
  const v = idStatut(P({ observations: 1 }));
  assert.equal(v.etat, "detecte");
});

test("STATUT : deux relevés cohérents et un type déclaré → confirmé (M sur N)", () => {
  assert.equal(idStatut(P({ observations: CONFIRMATION_OBS })).etat, "confirme");
});

test("STATUT : un type inconnu ne peut PAS être « confirmé » — fin de « Confirmé · 60 % »", () => {
  // La contradiction affichée avant : statut confirmé, confiance 60 %, motif « type inconnu ».
  const v = idStatut(P({ type: "inconnu" }));
  assert.equal(v.etat, "candidat");
  assert.match(v.motif, /type inconnu/);
});

test("STATUT : un drone coopératif reste candidat — le genre est déclaré, pas le modèle", () => {
  assert.equal(idStatut(P({ type: "drone" })).etat, "candidat");
});

test("STATUT : une incohérence en cours suspend la confirmation", () => {
  assert.equal(idStatut(P({ incoherences: 1 })).etat, "candidat");
});

test("STATUT : un doublon d'adresse ramène à candidat et plafonne la confiance", () => {
  const v = idStatut(P({ incoherences: 3, immatriculation: true, indicatif: true }));
  assert.equal(v.etat, "candidat");
  assert.ok(v.score <= PLAFOND_DOUBLON, `obtenu ${v.score}`);
  assert.match(v.motif, /adresse ICAO douteuse/);
});

/* ── CONFIANCE : précise, et chaque point a sa raison ───────────────────────────────────────────── */

test("PRÉCISION : immatriculation et indicatif émis distinguent deux avions du même type", () => {
  // Le défaut du lot précédent : 120 pistes exactement à 95 %, quelles que soient leurs preuves.
  const nu = idStatut(P());
  const complet = idStatut(P({ immatriculation: true, indicatif: true }));
  assert.ok(complet.score > nu.score, `${complet.score} doit dépasser ${nu.score}`);
  assert.match(complet.motif, /immatriculation connue/);
  assert.match(complet.motif, /indicatif émis/);
});

test("MATURITÉ : la confiance se GAGNE relevé après relevé, puis se stabilise", () => {
  const scores = [1, 2, 3, 4, 5, 6, 8, 12].map((n) => idStatut(P({ observations: n })).score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i]! >= scores[i - 1]!, `non décroissante : ${scores.join(" → ")}`);
  }
  assert.ok(scores[scores.length - 1]! > scores[0]!, "une piste mûre est plus sûre qu'une piste neuve");
  // Au-delà de la maturité, plus rien ne bouge : la jeunesse ne pèse plus.
  assert.equal(scores[5], scores[7]);
});

test("MOTIF : il énumère tout ce qui a compté, en clair", () => {
  const v = idStatut(P({ immatriculation: true, indicatif: true, observations: 4 }));
  assert.match(v.motif, /type déclaré au registre/);
  assert.match(v.motif, /4 relevés cohérents/);
});

test("BASE : un avion mûr au type déclaré, sans autre preuve, reçoit la base documentée", () => {
  assert.equal(idStatut(P()).score, BASE_TYPE_DECLARE);
});

test("CONFIANCE : elle chute pendant un doublon puis se rétablit", () => {
  const avant = idStatut(P()).score;
  const pendant = idStatut(P({ incoherences: 3 })).score;
  assert.ok(pendant < avant);
  assert.equal(idStatut(P()).score, avant);
});

test("BORNES : jamais 100, jamais 0, quelles que soient les preuves", () => {
  for (const type of ["declare", "inconnu", "drone"] as const) {
    for (const obs of [0, 1, 3, 20]) {
      for (const inc of [0, 1, 2, 5, 9]) {
        const s = idStatut(P({ type, observations: obs, incoherences: inc, immatriculation: true, indicatif: true })).score;
        assert.ok(s >= 5 && s <= 99, `${type}/${obs}/${inc} → ${s}`);
      }
    }
  }
});

/* ── OBSERVATION : un rapport resservi n'est pas une preuve de plus ─────────────────────────────── */

const R = { lat: 12.1331, lon: 15.0339, at: 1_700_000_000_000 };

test("OBSERVATION : le même rapport resservi n'est PAS une observation nouvelle", () => {
  // Valeurs mesurées sur de vrais relevés successifs : un rapport resservi revient à 4 ms au plus
  // de son heure d'observation, dans un sens comme dans l'autre.
  assert.equal(observationNouvelle(R, { ...R, at: R.at + 4 }), false);
  assert.equal(observationNouvelle(R, { ...R, at: R.at - 3 }), false);
  assert.equal(observationNouvelle(R, { ...R, at: R.at + MEME_RAPPORT_MS - 1 }), false);
});

test("OBSERVATION : une position qui change est nouvelle, même 0,8 s après (le plus court mesuré)", () => {
  assert.equal(observationNouvelle(R, { lat: R.lat, lon: R.lon + 0.0002, at: R.at + 797 }), true);
});

test("OBSERVATION : un appareil immobile qui réémet sa position est observé de nouveau", () => {
  // Au sol, la position ne bouge pas ; c'est l'heure qui prouve qu'il a émis de nouveau.
  assert.equal(observationNouvelle(R, { ...R, at: R.at + MEME_RAPPORT_MS }), true);
  assert.equal(observationNouvelle(R, { ...R, at: R.at + 20_000 }), true);
});

test("OBSERVATION : la toute première est nouvelle", () => {
  assert.equal(observationNouvelle(undefined, R), true);
});

test("CATÉGORIE : déduite de la plate-forme retenue pour la piste", () => {
  assert.equal(typeConnuDe("asecna-unk"), "inconnu");
  assert.equal(typeConnuDe("adsb-uav"), "drone");
  assert.equal(typeConnuDe("asecna-wide"), "declare");
});
