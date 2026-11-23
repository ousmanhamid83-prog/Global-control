import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DECLUTTER_FOCUS_KM, passesPaintFilter, siteRelevant } from "./iff.ts";
import type { Track } from "./types.ts";

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

const FTTJ = { lat: 12.1331, lon: 15.0339 };
const DAKAR = { lat: 14.69, lon: -17.44 };
/** À `km` au nord d'un point (1° de latitude ≈ 111,195 km). */
const auNord = (p: { lat: number; lon: number }, km: number) =>
  track({ lat: p.lat + km / 111.195, lon: p.lon });

describe("débruitage du scope : la sûreté du site, autour de l'antenne du poste", () => {
  it("dans le rayon du poste : gardé ; au-delà : du transit, écarté", () => {
    assert.equal(DECLUTTER_FOCUS_KM, 300);
    assert.equal(siteRelevant(auNord(FTTJ, 299), FTTJ), true);
    assert.equal(siteRelevant(auNord(FTTJ, 301), FTTJ), false);
  });

  it("un poste ailleurs qu'à FTTJ : son propre voisinage, pas celui de N'Djamena", () => {
    const pres = auNord(DAKAR, 50);
    const ndjamena = auNord(FTTJ, 10);
    assert.equal(siteRelevant(pres, DAKAR), true);
    assert.equal(siteRelevant(ndjamena, DAKAR), false);
    const filtre = { showFriends: true, threatFloor: "ALL" as const, selectedId: null };
    assert.equal(passesPaintFilter(pres, { ...filtre, declutter: true, poste: DAKAR }), true);
    assert.equal(passesPaintFilter(ndjamena, { ...filtre, declutter: true, poste: DAKAR }), false);
    // Sans débruitage, tout passe ; sans image du poste encore, FTTJ par défaut.
    assert.equal(passesPaintFilter(ndjamena, { ...filtre, poste: DAKAR }), true);
    assert.equal(passesPaintFilter(ndjamena, { ...filtre, declutter: true }), true);
    assert.equal(passesPaintFilter(pres, { ...filtre, declutter: true }), false);
  });

  it("signalé, où qu'il soit : urgence, militaire, GNSS dégradé — toujours gardé", () => {
    const loin = auNord(DAKAR, 2000);
    assert.equal(siteRelevant(loin, DAKAR), false);
    assert.equal(siteRelevant({ ...loin, emergency: "7700" } as Track, DAKAR), true);
    assert.equal(siteRelevant({ ...loin, military: true } as Track, DAKAR), true);
    assert.equal(siteRelevant({ ...loin, nic: 4 } as Track, DAKAR), true);
    assert.equal(siteRelevant({ ...loin, nic: 5 } as Track, DAKAR), false);
  });
});
