import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveAc, LivePicture } from "./live-adsb.ts";
import {
  cibleRegistre,
  lignesRegistre,
  lireAdsbLol,
  lireAdsbdb,
  marquage,
  resumeRegistre,
  type Registre,
} from "./registre-poste.ts";

// Réponses réelles, relevées le 8 novembre 2026 à travers le proxy du poste d'essai.
const ADSBDB_0900B5 = {
  response: {
    aircraft: {
      type: "DHC-8 402",
      icao_type: "DH8D",
      manufacturer: "Bombardier",
      mode_s: "0900B5",
      registration: "D2-EEB",
      registered_owner_country_iso_name: "AO",
      registered_owner_country_name: "Angola",
      registered_owner_operator_flag_code: "DH8D",
      registered_owner: "Government of Angola",
      url_photo: "https://image.airport-data.com/aircraft/001689913.jpg",
    },
  },
};
/** adsb.lol ne suit pas l'avion en ce moment. */
const ADSBLOL_VIDE = { ac: [], msg: "No error", now: 1794140424001, total: 0, ctime: 1794140424001, ptime: 0 };
/** adsb.lol le suit, sans dbFlags : non marqué (extrait de la vraie réponse pour 424bb1). */
const ADSBLOL_CIVIL = {
  ac: [{ hex: "424bb1", type: "adsb_icao", flight: "MADAM   ", r: "M-ADAM", t: "E35L", alt_baro: 24150 }],
  msg: "No error",
  total: 1,
};
/** Vu dans /v2/mil : dbFlags 1. */
const ADSBLOL_MIL = { ac: [{ hex: "ae0175", flight: "SPAR811 ", r: "84-0120", t: "LJ35", dbFlags: 1 }], total: 1 };

const piste = (x: Partial<LiveAc>): LiveAc => ({ hex: "0900b5", flight: "D2EEB", flightTx: true, reg: "D2-EEB", military: false, ...x }) as LiveAc;
const PIC = {
  aircraft: [piste({ via: "antenne" }), piste({ hex: "424bb1", flight: "MADAM", reg: "M-ADAM", via: "reseau" })],
} as unknown as LivePicture;

describe("registre en ligne : l'avion visé", () => {
  it("DANS L'IMAGE : par adresse, indicatif ou immatriculation, casse ignorée", () => {
    for (const a of ["0900B5", "0900b5", "d2eeb", " D2-EEB "]) {
      const c = cibleRegistre(a, PIC);
      assert.ok(!("erreur" in c) && c.hex === "0900b5" && c.ac?.via === "antenne", a);
    }
  });

  it("ABSENT DE L'IMAGE : une adresse ICAO vaut quand même ; autre chose, non", () => {
    assert.deepEqual(cibleRegistre("AE1234", PIC), { hex: "ae1234", ac: null });
    assert.deepEqual(cibleRegistre("ae1234", null), { hex: "ae1234", ac: null });
    const e = cibleRegistre("XYZ99", PIC);
    assert.ok("erreur" in e && /ni un avion de l'image du poste, ni une adresse ICAO/.test(e.erreur));
    const vide = cibleRegistre("  ", PIC);
    assert.ok("erreur" in vide && /^\/registre attend un avion/.test(vide.erreur));
  });
});

describe("registre en ligne : lecture des réponses", () => {
  it("ADSBDB : type, constructeur, immatriculation, propriétaire ; inconnu (404) : null", () => {
    assert.deepEqual(lireAdsbdb(ADSBDB_0900B5), {
      type: "DHC-8 402",
      icaoType: "DH8D",
      constructeur: "Bombardier",
      immat: "D2-EEB",
      proprietaire: "Government of Angola",
      pays: "Angola",
    });
    assert.equal(lireAdsbdb(null), null, "404 : avion inconnu du registre");
    assert.equal(lireAdsbdb({ response: "unknown aircraft" }), null);
    assert.deepEqual(lireAdsbdb({ response: { aircraft: { type: " ", registration: 7 } } }), {
      type: null,
      icaoType: null,
      constructeur: null,
      immat: null,
      proprietaire: null,
      pays: null,
    });
  });

  it("ADSB.LOL : suivi ou non ; marquage militaire = bit 1 de dbFlags", () => {
    assert.deepEqual(lireAdsbLol(ADSBLOL_VIDE, "0900b5"), { suivi: false, militaire: null });
    assert.deepEqual(lireAdsbLol(ADSBLOL_CIVIL, "424bb1"), { suivi: true, militaire: false });
    assert.deepEqual(lireAdsbLol(ADSBLOL_MIL, "ae0175"), { suivi: true, militaire: true });
    assert.deepEqual(lireAdsbLol({ ac: [{ hex: "ae0175", dbFlags: 2 }] }, "ae0175"), { suivi: true, militaire: false }, "2 : « intéressant », pas militaire");
    assert.deepEqual(lireAdsbLol(ADSBLOL_MIL, "0900b5"), { suivi: false, militaire: null }, "un autre avion");
    assert.deepEqual(lireAdsbLol(null, "0900b5"), { suivi: false, militaire: null });
  });
});

const reg = (r: Partial<Registre>): Registre => ({
  cible: { hex: "0900b5", ac: PIC.aircraft[0]! },
  adsbdb: lireAdsbdb(ADSBDB_0900B5),
  adsblol: { suivi: false, militaire: null },
  ...r,
});

describe("registre en ligne : marquage militaire, jamais « non » sans preuve", () => {
  it("ADSB.LOL LE SUIT : reçu de lui, militaire ou non marqué", () => {
    assert.equal(marquage(reg({ adsblol: { suivi: true, militaire: true } })), "militaire — reçu (adsb.lol)");
    assert.equal(marquage(reg({ adsblol: { suivi: true, militaire: false } })), "non marqué militaire — reçu (adsb.lol)");
  });

  it("NON SUIVI : une piste du relevé Internet porte déjà le marquage ; une de l'antenne, non : inconnu", () => {
    const reseau = { hex: "424bb1", ac: PIC.aircraft[1]! };
    assert.equal(marquage(reg({ cible: reseau })), "non marqué militaire — reçu (relevé Internet du poste)");
    assert.equal(
      marquage(reg({ cible: { hex: "424bb1", ac: { ...PIC.aircraft[1]!, military: true } } })),
      "militaire — reçu (relevé Internet du poste)",
    );
    assert.equal(marquage(reg({})), "inconnu : adsb.lol ne suit pas cet avion en ce moment");
    assert.equal(marquage(reg({ cible: { hex: "ae1234", ac: null } })), "inconnu : adsb.lol ne suit pas cet avion en ce moment");
    assert.equal(
      marquage(reg({ adsblol: { erreur: "injoignable (pas de réponse en 6 s)" } })),
      "inconnu : adsb.lol injoignable (pas de réponse en 6 s)",
    );
  });
});

describe("registre en ligne : lignes et journal", () => {
  it("LIGNES : d'où vient l'avion, « reçu (registre en ligne) », la fiche, le marquage, l'allocation", () => {
    assert.deepEqual(lignesRegistre(reg({})), [
      "Registre en ligne de 0900B5 (D2EEB), entendu par l'antenne du poste.",
      "Reçu (registre en ligne) : Internet, non vérifié, pas des données capteurs.",
      "  Type : DHC-8 402 (DH8D), Bombardier",
      "  Immatriculation : D2-EEB",
      "  Propriétaire : Government of Angola (Angola)",
      "  Marquage militaire : inconnu : adsb.lol ne suit pas cet avion en ce moment",
      "  Allocation OACI de l'adresse : Angola",
    ]);
  });

  it("INCONNU OU INJOIGNABLE : dit tel quel ; avion absent de l'image : dit aussi", () => {
    const l = lignesRegistre(reg({ cible: { hex: "ae1234", ac: null }, adsbdb: null }));
    assert.equal(l[0], "Registre en ligne de AE1234, absent de l'image du poste.");
    assert.ok(l.includes("  adsbdb : inconnu du registre."));
    const m = lignesRegistre(reg({ adsbdb: { erreur: "injoignable (ENOTFOUND)" } }));
    assert.ok(m.includes("  adsbdb : injoignable (ENOTFOUND)."));
  });

  it("JOURNAL : l'avion et ce que chaque source a rendu", () => {
    assert.equal(
      resumeRegistre(reg({ adsblol: { suivi: true, militaire: true } })),
      "0900B5, entendu par l'antenne du poste · adsbdb : D2-EEB · adsb.lol : militaire",
    );
    assert.equal(
      resumeRegistre(reg({ cible: { hex: "ae1234", ac: null }, adsbdb: null, adsblol: { erreur: "en erreur (HTTP 502)" } })),
      "AE1234, absent de l'image du poste · adsbdb : inconnu · adsb.lol : en erreur (HTTP 502)",
    );
    assert.equal(
      resumeRegistre(reg({ adsblol: { suivi: false, militaire: null } })),
      "0900B5, entendu par l'antenne du poste · adsbdb : D2-EEB · adsb.lol : non suivi",
    );
  });
});
