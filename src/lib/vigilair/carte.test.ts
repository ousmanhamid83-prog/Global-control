import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anneauxGeo,
  calageGeo,
  cercle,
  coinsMapLibre,
  contoursFondsGeo,
  etiquettePiste,
  mesureGeo,
  nosDronesGeo,
  pistesGeo,
  pointA,
  secondesVecteur,
  suivieGeo,
  tracesGeo,
  vecteursGeo,
  zoomPourLargeur,
  type Allure,
  type Collection,
  type Position,
} from "./carte-donnees.ts";
import { coteIcone, lireNom } from "./carte-icones.ts";
import {
  aeroportGeo,
  axesGeo,
  brouillageGeo,
  captureGeo,
  eauxGeo,
  frontieresGeo,
  hydroGeo,
  meteoGeo,
  minesGeo,
  mondeGeo,
  phenomenesGeo,
  picsGeo,
  pixelsGeo,
  routeNavGeo,
  routesLacGeo,
  zoneGpsGeo,
  zonesGeo,
} from "./carte-theatre.ts";
import type { OwnDrone } from "./drones-core.ts";
import { etatFond, fondsAPoser, poserImageFond } from "./drones-dessin.ts";
import type { Coins } from "./drones-fond.ts";
import { haversineKm, headingBetween } from "./geo.ts";
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
    hypotheses: [],
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

const ALLURE: Allure = { couleur: "#e48080", affil: "hostile", forme: "aile", tourne: true };
const props = (c: Collection, i = 0) => c.features[i]!.properties;
const coords = (c: Collection, i = 0) =>
  (c.features[i]!.geometry as { coordinates: unknown }).coordinates;

describe("carte : les échelles du poste deviennent des zooms de la bibliothèque", () => {
  it("à ce zoom, la largeur de la carte couvre exactement la distance voulue", () => {
    for (const [km, px, lat] of [
      [96, 1000, 12.13],
      [1.2, 1150, 12.13],
      [5200, 900, 0],
    ] as const) {
      const z = zoomPourLargeur(km, px, lat);
      const metresParPixel = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);
      assert.ok(Math.abs(metresParPixel * px - km * 1000) < 1e-6 * km * 1000, `${km} km`);
    }
  });

  it("deux fois plus large ou deux fois moins de pixels : un zoom de moins", () => {
    const z = zoomPourLargeur(96, 1000, 12);
    assert.ok(Math.abs(zoomPourLargeur(192, 1000, 12) - (z - 1)) < 1e-9);
    assert.ok(Math.abs(zoomPourLargeur(96, 500, 12) - (z - 1)) < 1e-9);
    // Une carte pas encore mesurée (0 px) n'en fait pas un zoom infini.
    assert.ok(Number.isFinite(zoomPourLargeur(96, 0, 12)));
  });

  it("la durée du vecteur vitesse suit la largeur : 1 s de près, 1 min à 120 km, 5 min au-delà", () => {
    assert.equal(secondesVecteur(1.2), 1);
    assert.equal(secondesVecteur(2.4), 2);
    assert.equal(secondesVecteur(96), 60);
    assert.equal(secondesVecteur(120), 60);
    assert.equal(secondesVecteur(240), 120);
    assert.equal(secondesVecteur(5200), 300);
  });
});

describe("carte : distances au sol", () => {
  it("un point à 10 km au 060 est à 10 km, dans ce cap", () => {
    const q = pointA(12.13, 15.03, 60, 10);
    assert.ok(Math.abs(haversineKm(12.13, 15.03, q.lat, q.lon) - 10) < 0.01);
    assert.ok(Math.abs(headingBetween(12.13, 15.03, q.lat, q.lon) - 60) < 0.5);
  });

  it("passé l'antiméridien, la longitude repart à -180 (pas 180,4)", () => {
    const q = pointA(0, 179.9, 90, 50);
    assert.ok(q.lon < -179 && q.lon >= -180, String(q.lon));
  });

  it("un cercle de 20 km : chaque sommet à 20 km, anneau fermé, [longitude, latitude]", () => {
    const c = cercle(12.13, 15.03, 20, 32);
    assert.equal(c.length, 33);
    assert.deepEqual(c[0], c[32]);
    for (const [lon, lat] of c)
      assert.ok(Math.abs(haversineKm(12.13, 15.03, lat, lon) - 20) < 0.02);
    // Le premier sommet est au nord du centre : la latitude est bien en second.
    assert.ok(c[0]![1] > 12.13 && Math.abs(c[0]![0] - 15.03) < 1e-9);
    // Il fait tout le tour : des sommets au sud, à l'est et à l'ouest du centre.
    assert.ok(c.some(([, lat]) => lat < 12.13 - 0.17));
    assert.ok(c.some(([lon]) => lon > 15.03 + 0.17) && c.some(([lon]) => lon < 15.03 - 0.17));
  });
});

describe("carte : les pistes reçues", () => {
  const opts = (o: Partial<Parameters<typeof pistesGeo>[1]> = {}) => ({
    selectedId: null,
    large: false,
    symboles: true,
    detaillee: false,
    allure: () => ALLURE,
    ami: () => false,
    plateforme: () => ({ name: "Bayraktar TB2", uasClass: "male" }),
    ...o,
  });

  it("chaque piste est un point [longitude, latitude] avec son cadre APP-6 et sa forme tournée au cap", () => {
    const c = pistesGeo([track({ id: "a", lat: 12.5, lon: 14.2, heading: 135 })], opts());
    assert.deepEqual(coords(c), [14.2, 12.5]);
    assert.equal(props(c).cadre, "cadre|hostile|#e48080|11");
    assert.equal(props(c).forme, "forme|aile|#e48080");
    assert.equal(props(c).cap, 135);
    assert.equal(props(c).sel, false);
  });

  it("verrouillée : grand cadre et sélection ; échelle large : petit cadre et un point, sans cap", () => {
    const v = pistesGeo([track({ locked: true })], opts());
    assert.equal(props(v).cadre, "cadre|hostile|#e48080|13");
    assert.equal(props(v).sel, true);
    assert.equal(props(v).verrou, true);
    const l = pistesGeo([track({ heading: 200 })], opts({ large: true }));
    assert.equal(props(l).cadre, "cadre|hostile|#e48080|6");
    assert.equal(props(l).forme, "point|#e48080|3");
    assert.equal(props(l).cap, 0);
    // Sans cadres (formes de plateforme), la forme tourne même au large.
    const f = pistesGeo([track({ heading: 200 })], opts({ large: true, symboles: false }));
    assert.equal(props(f).cadre, "");
    assert.equal(props(f).cap, 200);
  });

  it("une forme qui ne tourne pas (ami hors 1090) garde le nord", () => {
    const c = pistesGeo(
      [track({ heading: 77 })],
      opts({ allure: () => ({ ...ALLURE, tourne: false }) }),
    );
    assert.equal(props(c).cap, 0);
  });

  it("au large, un ami ordinaire se tait ; sélection, urgence et drone gardent leur étiquette, en tête", () => {
    const c = pistesGeo(
      [
        track({ id: "ami" }),
        track({ id: "sel" }),
        track({ id: "urg", emergency: "7700" } as Partial<Track>),
        track({ id: "b6", category: "b6" } as Partial<Track>),
        // Un autre modèle, reconnu à son seul type OACI.
        track({ id: "tb2", icaoType: "BTB2" } as Partial<Track>),
      ],
      opts({ large: true, ami: () => true, selectedId: "sel" }),
    );
    const parId = new Map(c.features.map((f) => [f.properties.id, f.properties]));
    assert.equal(parId.get("ami")!.l1, "");
    assert.notEqual(parId.get("sel")!.l1, "");
    assert.notEqual(parId.get("urg")!.l1, "");
    assert.notEqual(parId.get("b6")!.l1, "");
    assert.notEqual(parId.get("tb2")!.l1, "");
    assert.deepEqual(
      ["sel", "urg", "b6", "tb2", "ami"].map((id) => parId.get(id)!.rang),
      [0, 1, 2, 2, 3],
    );
    assert.equal(parId.get("b6")!.drone, true);
    assert.equal(parId.get("tb2")!.drone, true);
    assert.equal(parId.get("ami")!.drone, false);
    assert.equal(parId.get("urg")!.urgence, true);
  });

  it("un GNSS douteux (NIC < 5) est dit ; NIC 5 ne l'est pas", () => {
    assert.equal(props(pistesGeo([track({ nic: 4 } as Partial<Track>)], opts())).douteux, true);
    assert.equal(props(pistesGeo([track({ nic: 5 } as Partial<Track>)], opts())).douteux, false);
  });

  it("l'étiquette dit d'où vient la piste : rejeu, exercice, 1090 (militaire, UAV)", () => {
    const p = { name: "Bayraktar TB2", uasClass: "male" };
    assert.equal(
      etiquettePiste(track({ callsign: "AFR1", feed: "rejeu" }), p, false)[0],
      "AFR1 REJ",
    );
    assert.equal(
      etiquettePiste(track({ callsign: "EXE Aile-03", feed: "exercice" }), p, false)[0],
      "EXE Aile-03 EXERCICE",
    );
    assert.equal(
      etiquettePiste(
        track({ callsign: "R1702", category: "B6", military: true } as Partial<Track>),
        p,
        false,
      )[0],
      "R1702 MIL UAV 1090",
    );
    assert.equal(
      etiquettePiste(track({ callsign: "TB2X", icaoType: "BTB2" } as Partial<Track>), p, false)[0],
      "TB2X UAV 1090",
    );
  });

  it("la seconde ligne : mode et squawk du transpondeur, sinon altitude (et vitesse, plateforme de près)", () => {
    const p = { name: "Bayraktar TB2", uasClass: "male" };
    const iff = {
      mode: "ADS-B",
      squawk: "7000",
      icao24: "0A1B2C",
      flightId: "TEST",
      surveillance: "adsb",
      replies: [],
    };
    assert.equal(etiquettePiste(track({ iff } as Partial<Track>), p, false)[1], "ADS-B 7000");
    assert.equal(
      etiquettePiste(track({ iff } as Partial<Track>), p, true)[1],
      "ADS-B 7000 · Bayraktar TB2",
    );
    assert.equal(etiquettePiste(track({ altM: 1234.4 }), p, false)[1], "1234 m");
    assert.equal(
      etiquettePiste(track({ altM: 1234.4, speedKmh: 180.6 }), p, true)[1],
      "1234 m 181 km/h · Bayraktar TB2",
    );
    assert.equal(
      etiquettePiste(track({ altM: 6096 }), { name: "Su-25", uasClass: "chasse" }, true)[1],
      "FL200 200 km/h · Su-25",
    );
  });

  it("traces (deux positions au moins) et vecteurs vitesse au cap mesuré", () => {
    const t = track({
      trail: [
        { lat: 12, lon: 15 },
        { lat: 12.1, lon: 15.1 },
      ],
      locked: true,
    });
    const tr = tracesGeo([t, track({ id: "seul", trail: [{ lat: 1, lon: 1 }] })], () => ALLURE);
    assert.equal(tr.features.length, 1);
    assert.deepEqual(coords(tr), [
      [15, 12],
      [15.1, 12.1],
    ]);
    assert.equal(props(tr).verrou, true);
    const v = vecteursGeo(
      [track({ speedKmh: 360, heading: 90 }), track({ id: "lent", speedKmh: 5 })],
      60,
      () => ALLURE,
    );
    assert.equal(v.features.length, 1);
    const [[lon0, lat0], [lon1, lat1]] = coords(v) as Position[];
    assert.ok(Math.abs(haversineKm(lat0!, lon0!, lat1!, lon1!) - 6) < 0.01);
    assert.ok(Math.abs(headingBetween(lat0!, lon0!, lat1!, lon1!) - 90) < 0.5);
  });

  it("la piste suivie : sa route prédite, et le trait jusqu'à son premier relevé avec la distance", () => {
    assert.equal(suivieGeo(undefined).features.length, 0);
    const c = suivieGeo(
      track({
        lat: 12,
        lon: 15,
        launchFix: { lat: 12, lon: 14.9, at: 0, method: "1090ES réseau" },
      }),
    );
    assert.equal(props(c).quoi, "prediction");
    assert.deepEqual((coords(c) as Position[])[0], [15, 12]);
    const point = c.features.find((f) => f.geometry.type === "Point")!;
    assert.match(String(point.properties.nom), /^1er relevé · 10\.\d km$/);
  });
});

describe("carte : anneaux, mesure, images de nos sources", () => {
  it("les anneaux autour de FTTJ, chacun à son rayon, nommés au nord", () => {
    const c = anneauxGeo({ lat: 12.13, lon: 15.03 }, [20, 40]);
    assert.equal(c.features.length, 4);
    const nord = c.features[1]!;
    assert.equal(nord.properties.nom, "20 km");
    const [lon, lat] = (nord.geometry as { coordinates: Position }).coordinates;
    assert.ok(Math.abs(haversineKm(12.13, 15.03, lat, lon) - 20) < 0.01 && lat > 12.13);
  });

  it("la règle A→B : un point seul ; avec le curseur, un trait mobile ; B posé, un trait fixe, distance et azimut", () => {
    assert.equal(mesureGeo(null, null, null).features.length, 0);
    const a = { lat: 12, lon: 15 };
    assert.equal(mesureGeo(a, null, null).features.length, 1);
    const mobile = mesureGeo(a, null, { lat: 12, lon: 15.1 });
    assert.equal(
      mobile.features.find((f) => f.geometry.type === "LineString")!.properties.fixe,
      false,
    );
    const fixe = mesureGeo(a, { lat: 12.1, lon: 15 }, { lat: 0, lon: 0 });
    assert.equal(
      fixe.features.find((f) => f.geometry.type === "LineString")!.properties.fixe,
      true,
    );
    assert.equal(fixe.features.find((f) => f.properties.nom)!.properties.nom, "11.1 km · az 000°");
  });

  const COINS: Coins = [
    { lat: 12.136, lon: 15.054 },
    { lat: 12.136, lon: 15.056 },
    { lat: 12.134, lon: 15.056 },
    { lat: 12.134, lon: 15.054 },
  ];

  it("les coins d'une image dans l'ordre de MapLibre : haut gauche, haut droit, bas droit, bas gauche", () => {
    assert.deepEqual(coinsMapLibre(COINS), [
      [15.054, 12.136],
      [15.056, 12.136],
      [15.056, 12.134],
      [15.054, 12.134],
    ]);
  });

  it("chaque image posée a son contour fermé et son nom à l'heure de l'image", () => {
    const c = contoursFondsGeo([
      { nom: "Aile-03", a: Date.UTC(2026, 10, 17, 9, 41, 7), coins: COINS },
    ]);
    assert.equal((coords(c) as Position[]).length, 5);
    assert.deepEqual((coords(c) as Position[])[0], (coords(c) as Position[])[4]);
    assert.equal(props(c, 1).nom, "Aile-03 · image 09:41:07 Z");
  });

  it("un calage en cours : coins numérotés ; le tracé ne se ferme qu'au quatrième", () => {
    const noms = ["haut-gauche", "haut-droit", "bas-droit", "bas-gauche"];
    assert.equal(calageGeo([], noms).features.length, 0);
    const un = calageGeo(COINS.slice(0, 1), noms);
    assert.deepEqual(
      un.features.map((f) => f.properties.nom),
      ["1 · haut-gauche"],
    );
    const deux = calageGeo(COINS.slice(0, 2), noms);
    assert.equal(
      (
        deux.features.find((f) => f.geometry.type === "LineString")!.geometry as {
          coordinates: Position[];
        }
      ).coordinates.length,
      2,
    );
    const trois = calageGeo(COINS.slice(0, 3), noms);
    assert.equal(
      (
        trois.features.find((f) => f.geometry.type === "LineString")!.geometry as {
          coordinates: Position[];
        }
      ).coordinates.length,
      3,
    );
    const quatre = calageGeo(COINS, noms);
    assert.equal(
      (
        quatre.features.find((f) => f.geometry.type === "LineString")!.geometry as {
          coordinates: Position[];
        }
      ).coordinates.length,
      5,
    );
  });
});

describe("carte : nos drones, par leur liaison", () => {
  const drones = [
    {
      id: "d1",
      name: "Aile-03",
      patrouille: {
        points: [
          { lat: 12.134, lon: 15.052 },
          { lat: 12.1345, lon: 15.0505 },
        ],
      },
    },
  ];
  const base = {
    couleur: "#4cc38a",
    muet: "#94a7af",
    designation: false,
    rayonKm: 3,
    designe: null,
  };
  const suivi = (o: Partial<Parameters<typeof nosDronesGeo>[0][number]> = {}) => [
    {
      id: "d1",
      vivant: true,
      mode: "GUIDED",
      position: { lat: 12.135, lon: 15.06, hauteurM: 30.4, cap: 270 },
      depart: { lat: 12.134, lon: 15.068 },
      ...o,
    },
  ];

  it("le drone : cadre ami, trait de cap, nom et hauteur ; départ et circuit numéroté", () => {
    const c = nosDronesGeo(suivi(), drones, base);
    const de = (q: string) => c.features.filter((f) => f.properties.quoi === q);
    const d = de("drone")[0]!;
    assert.deepEqual((d.geometry as { coordinates: Position }).coordinates, [15.06, 12.135]);
    assert.equal(d.properties.icone, "cadre|ami|#4cc38a|10");
    assert.equal(d.properties.fleche, "cap|#4cc38a");
    assert.equal(d.properties.cap, 270);
    assert.equal(d.properties.l1, "Aile-03 · NOTRE DRONE");
    assert.equal(d.properties.l2, "30 m · GUIDED");
    assert.equal(de("depart")[0]!.properties.nom, "D");
    assert.equal(de("circuit").length, 1);
    assert.deepEqual(
      de("etape").map((f) => f.properties.nom),
      ["1", "2"],
    );
    assert.equal(de("rayon").length, 0);
  });

  it("liaison muette : couleur atténuée et « MUET » ; sans cap, pas de trait de cap", () => {
    const c = nosDronesGeo(
      suivi({ vivant: false, position: { lat: 12, lon: 15, hauteurM: 0, cap: null } }),
      drones,
      base,
    );
    const d = c.features.find((f) => f.properties.quoi === "drone")!;
    assert.equal(d.properties.icone, "cadre|ami|#94a7af|10");
    assert.equal(d.properties.l1, "Aile-03 · NOTRE DRONE · MUET");
    assert.equal(d.properties.fleche, "");
  });

  it("pendant une désignation : le rayon permis autour du départ, et le point désigné", () => {
    const c = nosDronesGeo(suivi(), drones, {
      ...base,
      designation: true,
      designe: { lat: 12.14, lon: 15.07 },
    });
    const rayon = c.features.find((f) => f.properties.quoi === "rayon")!;
    const [lon, lat] = (rayon.geometry as { coordinates: Position[] }).coordinates[0]!;
    assert.ok(Math.abs(haversineKm(12.134, 15.068, lat, lon) - 3) < 0.01);
    assert.equal(
      c.features.find((f) => f.properties.quoi === "designe")!.properties.nom,
      "POINT DÉSIGNÉ",
    );
    // Sans rayon connu (réglages pas encore reçus), pas de cercle inventé.
    assert.equal(
      nosDronesGeo(suivi(), drones, { ...base, designation: true, rayonKm: null }).features.some(
        (f) => f.properties.quoi === "rayon",
      ),
      false,
    );
  });

  it("un drone retiré du registre, ou sans position, n'est pas placé", () => {
    assert.equal(nosDronesGeo(suivi({ id: "inconnu" }), drones, base).features.length, 0);
    const sans = nosDronesGeo(suivi({ position: null }), drones, base);
    assert.equal(
      sans.features.some((f) => f.properties.quoi === "drone"),
      false,
    );
  });
});

describe("carte : le théâtre", () => {
  it("les frontières sont coupées là où elles sautent l'antiméridien", () => {
    const c = frontieresGeo([
      {
        p: [
          [
            [179, 0],
            [180, 1],
            [-179, 2],
            [-178, 3],
          ],
        ],
      },
    ]);
    assert.equal(c.features.length, 2);
    assert.deepEqual(coords(c, 0), [
      [179, 0],
      [180, 1],
    ]);
  });

  it("le monde : graticule de 30°, États sauf ceux mis à part, le Tchad marqué", () => {
    const c = mondeGeo(
      [
        { n: "Tchad", lat: 15, lon: 19, a: 107 },
        { n: "Antarctique", lat: -80, lon: 0, a: 1000 },
      ],
      [{ n: "Malte", lat: 35.9, lon: 14.4, r: 2 }],
      [{ name: "AFRIQUE", lat: 4, lon: 20 }],
      { sauf: new Set(["Antarctique"]), rang: () => 1 },
    );
    assert.equal(c.features.filter((f) => f.properties.quoi === "graticule").length, 5 + 13);
    const etats = c.features.filter((f) => f.properties.quoi === "etat");
    assert.deepEqual(
      etats.map((f) => f.properties.nom),
      ["Tchad", "Malte"],
    );
    assert.equal(etats[0]!.properties.tchad, true);
    assert.equal(etats[1]!.properties.rang, 2);
  });

  it("eaux : l'enveloppe AES se referme ; le lac est une surface", () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 1, lon: 1 },
    ];
    const c = eauxGeo({ chari: pts, logone: pts, lac: pts, aes: pts });
    const aes = c.features.find((f) => f.properties.quoi === "aes")!;
    assert.equal((aes.geometry as { coordinates: Position[] }).coordinates.length, 4);
    assert.equal(c.features.find((f) => f.properties.quoi === "lac")!.geometry.type, "Polygon");
  });

  it("zones et mines : un cercle à leur rayon, leur niveau du moment, leur nom", () => {
    const zones = zonesGeo(
      [{ id: "z", name: "FTTJ", lat: 12.13, lon: 15.03, radiusKm: 3, armed: true }],
      () => "intrusion",
    );
    assert.equal(zones.features[0]!.properties.niveau, "intrusion");
    assert.equal(zones.features[0]!.properties.arme, true);
    const [lon, lat] = (zones.features[0]!.geometry as { coordinates: Position[][] })
      .coordinates[0]![0]!;
    assert.ok(Math.abs(haversineKm(12.13, 15.03, lat, lon) - 3) < 0.01);
    const mines = minesGeo(
      [{ id: "m", short: "Mongo", commodity: "or", lat: 12, lon: 18, radiusKm: 5 }],
      { mineId: "m", niveau: () => "veille" },
    );
    assert.equal(mines.features[1]!.properties.nom, "Mongo · or");
    assert.equal(
      minesGeo([{ id: "m", short: "Mongo", commodity: "or", lat: 12, lon: 18, radiusKm: 5 }], {
        mineId: null,
        niveau: () => "veille",
      }).features[1]!.properties.nom,
      "Mongo",
    );
  });

  it("axes, routes du lac, eaux, pics, route de navigation, zone GPS : traits et noms", () => {
    const axes = axesGeo(
      { lat: 12, lon: 15 },
      [{ id: "a", short: "Abéché", lat: 13.8, lon: 20.8 }],
      { axisId: "a", km: () => 650.4 },
    );
    assert.equal(axes.features[1]!.properties.nom, "Abéché 650 km");
    const lac = routesLacGeo(
      [
        {
          id: "r",
          short: "Bol",
          craft: "jetski",
          waypoints: [
            { lat: 13, lon: 14 },
            { lat: 13.2, lon: 14.3 },
            { lat: 13.4, lon: 14.6 },
          ],
        },
      ],
      { routeId: null, km: () => 42 },
    );
    assert.equal(
      lac.features.find((f) => f.properties.quoi === "nom")!.properties.nom,
      "JET Bol 42.0 km",
    );
    const hy = hydroGeo(
      [{ id: "h", short: "Chari", lat: 12, lon: 15, radiusKm: 1, circle: true, region: "tchad" }],
      { waterId: null, km: () => 0 },
    );
    assert.deepEqual(
      hy.features.map((f) => f.geometry.type),
      ["Polygon", "Point"],
    );
    // Un repère sans cercle d'ordre de grandeur (le lac Tchad a déjà sa surface) : un point seul.
    const repere = hydroGeo(
      [{ id: "l", short: "Lac", lat: 13, lon: 14, radiusKm: 40, circle: false, region: "tchad" }],
      { waterId: null, km: () => 0 },
    );
    assert.deepEqual(
      repere.features.map((f) => f.geometry.type),
      ["Point"],
    );
    const pics = picsGeo(
      [{ id: "e", name: "Emi Koussi", lat: 19.8, lon: 18.5, elevM: 3415, mark: true }],
      { peakId: "e", couleur: "#4fd1c5" },
    );
    assert.equal(pics.features[0]!.properties.icone, "triangle|#4fd1c5|1");
    assert.equal(
      picsGeo([{ id: "e", name: "Emi Koussi", lat: 19.8, lon: 18.5, elevM: 3415, mark: true }], {
        peakId: null,
        couleur: "#4fd1c5",
      }).features[0]!.properties.icone,
      "triangle|#4fd1c5|0",
    );
    assert.equal(pics.features[0]!.properties.nom, "Emi Koussi 3415 m");
    assert.equal(routeNavGeo(null).features.length, 0);
    assert.equal(routeNavGeo({ points: [{ lat: 1, lon: 1 }], hazards: [] }).features.length, 0);
    const nav = routeNavGeo({
      points: [
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 },
        { lat: 3, lon: 3 },
      ],
      hazards: [{ lat: 1.5, lon: 1.5 }],
    });
    assert.deepEqual(
      nav.features.filter((f) => f.properties.quoi === "etape").map((f) => f.properties.nom),
      ["départ", "ét.1", "arrivée"],
    );
    const gps = zoneGpsGeo({ lat: 12, lon: 15, radiusKm: 2, nom: "Puits", coord: "12° N" });
    assert.equal(gps.features[1]!.properties.nom, "Puits\n12° N");
  });

  it("météo et phénomènes : catégorie de vol en couleur, SIGMET du théâtre seuls, feux VIIRS datés", () => {
    const m = meteoGeo(
      [
        { icao: "FTTJ", cat: "IFR", lat: 12.13, lon: 15.03 },
        { icao: "DRRN", cat: "MVFR", lat: 13.48, lon: 2.18 },
        { icao: "XXXX", cat: "VFR", lat: null, lon: null },
        { icao: "YYYY", cat: "VFR", lat: 10, lon: null },
      ],
      [
        {
          inAo: true,
          coords: [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 0 },
            { lat: 1, lon: 1 },
          ],
        },
        {
          inAo: false,
          coords: [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 0 },
            { lat: 1, lon: 1 },
          ],
        },
      ],
      { ok: "#00aa00", warn: "#aaaa00", crit: "#aa0000" },
    );
    assert.deepEqual(
      m.features.filter((f) => f.properties.quoi === "metar").map((f) => f.properties.icone),
      ["point|#aa0000|5", "point|#aaaa00|5"],
    );
    assert.equal(m.features.filter((f) => f.properties.quoi === "sigmet").length, 1);
    const ph = phenomenesGeo(
      [
        {
          id: "f",
          kind: "feu",
          source: "NASA FIRMS",
          title: "Feu",
          lat: 12,
          lon: 15,
          level: "moderee",
          theater: "tchad",
        },
        {
          id: "s",
          kind: "seisme",
          source: "USGS",
          title: "Séisme M5.1 très loin du poste",
          lat: 0,
          lon: 0,
          level: "critique",
          theater: "monde",
        },
      ],
      {
        ageFeu: () => "il y a 2 h",
        couleurs: { crit: "#aa0000", warn: "#aaaa00", ice: "#00aaaa" },
      },
    );
    assert.equal(ph.features[0]!.properties.nom, "VIIRS il y a 2 h");
    assert.equal(ph.features[0]!.properties.icone, "");
    assert.equal(ph.features[1]!.properties.icone, "point|#aa0000|6");
    assert.equal(String(ph.features[1]!.properties.nom).length, 28);
    assert.equal(
      brouillageGeo([
        { lat: 1, lon: 1, level: "low" },
        { lat: 2, lon: 2, level: "high" },
      ]).features.length,
      1,
    );
  });

  it("FTTJ : la piste à sa longueur, le repère et la catégorie METAR ; la scène ouverte et ses objets mesurés", () => {
    const ap = aeroportGeo({ lat: 12.13, lon: 15.03 }, "VFR", (cap) =>
      pointA(12.13, 15.03, cap, 1.4),
    );
    const piste = (ap.features[0]!.geometry as { coordinates: Position[] }).coordinates;
    assert.ok(
      Math.abs(haversineKm(piste[0]![1], piste[0]![0], piste[1]![1], piste[1]![0]) - 2.8) < 0.01,
    );
    assert.equal(ap.features[1]!.properties.nom, "FTTJ VFR");
    assert.equal(
      aeroportGeo({ lat: 0, lon: 0 }, null, () => ({ lat: 0, lon: 0 })).features[1]!.properties.nom,
      "FTTJ",
    );
    assert.equal(captureGeo(null).features.length, 0);
    const sc = captureGeo({
      lat: 12,
      lon: 15,
      title: "Scène ident",
      gsd: "0.3 m",
      objects: [
        {
          id: "v1",
          lat: 12.001,
          lon: 15.001,
          label: "Véhicule",
          kind: "vehicule",
          resolvable: true,
        },
        { id: "gsd", lat: 12, lon: 15, label: "GSD", kind: "x", resolvable: true },
        { id: "v2", lat: 12.002, lon: 15, label: "Flou", kind: "x", resolvable: false },
        { id: "v3", lat: null, lon: null, label: "Sans lieu", kind: "x", resolvable: true },
      ],
    });
    assert.equal(sc.features[0]!.properties.nom, "Scène ident\nGSD 0.3 m");
    assert.deepEqual(
      sc.features.slice(1).map((f) => f.properties.nom),
      ["Véhicule"],
    );
  });
});

describe("carte : l'analyse des pixels de l'image", () => {
  it("un repère par objet mesuré (H, V, P et sa classe) ; un foyer daté, voiture ou non", () => {
    const c = pixelsGeo(
      {
        hits: [
          { id: "voiture", lat: 12.1, lon: 15.1, cls: "detection" },
          { id: "pirogue", lat: 12.2, lon: 15.2, cls: "reconnaissance" },
          { id: "homme", lat: 12.3, lon: 15.3, cls: "detection" },
        ],
        fires: [
          { kind: "vehicule", lat: 12.12345, lon: 15.06789 },
          { kind: "naturel", lat: 12.5, lon: 15.5 },
        ],
      },
      { classe: (cls) => `«${cls}»`, ageFeu: (id) => `[${id}]` },
    );
    assert.deepEqual(
      c.features.map((f) => f.properties.nom),
      [
        "V «detection»",
        "P «reconnaissance»",
        "H «detection»",
        "feu voiture [px-12.123-15.068]",
        "feu [px-12.500-15.500]",
      ],
    );
    assert.deepEqual(
      c.features.map((f) => f.properties.feu),
      [false, false, false, true, true],
    );
    assert.deepEqual(coords(c, 3), [15.06789, 12.12345]);
  });
});

describe("carte : les noms des symboles", () => {
  it("un nom de symbole se relit ; un nom étranger ou abîmé est refusé", () => {
    assert.deepEqual(lireNom("cadre|hostile|#c45c5c|11"), {
      type: "cadre",
      affil: "hostile",
      couleur: "#c45c5c",
      rayon: 11,
    });
    assert.deepEqual(lireNom("forme|aile|#8aa0b8"), {
      type: "forme",
      forme: "aile",
      couleur: "#8aa0b8",
    });
    assert.deepEqual(lireNom("triangle|#4fd1c5|1"), {
      type: "triangle",
      couleur: "#4fd1c5",
      plein: true,
    });
    assert.deepEqual(lireNom("triangle|#4fd1c5|0"), {
      type: "triangle",
      couleur: "#4fd1c5",
      plein: false,
    });
    assert.deepEqual(lireNom("point|#4fd1c5|5"), { type: "point", couleur: "#4fd1c5", cote: 5 });
    for (const faux of [
      "cadre|ennemi|#c45c5c|11",
      "cadre|hostile|rouge|11",
      "cadre|hostile|#c45c5c|90",
      "forme|ovni|#ffffff",
      "point|#ffffff|0",
      "marker-15",
      "",
    ]) {
      assert.equal(lireNom(faux), null, faux);
    }
  });

  it("le côté de l'image suit le symbole : un cadre plus grand pour une piste verrouillée", () => {
    assert.ok(
      coteIcone(lireNom("cadre|ami|#ffffff|13")!) > coteIcone(lireNom("cadre|ami|#ffffff|11")!),
    );
    assert.equal(coteIcone(lireNom("cap|#ffffff")!), 48);
  });
});

describe("carte : les images de nos sources à poser", () => {
  const COINS_POSES: Coins = [
    { lat: 12.136, lon: 15.054 },
    { lat: 12.136, lon: 15.056 },
    { lat: 12.134, lon: 15.056 },
    { lat: 12.134, lon: 15.054 },
  ];
  // Ce que la carte lit d'une image : sa taille et son adresse (data: URL de la station du drone).
  const image = (src: string) => ({ width: 400, height: 300, src }) as unknown as HTMLImageElement;
  const source = (o: Partial<OwnDrone>): OwnDrone =>
    ({ id: "s", name: "Cam-Portail", ident: "", site: "FTTJ", ...o }) as OwnDrone;

  it("calée par ses quatre coins : posée entre eux, l'image reçue elle-même, avec son heure", () => {
    const cam = source({ id: "cam", fond: { mode: "coins", coins: COINS_POSES } });
    const recue = image("data:image/jpeg;base64,AAA");
    poserImageFond(cam, recue, 1000, null);
    const fonds = fondsAPoser([cam], null);
    assert.deepEqual(fonds, [
      { id: "cam", nom: "Cam-Portail", image: recue, a: 1000, coins: COINS_POSES },
    ]);
    assert.equal(fonds[0]!.image, recue);
  });

  it("emprise calculée : posée seulement si le drone avait position, cap et hauteur à l'instant de l'image", () => {
    const d = source({ id: "d", name: "Aile-03", fond: { mode: "drone", champDeg: 90 } });
    poserImageFond(d, image("data:a"), 1, null);
    assert.deepEqual(fondsAPoser([d], null), []);
    assert.equal(etatFond(d)!.posee, false);
    poserImageFond(d, image("data:b"), 2, { lat: 12.134, lon: 15.068, hauteurM: 100, cap: 0 });
    const [f] = fondsAPoser([d], null);
    // 200 m de large à 100 m sous un champ de 90° : le haut de l'image vers le nord (cap 0).
    assert.ok(
      Math.abs(
        haversineKm(f!.coins[0].lat, f!.coins[0].lon, f!.coins[1].lat, f!.coins[1].lon) - 0.2,
      ) < 0.001,
    );
    assert.ok(f!.coins[0].lat > 12.134 && f!.coins[3].lat < 12.134);
    assert.equal(etatFond(d)!.posee, true);
    // Le chef retire l'image de la carte : le drone n'a plus de calage, son image n'est plus posée.
    assert.deepEqual(fondsAPoser([{ ...d, fond: undefined }], null), []);
  });

  it("un calage en cours remplace l'ancien : posé au quatrième coin valable, rien tant qu'il est faux", () => {
    const cam = source({ id: "c2", fond: { mode: "coins", coins: COINS_POSES } });
    poserImageFond(cam, image("data:c"), 3, null);
    assert.deepEqual(fondsAPoser([cam], { id: "c2", coins: COINS_POSES.slice(0, 3) }), []);
    const croises = [COINS_POSES[0], COINS_POSES[2], COINS_POSES[1], COINS_POSES[3]];
    assert.deepEqual(fondsAPoser([cam], { id: "c2", coins: croises }), []);
    const neufs: Coins = COINS_POSES.map((c) => ({ lat: c.lat + 0.01, lon: c.lon })) as Coins;
    assert.deepEqual(fondsAPoser([cam], { id: "c2", coins: neufs })[0]!.coins, neufs);
    // Le calage d'une AUTRE source ne touche pas celle-ci.
    assert.deepEqual(fondsAPoser([cam], { id: "autre", coins: [] })[0]!.coins, COINS_POSES);
  });

  it("une source sans calage n'est pas posée ; retirée du registre, son image est oubliée", () => {
    const libre = source({ id: "libre" });
    poserImageFond(libre, image("data:d"), 4, null);
    assert.deepEqual(fondsAPoser([libre], null), []);
    assert.notEqual(etatFond(libre), null);
    fondsAPoser([], null);
    assert.equal(etatFond(libre), null);
  });
});
