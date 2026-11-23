import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { affiliationOf } from "./app6.ts";
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
    idState: "detecte",
    confidence: 90,
    origin: null,
    classGuess: null,
    hypotheses: [{ platformId: "adsb-uav", score: 90 }],
    sensors: [],
    firstSeen: 0,
    lastUpdate: 0,
    dwellS: 0,
    confirmedAt: 0,
    cpa: null,
    siteWarned: true,
    launchFix: null,
    locked: false,
    corridor: "",
    feed: "adsb",
    ...over,
  } as Track;
}

describe("affiliation APP-6", () => {
  it("un ami ASECNA est AMI", () => {
    assert.equal(affiliationOf(track({ friendKind: "asecna" }), FAIBLE).affiliation, "ami");
  });

  it("notre drone inscrit est AMI, et son nom est donné", () => {
    const r = affiliationOf(track({ friendKind: "drone", ownDrone: "Aile-03" }), FAIBLE);
    assert.deepEqual(r, { affiliation: "ami", reason: "Notre drone · Aile-03" });
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

  it("un civil hors zone ASECNA est NEUTRE, pas ami", () => {
    const t = track({ feed: "adsb", idState: "confirme", origin: "XX", friendKind: "civil", category: "A3" });
    assert.equal(affiliationOf(t, FAIBLE).affiliation, "neutre");
  });
});
