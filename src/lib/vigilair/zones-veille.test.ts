import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OwnDrone } from "./drones-core.ts";
import { etatVide, type EtatDrone } from "./drones-pilotage.ts";
import type { LiveAc } from "./live-adsb.ts";
import { pistesDeVeille } from "./zones-veille.server.ts";
import { evaluateZones, passagesDe, type ZoneRow } from "./zones.ts";

const T = Date.UTC(2026, 10, 23, 10, 0, 0);
const BULLE: ZoneRow = {
  id: "fttj",
  name: "Aérodrome",
  kind: "aerodrome",
  lat: 12.1331,
  lon: 15.0339,
  radiusKm: 3,
  armed: true,
  note: "",
};

/** Un aéronef reçu au-dessus de la bulle (l'image du poste). */
function avion(over: Partial<LiveAc> = {}): LiveAc {
  return {
    hex: "aa0001",
    flight: "UAV1",
    flightTx: true,
    messages: 200,
    lat: 12.1335,
    lon: 15.034,
    altM: 120,
    gsKmh: 40,
    track: 90,
    climbMs: 0,
    squawk: null,
    icaoType: null,
    reg: null,
    rssi: null,
    emergency: null,
    seenS: 0,
    onGround: false,
    category: "B6",
    nic: 8,
    nacp: 9,
    sil: 3,
    military: false,
    posSource: "adsb",
    rcM: null,
    ...over,
  };
}

const AILE: OwnDrone = {
  id: "d1",
  name: "Aile-02",
  ident: "4D2023",
  site: "",
  at: 0,
  liaison: "tcp://127.0.0.1:5760",
};

/** La liaison du drone : vivante, position reçue `age` ms plus tôt. */
function liaison(lat: number, lon: number, age = 1000): EtatDrone {
  const e = etatVide("d1");
  e.lie = true;
  e.battementA = T - 500;
  e.position = { lat, lon, altM: 335, hauteurM: 40, vitesseMs: 10, cap: 90, a: T - age };
  return e;
}

const passages = (aircraft: LiveAc[], drones: OwnDrone[] = [], etat: EtatDrone | null = null) =>
  passagesDe(
    evaluateZones(
      pistesDeVeille([], aircraft, drones, () => etat, T),
      [BULLE],
    ),
  );

describe("veille des bulles dans le serveur : les mêmes pistes que la console", () => {
  it("un UAV (B6) reçu au-dessus de la bulle : un passage réel ; un avion de ligne : rien", () => {
    const l = passages([avion()]);
    assert.equal(l.length, 1);
    assert.equal(l[0]!.trackId, "live-aa0001");
    assert.equal(l[0]!.kind, "inside");
    assert.equal(l[0]!.exercice, false);
    assert.deepEqual(passages([avion({ hex: "bb0002", category: "A3" })]), []);
  });

  it("à l'adresse de notre drone : intrus tant que le chef ne l'a pas confirmé, ami ensuite", () => {
    const sienne = avion({ hex: "4d2023", flight: "4D2023" });
    assert.equal(passages([sienne], [AILE])[0]?.trackId, "live-4d2023");
    const confirme = { ...AILE, ami1090Jusqua: T + 3_600_000 };
    assert.deepEqual(passages([sienne], [confirme], liaison(12.1335, 15.034)), []);
    // Confirmée, mais la télémétrie place le drone à des kilomètres : adresse copiée, intrus.
    assert.equal(passages([sienne], [confirme], liaison(12.3, 15.3)).length, 1);
  });

  it("exercice : la vraie télémétrie de notre drone, jouée comme intrus, un passage marqué exercice", () => {
    const enExercice: OwnDrone = {
      ...AILE,
      exercice: { plateforme: "dji-mavic-3t", jusqua: T + 7_200_000 },
    };
    const [p] = passages([], [enExercice], liaison(12.1332, 15.034));
    assert.equal(p?.trackId, "exe-d1");
    assert.equal(p?.exercice, true);
    // La liaison s'est tue (plus de battement depuis 6 s) : sa dernière position ne compte plus.
    const muette = liaison(12.1332, 15.034);
    muette.battementA = T - 6000;
    assert.deepEqual(passages([], [enExercice], muette), []);
    // Reçue il y a 5 s tout juste : encore fraîche.
    assert.equal(passages([], [enExercice], liaison(12.1332, 15.034, 5000)).length, 1);
    // Télémétrie trop vieille, exercice fini, ou pas de liaison : pas de piste d'exercice.
    assert.deepEqual(passages([], [enExercice], liaison(12.1332, 15.034, 5001)), []);
    const fini = { ...enExercice, exercice: { plateforme: "dji-mavic-3t", jusqua: T } };
    assert.deepEqual(passages([], [fini], liaison(12.1332, 15.034)), []);
    const sansLiaison = { ...enExercice, liaison: undefined };
    assert.deepEqual(passages([], [sansLiaison], liaison(12.1332, 15.034)), []);
  });
});
