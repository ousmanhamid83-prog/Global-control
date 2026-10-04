import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoLockPick, isAutoCandidate } from "./auto-lock.ts";
import type { Track } from "./types.ts";

const NOW = Date.UTC(2026, 9, 4, 17, 0);

// Positions réelles : FTTJ, Moundou (Tchad, ~420 km), Douala (hors théâtre), Johannesburg.
const FTTJ = { lat: 12.1337, lon: 15.034 };
const MOUNDOU = { lat: 8.62, lon: 16.07 };
const DOUALA = { lat: 4.006, lon: 9.719 };
const JNB = { lat: -26.14, lon: 28.24 };

function ac(id: string, over: Partial<Track>): Track {
  return {
    id,
    callsign: id.toUpperCase(),
    lat: FTTJ.lat,
    lon: FTTJ.lon,
    altM: 10000,
    heading: 90,
    speedKmh: 800,
    climbMs: 0,
    trail: [],
    truePlatformId: "adsb-ifr",
    idState: "confirme",
    confidence: 95,
    origin: null,
    classGuess: null,
    hypotheses: [],
    sensors: [],
    firstSeen: NOW - 60_000,
    lastUpdate: NOW - 5_000,
    dwellS: 0,
    confirmedAt: NOW,
    motion: "transit",
    loiterCx: 0,
    loiterCy: 0,
    loiterR: 0,
    turnRate: 0,
    acoustic: null,
    pilotFix: null,
    cpa: null,
    siteWarned: true,
    launchFix: null,
    stopFix: null,
    locked: false,
    corridor: null,
    ew: null,
    feed: "adsb",
    ...over,
  } as Track;
}

describe("verrou automatique", () => {
  it("rien de réel : pas de verrou (un inject n'est jamais candidat)", () => {
    const inj = ac("inj-1", { feed: "sim", injected: true });
    assert.equal(autoLockPick([inj], NOW), null);
    assert.equal(isAutoCandidate(ac("live-x", { injected: true }), NOW), false);
  });

  it("une piste muette depuis plus de 45 s ou perdue n'est plus candidate", () => {
    assert.equal(isAutoCandidate(ac("old", { lastUpdate: NOW - 50_000 }), NOW), false);
    assert.equal(isAutoCandidate(ac("lost", { idState: "perdu" }), NOW), false);
  });

  it("sans gravité : la plus proche de FTTJ", () => {
    const pick = autoLockPick([ac("douala", DOUALA), ac("moundou", MOUNDOU)], NOW);
    assert.equal(pick?.id, "moundou");
    assert.equal(pick?.cls, 4);
    assert.match(pick!.reason, /plus proche de FTTJ · \d+ km de FTTJ/);
  });

  it("une urgence au Tchad passe devant un avion au-dessus de FTTJ", () => {
    const pick = autoLockPick(
      [ac("near", FTTJ), ac("emg", { ...MOUNDOU, emergency: "7700 urgence générale" })],
      NOW,
    );
    assert.equal(pick?.id, "emg");
    assert.equal(pick?.cls, 0);
  });

  it("une urgence à Johannesburg ne vole pas l'écran de N'Djamena", () => {
    const pick = autoLockPick([ac("near", FTTJ), ac("jnb", { ...JNB, emergency: "7700 urgence générale" })], NOW);
    assert.equal(pick?.id, "near");
  });

  it("un UAS B6 passe devant un militaire, un militaire devant un GNSS douteux", () => {
    const mil = ac("mil", { ...MOUNDOU, military: true });
    const gnss = ac("gnss", { ...FTTJ, nic: 3 });
    const uav = ac("uav", { ...MOUNDOU, category: "B6" });
    assert.equal(autoLockPick([mil, gnss, uav], NOW)?.id, "uav");
    assert.equal(autoLockPick([mil, gnss], NOW)?.id, "mil");
    assert.equal(autoLockPick([gnss, ac("plain", FTTJ)], NOW)?.id, "gnss");
  });

  it("le verrou en place tient tant que rien de plus grave n'apparaît", () => {
    const a = ac("a", MOUNDOU);
    const b = ac("b", { lat: 9.2, lon: 16 }); // un peu plus proche, pas nettement
    const first = autoLockPick([a], NOW);
    assert.equal(autoLockPick([a, b], NOW, first)?.id, "a");
    // Nettement plus proche : on passe.
    assert.equal(autoLockPick([a, ac("c", FTTJ)], NOW, first)?.id, "c");
    // Plus grave : on passe aussi.
    assert.equal(autoLockPick([a, ac("d", { ...DOUALA, lat: 13, lon: 18, category: "B6" })], NOW, first)?.id, "d");
  });

  it("le verrou en place disparu : on reprend le meilleur", () => {
    const first = autoLockPick([ac("a", MOUNDOU)], NOW);
    assert.equal(autoLockPick([ac("z", DOUALA)], NOW, first)?.id, "z");
  });
});
