import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { garderTraces } from "./traces-gabarit.ts";

type Sorte = "homme" | "voiture" | "pirogue";
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
