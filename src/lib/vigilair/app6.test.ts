import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { affiliationOf, app6Of } from "./app6.ts";
import type { Track } from "./types.ts";

const FAIBLE = "faible" as const;
const ELEVEE = "elevee" as const;

function track(over: Partial<Track>): Track {
  return {
    id: "t",
    callsign: "TEST",
    lat: 12,
    lon: 15,
    altM: 1000,
    heading: 90,
    speedKmh: 200,
    climbMs: 0,
    trail: [],
    truePlatformId: "adsb-uav",
    idState: "confirme",
    confidence: 90,
    origin: null,
    classGuess: null,
    hypotheses: [{ platformId: "adsb-uav", score: 90 }],
    sensors: [],
    firstSeen: 0,
    lastUpdate: 0,
    dwellS: 0,
    confirmedAt: 0,
    motion: "transit",
    loiterCx: 12,
    loiterCy: 15,
    loiterR: 0,
    turnRate: 0,
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: true,
    launchFix: null,
    stopFix: null,
    locked: false,
    corridor: "",
    ew: null,
    ...over,
  } as Track;
}

describe("affiliation APP-6", () => {
  it("un ami ASECNA est AMI", () => {
    assert.equal(affiliationOf(track({ friendKind: "asecna" }), FAIBLE).affiliation, "ami");
  });

  it("un ami FATL au Mode 4 invalide devient SUSPECT", () => {
    const t = track({ friendKind: "fatl", iff: { m4: "invalid" } as Track["iff"] });
    assert.equal(affiliationOf(t, FAIBLE).affiliation, "suspect");
  });

  it("une piste sans IFF ni mandat reste INCONNU, jamais hostile par défaut", () => {
    assert.equal(affiliationOf(track({ origin: "XX" }), FAIBLE).affiliation, "inconnu");
    assert.equal(affiliationOf(track({ origin: null }), FAIBLE).affiliation, "inconnu");
  });

  it("un mandat CN à menace élevée est HOSTILE ; à faible menace, SUSPECT", () => {
    assert.equal(affiliationOf(track({ origin: "CN" }), ELEVEE).affiliation, "hostile");
    assert.equal(affiliationOf(track({ origin: "CN" }), FAIBLE).affiliation, "suspect");
  });

  it("un 1090ES civil confirmé hors mandat est NEUTRE", () => {
    const t = track({ feed: "adsb", idState: "confirme", origin: "XX", military: false, category: "A3" });
    assert.equal(affiliationOf(t, FAIBLE).affiliation, "neutre");
  });

  it("une urgence 1090ES porte l'amplificateur emergency", () => {
    const t = track({ feed: "adsb", origin: "XX", emergency: "7700 urgence générale" });
    assert.equal(app6Of(t, FAIBLE).emergency, true);
  });

  it("un NIC faible marque une position GNSS douteuse", () => {
    assert.equal(app6Of(track({ nic: 3 }), FAIBLE).gnssSuspect, true);
    assert.equal(app6Of(track({ nic: 8 }), FAIBLE).gnssSuspect, false);
  });
});
