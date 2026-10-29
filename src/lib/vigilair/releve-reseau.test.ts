import { test } from "node:test";
import assert from "node:assert/strict";
import { cellulesDuReleve, reunirLots, vieCellule, type Cellule } from "./releve-reseau.ts";
import type { LiveAc } from "./live-adsb.ts";

const CELLS: Cellule[] = Array.from({ length: 21 }, (_, i) => ({ lat: i, lon: i, label: `C${i}` }));

function ac(hex: string, seenS: number, over: Partial<LiveAc> = {}): LiveAc {
  return {
    hex,
    flight: hex.toUpperCase(),
    flightTx: false,
    messages: null,
    lat: 12,
    lon: 15,
    altM: 9000,
    gsKmh: 720,
    track: 90,
    climbMs: 0,
    squawk: null,
    icaoType: null,
    reg: null,
    rssi: null,
    emergency: null,
    seenS,
    onGround: false,
    category: null,
    nic: null,
    nacp: null,
    sil: null,
    military: false,
    posSource: "adsb",
    rcM: null,
    ...over,
  };
}

/** Rejoue la rotation : un relevé toutes les `cadenceMs`, et compte les cellules expirées avant de repasser. */
function trous(vieMs: number, cadenceMs: number, dureeMs: number): number {
  const releveeA = new Map<string, number>();
  let n = 0;
  for (let t = 0; t <= dureeMs; t += cadenceMs) {
    for (const [label, at] of releveeA) {
      if (t - at > vieMs) {
        releveeA.delete(label);
        n++;
      }
    }
    for (const c of cellulesDuReleve(CELLS, releveeA, 3)) releveeA.set(c.label, t);
  }
  return n;
}

/* ── QUELLES CELLULES RELEVER ───────────────────────────────────────────────────────────────────── */

test("DÉMARRAGE : tout ce qui manque est relevé d'un coup — l'image est complète au premier relevé", () => {
  // Avant : trois cellules à la fois, plus de deux minutes avant une image complète.
  assert.equal(cellulesDuReleve(CELLS, new Map(), 3).length, 21);
});

test("ROTATION : en régime, les trois cellules les plus anciennes", () => {
  const releveeA = new Map(CELLS.map((c, i) => [c.label, 1000 + i * 10]));
  assert.deepEqual(
    cellulesDuReleve(CELLS, releveeA, 3).map((c) => c.label),
    ["C0", "C1", "C2"],
  );
});

test("ROTATION : quelques manquantes passent en tête, sans rafale", () => {
  const releveeA = new Map(CELLS.slice(2).map((c, i) => [c.label, 1000 + i]));
  assert.deepEqual(
    cellulesDuReleve(CELLS, releveeA, 3).map((c) => c.label),
    ["C0", "C1", "C2"],
  );
});

test("PLUS DE TROU : à la cadence mesurée, aucune cellule n'expire avant que la rotation repasse", () => {
  // Mesuré : un relevé réseau toutes les ~24 s (client à 12 s, image gardée 20 s), tour de ~168 s.
  // L'ancienne durée de vie (100 s) faisait disparaître chaque cellule ~40 % du temps.
  assert.ok(trous(100_000, 24_000, 30 * 60_000) > 0, "l'ancienne durée de vie trouait l'image");
  assert.equal(trous(vieCellule(21, 3, 20_000), 24_000, 30 * 60_000), 0);
});

test("PLUS DE TROU : ni avec des relevés franchement espacés (40 s)", () => {
  assert.equal(trous(vieCellule(21, 3, 20_000), 40_000, 30 * 60_000), 0);
});

/* ── UNE HEURE DE RÉFÉRENCE POUR TOUT LE RELEVÉ ─────────────────────────────────────────────────── */

test("HEURE UNIQUE : un rapport resservi garde son heure d'observation, relevé après relevé", () => {
  // Cellule relevée à t = 1 000 ms, avion vu 5 s plus tôt : observé à t = −4 000 ms. Resservi aux
  // relevés suivants, à cadence irrégulière, il doit garder exactement cette heure-là.
  const lot = { ac: [ac("abc123", 5)], at: 1000 };
  for (const refAt of [21_000, 47_700, 73_123]) {
    const [r] = reunirLots([lot], refAt);
    assert.ok(Math.abs(refAt - r!.seenS * 1000 - -4000) < 1e-6, `à ${refAt} : ${refAt - r!.seenS * 1000}`);
  }
});

test("COMPARAISON À LA MÊME HEURE : le rapport le plus frais l'emporte, même s'il a l'air plus vieux", () => {
  // Lot A relevé à 0 : vu 1 s avant → 11 s d'âge à 10 000. Lot B relevé à 9 000 : vu 5 s avant →
  // 6 s d'âge. Comparés tels quels (1 s contre 5 s), le plus vieux l'aurait emporté.
  const a = { ac: [ac("abc123", 1, { lat: 12.0 })], at: 0 };
  const b = { ac: [ac("abc123", 5, { lat: 12.1 })], at: 9000 };
  const [r] = reunirLots([a, b], 10_000);
  assert.equal(r!.lat, 12.1);
  assert.ok(Math.abs(r!.seenS - 6) < 1e-9);
});

test("FUSION : une urgence ou un drapeau militaire vus dans un autre lot ne se perdent pas", () => {
  const vieux = { ac: [ac("abc123", 2, { emergency: "7700", military: true })], at: 0 };
  const frais = { ac: [ac("abc123", 1)], at: 9000 };
  const [r] = reunirLots([vieux, frais], 10_000);
  assert.equal(r!.emergency, "7700");
  assert.equal(r!.military, true);
});
