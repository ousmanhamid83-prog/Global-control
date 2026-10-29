import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_TYPE_DECLARE,
  CONFIRMATION_OBS,
  idStatut,
  MATURITE_OBS,
  MESSAGES_CORROBORATION,
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
  messages: 0,
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

const R = { lat: 12.1331, lon: 15.0339 };

test("OBSERVATION : le même rapport resservi n'est PAS une observation nouvelle", () => {
  // Une position identique est le même rapport, quelle que soit l'heure qu'on lui prête : mesuré,
  // l'heure des rapports resservis glissait de 2,2 à 3,7 s à chaque rafraîchissement réseau, et un
  // critère horaire comptait 188 rapports resservis sur 191 comme des observations neuves.
  assert.equal(observationNouvelle(R, { ...R }), false);
});

test("OBSERVATION : une position qui change est une observation nouvelle", () => {
  assert.equal(observationNouvelle(R, { lat: R.lat, lon: R.lon + 0.0002 }), true);
  assert.equal(observationNouvelle(R, { lat: R.lat - 0.0001, lon: R.lon }), true);
});

test("OBSERVATION : la toute première est nouvelle", () => {
  assert.equal(observationNouvelle(undefined, R), true);
});

/* ── PREUVE PAR LES MESSAGES : établie dès le premier relevé ────────────────────────────────────── */

test("MESSAGES : une adresse entendue des milliers de fois est confirmée dès son premier relevé", () => {
  // Médiane mesurée sur de vrais rapports d'agrégateur : 10 809 messages par adresse. Attendre le
  // prochain passage de la cellule (58 s en médiane, mesuré) n'apprenait rien de plus.
  const v = idStatut(P({ observations: 1, messages: 10_809 }));
  assert.equal(v.etat, "confirme");
  assert.equal(v.score, BASE_TYPE_DECLARE, "établie : plus de pénalité de jeunesse");
  assert.match(v.motif, /10\s809 messages reçus de l'adresse/);
});

test("MESSAGES : sous le seuil, rien ne change — un fantôme de décodage reste « détecté »", () => {
  const v = idStatut(P({ observations: 1, messages: MESSAGES_CORROBORATION - 1 }));
  assert.equal(v.etat, "detecte");
  assert.ok(v.score < BASE_TYPE_DECLARE);
  assert.doesNotMatch(v.motif, /messages/);
});

test("MESSAGES : ils établissent la piste, pas son TYPE — un type inconnu reste candidat", () => {
  assert.equal(idStatut(P({ type: "inconnu", observations: 1, messages: 5000 })).etat, "candidat");
});

test("MESSAGES : ils ne blanchissent pas une adresse douteuse", () => {
  // Deux émetteurs sur la même adresse font aussi beaucoup de messages : le doublon prime.
  const v = idStatut(P({ observations: 1, messages: 5000, incoherences: 3 }));
  assert.equal(v.etat, "candidat");
  assert.ok(v.score <= PLAFOND_DOUBLON);
});

test("CATÉGORIE : déduite de la plate-forme retenue pour la piste", () => {
  assert.equal(typeConnuDe("asecna-unk"), "inconnu");
  assert.equal(typeConnuDe("adsb-uav"), "drone");
  assert.equal(typeConnuDe("asecna-wide"), "declare");
});
