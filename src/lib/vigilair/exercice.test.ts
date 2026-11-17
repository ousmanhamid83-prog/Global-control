import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exerciceEnCours, refusExercice } from "./drones-core.ts";
import { pisteExercice, type MesureLiaison } from "./exercice.ts";
import { evaluateZones, isUasThreat, type ZoneRow } from "./zones.ts";
import type { Track } from "./types.ts";

const T = Date.UTC(2026, 10, 17, 9, 0, 0);
const AILE = { id: "d1", name: "Aile-03" };
/** Ce que l'autopilote envoie : position, hauteur, vitesse, cap, à l'heure `a` du poste. */
function mesure(lat: number, lon: number, ageMs = 1500, cap: number | null = 90): MesureLiaison {
  return {
    position: { lat, lon, altM: 320, hauteurM: 25, vitesseMs: 5, cap, a: T - ageMs },
    ageMs,
  };
}

describe("exercice : la vraie télémétrie d'un de nos drones, jouée comme intrus", () => {
  it("reprend la télémétrie telle quelle, joue la plateforme choisie, et le dit", () => {
    const t = pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.06), T)!;
    assert.equal(t.id, "exe-d1");
    assert.equal(t.callsign, "EXE Aile-03");
    assert.deepEqual([t.lat, t.lon, t.altM, t.heading, t.speedKmh], [12.134, 15.06, 320, 90, 18]);
    assert.deepEqual(t.trail, [{ lat: 12.134, lon: 15.06 }]);
    assert.equal(t.feed, "exercice");
    assert.equal(t.injected, true);
    assert.deepEqual(t.sensors, ["liaison"]);
    assert.deepEqual(t.exercice, { drone: "Aile-03", plateforme: "dji-mavic-3t" });
    assert.equal(t.origin, "CN");
    assert.equal(t.truePlatformId, "dji-mavic-3t");
    assert.equal(t.classGuess, "multirotor");
    assert.deepEqual(t.hypotheses, [{ platformId: "dji-mavic-3t", score: 100 }]);
    assert.equal(t.idState, "confirme");
    assert.match(t.confidenceNote!, /jouée par l'exercice.*pas une identification/);
    // L'heure est celle de la MESURE, pas celle de la console.
    assert.equal(t.lastUpdate, T - 1500);
    assert.equal(t.firstSeen, T - 1500);
    assert.equal(t.confirmedAt, T - 1500);
    assert.equal(t.dwellS, 0);
    assert.deepEqual(t.launchFix, {
      lat: 12.134,
      lon: 15.06,
      at: T - 1500,
      method: "vol d'exercice · liaison MAVLink de Aile-03",
    });
    assert.equal(t.corridor, "Exercice");
    assert.equal(t.locked, false);
    assert.equal(t.siteWarned, false);
    assert.equal(t.cpa, null);
  });

  it("la trace garde les 80 dernières positions ; un long nom tient dans l'indicatif ; le temps ne recule pas", () => {
    let t = pisteExercice(AILE, "dji-mavic-3t", mesure(12, 15), T)!;
    for (let i = 1; i <= 85; i++)
      t = pisteExercice(AILE, "dji-mavic-3t", mesure(12, 15 + i / 1000), T + i * 1000, t)!;
    assert.equal(t.trail.length, 80);
    assert.deepEqual(t.trail.at(-1), { lat: 12, lon: 15.085 });
    const long = pisteExercice(
      { id: "d2", name: "Aile-de-reconnaissance-nord-07" },
      "dji-mavic-3t",
      mesure(12, 15),
      T,
    )!;
    assert.equal(long.callsign, "EXE Aile-de-reconnaissan");
    // Une mesure plus ancienne que la précédente (horloge du poste reprise) : la durée ne baisse pas.
    const vieille = pisteExercice(AILE, "dji-mavic-3t", mesure(12, 15.1, 60_000), T, t)!;
    assert.equal(vieille.dwellS, t.dwellS);
  });

  it("une plateforme absente du catalogue : pas de piste", () => {
    assert.equal(pisteExercice(AILE, "inconnue", mesure(12.134, 15.06), T), null);
  });

  it("d'une mesure à l'autre : la trace suit le vol, l'état de veille est gardé", () => {
    const a = pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.06), T)!;
    const tenue = {
      ...a,
      locked: true,
      siteWarned: true,
      cpa: { siteId: "nation", name: "Nation", distKm: 1, etaS: 60, closing: true },
    };
    const b = pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.055, 500), T + 4000, tenue)!;
    assert.deepEqual(b.trail, [
      { lat: 12.134, lon: 15.06 },
      { lat: 12.134, lon: 15.055 },
    ]);
    assert.equal(b.locked, true);
    assert.equal(b.siteWarned, true);
    assert.deepEqual(b.cpa, tenue.cpa);
    assert.deepEqual(b.launchFix, a.launchFix);
    assert.equal(b.firstSeen, T - 1500);
    assert.equal(b.confirmedAt, T - 1500);
    // 5 s entre les deux mesures (T−1,5 s puis T+3,5 s).
    assert.equal(b.dwellS, 5);
    // Immobile : la trace ne double pas son dernier point.
    const c = pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.055, 0), T + 5000, b)!;
    assert.equal(c.trail.length, 2);
    // Sans cap envoyé : celui de la mesure précédente, jamais un cap inventé ; d'emblée, 0.
    assert.equal(
      pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.05, 0, null), T + 6000, c)!.heading,
      90,
    );
    assert.equal(
      pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.05, 0, null), T)!.heading,
      0,
    );
  });

  it("une piste d'exercice est une menace pour les bulles, et l'intrusion se dit exercice", () => {
    const t = pisteExercice(AILE, "dji-mavic-3t", mesure(12.134, 15.049), T)!;
    assert.equal(isUasThreat(t), true);
    const nation: ZoneRow = {
      id: "nation",
      name: "Nation",
      kind: "ministere",
      lat: 12.134,
      lon: 15.049,
      radiusKm: 0.9,
      armed: true,
      note: "",
    };
    const [z] = evaluateZones([t], [nation]);
    assert.equal(z!.level, "intrusion");
    assert.deepEqual(z!.inside, [
      {
        trackId: "exe-d1",
        callsign: "EXE Aile-03",
        distKm: 0,
        uas: true,
        friend: false,
        exercice: true,
      },
    ]);
    // Un rejeu reste du passé : jamais une intrusion.
    assert.equal(isUasThreat({ ...t, feed: "rejeu" } as Track), false);
  });
});

describe("exercice : ce que le chef peut lancer", () => {
  it("il faut une liaison et un drone du catalogue, pas un avion de chasse", () => {
    const multirotor = { uasClass: "multirotor" };
    assert.equal(refusExercice({ liaison: "tcp://127.0.0.1:5760" }, multirotor), null);
    assert.match(refusExercice({}, multirotor)!, /liaison requise/);
    assert.match(
      refusExercice({ liaison: "tcp://127.0.0.1:5760" }, undefined)!,
      /plateforme inconnue/,
    );
    assert.match(
      refusExercice({ liaison: "tcp://127.0.0.1:5760" }, { uasClass: "chasse" })!,
      /plateforme inconnue/,
    );
  });

  it("en cours jusqu'à l'heure posée, et pas une milliseconde de plus", () => {
    const d = { exercice: { plateforme: "dji-mavic-3t", jusqua: T } };
    assert.equal(exerciceEnCours(d, T - 1), "dji-mavic-3t");
    assert.equal(exerciceEnCours(d, T), null);
    assert.equal(exerciceEnCours({}, T), null);
  });
});
