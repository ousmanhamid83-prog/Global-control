import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fusionnerCrans,
  garderTraces,
  mesurerTaches,
  type Cran,
  type Sorte,
} from "./traces-gabarit.ts";

type Candidate = { id: Sorte; force: number; fx: number; fy: number; n: number };

/** Un tirage reproductible (générateur congruentiel), pour des contrastes sans lien avec la place. */
function tirage(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Une tuile de 256 px couverte de traces sur une grille 16 × 16, dans l'ordre où le balayage les
 * trouve (de haut en bas, de gauche à droite), chacune d'un contraste tiré au hasard.
 */
function tuileDeTraces(graine: number, sorte: (i: number) => Sorte = () => "voiture"): Candidate[] {
  const hasard = tirage(graine);
  const out: Candidate[] = [];
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const n = out.length;
      out.push({
        id: sorte(n),
        force: 22 + hasard() * 80,
        fx: (i + 0.5) / 16,
        fy: (j + 0.5) / 16,
        n,
      });
    }
  }
  return out;
}

/** L'ancienne règle, pour comparer : les premières trouvées, 4 par sorte et 8 en tout. */
function premieresLues(c: readonly Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of c) if (out.filter((h) => h.id === t.id).length < 4 && out.length < 8) out.push(t);
  return out;
}

const moyenne = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

describe("garderTraces : les plus nettes, pas les premières lues", () => {
  it("sur une tuile lue de haut en bas, les traces montrées ne collent plus au bord haut", () => {
    const sortes: Sorte[] = ["homme", "voiture", "pirogue"];
    const hauteurs: number[] = [];
    const avant: number[] = [];
    for (let graine = 1; graine <= 60; graine++) {
      const c = tuileDeTraces(graine, (n) => sortes[n % 3]!);
      const gardees = garderTraces(c, { parSorte: 4, total: 8 });
      assert.equal(gardees.length, 8);
      hauteurs.push(...gardees.map((t) => t.fy));
      avant.push(...premieresLues(c).map((t) => t.fy));
    }
    // L'ancienne règle ne montrait que la première rangée de la tuile.
    assert.ok(Math.max(...avant) < 0.07, String(Math.max(...avant)));
    // Choisies au contraste, réparties sur toute la hauteur : moyenne au milieu, haut et bas aussi fournis.
    const m = moyenne(hauteurs);
    assert.ok(m > 0.42 && m < 0.58, `hauteur moyenne ${m.toFixed(3)}`);
    const haut = hauteurs.filter((y) => y < 0.5).length;
    assert.ok(
      Math.abs(haut / hauteurs.length - 0.5) < 0.08,
      `${haut} sur ${hauteurs.length} en haut`,
    );
  });

  it("ce sont exactement les plus contrastées, de la plus nette à la moins nette", () => {
    const c = tuileDeTraces(7);
    const gardees = garderTraces(c, { total: 8 });
    const attendues = [...c].sort((a, b) => b.force - a.force).slice(0, 8);
    assert.deepEqual(
      gardees.map((t) => t.n),
      attendues.map((t) => t.n),
    );
  });

  it("au plus 4 d'une même sorte et 8 en tout : les autres sortes prennent la suite, par contraste", () => {
    const c: Candidate[] = [];
    // Les dix plus nettes sont des voitures ; puis des hommes et des pirogues, moins nets.
    for (let k = 0; k < 10; k++) c.push({ id: "voiture", force: 100 - k, fx: 0, fy: 0, n: k });
    for (let k = 0; k < 5; k++) c.push({ id: "homme", force: 60 - k, fx: 0, fy: 0, n: 10 + k });
    for (let k = 0; k < 5; k++)
      c.push({ id: "pirogue", force: 58 - k * 2, fx: 0, fy: 0, n: 15 + k });
    const g = garderTraces(c, { parSorte: 4, total: 8 });
    assert.deepEqual(
      g.map((t) => `${t.id}${t.force}`),
      // À contraste égal (58), l'homme reçu avant la pirogue passe avant elle.
      [
        "voiture100",
        "voiture99",
        "voiture98",
        "voiture97",
        "homme60",
        "homme59",
        "homme58",
        "pirogue58",
      ],
    );
  });

  it("sur les 3 × 3 tuiles du centre : les 12 plus nettes, d'où qu'elles viennent, sans plafond par sorte", () => {
    // Neuf tuiles de huit traces, dans l'ordre où le balayage les lit (haut gauche d'abord). Les plus
    // nettes sont dans la rangée du bas : l'ancienne règle prenait les 12 premières lues.
    const c: Candidate[] = [];
    for (let tuile = 0; tuile < 9; tuile++) {
      for (let k = 0; k < 8; k++) {
        c.push({
          id: "voiture",
          force: tuile * 10 + k,
          fx: 0,
          fy: Math.floor(tuile / 3),
          n: c.length,
        });
      }
    }
    const g = garderTraces(c, { total: 12 });
    assert.equal(g.length, 12);
    assert.ok(
      g.every((t) => t.fy === 2),
      "toutes dans la rangée du bas, la plus nette",
    );
    assert.deepEqual(
      g.map((t) => t.force),
      [87, 86, 85, 84, 83, 82, 81, 80, 77, 76, 75, 74],
    );
  });

  it("à contraste égal, l'ordre reçu ; la liste reçue n'est pas touchée", () => {
    const c: Candidate[] = [
      { id: "voiture", force: 30, fx: 0, fy: 0, n: 0 },
      { id: "homme", force: 50, fx: 0, fy: 0, n: 1 },
      { id: "voiture", force: 50, fx: 0, fy: 0, n: 2 },
      { id: "pirogue", force: 30, fx: 0, fy: 0, n: 3 },
    ];
    const copie = c.map((t) => ({ ...t }));
    assert.deepEqual(
      garderTraces(c, { total: 4 }).map((t) => t.n),
      [1, 2, 0, 3],
    );
    assert.deepEqual(c, copie);
  });

  it("moins de traces que les plafonds : toutes ; aucune : aucune", () => {
    const c: Candidate[] = [
      { id: "homme", force: 25, fx: 0, fy: 0, n: 0 },
      { id: "homme", force: 40, fx: 0, fy: 0, n: 1 },
    ];
    assert.deepEqual(
      garderTraces(c, { parSorte: 4, total: 8 }).map((t) => t.n),
      [1, 0],
    );
    assert.deepEqual(garderTraces([], { total: 12 }), []);
  });
});

// ——— La mesure des taches, sur des tuiles de synthèse au contraste calculé.

const S = 256;
/** Le cran d'une tache de tant de pixels (les seuils du poste : 1,5 / 6 / 12 px). */
const cranDe = (px: number): Cran =>
  px >= 12 ? "identification" : px >= 6 ? "reconnaissance" : px >= 1.5 ? "detection" : "aucune";
const TOUS: Record<Sorte, Cran> = {
  homme: "detection",
  voiture: "detection",
  pirogue: "detection",
};

/** Une tuile grise (150), et des taches sombres (100) : un écart de 50 qui ne déborde pas sur le fond. */
function tuile(
  taches: readonly [x: number, y: number, larg: number, haut: number][],
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(S * S * 4).fill(150);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  for (const [x0, y0, l, h] of taches) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + l; x++) {
        const k = (y * S + x) * 4;
        px[k] = px[k + 1] = px[k + 2] = 100;
      }
    }
  }
  return px;
}

describe("mesurerTaches : les taches de contraste d'une tuile, au gabarit", () => {
  it("des voitures (4 × 2 px à 1,2 m : 4,8 m) : comptées, centrées, leur cran et leur contraste", () => {
    const places: [number, number][] = [
      [40, 40],
      [120, 60],
      [200, 180],
      [60, 200],
      [128, 128],
    ];
    const m = mesurerTaches(tuile(places.map(([x, y]) => [x, y, 4, 2])), S, {
      gsd: 1.2,
      eau: false,
      crans: TOUS,
      cranDe,
    });
    assert.equal(m.voiture, 5);
    assert.equal(m.homme, 0);
    assert.equal(m.pirogue, 0);
    assert.deepEqual(m.crans, { voiture: "detection" });
    const centres = m.taches.map((t) => `${t.cx},${t.cy}`).sort();
    assert.deepEqual(centres, places.map(([x, y]) => `${x + 1.5},${y + 0.5}`).sort());
    for (const t of m.taches) {
      assert.equal(t.id, "voiture");
      assert.equal(t.px, 4);
      assert.equal(t.cls, "detection");
      assert.ok(t.force > 22 && t.force < 50, String(t.force));
    }
  });

  it("une tache qui touche le bord de la zone regardée est coupée : ni comptée ni montrée", () => {
    // La zone regardée va du pixel 2 au pixel 253 (il faut 2 pixels de voisinage de chaque côté).
    const coupees: [number, number, number, number][] = [
      [2, 100, 4, 2], // touche la colonne 2
      [250, 60, 4, 2], // touche la colonne 253
      [100, 2, 4, 2], // touche la ligne 2
      [180, 252, 4, 2], // touche la ligne 253
      [0, 30, 4, 2], // à cheval sur le bord de la tuile
    ];
    const entieres: [number, number, number, number][] = [
      [3, 140, 4, 2],
      [249, 180, 4, 2],
      [160, 3, 4, 2],
      [60, 251, 4, 2],
    ];
    const m = mesurerTaches(tuile([...coupees, ...entieres]), S, {
      gsd: 1.2,
      eau: false,
      crans: TOUS,
      cranDe,
    });
    assert.equal(m.voiture, 4);
    assert.deepEqual(
      m.taches.map((t) => `${t.cx},${t.cy}`).sort(),
      entieres.map(([x, y]) => `${x + 1.5},${y + 0.5}`).sort(),
    );
  });

  it("une pirogue (10 × 2 px à 1,2 m : 12 m, allongée) sur l'eau seulement", () => {
    const px = tuile([[80, 90, 10, 2]]);
    const surLeau = mesurerTaches(px, S, { gsd: 1.2, eau: true, crans: TOUS, cranDe });
    assert.equal(surLeau.pirogue, 1);
    assert.deepEqual(surLeau.crans, { pirogue: "reconnaissance" });
    assert.equal(surLeau.taches[0]!.px, 10);
    const aTerre = mesurerTaches(px, S, { gsd: 1.2, eau: false, crans: TOUS, cranDe });
    assert.equal(aTerre.pirogue + aTerre.voiture + aTerre.homme, 0);
  });

  it("un homme (2 × 2 px à 0,3 m : 0,6 m) ; rien d'une sorte que cette finesse ne permet pas", () => {
    const px = tuile([[50, 50, 2, 2]]);
    assert.equal(mesurerTaches(px, S, { gsd: 0.3, eau: false, crans: TOUS, cranDe }).homme, 1);
    const sansHomme = { ...TOUS, homme: "aucune" as const };
    assert.equal(mesurerTaches(px, S, { gsd: 0.3, eau: false, crans: sansHomme, cranDe }).homme, 0);
    // Une voiture que la finesse ne permet pas de voir n'est pas comptée non plus.
    const voit = tuile([[50, 50, 4, 2]]);
    const sansVoiture = { ...TOUS, voiture: "aucune" as const };
    assert.equal(
      mesurerTaches(voit, S, { gsd: 1.2, eau: false, crans: sansVoiture, cranDe }).voiture,
      0,
    );
  });

  it("une tache d'une seule venue, quelle que soit sa forme (un U, un J) : comptée une fois, entière", () => {
    // Le U se parcourt en remontant son bras droit, le J en revenant vers la gauche par son pied.
    const u: [number, number, number, number][] = [
      [60, 60, 1, 3],
      [63, 60, 1, 3],
      [61, 62, 2, 1],
    ];
    const jj: [number, number, number, number][] = [
      [143, 120, 1, 3],
      [140, 122, 3, 1],
    ];
    const m = mesurerTaches(tuile([...u, ...jj]), S, { gsd: 1.2, eau: false, crans: TOUS, cranDe });
    assert.equal(m.voiture, 2);
    const centres = m.taches.map((t) => [t.cx, t.cy]).sort((a, b) => a[0]! - b[0]!);
    assert.deepEqual(centres, [
      [61.5, 61.25],
      // Le J : 3 px de bras (x 143) et 3 px de pied (x 140 à 142) ; y 120 à 122, pied en 122.
      [142, 121.5],
    ]);
  });

  it("écartées : trop petite (2 px), trop longue (plus de 18 px), mal remplie, trop grande", () => {
    // 2 px ; un L de 8 × 8 px (15 px : remplissage 0,23) qui, plein, serait une voiture de 4 m.
    const m = mesurerTaches(
      tuile([
        [30, 30, 2, 1],
        [120, 120, 8, 1],
        [120, 121, 1, 7],
      ]),
      S,
      { gsd: 0.5, eau: true, crans: TOUS, cranDe },
    );
    assert.equal(m.homme + m.voiture + m.pirogue, 0);
    // 2 px à 0,3 m : 0,6 m, la taille d'un homme — mais moins de 3 pixels, rien de mesurable.
    assert.equal(
      mesurerTaches(tuile([[30, 30, 2, 1]]), S, { gsd: 0.3, eau: false, crans: TOUS, cranDe })
        .homme,
      0,
    );
    // Un cadre de 20 × 4 px à 0,5 m (10 m, allongé de 5) : une pirogue, mais plus de 18 px de long.
    const cadre = mesurerTaches(
      tuile([
        [100, 100, 20, 1],
        [100, 103, 20, 1],
        [100, 101, 1, 2],
        [119, 101, 1, 2],
      ]),
      S,
      { gsd: 0.5, eau: true, crans: TOUS, cranDe },
    );
    assert.equal(cadre.pirogue, 0);
    // Le même cadre de 16 px (8 m) : une pirogue — c'est bien la longueur qui l'écartait.
    const court = mesurerTaches(
      tuile([
        [100, 100, 16, 1],
        [100, 103, 16, 1],
        [100, 101, 1, 2],
        [115, 101, 1, 2],
      ]),
      S,
      { gsd: 0.5, eau: true, crans: TOUS, cranDe },
    );
    assert.equal(court.pirogue, 1);
    // Sans finesse pour la voir, pas de pirogue.
    const sansPirogue = { ...TOUS, pirogue: "aucune" as const };
    assert.equal(
      mesurerTaches(tuile([[80, 90, 10, 2]]), S, {
        gsd: 1.2,
        eau: true,
        crans: sansPirogue,
        cranDe,
      }).pirogue,
      0,
    );
    // Trop grande : 7 × 7 px au contraste fort font plus de 48 pixels qui tranchent.
    const grand = new Uint8ClampedArray(tuile([])).fill(150);
    for (let y = 100; y < 107; y++) {
      for (let x = 100; x < 107; x++) {
        const k = (y * S + x) * 4;
        grand[k] = grand[k + 1] = grand[k + 2] = 0;
      }
    }
    const g = mesurerTaches(grand, S, { gsd: 0.6, eau: true, crans: TOUS, cranDe });
    assert.equal(g.taches.length, 0);
  });

  it("le cran retenu pour une sorte est le meilleur de toutes ses taches", () => {
    // À 1,2 m : 4 × 2 px = 4,8 m et 5 × 2 px = 6 m, deux voitures ; ce cran-ci dit « reconnaissance »
    // dès 5 px. Un bloc de 3 px de haut, au contraste uniforme, ne trancherait pas en son milieu
    // sans déborder sur le fond (fenêtre de 5 × 5) : les taches d'essai font 2 px de haut.
    const cran5 = (px: number): Cran => (px >= 5 ? "reconnaissance" : "detection");
    const m = mesurerTaches(
      tuile([
        [40, 40, 4, 2],
        [100, 100, 5, 2],
        [160, 60, 4, 2],
      ]),
      S,
      { gsd: 1.2, eau: false, crans: TOUS, cranDe: cran5 },
    );
    assert.equal(m.voiture, 3);
    assert.deepEqual(m.crans, { voiture: "reconnaissance" });
    assert.deepEqual(m.taches.map((t) => t.cls).sort(), [
      "detection",
      "detection",
      "reconnaissance",
    ]);
  });

  it("fusionnerCrans : sorte par sorte, le meilleur des deux", () => {
    assert.deepEqual(
      fusionnerCrans(
        { voiture: "detection", homme: "reconnaissance" },
        { voiture: "reconnaissance", homme: "detection", pirogue: "detection" },
      ),
      { voiture: "reconnaissance", homme: "reconnaissance", pirogue: "detection" },
    );
    assert.deepEqual(fusionnerCrans({}, { homme: "identification" }), { homme: "identification" });
    assert.deepEqual(fusionnerCrans({ homme: "detection" }, {}), { homme: "detection" });
  });
});
