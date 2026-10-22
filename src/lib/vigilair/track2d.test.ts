import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedTracks, detectOcclusions, isStationary, stepTracker, type Track2D } from "./track2d.ts";

const OPTS = { gate: 50, maxMisses: 2, maxTrail: 8 };

test("deux cibles distinctes gardent leur id sur plusieurs trames", () => {
  let seed = 1;
  let tracks: Track2D[] = [];
  const frames = [
    [{ cx: 10, cy: 10 }, { cx: 100, cy: 100 }],
    [{ cx: 16, cy: 10 }, { cx: 106, cy: 100 }],
    [{ cx: 22, cy: 10 }, { cx: 112, cy: 100 }],
  ];
  for (const dets of frames) {
    const r = stepTracker(tracks, dets, seed, OPTS);
    tracks = r.tracks;
    seed = r.nextId;
  }
  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map((t) => t.id).sort((a, b) => a - b), [1, 2]);
  for (const t of tracks) assert.equal(t.hits, 3);
  // la cible qui va vers +x a une vitesse écran positive
  const t1 = tracks.find((t) => t.id === 1)!;
  assert.ok(t1.vx > 0);
});

test("une détection isolée fait naître une nouvelle piste (id incrémenté)", () => {
  const r1 = stepTracker([], [{ cx: 5, cy: 5 }], 1, OPTS);
  assert.equal(r1.tracks[0]!.id, 1);
  assert.equal(r1.nextId, 2);
  const r2 = stepTracker(r1.tracks, [{ cx: 5, cy: 5 }, { cx: 90, cy: 90 }], r1.nextId, OPTS);
  // la piste 1 continue, une piste 2 naît
  assert.deepEqual(r2.tracks.map((t) => t.id).sort((a, b) => a - b), [1, 2]);
});

test("une piste cachée une trame est coastée puis reprise (même id)", () => {
  let seed = 1;
  let tracks: Track2D[] = [];
  const frames: { cx: number; cy: number }[][] = [
    [{ cx: 50, cy: 50 }],
    [{ cx: 56, cy: 50 }],
    [], // cible masquée
    [{ cx: 62, cy: 50 }],
  ];
  for (const dets of frames) {
    const r = stepTracker(tracks, dets, seed, OPTS);
    tracks = r.tracks;
    seed = r.nextId;
  }
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.id, 1); // id conservé malgré la disparition brève
  assert.equal(tracks[0]!.hits, 3);
  assert.equal(tracks[0]!.misses, 0);
});

test("au-delà de maxMisses la piste est abandonnée", () => {
  let tracks = stepTracker([], [{ cx: 50, cy: 50 }], 1, OPTS).tracks;
  for (let i = 0; i < 3; i++) tracks = stepTracker(tracks, [], 99, OPTS).tracks; // 3 trames vides > maxMisses(2)
  assert.equal(tracks.length, 0);
});

test("confirmedTracks ne garde que les pistes établies et actives", () => {
  const tracks: Track2D[] = [
    { id: 1, cx: 0, cy: 0, vx: 0, vy: 0, trail: [], hits: 1, misses: 0 }, // trop jeune
    { id: 2, cx: 0, cy: 0, vx: 0, vy: 0, trail: [], hits: 3, misses: 0 }, // OK
    { id: 3, cx: 0, cy: 0, vx: 0, vy: 0, trail: [], hits: 4, misses: 1 }, // en coast mobile
  ];
  assert.deepEqual(confirmedTracks(tracks, 2).map((t) => t.id), [2]);
  // une présence immobile (still≥3) en coast court reste affichée si on l'autorise
  const stat: Track2D = { id: 9, cx: 0, cy: 0, vx: 0, vy: 0, trail: [], hits: 5, misses: 2, still: 6 };
  assert.deepEqual(confirmedTracks([stat], 2, 8).map((t) => t.id), [9]);
  assert.deepEqual(confirmedTracks([stat], 2, 0).map((t) => t.id), []); // sans tolérance, non
});

test("une présence qui s'arrête survit plus longtemps qu'une piste mobile perdue", () => {
  const OPTS_S = { gate: 50, maxMisses: 2, maxTrail: 8, stillEps: 1.2, stationaryGrace: 8 };
  let seed = 1;
  let tracks: Track2D[] = [];
  // 5 trames sur place (immobile) → still grimpe
  for (let k = 0; k < 5; k++) {
    const r = stepTracker(tracks, [{ cx: 40, cy: 40 }], seed, OPTS_S);
    tracks = r.tracks;
    seed = r.nextId;
  }
  assert.ok(isStationary(tracks[0]!)); // reconnue immobile
  // puis l'objet immobile ne produit plus de détection : il tient grâce à stationaryGrace (8 > 2)
  for (let k = 0; k < 4; k++) tracks = stepTracker(tracks, [], seed, OPTS_S).tracks;
  assert.equal(tracks.length, 1); // toujours là après 4 trames sans détection
  assert.equal(tracks[0]!.id, 1);
});

test("detectOcclusions compte les détections revendiquées par deux pistes (croisement)", () => {
  const prev: Track2D[] = [
    { id: 1, cx: 48, cy: 50, vx: 2, vy: 0, trail: [], hits: 5, misses: 0 },
    { id: 2, cx: 52, cy: 50, vx: -2, vy: 0, trail: [], hits: 5, misses: 0 },
  ];
  // les deux pistes convergent vers un seul point : occlusion
  assert.equal(detectOcclusions(prev, [{ cx: 50, cy: 50 }], 50), 1);
  // deux pistes BIEN séparées avec chacune sa détection : pas d'occlusion
  const apart: Track2D[] = [
    { id: 1, cx: 20, cy: 50, vx: 0, vy: 0, trail: [], hits: 5, misses: 0 },
    { id: 2, cx: 80, cy: 50, vx: 0, vy: 0, trail: [], hits: 5, misses: 0 },
  ];
  assert.equal(detectOcclusions(apart, [{ cx: 20, cy: 50 }, { cx: 80, cy: 50 }], 30), 0);
});
