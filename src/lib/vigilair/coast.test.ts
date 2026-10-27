import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkJump,
  coastRadiusKm,
  deadReckon,
  DEFAULT_COAST_CFG,
  DUP_ADDR_RUN,
  DUP_ADDR_WINDOW_MS,
  impliedSpeedKmh,
  noteJump,
  suspectActive,
  stepCoast,
} from "./coast.ts";
import { haversineKm } from "./geo.ts";

test("deadReckon : avance au cap et à la vitesse dits", () => {
  // Plein nord à 720 km/h pendant 60 s = 12 km vers le nord.
  const p = deadReckon({ lat: 12, lon: 15, heading: 0, speedKmh: 720 }, 60);
  assert.ok(Math.abs(haversineKm(12, 15, p.lat, p.lon) - 12) < 0.2);
  assert.ok(p.lat > 12 && Math.abs(p.lon - 15) < 1e-6); // plein nord : la longitude ne bouge pas
  // Plein est : c'est la longitude qui bouge.
  const e = deadReckon({ lat: 12, lon: 15, heading: 90, speedKmh: 720 }, 60);
  assert.ok(e.lon > 15 && Math.abs(e.lat - 12) < 1e-6);
  // Cas dégénérés : on ne bouge pas.
  assert.deepEqual(deadReckon({ lat: 12, lon: 15, heading: 0, speedKmh: 0 }, 60), { lat: 12, lon: 15 });
  assert.deepEqual(deadReckon({ lat: 12, lon: 15, heading: 0, speedKmh: 720 }, 0), { lat: 12, lon: 15 });
});

test("coastRadiusKm : l'incertitude grandit avec le silence et la vitesse", () => {
  const lent = coastRadiusKm(100, 30);
  const rapide = coastRadiusKm(900, 30);
  assert.ok(rapide > lent, "une piste rapide dérive plus vite");
  assert.ok(coastRadiusKm(900, 40) > coastRadiusKm(900, 10), "plus le silence dure, plus c'est flou");
  // Plancher : même une piste quasi immobile a une incertitude non nulle.
  assert.equal(coastRadiusKm(0, 10), DEFAULT_COAST_CFG.minRadiusKm);
  assert.equal(coastRadiusKm(900, 0), 0); // pas de silence, pas d'incertitude
});

test("impliedSpeedKmh : vitesse qu'un déplacement aurait exigée", () => {
  // 12 km en 60 s = 720 km/h.
  const p = deadReckon({ lat: 12, lon: 15, heading: 0, speedKmh: 720 }, 60);
  assert.ok(Math.abs(impliedSpeedKmh(12, 15, p.lat, p.lon, 60) - 720) < 10);
  assert.equal(impliedSpeedKmh(12, 15, 12, 15, 0), Infinity); // temps nul : indéterminé
});

test("checkJump : un déplacement normal passe", () => {
  const prev = { lat: 12, lon: 15, altM: 9000 };
  const p = deadReckon({ lat: 12, lon: 15, heading: 45, speedKmh: 800 }, 10);
  const v = checkJump(prev, { lat: p.lat, lon: p.lon, altM: 9050 }, 10);
  assert.equal(v.ok, true);
  assert.ok(v.impliedKmh > 700 && v.impliedKmh < 900);
});

test("checkJump : une TÉLÉPORTATION est refusée (trame brouillée ou falsifiée)", () => {
  // 300 km en 10 s = 108 000 km/h : impossible.
  const v = checkJump({ lat: 12, lon: 15, altM: 9000 }, { lat: 14.7, lon: 15, altM: 9000 }, 10);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /saut de position/);
  assert.ok(v.impliedKmh > DEFAULT_COAST_CFG.maxSpeedKmh);
});

test("checkJump : un saut d'ALTITUDE impossible est refusé aussi", () => {
  // 5 000 m en 10 s = 500 m/s, bien au-delà du crédible.
  const v = checkJump({ lat: 12, lon: 15, altM: 1000 }, { lat: 12, lon: 15, altM: 6000 }, 10);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /saut d'altitude/);
});

test("stepCoast : la piste muette est EXTRAPOLÉE, pas figée", () => {
  const t = { lat: 12, lon: 15, heading: 90, speedKmh: 720, lastUpdate: 1_000_000 };
  const fige = stepCoast(t, 1_000_000); // aucun silence
  assert.equal(fige.silentS, 0);
  assert.equal(fige.drop, false);

  const apres20s = stepCoast(t, 1_000_000 + 20_000);
  assert.equal(apres20s.silentS, 20);
  // 720 km/h pendant 20 s = 4 km : la position a bougé, elle n'est pas restée sur place.
  assert.ok(Math.abs(haversineKm(12, 15, apres20s.lat, apres20s.lon) - 4) < 0.2);
  assert.ok(apres20s.radiusKm > 0);
  assert.equal(apres20s.drop, false);
});

test("noteJump : une trame ratée isolée garde son motif, la RÉPÉTITION accuse l'adresse", () => {
  const T = 1_000_000;
  // Un seul relevé refusé : c'est une trame brouillée, on n'accuse personne.
  const un = noteJump(null, T, "saut de position : 90000 km/h impliqués");
  assert.equal(un.run, 1);
  assert.equal(un.dupAddr, false);
  assert.match(un.label, /saut de position/);

  // Des refus RÉPÉTÉS dans la fenêtre, même entrecoupés de bonnes trames : deux émetteurs.
  let st = un;
  for (let i = 2; i <= DUP_ADDR_RUN; i++) st = noteJump(st, T + i * 10_000, "saut de position");
  assert.equal(st.run, DUP_ADDR_RUN);
  assert.equal(st.dupAddr, true);
  assert.match(st.label, /adresse ICAO partagée/);
  assert.equal(st.since, T, "la fenêtre garde son origine");
});

test("noteJump : l'épisode se ferme un délai après le DERNIER incident, pas le premier", () => {
  const T = 1_000_000;
  const episode = { run: 5, since: T, at: T + 120_000 };
  // Ancré sur le dernier incident : toujours vivant bien après le premier.
  assert.equal(suspectActive(episode, T + 120_000 + DUP_ADDR_WINDOW_MS), true);
  assert.equal(suspectActive(episode, T + 120_000 + DUP_ADDR_WINDOW_MS + 1), false);
  assert.equal(suspectActive(null, T), false);
  // Un refus hors épisode en ouvre un neuf, il ne s'empile pas sur une vieille histoire.
  const neuf = noteJump(episode, T + 120_000 + DUP_ADDR_WINDOW_MS + 1, "saut de position");
  assert.equal(neuf.run, 1);
  assert.equal(neuf.dupAddr, false);
});

test("stepCoast : au-delà du délai, la piste est abandonnée", () => {
  const t = { lat: 12, lon: 15, heading: 90, speedKmh: 720, lastUpdate: 1_000_000 };
  const juste = stepCoast(t, 1_000_000 + DEFAULT_COAST_CFG.dropAfterS * 1000);
  assert.equal(juste.drop, false, "pile au délai, on tient encore");
  const trop = stepCoast(t, 1_000_000 + (DEFAULT_COAST_CFG.dropAfterS + 1) * 1000);
  assert.equal(trop.drop, true);
});
