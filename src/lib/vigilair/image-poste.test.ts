import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  antenneVivante,
  fusionAntenne,
  imageDuPoste,
  localN,
  sahelCount,
  vieillir,
} from "./image-poste.ts";
import type { LiveAc, LivePicture } from "./live-adsb.ts";
import type { ReceiverStatus } from "./rx1090.server.ts";

function avion(p: Partial<LiveAc>): LiveAc {
  return {
    hex: "000000",
    flight: "XXX000",
    flightTx: true,
    messages: null,
    lat: 12.3,
    lon: 15.2,
    altM: 9000,
    gsKmh: 800,
    track: 0,
    climbMs: 0,
    squawk: null,
    icaoType: null,
    reg: null,
    rssi: null,
    emergency: null,
    seenS: 1,
    onGround: false,
    category: null,
    nic: 8,
    nacp: 9,
    sil: 3,
    military: false,
    posSource: "adsb",
    rcM: null,
    ...p,
  } as LiveAc;
}

const T = Date.UTC(2026, 10, 2, 12, 0, 0);

function antenne(p: Partial<ReceiverStatus> = {}): ReceiverStatus {
  return {
    enabled: true,
    endpoint: "127.0.0.1:30002",
    connected: true,
    connectedAt: T - 600_000,
    lastLineAt: T - 1000,
    lastError: null,
    msgPerS: 40,
    heard: 3,
    positioned: 2,
    stats: {} as ReceiverStatus["stats"],
    antenna: { lat: 12.1331, lon: 15.0339 },
    ...p,
  };
}

const RESEAU_AC = avion({
  hex: "0a0b01",
  flight: "RES001",
  flightTx: true,
  icaoType: "B738",
  reg: "TT-AAA",
  military: true,
  seenS: 3,
});

/** Relevé réseau de 30 s avant T : un contact, ses sources. */
const NET = {
  at: T - 30_000,
  source: "adsb.lol",
  aircraft: [RESEAU_AC],
  sources: [
    { id: "1090", label: "1090ES adsb.lol", ok: true, detail: "" },
    { id: "metar", label: "METAR NOAA", ok: true, detail: "" },
    { id: "nic", label: "GNSS NIC (ADS-B)", ok: false, detail: "ancien" },
  ],
  sourceAt: {},
  errors: [],
} as unknown as LivePicture;

const VIDE = () =>
  ({
    at: T,
    source: "ingest partiel",
    aircraft: [],
    sources: [],
    errors: ["relevé Internet absent"],
  }) as unknown as LivePicture;

describe("image du poste : relevé réseau + antenne, pour tout ce qui lit l'image côté serveur", () => {
  it("ANTENNE VIVANTE : réglée, connectée, une trame il y a moins d'une minute", () => {
    assert.equal(antenneVivante(antenne(), T), true);
    assert.equal(antenneVivante(antenne({ lastLineAt: T - 59_999 }), T), true);
    assert.equal(antenneVivante(antenne({ lastLineAt: T - 60_000 }), T), false);
    assert.equal(antenneVivante(antenne({ lastLineAt: null }), T), false);
    assert.equal(antenneVivante(antenne({ connected: false }), T), false);
    assert.equal(antenneVivante(antenne({ enabled: false }), T), false);
  });

  it("LE DÉFAUT CORRIGÉ : Internet coupé, l'antenne entend — l'image porte ses avions", () => {
    const tst = avion({ hex: "0a0b02", flight: "TST202", via: "antenne" } as Partial<LiveAc>);
    const pic = imageDuPoste(null, antenne(), [tst], T, VIDE);
    assert.ok(pic, "avant : aucune image, « pas encore de relevé »");
    assert.deepEqual(
      pic.aircraft.map((a) => a.flight),
      ["TST202"],
    );
    assert.equal(pic.at, T, "l'antenne est en direct : l'image a l'âge de sa dernière trame");
    assert.equal(pic.source, "antenne 127.0.0.1:30002 · 1 avions");
    assert.deepEqual(
      pic.sources.map((s) => [s.id, s.ok]),
      [["rx", true]],
    );
    assert.equal(pic.localN, 1);
  });

  it("RIEN DU TOUT : ni relevé réseau ni antenne qui entend → pas d'image (rien n'est inventé)", () => {
    assert.equal(imageDuPoste(null, antenne({ connected: false }), [], T, VIDE), null);
    assert.equal(imageDuPoste(null, antenne({ enabled: false }), [], T, VIDE), null);
  });

  it("RÉSEAU SEUL : relevé vieilli de son âge, l'heure du relevé gardée, l'antenne muette signalée", () => {
    const muette = antenne({ connected: false, lastLineAt: null, lastError: "ECONNREFUSED" });
    const pic = imageDuPoste(NET, muette, [], T, VIDE)!;
    assert.equal(pic.at, NET.at);
    assert.equal(pic.aircraft[0]!.seenS, 33, "3 s à la réception + 30 s d'âge du relevé");
    assert.deepEqual(pic.errors, ["Antenne: ECONNREFUSED"]);
    const rx = pic.sources.find((s) => s.id === "rx")!;
    assert.equal(rx.ok, false);
    assert.equal(rx.detail, "ECONNREFUSED · 127.0.0.1:30002");
  });

  it("FUSION : l'antenne donne la position, le registre réseau le type, l'immat, le marquage", () => {
    const entendu = avion({
      hex: "0a0b01",
      flight: "ANT001",
      flightTx: true,
      lat: 12.5,
      military: false,
      icaoType: null,
      via: "antenne",
    } as Partial<LiveAc>);
    const [a] = fusionAntenne(NET, antenne(), [entendu], T).aircraft;
    assert.equal(a!.lat, 12.5);
    assert.equal(a!.flight, "ANT001");
    assert.equal(a!.icaoType, "B738");
    assert.equal(a!.reg, "TT-AAA");
    assert.equal(a!.military, true);
    const sansIndicatif = { ...entendu, flight: "", flightTx: false };
    const [b] = fusionAntenne(NET, antenne(), [sansIndicatif], T).aircraft;
    assert.equal(b!.flight, "RES001", "indicatif pas encore décodé : celui du réseau le supplée");
  });

  it("SOURCES : l'antenne juste après le 1090 réseau, le NIC recalculé sur l'image fusionnée", () => {
    const pic = fusionAntenne(NET, antenne(), [], T);
    assert.deepEqual(
      pic.sources.map((s) => s.id),
      ["1090", "rx", "metar", "nic"],
    );
    assert.equal(
      pic.sources.find((s) => s.id === "nic")!.ok,
      true,
      "le contact réseau porte un NIC",
    );
    assert.equal(pic.sourceAt?.rx, T);
    assert.equal(pic.at, T, "antenne en direct : l'image a son âge, pas celui du vieux relevé");
    assert.equal(pic.sourceAt?.["1090"], NET.at);
  });

  it("VIEILLIR : les contacts réseau prennent l'âge du relevé ; ceux de l'antenne, jamais", () => {
    const pic = {
      ...NET,
      aircraft: [RESEAU_AC, avion({ hex: "0a0b09", seenS: 2, via: "antenne" } as Partial<LiveAc>)],
    } as LivePicture;
    const v = vieillir(pic, T);
    assert.deepEqual(
      v.aircraft.map((a) => a.seenS),
      [33, 2],
    );
    assert.equal(vieillir(pic, NET.at - 5000).aircraft[0]!.seenS, 3, "horloge en arrière : âge 0");
  });

  it("COMPTES : à 120 km de FTTJ, et au-dessus du Sahel", () => {
    const pres = avion({ lat: 12.5, lon: 15.3 });
    const loin = avion({ lat: 13.5, lon: 15.0557 });
    const caire = avion({ lat: 30.1, lon: 31.4 });
    assert.equal(localN([pres, loin, caire]), 1);
    assert.equal(sahelCount([pres, loin, caire]), 2);
  });
});
