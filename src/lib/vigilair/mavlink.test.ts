import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  battement,
  crcX25,
  LecteurMavlink,
  missionNombre,
  missionPoint,
  ORDRE,
  ordreAller,
  ordreLong,
  trame,
  type MessageMav,
} from "./mavlink.ts";

// Trames de référence écrites par pymavlink 2.4.47 (dialecte ardupilotmega), la bibliothèque MAVLink
// d'ArduPilot : LUS, ce que le drone 1/1 envoie ; ECRITS, ce qu'une station 254/190 lui envoie.
const LUS = {
  battement: "fd090000070101000000040000000203d904038ed4",
  batterie:
    "fd1f000007010101000000000000000000000000000000002b31ffff000000000000000000000000576f35",
  batterieInconnue:
    "fd1f00000701010100000000000000000000000000000000ffffffff000000000000000000000000ffa693",
  gps: "fd1e00000701011800000000000000000000385d3b07b8fdf50888f504007900c80000000000030a70c4",
  gpsSansCompte:
    "fd1e00000701011800000000000000000000000000000000000000000000ffffffff0000000001ff3c9f",
  position: "fd1c000007010121000040e20100385d3b07b8fdf50888f50400307500002c0170fe00002823df2c",
  positionSud: "fd1c0000070101210000010000008087daeb804bebd5e02e000024faffff000000000000ffff9964",
  depart: "fd1c0000070101f20000385d3b07b8fdf508588004000000000000000000000000000000803f9b6d",
  accuse: "fd0100000701014d000016a2a2",
  accuseRefus: "fd0300000701014d00009001049170",
  texte:
    "fd2f0000070101fd00000250726541726d3a204261747465727920312062656c6f77206d696e696d756d2061726d696e6720766f6c74616765c664",
  textePlein:
    "fd330000070101fd0000067878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878a44f",
  demandeInt: "fd0400000701013300000300febefda2",
  demande: "fd0400000701012800000200febebd57",
  courant: "fd0100000701012a000004fe33",
  missionOk: "fd0200000701012f0000febee2e7",
  missionRefus: "fd0300000701012f0000febe0d23b6",
  attitudeInconnue: "fd1000000701011e000001000000cdcccc3dcdcc4c3e9a99993ea308",
  battementV1: "fe09030901000b0000000103590403ce87",
  positionV1: "fe1c0309012105000000385d3b07b8fdf50888f50400307500002c0170fe000028232643",
  battementSigne: "fd090100000101000000000000000203510303056a00010000000000ce1c0f722daf",
};
const ECRITS = {
  battement: "fd09000000febe0000000000000006080004031700",
  rtl: "fd20000001febe4c00000000000000000000000000000000000000000000000000000000000014000101514d",
  atterrir:
    "fd20000002febe4c000000000000000000000000000000000000000000000000000000000000150001012799",
  decoller30:
    "fd20000003febe4c00000000000000000000000000000000000000000000000000000000f04116000101ae5f",
  modeGuide:
    "fd20000004febe4c00000000803f000080400000000000000000000000000000000000000000b00001016f1a",
  armer: "fd20000005febe4c00000000803f00000000000000000000000000000000000000000000000090010101118d",
  armerRedit:
    "fd21000005febe4c00000000803f0000000000000000000000000000000000000000000000009001010102ad92",
  rythmePosition:
    "fd20000006febe4c000000000442002474480000000000000000000000000000000000000000ff010101da20",
  mission:
    "fd20000007febe4c0000000000000000000000000000000000000000000000000000000000002c0101016e69",
  aller:
    "fd21000008febe4b0000000080bf0000803f000000000000c07fc06a3c0700ecf60800002042c000010106e21c",
  nombre5: "fd04000009febe2c00000500010183b2",
  passage:
    "fd2500000afebe49000000000000000000000000000000000000c06a3c0700ecf60800002042010010000101060001825d",
  retour:
    "fd2500000bfebe4900000000000000000000000000000000000000000000000000000000000004001400010102000136ac",
  reprendre:
    "fd2500000cfebe4900000000803f0000004000000000000000000000000000000000000000000300b10001010200013461",
};

const octets = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (o: Uint8Array) => Buffer.from(o).toString("hex");
const lire = (...trames: string[]): MessageMav[] =>
  new LecteurMavlink().lire(octets(trames.join("")));
const DRONE = { sys: 1, comp: 1 };
const ecrire = (seq: number, m: { id: number; charge: Uint8Array }) =>
  hex(trame(seq, 254, 190, m.id, m.charge));

describe("MAVLink : lire ce que le drone envoie (trames de pymavlink)", () => {
  it("CRC X.25 : la valeur de contrôle connue de « 123456789 »", () => {
    assert.equal(crcX25(new TextEncoder().encode("123456789"), 0, 9), 0x6f91);
  });

  it("battement : type, autopilote, mode de vol, moteurs armés", () => {
    assert.deepEqual(lire(LUS.battement), [
      {
        sys: 1,
        comp: 1,
        v1: false,
        nom: "HEARTBEAT",
        type: 2,
        autopilote: 3,
        modeBase: 217,
        mode: 4,
      },
    ]);
  });

  it("batterie et GPS : une valeur inconnue (65535 mV, -1 %, 255 satellites) reste inconnue", () => {
    assert.deepEqual(lire(LUS.batterie, LUS.batterieInconnue, LUS.gps, LUS.gpsSansCompte), [
      { sys: 1, comp: 1, v1: false, nom: "SYS_STATUS", tensionV: 12.587, batteriePct: 87 },
      { sys: 1, comp: 1, v1: false, nom: "SYS_STATUS", tensionV: null, batteriePct: null },
      { sys: 1, comp: 1, v1: false, nom: "GPS_RAW_INT", fix: 3, satellites: 10 },
      { sys: 1, comp: 1, v1: false, nom: "GPS_RAW_INT", fix: 1, satellites: null },
    ]);
  });

  it("position : degrés, mètres, vitesse sol des deux composantes, cap ; sud et ouest négatifs, cap inconnu", () => {
    assert.deepEqual(lire(LUS.position, LUS.positionSud, LUS.depart), [
      {
        sys: 1,
        comp: 1,
        v1: false,
        nom: "GLOBAL_POSITION_INT",
        lat: 12.1331,
        lon: 15.0339,
        altM: 325,
        hauteurM: 30,
        vitesseMs: 5,
        cap: 90,
      },
      {
        sys: 1,
        comp: 1,
        v1: false,
        nom: "GLOBAL_POSITION_INT",
        lat: -33.8,
        lon: -70.6,
        altM: 12,
        hauteurM: -1.5,
        vitesseMs: 0,
        cap: null,
      },
      { sys: 1, comp: 1, v1: false, nom: "HOME_POSITION", lat: 12.1331, lon: 15.0339, altM: 295 },
    ]);
  });

  it("accusés d'ordre, textes du drone (coupés au premier zéro, ou pleins), mission", () => {
    assert.deepEqual(
      lire(
        LUS.accuse,
        LUS.accuseRefus,
        LUS.texte,
        LUS.textePlein,
        LUS.demandeInt,
        LUS.demande,
        LUS.courant,
        LUS.missionOk,
        LUS.missionRefus,
      ),
      [
        { sys: 1, comp: 1, v1: false, nom: "COMMAND_ACK", ordre: 22, resultat: 0 },
        { sys: 1, comp: 1, v1: false, nom: "COMMAND_ACK", ordre: 400, resultat: 4 },
        {
          sys: 1,
          comp: 1,
          v1: false,
          nom: "STATUSTEXT",
          gravite: 2,
          texte: "PreArm: Battery 1 below minimum arming voltage",
        },
        { sys: 1, comp: 1, v1: false, nom: "STATUSTEXT", gravite: 6, texte: "x".repeat(50) },
        { sys: 1, comp: 1, v1: false, nom: "MISSION_REQUEST", seq: 3 },
        { sys: 1, comp: 1, v1: false, nom: "MISSION_REQUEST", seq: 2 },
        { sys: 1, comp: 1, v1: false, nom: "MISSION_CURRENT", seq: 4 },
        { sys: 1, comp: 1, v1: false, nom: "MISSION_ACK", resultat: 0 },
        { sys: 1, comp: 1, v1: false, nom: "MISSION_ACK", resultat: 13 },
      ],
    );
  });

  it("vieux lien MAVLink 1 : lu de même, et compté", () => {
    const l = new LecteurMavlink();
    assert.deepEqual(l.lire(octets(LUS.battementV1 + LUS.positionV1)), [
      {
        sys: 9,
        comp: 1,
        v1: true,
        nom: "HEARTBEAT",
        type: 1,
        autopilote: 3,
        modeBase: 89,
        mode: 11,
      },
      {
        sys: 9,
        comp: 1,
        v1: true,
        nom: "GLOBAL_POSITION_INT",
        lat: 12.1331,
        lon: 15.0339,
        altM: 325,
        hauteurM: 30,
        vitesseMs: 5,
        cap: 90,
      },
    ]);
    assert.equal(l.v1, 2);
  });

  it("trame signée : lue, sa signature sautée, comptée ; la suivante n'est pas décalée", () => {
    const l = new LecteurMavlink();
    const m = l.lire(octets(LUS.battementSigne + LUS.accuse));
    assert.deepEqual(
      m.map((x) => x.nom),
      ["HEARTBEAT", "COMMAND_ACK"],
    );
    assert.equal(l.signees, 1);
    assert.equal(l.refusees, 0);
  });

  it("flux coupé n'importe où, bruit entre les trames, message non lu sauté d'un bloc", () => {
    const flux = octets(
      `0055${LUS.battement}${LUS.attitudeInconnue}aa${LUS.position}7f7f${LUS.accuse}`,
    );
    for (const pas of [1, 2, 3, 7, 16, flux.length]) {
      const l = new LecteurMavlink();
      const m: MessageMav[] = [];
      for (let i = 0; i < flux.length; i += pas) m.push(...l.lire(flux.subarray(i, i + pas)));
      assert.deepEqual(
        m.map((x) => x.nom),
        ["HEARTBEAT", "GLOBAL_POSITION_INT", "COMMAND_ACK"],
        `pas ${pas}`,
      );
      assert.equal(l.refusees, 0, `pas ${pas}`);
    }
  });

  it("faux début de trame (un fd perdu) : écarté par ses drapeaux inconnus, la vraie trame lue aussitôt", () => {
    assert.deepEqual(
      lire(`fd${LUS.battement}fdfd${LUS.position}`).map((x) => x.nom),
      ["HEARTBEAT", "GLOBAL_POSITION_INT"],
    );
  });

  it("faux début qui a l'air d'une longue trame signée : la lecture attend la suite, puis se recale", () => {
    const l = new LecteurMavlink();
    // « fd » puis une trame d'un octet de charge : fd, fd (taille 253), 01 (signée)… rien à lire encore.
    assert.deepEqual(l.lire(octets(`fd${LUS.accuse}`)), []);
    const suite = l.lire(octets(LUS.battement.repeat(20)));
    assert.ok(suite.length >= 5 && suite.length < 20, String(suite.length));
    assert.ok(suite.every((x) => x.nom === "HEARTBEAT"));
    assert.deepEqual(
      l.lire(octets(LUS.accuse)).map((x) => x.nom),
      ["COMMAND_ACK"],
    );
  });

  it("un octet abîmé : la trame est refusée au CRC et comptée ; la lecture se recale sur les suivantes", () => {
    const abimee = octets(LUS.position);
    abimee[14]! ^= 0x01;
    const l = new LecteurMavlink();
    const suite = [LUS.accuse, LUS.battement, LUS.gps].map(octets).flatMap((o) => [...o]);
    const m = l.lire(Uint8Array.from([...abimee, ...suite]));
    assert.equal(l.refusees, 1);
    assert.ok(!m.some((x) => x.nom === "GLOBAL_POSITION_INT"), "la trame abîmée n'est pas lue");
    assert.deepEqual(
      m.slice(-2).map((x) => x.nom),
      ["HEARTBEAT", "GPS_RAW_INT"],
    );
  });

  it("UDP : un datagramme fini sur un faux début n'abîme pas le suivant", () => {
    const l = new LecteurMavlink();
    assert.deepEqual(
      l.lire(octets(`${LUS.battement}fe`)).map((x) => x.nom),
      ["HEARTBEAT"],
    );
    l.oublier();
    assert.deepEqual(
      l.lire(octets(LUS.accuse)).map((x) => x.nom),
      ["COMMAND_ACK"],
    );
  });
});

describe("MAVLink : écrire, octet pour octet comme pymavlink", () => {
  it("battement de station, ordres de vol, rythme de télémétrie", () => {
    assert.equal(ecrire(0, battement()), ECRITS.battement);
    assert.equal(ecrire(1, ordreLong(DRONE, ORDRE.RTL, [])), ECRITS.rtl);
    assert.equal(ecrire(2, ordreLong(DRONE, ORDRE.ATTERRIR, [])), ECRITS.atterrir);
    assert.equal(
      ecrire(3, ordreLong(DRONE, ORDRE.DECOLLER, [0, 0, 0, 0, 0, 0, 30])),
      ECRITS.decoller30,
    );
    assert.equal(ecrire(4, ordreLong(DRONE, ORDRE.MODE, [1, 4])), ECRITS.modeGuide);
    assert.equal(ecrire(5, ordreLong(DRONE, ORDRE.ARMER_MOTEURS, [1])), ECRITS.armer);
    assert.equal(ecrire(5, ordreLong(DRONE, ORDRE.ARMER_MOTEURS, [1], 2)), ECRITS.armerRedit);
    assert.equal(ecrire(6, ordreLong(DRONE, ORDRE.RYTHME, [33, 250000])), ECRITS.rythmePosition);
    assert.equal(ecrire(7, ordreLong(DRONE, ORDRE.MISSION, [])), ECRITS.mission);
  });

  it("aller à un point, et une mission : nombre, passage, retour au départ, reprise", () => {
    assert.equal(ecrire(8, ordreAller(DRONE, 12.14, 15.04, 40)), ECRITS.aller);
    assert.equal(ecrire(9, missionNombre(DRONE, 5)), ECRITS.nombre5);
    assert.equal(
      ecrire(10, missionPoint(DRONE, 1, { quoi: "passage", lat: 12.14, lon: 15.04, hauteurM: 40 })),
      ECRITS.passage,
    );
    assert.equal(ecrire(11, missionPoint(DRONE, 4, { quoi: "retour" })), ECRITS.retour);
    assert.equal(
      ecrire(12, missionPoint(DRONE, 3, { quoi: "reprendre", aSeq: 1, fois: 2 })),
      ECRITS.reprendre,
    );
  });

  it("ce que le poste écrit, il le relit : numéro de suite au-delà de 255 ramené sur un octet", () => {
    const t = trame(300, 254, 190, 0, battement().charge);
    assert.equal(t[4], 44);
    assert.deepEqual(
      new LecteurMavlink().lire(t).map((m) => [m.nom, m.sys, m.comp]),
      [["HEARTBEAT", 254, 190]],
    );
  });

  it("AUCUN ORDRE DE CHARGE NI DE DÉSARMEMENT : servo, relais, pince, parachute, coupure moteurs, armement forcé — refusés à l'écriture", () => {
    for (const ordre of [181, 182, 183, 184, 185, 208, 211, 2000, 2500, 42600]) {
      assert.throws(() => ordreLong(DRONE, ordre, [1, 1]), /non permis/, String(ordre));
    }
    assert.throws(
      () => ordreLong(DRONE, ORDRE.ALLER, []),
      /non permis/,
      "aller : par ordreAller seulement",
    );
    assert.throws(() => ordreLong(DRONE, ORDRE.ARMER_MOTEURS, [0]), /ni forcé, ni désarmement/);
    assert.throws(
      () => ordreLong(DRONE, ORDRE.ARMER_MOTEURS, [1, 21196]),
      /ni forcé, ni désarmement/,
    );
    assert.throws(() => ordreLong(DRONE, ORDRE.ARMER_MOTEURS, []), /ni forcé, ni désarmement/);
  });
});
