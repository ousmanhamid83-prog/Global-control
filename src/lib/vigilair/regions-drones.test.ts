import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cameraLibre, droneACapturer, lieuDrone } from "./regions-drones.ts";

/** La marge au large : 12 milles marins (22,2 km) et l'écart mesuré du contour (5,9 km). */
const MARGE_KM = 29;
import type { Track } from "./types.ts";

const ou = (lat: number, lon: number) => {
  const l = lieuDrone(lat, lon);
  return l ? `${l.region} · ${l.pays}` : null;
};

describe("où vole un drone : Afrique, Moyen-Orient, ou ailleurs", () => {
  it("au-dessus des terres : le pays, Tchad compris ; une enclave l'emporte", () => {
    assert.deepEqual(lieuDrone(12.1348, 15.0557), { region: "afrique", pays: "Tchad", km: 0 });
    assert.equal(ou(30.044, 31.236), "afrique · Égypte");
    // Le drone réel du 23 novembre 2026 (BOOSTER, catégorie B6, type HRON).
    assert.equal(ou(31.83, 34.83), "moyen-orient · Israël");
    assert.equal(ou(24.713, 46.675), "moyen-orient · Arabie saoudite");
    assert.equal(ou(35.689, 51.389), "moyen-orient · Iran");
    assert.equal(ou(41.009, 28.978), "moyen-orient · Turquie");
    assert.equal(ou(-29.31, 27.48), "afrique · Lesotho");
  });

  it("les îles de la région, même petites et loin du continent", () => {
    assert.equal(ou(-20.16, 57.502), "afrique · Maurice");
    assert.equal(ou(-4.62, 55.455), "afrique · Seychelles");
    assert.equal(ou(-9.4, 46.35), "afrique · Seychelles");
    assert.equal(ou(-11.704, 43.24), "afrique · Comores");
    assert.equal(ou(14.933, -23.513), "afrique · Cap-Vert");
    assert.equal(ou(0.336, 6.727), "afrique · Sao Tomé-et-Principe");
    assert.equal(ou(26.228, 50.586), "moyen-orient · Bahreïn");
    assert.equal(ou(12.5, 53.8), "moyen-orient · Yémen");
  });

  it("ailleurs : l'Europe, le Caucase, l'Asie voisine, les territoires européens d'Afrique", () => {
    const ailleurs: [string, number, number][] = [
      ["Paris", 48.857, 2.352],
      ["Athènes", 37.984, 23.728],
      ["Kos", 36.893, 27.288],
      ["Erevan", 40.179, 44.499],
      ["Bakou", 40.409, 49.867],
      ["Tbilissi", 41.716, 44.783],
      ["Kaboul", 34.555, 69.207],
      ["Karachi", 24.861, 67.01],
      ["Achgabat", 37.96, 58.326],
      ["Tarifa", 36.013, -5.606],
      ["Gibraltar", 36.14, -5.353],
      ["Ceuta", 35.889, -5.32],
      ["Tenerife", 28.29, -16.63],
      ["Réunion", -21.115, 55.536],
      ["Mayotte", -12.78, 45.23],
      ["Sainte-Hélène", -15.965, -5.708],
      // Le drone réel du 23 novembre 2026 au-dessus de la Bavière (SPEEDY0, catégorie B6).
      ["Bavière", 48.69, 11.55],
    ];
    for (const [nom, lat, lon] of ailleurs) assert.equal(lieuDrone(lat, lon), null, nom);
    assert.equal(lieuDrone(Number.NaN, 15), null);
    assert.equal(lieuDrone(12, Number.POSITIVE_INFINITY), null);
  });

  it(`au large : la côte la plus proche, à moins de ${MARGE_KM} km ; la haute mer, nulle part`, () => {
    const libye = lieuDrone(33.03, 13.19);
    assert.equal(libye?.pays, "Libye");
    assert.ok(libye!.km > 15 && libye!.km < 20, String(libye?.km));
    // Le bord de la marge, au nord de Tripoli.
    const bord = lieuDrone(33.135, 13.19);
    assert.equal(bord?.pays, "Libye");
    assert.ok(bord!.km > 28.5 && bord!.km <= MARGE_KM, String(bord?.km));
    assert.equal(lieuDrone(33.14, 13.19), null);
    assert.equal(ou(12.6, 43.4), "moyen-orient · Yémen");
    assert.equal(lieuDrone(20.0, 38.6), null, "milieu de la mer Rouge");
    assert.equal(lieuDrone(2.0, 3.0), null, "golfe de Guinée");
  });

  it("au large des extrémités : au-delà de la boîte d'un pays, la marge compte encore", () => {
    // 15 km au large des quatre extrémités de l'Afrique : ras ben Sakka au nord, la pointe des
    // Almadies à l'ouest, ras Hafun à l'est, le cap des Aiguilles au sud.
    const extremites: [string, number, number][] = [
      ["Tunisie", 37.4832, 9.7553],
      ["Sénégal", 14.7444, -17.6701],
      ["Somalie", 10.4467, 51.548],
      ["Afrique du Sud", -34.9682, 20.0],
    ];
    for (const [pays, lat, lon] of extremites) {
      const l = lieuDrone(lat, lon);
      assert.equal(l?.pays, pays);
      assert.ok(l!.km > 12 && l!.km < 18, `${pays} ${l?.km}`);
    }
    // 25 km à l'est du cap Apostolos Andreas : la longitude compte moins de kilomètres à 35,7° N.
    const chypre = lieuDrone(35.6936, 34.8643);
    assert.equal(chypre?.pays, "Chypre du Nord");
    assert.ok(chypre!.km > 23 && chypre!.km < 27, String(chypre?.km));
    // 6 km au large de Zouara, en Libye.
    const zouara = lieuDrone(33.0533, 11.9586);
    assert.equal(zouara?.pays, "Libye");
    assert.ok(zouara!.km > 4 && zouara!.km < 8, String(zouara?.km));
  });

  it("entre deux côtes, la ligne d'équidistance : côté Kos, la Grèce ; côté Bodrum, la Turquie", () => {
    assert.equal(lieuDrone(36.9, 27.33), null);
    assert.equal(ou(36.95, 27.3), "moyen-orient · Turquie");
    assert.equal(lieuDrone(35.97, -5.5), null, "détroit de Gibraltar, plus près de l'Espagne");
  });
});

function piste(id: string, lat: number, lon: number, over: Partial<Track> = {}): Track {
  return { id, callsign: id.toUpperCase(), lat, lon, feed: "adsb", ...over } as Track;
}

describe("la capture automatique d'un drone né", () => {
  it("un drone déclaré au-dessus de la région : ni un civil, ni un drone d'ailleurs", () => {
    const r = droneACapturer(
      [
        piste("civil", 12.1, 15.1, { category: "A3", icaoType: "B738" }),
        piste("bavière", 48.69, 11.55, { category: "B6" }),
        piste("booster", 31.83, 34.83, { category: "B6", icaoType: "HRON" }),
      ],
      () => false,
    );
    assert.equal(r?.piste.id, "booster");
    assert.deepEqual(r?.drone, { par: "B6", type: "HRON", modele: "Heron / Harfang" });
    assert.deepEqual(r?.lieu, { region: "moyen-orient", pays: "Israël", km: 0 });
    assert.equal(r?.rang, 1);
  });

  it("le théâtre le plus proche du poste d'abord ; à théâtre égal, le premier né", () => {
    const israel = piste("booster", 31.83, 34.83, { category: "B6" });
    const riyad = piste("riyad", 24.713, 46.675, { category: "B6" });
    const dakar = piste("dakar", 14.69, -17.45, { category: "B6" });
    const niamey = piste("niamey", 13.51, 2.11, { category: "B6" });
    const fasher = piste("fasher", 13.63, 25.35, { category: "B6" });
    const tchad = piste("tchad", 12.2, 15.2, { icaoType: "BTB2" });
    const premier = (nes: Track[]) => {
      const r = droneACapturer(nes, () => false);
      return `${r?.piste.id} ${r?.rang}`;
    };
    assert.equal(premier([israel, dakar]), "dakar 2");
    assert.equal(premier([dakar, niamey]), "niamey 3");
    assert.equal(premier([niamey, fasher]), "fasher 4");
    assert.equal(premier([israel, fasher, tchad, dakar]), "tchad 5");
    assert.equal(premier([israel, riyad]), "booster 1");
    assert.equal(premier([riyad, israel]), "riyad 1");
  });

  it("un autre modèle, reconnu à son seul type ; ceux qu'on écarte ne partent pas", () => {
    const nes = [
      piste("nous", 12.15, 15.05, { category: "B6" }),
      piste("tb2", 13.5, 16, { icaoType: "BTB2" }),
    ];
    const r = droneACapturer(nes, (id) => id === "nous");
    assert.equal(r?.piste.id, "tb2");
    assert.equal(r?.drone.par, "type");
    assert.equal(r?.lieu.pays, "Tchad");
    assert.equal(
      droneACapturer(nes, () => true),
      null,
    );
    assert.equal(
      droneACapturer([], () => false),
      null,
    );
  });

  it("la caméra : libre, ou reprise à la capture seule d'un drone plus lointain ; jamais à la main", () => {
    assert.equal(cameraLibre(null, 1), true);
    const israel = { id: "cap-uav-live-738be8", theater: "monde" as const };
    assert.equal(cameraLibre(israel, 5), true);
    assert.equal(cameraLibre(israel, 2), true);
    assert.equal(cameraLibre(israel, 1), false);
    assert.equal(cameraLibre({ id: "cap-uav-live-aa0001", theater: "tchad" }, 5), false);
    // Une scène ouverte par l'opérateur, ou pour un autre événement, n'est pas reprise.
    assert.equal(cameraLibre({ id: "cap-scene-12134-15056-1", theater: "monde" }, 5), false);
    assert.equal(cameraLibre({ id: "cap-feu-1", theater: "sahel" }, 5), false);
  });
});
