import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellulesDuReleve,
  echeance,
  pasEncoreAbsents,
  PLAN_RELEVE,
  reposSource,
  reunirLots,
  vieCellule,
  type Cellule,
  type EtatCellule,
} from "./releve-reseau.ts";

const RYTHME = PLAN_RELEVE.rythme;
import type { LiveAc } from "./live-adsb.ts";

const CELLS: Cellule[] = Array.from({ length: 139 }, (_, i) => ({ lat: i, lon: i, label: `C${i}` }));

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

/**
 * Rejoue la rotation : un relevé toutes les `cadenceMs` ; les cellules `actives` rendent des avions,
 * les autres aucun. Compte les cellules ACTIVES expirées avant que la rotation repasse : autant de
 * pistes perdues puis renées.
 */
function trous(actives: number, cadenceMs: number, dureeMs: number): number {
  const etats = new Map<string, EtatCellule>();
  let n = 0;
  for (let t = 0; t <= dureeMs; t += cadenceMs) {
    for (const [label, etat] of etats) {
      if (t - etat.at > vieCellule(etat, RYTHME)) {
        etats.delete(label);
        if (etat.avions > 0) n++;
      }
    }
    for (const c of cellulesDuReleve(CELLS, etats, t, PLAN_RELEVE)) {
      etats.set(c.label, { at: t, avions: Number(c.label.slice(1)) < actives ? 5 : 0 });
    }
  }
  return n;
}

/* ── QUELLES CELLULES RELEVER ───────────────────────────────────────────────────────────────────── */

test("DÉMARRAGE : par lots, dans l'ordre de la liste — jamais en rafale (les API la refusent)", () => {
  // Mesuré : 139 cellules en 10 s, 133 refus 429. Seize au premier relevé, seize au suivant.
  const premier = cellulesDuReleve(CELLS, new Map(), 0, PLAN_RELEVE);
  assert.deepEqual(
    premier.map((c) => c.label),
    CELLS.slice(0, 16).map((c) => c.label),
  );
  const etats = new Map(premier.map((c) => [c.label, { at: 0, avions: 0 }]));
  assert.deepEqual(
    cellulesDuReleve(CELLS, etats, 20_000, PLAN_RELEVE).map((c) => c.label),
    CELLS.slice(16, 32).map((c) => c.label),
  );
});

test("ÉCHÉANCE : une cellule active revient après une minute, une vide après un quart d'heure", () => {
  assert.equal(echeance(undefined, RYTHME), Number.NEGATIVE_INFINITY);
  assert.equal(echeance({ at: 1000, avions: 3 }, RYTHME), 61_000);
  assert.equal(echeance({ at: 1000, avions: 0 }, RYTHME), 901_000);
  const etats = new Map<string, EtatCellule>(CELLS.map((c) => [c.label, { at: 0, avions: 0 }]));
  etats.set("C5", { at: 0, avions: 2 });
  etats.set("C9", { at: 10_000, avions: 7 });
  // À 60 s, seule C5 est due ; à 70 s, C9 aussi, après C5 (la plus en retard d'abord).
  assert.deepEqual(
    cellulesDuReleve(CELLS, etats, 60_000, PLAN_RELEVE).map((c) => c.label),
    ["C5"],
  );
  assert.deepEqual(
    cellulesDuReleve(CELLS, etats, 70_000, PLAN_RELEVE).map((c) => c.label),
    ["C5", "C9"],
  );
  assert.deepEqual(cellulesDuReleve(CELLS, etats, 59_999, PLAN_RELEVE), []);
  // Un quart d'heure plus tard, tout est dû : les actives d'abord, puis les vides, seize en tout.
  const tard = cellulesDuReleve(CELLS, etats, 900_000, PLAN_RELEVE);
  assert.deepEqual(
    tard.map((c) => c.label),
    ["C5", "C9", ...["C0", "C1", "C2", "C3", "C4", "C6", "C7", "C8"], "C10", "C11", "C12", "C13", "C14", "C15"],
  );
});

test("RÉSERVE : des actives nombreuses n'affament pas les autres — deux places leur restent", () => {
  const etats = new Map<string, EtatCellule>(
    CELLS.slice(0, 40).map((c) => [c.label, { at: 0, avions: 3 }]),
  );
  // 40 actives dues, 99 jamais relevées : 14 actives, puis les 2 premières jamais relevées.
  const pris = cellulesDuReleve(CELLS, etats, 60_000, PLAN_RELEVE).map((c) => c.label);
  assert.deepEqual(pris, [...CELLS.slice(0, 14).map((c) => c.label), "C40", "C41"]);
  // Sans autres cellules dues, les actives prennent les seize places.
  const toutesRelevees = new Map<string, EtatCellule>(
    CELLS.map((c, i) => [c.label, { at: 0, avions: i < 40 ? 3 : 0 }]),
  );
  assert.equal(cellulesDuReleve(CELLS, toutesRelevees, 60_000, PLAN_RELEVE).length, 16);
  // Une seule autre due : une place pour elle, quinze pour les actives.
  toutesRelevees.set("C100", { at: -900_000, avions: 0 });
  const un = cellulesDuReleve(CELLS, toutesRelevees, 60_000, PLAN_RELEVE).map((c) => c.label);
  assert.equal(un.length, 16);
  assert.equal(un.at(-1), "C100");
});

test("DURÉE DE VIE : trois fois le rythme de la cellule", () => {
  assert.equal(vieCellule({ at: 0, avions: 1 }, RYTHME), 180_000);
  assert.equal(vieCellule({ at: 0, avions: 0 }, RYTHME), 2_700_000);
});

test("PLUS DE TROU : 139 cellules, 35 actives (29 mesurées), relevés toutes les 20, 30 ou 40 s", () => {
  for (const cadence of [20_000, 30_000, 40_000]) {
    assert.equal(trous(35, cadence, 2 * 3600_000), 0, `relevés toutes les ${cadence / 1000} s`);
  }
});

test("PLUS DE TROU : ni avec 47 actives (balayage total : les cellules du monde aussi)", () => {
  assert.equal(trous(47, 30_000, 2 * 3600_000), 0);
});

/* ── UNE SOURCE QUI N'A PLUS DE QUOI RÉPONDRE ───────────────────────────────────────────────────── */

test("REPOS : adsb.lol à court (500 par jour) attend sa remise à zéro ; ouverte tant qu'il en reste", () => {
  const entetes = (h: Record<string, string>) => (nom: string) => h[nom] ?? null;
  // Les en-têtes réels du 23 novembre 2026, 19:51 UTC : 81 requêtes restantes, minuit dans 14 925 s.
  const reel = { "x-ratelimit-limit": "500, 500;w=86400", "x-ratelimit-remaining": "81", "x-ratelimit-reset": "14925" };
  assert.equal(reposSource(200, entetes(reel), 0), null);
  assert.equal(reposSource(200, entetes({}), 0), null, "adsb.fi ne dit rien : ouverte");
  // La dernière accordée : plus rien avant minuit.
  assert.equal(reposSource(200, entetes({ ...reel, "x-ratelimit-remaining": "0" }), 5), 5 + 14_925_000);
  assert.equal(reposSource(429, entetes(reel), 5), 5 + 14_925_000);
  // Un refus sans en-tête lisible : une minute.
  assert.equal(reposSource(429, entetes({}), 5), 60_005);
  assert.equal(reposSource(429, entetes({ "x-ratelimit-reset": "bientôt" }), 5), 60_005);
  assert.equal(reposSource(429, entetes({ "x-ratelimit-reset": "0" }), 5), 60_005);
  // Jamais plus d'un jour.
  assert.equal(reposSource(429, entetes({ "x-ratelimit-reset": "1800000000" }), 5), 5 + 86_400_000);
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

/* ── UN AVION ABSENT D'UN RELEVÉ N'A PAS FORCÉMENT DISPARU ──────────────────────────────────────── */

// Sur l'équateur, cap à l'est à 720 km/h : 0,1079° de longitude par minute. La cellule A, centrée
// à 0°, couvre jusqu'à 4,164° E ; la cellule B, centrée à 7,5° E, à partir de 3,336° E.
const A: Cellule = { lat: 0, lon: 0, label: "A" };
const B: Cellule = { lat: 0, lon: 7.5, label: "B" };
const rapport = (lon: number, seenS = 0) => ({ ac: ac("abc123", seenS, { lat: 0, lon }), at: 0 });
const gardes = (r: ReturnType<typeof rapport>, cellules: Cellule[], maintenant: number) =>
  pasEncoreAbsents([r], new Set(), cellules, maintenant, 300).length;

test("PISTE MÉMOIRE : absent des relevés frais, gardé tant qu'il vole dans la zone couverte", () => {
  // Rapport à 4,10° E ; 90 s plus tard il serait à 4,26° E : sorti de A, dans B.
  assert.equal(gardes(rapport(4.1), [A, B], 90_000), 1);
  // Sans B, il est sorti de la seule cellule : il s'en va.
  assert.equal(gardes(rapport(4.1), [A], 90_000), 0);
  // Au bord : 462,5 km du centre de A au bout de 30 s (rayon 463 km), il y est encore.
  assert.equal(gardes(rapport(4.1054), [A], 30_000), 1);
  assert.equal(gardes(rapport(4.111), [A], 30_000), 0);
  // Il est cherché là où il devrait être, à son cap : vers l'ouest, il reste dans A.
  const ouest = { ac: ac("abc123", 0, { lat: 0, lon: 4.1, track: 270 }), at: 0 };
  assert.equal(gardes(ouest, [A], 90_000), 1);
});

test("PISTE MÉMOIRE : jamais plus de 300 s sans rapport, l'âge du rapport compris", () => {
  assert.equal(gardes(rapport(3.0), [A], 300_000), 1);
  assert.equal(gardes(rapport(3.0), [A], 300_001), 0);
  // Vu 30 s avant le relevé qui l'a rendu : 30 s de moins à attendre.
  assert.equal(gardes(rapport(3.0, 30), [A], 270_000), 1);
  assert.equal(gardes(rapport(3.0, 30), [A], 270_001), 0);
  // Un avion présent dans les relevés frais n'est pas « gardé » : il y est déjà.
  assert.deepEqual(pasEncoreAbsents([rapport(3.0)], new Set(["abc123"]), [A], 90_000, 300), []);
});
