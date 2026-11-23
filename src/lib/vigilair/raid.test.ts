import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectRaids,
  RAID_ALLURE,
  RAID_CAP_DEG,
  RAID_LIEN_KM,
  RAID_MIN,
  raidTrackIds,
} from "./raid.ts";
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
    ...over,
  } as Track;
}

/** À `km` à l'est d'un point (sur l'équateur, 1° de longitude ≈ 111,195 km). */
const a = (id: string, km: number, over: Partial<Track> = {}) =>
  track({ id, callsign: id.toUpperCase(), lat: 0, lon: km / 111.195, ...over });

describe("raid : des pistes non amies qui volent ensemble, mesuré sur les pistes reçues", () => {
  it("trois drones proches, même cap, même allure : un raid, son centre, son cap, sa clé", () => {
    const raids = detectRaids([
      a("u3", 0, { heading: 85, speedKmh: 160 }),
      a("u1", 4, { heading: 90, speedKmh: 150 }),
      a("u2", 8, { heading: 95, speedKmh: 140 }),
    ]);
    assert.equal(raids.length, 1);
    const r = raids[0]!;
    assert.equal(r.count, 3);
    assert.deepEqual(r.trackIds, ["u1", "u2", "u3"]);
    assert.equal(r.cle, "u1");
    assert.ok(Math.abs(r.cap - 90) < 1e-9);
    assert.ok(Math.abs(r.vitesseKmh - 150) < 1e-9);
    assert.ok(Math.abs(r.lat) < 1e-12 && Math.abs(r.lon - 4 / 111.195) < 1e-12);
    assert.equal(r.lieu, "0,00° N 0,04° E");
    assert.deepEqual([...raidTrackIds(raids)].sort(), ["u1", "u2", "u3"]);
  });

  it("le cap moyen se lit sur le cercle : 350°, 0° et 10° font 0°, pas 120°", () => {
    const [r] = detectRaids([
      a("u1", 0, { heading: 350 }),
      a("u2", 3, { heading: 0 }),
      a("u3", 6, { heading: 10 }),
    ]);
    assert.ok(r && Math.min(r.cap, 360 - r.cap) < 1e-9, String(r?.cap));
  });

  it("moins de trois, ou des pistes amies (ASECNA, civil, nos drones) : pas de raid", () => {
    assert.equal(RAID_MIN, 3);
    assert.deepEqual(detectRaids([a("u1", 0), a("u2", 3)]), []);
    for (const friendKind of ["asecna", "civil", "drone"] as const) {
      const trois = [
        a("f1", 0, { friendKind }),
        a("f2", 3, { friendKind }),
        a("f3", 6, { friendKind }),
      ];
      assert.deepEqual(detectRaids(trois), [], friendKind);
    }
    // Deux drones et un ami : le groupe n'a que deux pistes non amies.
    assert.deepEqual(
      detectRaids([a("u1", 0), a("u2", 3), a("f1", 6, { friendKind: "civil" })]),
      [],
    );
  });

  it("marquées militaires, elles comptent même affiliées civiles ; nos drones, jamais", () => {
    const mil = (id: string, km: number) => a(id, km, { friendKind: "civil", military: true });
    assert.equal(detectRaids([mil("m1", 0), mil("m2", 3), mil("m3", 6)]).length, 1);
    const nos = (id: string, km: number) => a(id, km, { friendKind: "drone", military: true });
    assert.deepEqual(detectRaids([nos("d1", 0), nos("d2", 3), nos("d3", 6)]), []);
  });

  it("de proche en proche : une chaîne de liens courts, oui ; un lien trop long, non", () => {
    assert.equal(RAID_LIEN_KM, 20);
    // 19 km entre voisins (38 km aux bouts) : un seul groupe.
    assert.equal(detectRaids([a("u1", 0), a("u2", 19), a("u3", 38)]).length, 1);
    assert.deepEqual(detectRaids([a("u1", 0), a("u2", 19), a("u3", 40)]), []);
  });

  it("même cap à 30° près, même allure à 1,35 fois près, et en mouvement (10 km/h au moins)", () => {
    assert.equal(RAID_CAP_DEG, 30);
    assert.equal(RAID_ALLURE, 1.35);
    const cap = (c: number) => [
      a("u1", 0, { heading: 90 }),
      a("u2", 3, { heading: 90 }),
      a("u3", 6, { heading: c }),
    ];
    assert.equal(detectRaids(cap(119)).length, 1);
    assert.equal(detectRaids(cap(121)).length, 0);
    const vit = (v: number) => [
      a("u1", 0, { speedKmh: 100 }),
      a("u2", 3, { speedKmh: 100 }),
      a("u3", 6, { speedKmh: v }),
    ];
    assert.equal(detectRaids(vit(135)).length, 1);
    assert.equal(detectRaids(vit(136)).length, 0);
    const sol = (v: number) => [
      a("u1", 0, { speedKmh: v }),
      a("u2", 3, { speedKmh: v }),
      a("u3", 6, { speedKmh: v }),
    ];
    assert.equal(detectRaids(sol(10)).length, 1, "un essaim lent : un raid");
    assert.equal(detectRaids(sol(9)).length, 0, "posés ou en stationnaire : pas un raid");
    assert.equal(detectRaids(sol(9.5)).length, 0, "9,5 km/h : encore sous le seuil");
  });

  it("pistes perdues ou hors mandat : écartées", () => {
    for (const idState of ["perdu", "hors-mandat"] as const) {
      assert.deepEqual(detectRaids([a("u1", 0), a("u2", 3), a("u3", 6, { idState })]), [], idState);
    }
  });

  it("deux groupes : les plus nombreux d'abord, puis les plus menaçants ; la tête est la plus menaçante", () => {
    const loin = (id: string, km: number, plat = "adsb-uav") =>
      a(id, km + 500, { truePlatformId: plat, hypotheses: [{ platformId: plat, score: 90 }] });
    const raids = detectRaids([
      a("a1", 0),
      a("a2", 3),
      a("a3", 6),
      loin("b1", 0, "dji-mini-4-pro"),
      loin("b2", 3, "ch-4b"),
      loin("b3", 6, "dji-mini-4-pro"),
      loin("b4", 9, "dji-mini-4-pro"),
    ]);
    assert.deepEqual(
      raids.map((r) => r.count),
      [4, 3],
    );
    assert.equal(raids[0]!.worst, "critique");
    assert.equal(raids[0]!.leadCallsign, "B2");
    // À nombre égal, le plus menaçant d'abord.
    const egal = detectRaids([
      loin("b1", 0, "dji-mini-4-pro"),
      loin("b2", 3, "dji-mini-4-pro"),
      loin("b3", 6, "dji-mini-4-pro"),
      a("a1", 0),
      a("a2", 3),
      a("a3", 6),
    ]);
    assert.deepEqual(
      egal.map((r) => r.worst),
      ["elevee", "faible"],
    );
    // Le plus nombreux d'abord, même moins menaçant : quatre petits drones avant trois gros.
    const nombre = detectRaids([
      loin("b1", 0, "ch-4b"),
      loin("b2", 3, "ch-4b"),
      loin("b3", 6, "ch-4b"),
      a("c1", 0, {
        truePlatformId: "dji-mini-4-pro",
        hypotheses: [{ platformId: "dji-mini-4-pro", score: 90 }],
      }),
      a("c2", 3, {
        truePlatformId: "dji-mini-4-pro",
        hypotheses: [{ platformId: "dji-mini-4-pro", score: 90 }],
      }),
      a("c3", 6, {
        truePlatformId: "dji-mini-4-pro",
        hypotheses: [{ platformId: "dji-mini-4-pro", score: 90 }],
      }),
      a("c4", 9, {
        truePlatformId: "dji-mini-4-pro",
        hypotheses: [{ platformId: "dji-mini-4-pro", score: 90 }],
      }),
    ]);
    assert.deepEqual(
      nombre.map((r) => [r.count, r.worst]),
      [
        [4, "faible"],
        [3, "critique"],
      ],
    );
  });
});
