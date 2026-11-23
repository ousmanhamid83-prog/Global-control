import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track } from "./types.ts";
import { bulleDeLigne, evaluateZones, passagesDe, sorteDeBulle, type ZoneRow } from "./zones.ts";

const BULLE: ZoneRow = {
  id: "z1",
  name: "Bulle essai",
  kind: "aerodrome",
  lat: 0,
  lon: 0,
  radiusKm: 2,
  armed: true,
  note: "",
};

/** Une piste à `km` à l'est du centre de la bulle (1° de longitude ≈ 111,195 km sur l'équateur). */
function piste(id: string, km: number, over: Partial<Track> = {}): Track {
  return {
    id,
    callsign: id.toUpperCase(),
    lat: 0,
    lon: km / 111.195,
    altM: 100,
    heading: 270,
    speedKmh: 40,
    climbMs: 0,
    trail: [],
    truePlatformId: "adsb-uav",
    idState: "detecte",
    confidence: 90,
    origin: "XX",
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
    category: "B6",
    ...over,
  } as Track;
}

const passages = (pistes: Track[], bulles: ZoneRow[] = [BULLE]) =>
  passagesDe(evaluateZones(pistes, bulles));

describe("bulles : les passages consignés, par la console comme par le serveur", () => {
  it("un UAS (catégorie B6) dans une bulle armée : un passage « inside », réel", () => {
    assert.deepEqual(passages([piste("u1", 1)]), [
      {
        zoneId: "z1",
        zoneName: "Bulle essai",
        trackId: "u1",
        callsign: "U1",
        distKm: passages([piste("u1", 1)])[0]!.distKm,
        kind: "inside",
        uas: true,
        exercice: false,
      },
    ]);
    assert.ok(Math.abs(passages([piste("u1", 1)])[0]!.distKm - 1) < 1e-6);
  });

  it("bulle désarmée, trafic civil, nos drones reconnus, rejeu : rien à consigner", () => {
    assert.deepEqual(passages([piste("u1", 1)], [{ ...BULLE, armed: false }]), []);
    assert.deepEqual(passages([piste("c1", 1, { category: "A3" })]), []);
    assert.deepEqual(passages([piste("d1", 1, { friendKind: "drone" })]), []);
    assert.deepEqual(passages([piste("r1", 1, { feed: "rejeu" })]), []);
    assert.deepEqual(passages([piste("p1", 1, { idState: "perdu" })]), []);
  });

  it("une piste d'exercice dans la bulle : consignée, marquée exercice", () => {
    const [p] = passages([piste("exe-d", 0.5, { feed: "exercice", category: undefined })]);
    assert.equal(p?.kind, "inside");
    assert.equal(p?.exercice, true);
  });

  it("approche : vers la bulle, à plus de 8 km/h, à moins de 2,4 rayons", () => {
    assert.equal(passages([piste("a1", 4)])[0]?.kind, "approach");
    assert.deepEqual(passages([piste("a2", 4, { heading: 90 })]), [], "s'éloigne");
    assert.deepEqual(passages([piste("a3", 4, { speedKmh: 8 })]), [], "trop lent");
    assert.deepEqual(passages([piste("a4", 4.9)]), [], "au-delà de 2,4 rayons");
    assert.equal(passages([piste("a5", 4.7)])[0]?.kind, "approach");
  });

  it("dans chaque bulle, les entrées avant les approches ; les bulles dans leur ordre", () => {
    const deux: ZoneRow = { ...BULLE, id: "z2", name: "Autre", lat: 1 };
    const l = passages([piste("a1", 4), piste("u1", 1), piste("v1", 0, { lat: 1 })], [BULLE, deux]);
    assert.deepEqual(
      l.map((p) => `${p.zoneId}:${p.kind}:${p.trackId}`),
      ["z1:inside:u1", "z1:approach:a1", "z2:inside:v1"],
    );
  });

  it("une ligne du registre des bulles : nombres lus, sorte inconnue = « ministere »", () => {
    const ligne = {
      id: "b",
      name: "Pont",
      kind: "pont",
      lat: 12,
      lon: 15,
      radius_km: 2.5,
      armed: true,
      note: "",
    };
    assert.deepEqual(bulleDeLigne(ligne), {
      id: "b",
      name: "Pont",
      kind: "pont",
      lat: 12,
      lon: 15,
      radiusKm: 2.5,
      armed: true,
      note: "",
    });
    assert.equal(sorteDeBulle("sonar"), "ministere");
    for (const k of ["aerodrome", "palais", "camp", "pont", "ministere"]) {
      assert.equal(sorteDeBulle(k), k);
    }
  });
});
