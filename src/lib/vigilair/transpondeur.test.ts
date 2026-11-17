import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { methodBlurb } from "./engine.ts";
import { pisteExercice } from "./exercice.ts";
import { liveAcToTrack, type LiveAc } from "./live-adsb.ts";
import { collectWaterfall, countModeS, iffEvidenceLine, surveillanceLabel } from "./mode-s.ts";
import type { Track } from "./types.ts";

const T = Date.UTC(2026, 10, 17, 9, 0, 0);

function avion(over: Partial<LiveAc> = {}): LiveAc {
  return {
    hex: "3c6444",
    flight: "DLH570",
    flightTx: true,
    messages: 40,
    lat: 12.2,
    lon: 15.1,
    altM: 10668,
    gsKmh: 820,
    track: 180,
    climbMs: 0,
    squawk: "2000",
    icaoType: "A20N",
    reg: null,
    rssi: -12,
    emergency: null,
    seenS: 3,
    onGround: false,
    category: "A3",
    nic: 8,
    nacp: 9,
    sil: null,
    military: false,
    posSource: "adsb",
    rcM: null,
    ...over,
  };
}

describe("transpondeur : ce que l'antenne a vraiment entendu, rien de plus", () => {
  it("position ADS-B entendue par l'antenne : une trame DF17, à l'heure de la mesure", () => {
    const t = liveAcToTrack(avion({ via: "antenne" }), T);
    assert.equal(t.iff!.mode, "ADS-B");
    assert.equal(t.iff!.surveillance, "adsb");
    assert.deepEqual(t.iff!.replies, [
      {
        id: `df17-3c6444-${T - 3000}`,
        df: "DF17",
        label: "ADS-B squitter 1090ES",
        icao24: "3C6444",
        at: T - 3000,
        siteId: "antenne-1090",
        siteName: "1090ES antenne du poste",
        bds: "0,5",
        payload: "12.2000 15.1000 FL350",
        solicited: false,
      },
    ]);
    assert.deepEqual(t.sensors, ["antenne"]);
    assert.deepEqual(t.launchFix, {
      lat: 12.2,
      lon: 15.1,
      at: T - 3000,
      method: "1090ES antenne du poste",
    });
  });

  it("position MLAT du réseau : Mode S sans ADS-B, et aucune trame DF17 inventée", () => {
    const t = liveAcToTrack(avion({ posSource: "mlat" }), T);
    assert.equal(t.iff!.mode, "S");
    assert.equal(t.iff!.surveillance, "modes");
    assert.deepEqual(t.iff!.replies, []);
    assert.deepEqual(t.sensors, ["reseau"]);
    assert.equal(t.launchFix!.method, "1090ES réseau");
    // Source de position non annoncée : pas de DF17 non plus.
    assert.deepEqual(liveAcToTrack(avion({ posSource: "autre" }), T).iff!.replies, []);
    // Le relevé réseau, en ADS-B : la trame dit d'où elle vient.
    assert.equal(liveAcToTrack(avion(), T).iff!.replies[0]!.siteName, "1090ES réseau");
  });

  it("comptes, ligne de preuve et cascade : seulement des pistes entendues", () => {
    const adsb = liveAcToTrack(avion({ squawk: "7700", via: "antenne" }), T);
    const mlat = liveAcToTrack(avion({ hex: "0d0e4f", posSource: "mlat", seenS: 1 }), T);
    const autre = liveAcToTrack(avion({ hex: "0a0b0c", posSource: "autre" }), T);
    const perdu = { ...liveAcToTrack(avion({ hex: "aaaaaa" }), T), idState: "perdu" } as Track;
    assert.deepEqual(countModeS([adsb, mlat, autre, perdu]), { adsb: 1, modes: 2 });
    assert.equal(
      iffEvidenceLine(adsb),
      "ADS-B 1090ES 3C6444 · squawk 7700 · position émise par l'appareil (DF17). AfriControl n'émet pas.",
    );
    assert.match(
      iffEvidenceLine(mlat)!,
      /^Mode S sans ADS-B 0D0E4F · squawk 2000 · position MLAT du réseau\./,
    );
    assert.match(iffEvidenceLine(autre)!, /position de source non annoncée/);
    assert.equal(iffEvidenceLine({ ...adsb, iff: null }), null);
    assert.equal(surveillanceLabel("adsb"), "ADS-B 1090ES");
    // La plus récente d'abord, une piste perdue n'y est plus, et la fenêtre est bornée.
    const plusRecente = liveAcToTrack(avion({ hex: "bbbbbb", seenS: 0 }), T);
    assert.deepEqual(
      collectWaterfall([adsb, plusRecente, perdu]).map((r) => r.icao24),
      ["BBBBBB", "3C6444"],
    );
    assert.equal(collectWaterfall([adsb, plusRecente], 1).length, 1);
  });

  it("la méthode dit d'où vient la piste : antenne, réseau, rejeu ou exercice", () => {
    assert.match(
      methodBlurb(liveAcToTrack(avion({ via: "antenne" }), T)),
      /^1090ES en direct, antenne du poste · DLH570 · 3C6444/,
    );
    assert.match(methodBlurb(liveAcToTrack(avion(), T)), /^1090ES en direct, relevé réseau ·/);
    assert.match(
      methodBlurb({ ...liveAcToTrack(avion(), T), feed: "rejeu" }),
      /^REJEU RÉEL 1090ES/,
    );
    const exe = pisteExercice(
      { id: "d1", name: "Aile-03" },
      "dji-mavic-3t",
      {
        position: { lat: 12.1, lon: 15, altM: 320, hauteurM: 25, vitesseMs: 4, cap: 0, a: T },
        ageMs: 0,
      },
      T,
    )!;
    assert.equal(
      methodBlurb(exe),
      "EXERCICE · vol réel de notre drone Aile-03 (liaison MAVLink), joue DJI Mavic 3T · pas un contact réel",
    );
  });
});
