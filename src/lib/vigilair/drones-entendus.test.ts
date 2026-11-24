import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dronesSansPosition, ouLibelle } from "./drones-entendus.ts";

// Extraits réels de la liste militaire d'adsb.fi (opendata.adsb.fi/api/v2/mil), 23 novembre 2026.
const OVRLD01 = {
  hex: "ae6258",
  type: "mode_s",
  flight: "OVRLD01 ",
  r: "169172",
  t: "Q4",
  desc: "NORTHROP GRUMMAN RQ-4 Global Hawk",
  rr_lat: 32.1,
  rr_lon: 37.2,
  seen: 0.2,
  alt_baro: 36775,
};
const BLKCAT6 = {
  hex: "ae7812",
  type: "mode_s",
  flight: "BLKCAT6 ",
  r: "169659",
  t: "Q4",
  desc: "Northrop Grumman MQ-4C Triton",
  lastPosition: { lat: 27.558389, lon: -84.558969, nic: 0, rc: 0, seen_pos: 1141.624 },
  rr_lat: 26.7,
  rr_lon: -82.1,
  seen: 4.5,
  alt_baro: 46950,
};
const POSITIONNE = {
  hex: "ae749a",
  type: "adsb_icao",
  flight: "12202284",
  t: "Q1",
  category: "B6",
  lat: 34.642081,
  lon: -117.597828,
  seen: 0.3,
};
const CHINOOK = {
  hex: "480444",
  type: "mode_s",
  flight: "NAF298C ",
  t: "H47",
  desc: "BOEING-VERTOL CH-47 Chinook",
  lastPosition: { lat: 52.756124, lon: 9.238838, nic: 0, rc: 0, seen_pos: 1762.543 },
  rr_lat: 53.2,
  rr_lon: 7.6,
  seen: 1.1,
};

describe("drones entendus sans position (liste militaire d'adsb.fi)", () => {
  it("OVRLD01 : un RQ-4 reconnu à son seul type, sans catégorie B6, estimé au-dessus de la Jordanie", () => {
    assert.deepEqual(dronesSansPosition([OVRLD01]), [
      {
        hex: "ae6258",
        indicatif: "OVRLD01",
        drone: { par: "type", type: "Q4", modele: "RQ-4 Global Hawk / MQ-4 Triton" },
        registre: "NORTHROP GRUMMAN RQ-4 Global Hawk",
        vuIlYaS: 0.2,
        ou: { lat: 32.1, lon: 37.2, par: "recepteurs", ageS: null },
        region: { region: "moyen-orient", pays: "Jordanie", km: 0 },
      },
    ]);
  });

  it("où : sa dernière position de 10 min au plus, sinon l'estimation des récepteurs, sinon sa vieille position", () => {
    // BLKCAT6, un MQ-4C Triton : position vieille de 19 min, récepteurs en Floride.
    const [vieille] = dronesSansPosition([BLKCAT6]);
    assert.deepEqual(vieille?.ou, { lat: 26.7, lon: -82.1, par: "recepteurs", ageS: null });
    assert.equal(vieille?.region, null, "la Floride : ailleurs");
    const recente = { ...BLKCAT6, lastPosition: { ...BLKCAT6.lastPosition, seen_pos: 600 } };
    assert.deepEqual(dronesSansPosition([recente])[0]?.ou, {
      lat: 27.558389,
      lon: -84.558969,
      par: "position",
      ageS: 600,
    });
    const sansRecepteurs = { ...BLKCAT6, rr_lat: undefined, rr_lon: undefined };
    assert.deepEqual(dronesSansPosition([sansRecepteurs])[0]?.ou, {
      lat: 27.558389,
      lon: -84.558969,
      par: "position",
      ageS: 1141.624,
    });
    const [nulle] = dronesSansPosition([{ ...sansRecepteurs, lastPosition: undefined }]);
    assert.equal(nulle?.ou, null);
    assert.equal(nulle?.region, null);
    // Une position sans âge n'est pas tenue pour fraîche ; une coordonnée seule ne place rien.
    const sansAge = { ...BLKCAT6, lastPosition: { lat: 27.5, lon: -84.5 } };
    assert.equal(dronesSansPosition([sansAge])[0]?.ou?.par, "recepteurs");
    const moities = {
      hex: "ae6258",
      t: "Q4",
      rr_lat: 32.1,
      lastPosition: { lat: 27.5, seen_pos: 5 },
    };
    assert.equal(dronesSansPosition([moities])[0]?.ou, null);
  });

  it("ni un drone positionné (les cellules le rendent), ni un appareil qui n'est pas un drone", () => {
    assert.deepEqual(dronesSansPosition([POSITIONNE, CHINOOK, null, 3, "x", { t: "Q4" }]), []);
    // Pas une position pour les cellules (parseDump1090), donc gardé ici : une latitude sans
    // longitude, une coordonnée en texte, un nombre hors de portée (1e999 se lit Infinity).
    const sansPositionLisible = [
      { hex: "ae6258", t: "Q9", lat: 10 },
      { hex: "ae6258", t: "Q9", lat: "12", lon: 15 },
      JSON.parse('{ "hex": "ae6258", "t": "Q9", "lat": 1e999, "lon": 15 }') as unknown,
    ];
    for (const a of sansPositionLisible) assert.equal(dronesSansPosition([a]).length, 1);
    // La catégorie B6 seule suffit ; sans indicatif, registre ni âge.
    assert.deepEqual(dronesSansPosition([{ hex: "~1A2B3C", category: "B6", flight: "  " }]), [
      {
        hex: "~1a2b3c",
        indicatif: null,
        drone: { par: "B6", type: null, modele: null },
        registre: null,
        vuIlYaS: 0,
        ou: null,
        region: null,
      },
    ]);
  });

  it("où il est, en mots : l'estimation des récepteurs, ou sa dernière position et son âge", () => {
    const [ovrld] = dronesSansPosition([OVRLD01]);
    assert.equal(
      ouLibelle(ovrld!),
      "estimé : Jordanie, d'après les récepteurs qui l'entendent (à quelques centaines de km près)",
    );
    const [blkcat] = dronesSansPosition([BLKCAT6]);
    assert.equal(
      ouLibelle(blkcat!),
      "estimé : hors Afrique et Moyen-Orient, d'après les récepteurs qui l'entendent (à quelques centaines de km près)",
    );
    const position = (seen_pos: number) =>
      ouLibelle(
        dronesSansPosition([{ ...OVRLD01, lastPosition: { lat: 31.9, lon: 35.9, seen_pos } }])[0]!,
      );
    assert.equal(position(42.4), "dernière position : Jordanie, il y a 42 s");
    assert.equal(position(42.6), "dernière position : Jordanie, il y a 43 s");
    assert.equal(position(119), "dernière position : Jordanie, il y a 119 s");
    assert.equal(position(120), "dernière position : Jordanie, il y a 2 min");
    assert.equal(position(570), "dernière position : Jordanie, il y a 10 min");
    assert.equal(
      ouLibelle(dronesSansPosition([{ hex: "ae6258", t: "Q4" }])[0]!),
      "position inconnue",
    );
  });
});
