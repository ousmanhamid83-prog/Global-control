import { test } from "node:test";
import assert from "node:assert/strict";
import {
  couvertureVerdict,
  PORTEE_COURTE_KM,
  PORTEE_NORMALE_KM,
  porteeVerdict,
  rangeProfile,
  RING_KM,
  type CellOutcome,
} from "./portee.ts";

test("PROFIL : résume des distances en max, médiane et anneaux", () => {
  const p = rangeProfile([3, 8, 8, 40, 250]);
  assert.equal(p.n, 5);
  assert.equal(p.maxKm, 250);
  assert.equal(p.medKm, 8);
  assert.equal(p.bins.length, RING_KM.length + 1);
  assert.equal(p.bins[0], 1, "un seul contact sous 5 km");
  assert.equal(p.bins[1], 2, "deux entre 5 et 10 km");
});

test("PROFIL : un lot vide ne fabrique pas de chiffres", () => {
  const p = rangeProfile([]);
  assert.equal(p.n, 0);
  assert.equal(p.maxKm, 0);
  assert.equal(p.medKm, 0);
  assert.ok(p.bins.every((b) => b === 0));
});

test("PROFIL : les valeurs aberrantes sont écartées, pas comptées", () => {
  const p = rangeProfile([10, Number.NaN, -3, Infinity, 20]);
  assert.equal(p.n, 2);
  assert.equal(p.maxKm, 20);
});

test("PROFIL : au-delà du dernier anneau, tout tombe dans le dernier seau", () => {
  const p = rangeProfile([5000]);
  assert.equal(p.bins[RING_KM.length], 1);
});

test("VERDICT : sans antenne déclarée, on ne juge pas une portée", () => {
  const v = porteeVerdict(rangeProfile([]), false);
  assert.equal(v.concluant, false);
  assert.equal(v.alerte, false);
  assert.match(v.texte, /Aucune antenne locale/);
});

test("VERDICT : antenne branchée mais muette → on alerte SANS conclure", () => {
  // Le piège à éviter : déduire d'un échantillon vide que l'antenne est mauvaise.
  const v = porteeVerdict(rangeProfile([]), true);
  assert.equal(v.concluant, false, "rien reçu = rien à conclure");
  assert.equal(v.alerte, true, "mais l'opérateur doit le voir");
  assert.match(v.texte, /rien à conclure/);
});

test("VERDICT : le cas de l'opérateur — on n'entend que sous 10 km", () => {
  // C'est la plainte réelle : « le radar couvre des milliers de km² et je ne reçois que < 10 km ».
  const v = porteeVerdict(rangeProfile([2, 4, 5, 6, 7, 8, 8, 9, 9, 9.5]), true);
  assert.equal(v.alerte, true);
  assert.equal(v.concluant, true);
  assert.match(v.texte, /installation/);
  // Le poste doit DISCULPER explicitement le logiciel, sinon on cherche le bug au mauvais endroit.
  assert.match(v.texte, /800 km/);
});

test("VERDICT : un maximum tiré de 3 positions n'est pas concluant", () => {
  const v = porteeVerdict(rangeProfile([2, 5, 8]), true);
  assert.equal(v.concluant, false, "échantillon trop maigre pour trancher");
  assert.equal(v.alerte, true, "mais le chiffre reste affiché");
});

test("VERDICT : portée moyenne et portée normale sont distinguées", () => {
  const moyen = porteeVerdict(rangeProfile(Array.from({ length: 30 }, () => PORTEE_COURTE_KM + 10)), true);
  assert.equal(moyen.alerte, false);
  assert.match(moyen.texte, /perfectible/);
  const bon = porteeVerdict(rangeProfile(Array.from({ length: 30 }, () => PORTEE_NORMALE_KM + 50)), true);
  assert.equal(bon.alerte, false);
  assert.match(bon.texte, /Normale/);
});

/* ── COUVERTURE RÉSEAU : « on m'a refusé » n'est pas « il n'y a personne » ─────────────────────── */

const cell = (o: Partial<CellOutcome> = {}): CellOutcome => ({
  label: "FTTJ",
  repondu: true,
  refusee: false,
  avions: 0,
  ...o,
});

test("COUVERTURE : le cas mesuré au Tchad — répondu, zéro avion", () => {
  // Mesuré en réel : HTTP 200 et « total: 0 » dans un rayon de 463 km autour de N'Djamena.
  // Ce n'est pas une panne : c'est qu'aucun récepteur n'écoute là-bas.
  const v = couvertureVerdict([cell(), cell({ label: "Niamey" }), cell({ label: "Douala" })]);
  assert.equal(v.repondues, 3);
  assert.equal(v.videsConfirmees, 3);
  assert.equal(v.avions, 0);
  assert.match(v.texte, /aucun récepteur/);
  assert.match(v.texte, /le ciel n'est pas vide/);
});

test("COUVERTURE : tout refusé pour débit → le vide ne dit RIEN sur le ciel", () => {
  // Le piège exact : un scope vide parce qu'on nous a jetés ressemble à un scope vide parce que
  // le ciel est calme. Les confondre, c'est déguiser une panne de capteur en calme plat.
  const v = couvertureVerdict([
    cell({ repondu: false, refusee: true }),
    cell({ repondu: false, refusee: true, label: "Niamey" }),
  ]);
  assert.equal(v.repondues, 0);
  assert.equal(v.refusees, 2);
  assert.match(v.texte, /ne dit RIEN sur le ciel/);
});

test("COUVERTURE : échec réseau et refus de débit sont comptés séparément", () => {
  const v = couvertureVerdict([
    cell({ repondu: false, refusee: true }),
    cell({ repondu: false, refusee: false, label: "Khartoum" }),
  ]);
  assert.equal(v.refusees, 1);
  assert.equal(v.muettes, 1);
});

test("COUVERTURE : du trafic trouvé, avec mention des cellules refusées", () => {
  const v = couvertureVerdict([
    cell({ label: "Tunis", avions: 62 }),
    cell({ label: "Alger", repondu: false, refusee: true }),
  ]);
  assert.equal(v.avions, 62);
  assert.match(v.texte, /62 avions/);
  assert.match(v.texte, /1 refusée pour débit/);
});

test("COUVERTURE : une cellule refusée ne compte AUCUN avion", () => {
  // Sinon une cellule jamais lue contribuerait un chiffre inventé au total.
  const v = couvertureVerdict([cell({ repondu: false, refusee: true, avions: 99 })]);
  assert.equal(v.avions, 0);
});

test("COUVERTURE : aucune cellule interrogée se dit tel quel", () => {
  const v = couvertureVerdict([]);
  assert.equal(v.interrogees, 0);
  assert.match(v.texte, /Aucune cellule interrogée/);
});
