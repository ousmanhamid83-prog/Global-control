import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { choisirGabarits, type CandidatGabarit } from "./choix-gabarits.ts";

/** Tirage pseudo-aléatoire à graine (mulberry32) : le même essai à chaque passage. */
function tirage(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tache = CandidatGabarit & { lig: number };

/**
 * Une tuile couverte de taches en grille de `cote` × `cote`, dans l'ordre du balayage (ligne par
 * ligne, du haut vers le bas) : voitures et hommes en damier, contraste donné par `force`.
 */
function tuileEnGrille(
  tx: number,
  ty: number,
  cote: number,
  force: (lig: number, col: number) => number,
): Tache[] {
  const taches: Tache[] = [];
  for (let lig = 0; lig < cote; lig++) {
    for (let col = 0; col < cote; col++) {
      taches.push({
        id: (lig + col) % 2 === 0 ? "voiture" : "homme",
        tuile: `${tx}/${ty}`,
        x: tx + (col + 0.5) / cote,
        y: ty + (lig + 0.5) / cote,
        force: force(lig, col),
        lig,
      });
    }
  }
  return taches;
}

/** L'ancien choix, pour comparer : les premières taches trouvées au balayage (4 par classe, 8). */
function premiersTrouves(taches: readonly Tache[]): Tache[] {
  const gardes: Tache[] = [];
  for (const t of taches) {
    if (gardes.filter((h) => h.id === t.id).length < 4 && gardes.length < 8) gardes.push(t);
  }
  return gardes;
}

const moyenne = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;

describe("repères de la carte : sur une tuile, le contraste décide, pas la place", () => {
  it("garde les taches les plus contrastées, en bas comme en haut de la tuile", () => {
    // Contraste croissant vers le bas : l'ancien choix gardait la première ligne, la plus pâle.
    const versLeBas = tuileEnGrille(0, 0, 16, (lig, col) => 30 + lig + col / 100);
    assert.ok(premiersTrouves(versLeBas).every((t) => t.lig === 0));
    const enBas = choisirGabarits(versLeBas, { x: 0.5, y: 0.5 });
    assert.equal(enBas.length, 8);
    assert.deepEqual(
      enBas.map((t) => t.lig),
      [15, 15, 15, 15, 15, 15, 15, 15],
    );
    assert.deepEqual(
      enBas.map((t) => t.id),
      ["voiture", "homme", "voiture", "homme", "voiture", "homme", "voiture", "homme"],
    );
    // Contraste croissant vers le haut : la première ligne est gardée, parce qu'elle est la plus nette.
    const versLeHaut = tuileEnGrille(0, 0, 16, (lig, col) => 30 - lig + col / 100);
    const enHaut = choisirGabarits(versLeHaut, { x: 0.5, y: 0.5 });
    assert.ok(enHaut.every((t) => t.lig === 0));
  });

  it("taches réparties sur toute la tuile, contraste sans lien avec la place : les repères aussi", () => {
    const ancien: number[] = [];
    const nouveau: number[] = [];
    for (let graine = 1; graine <= 400; graine++) {
      const r = tirage(graine);
      const taches = tuileEnGrille(0, 0, 16, () => 22 + 60 * r());
      for (const t of premiersTrouves(taches)) ancien.push(t.y);
      const gardes = choisirGabarits(taches, { x: 0.5, y: 0.5 });
      assert.equal(gardes.length, 8);
      for (const t of gardes) nouveau.push(t.y);
    }
    // L'ancien choix : tout sur la première ligne (y moyen 1/32 de la tuile).
    assert.ok(ancien.every((y) => y < 1 / 16));
    // Le nouveau : y moyen au milieu de la tuile, et autant de repères dans chaque moitié.
    assert.ok(Math.abs(moyenne(nouveau) - 0.5) < 0.03, `y moyen ${moyenne(nouveau)}`);
    const enHaut = nouveau.filter((y) => y < 0.5).length / nouveau.length;
    assert.ok(Math.abs(enHaut - 0.5) < 0.05, `moitié haute ${enHaut}`);
  });
});

describe("repères de la carte : sur le bloc de 3 × 3 tuiles du balayage", () => {
  it("la rangée de tuiles du haut ne prend plus les 12 places", () => {
    const parRangee = [0, 0, 0];
    let total = 0;
    for (let graine = 1; graine <= 300; graine++) {
      const r = tirage(graine);
      const tuiles: Tache[][] = [];
      // L'ordre de scanCenterTile : tuiles du haut d'abord, puis de gauche à droite.
      for (let ty = 0; ty < 3; ty++) {
        for (let tx = 0; tx < 3; tx++) tuiles.push(tuileEnGrille(tx, ty, 8, () => 22 + 60 * r()));
      }
      const ancien = tuiles.flatMap(premiersTrouves).slice(0, 12);
      assert.ok(
        ancien.every((t) => t.y < 1 / 8),
        "l'ancien choix : la première ligne du haut",
      );
      const gardes = choisirGabarits(tuiles.flat(), { x: 1.5, y: 1.5 });
      assert.equal(gardes.length, 12);
      for (const t of gardes) parRangee[Math.floor(t.y)]++;
      total += gardes.length;
    }
    for (const n of parRangee) {
      assert.ok(Math.abs(n / total - 1 / 3) < 0.05, `rangées ${parRangee.join(" / ")}`);
    }
  });
});

describe("repères de la carte : plafonds, ordre, centre", () => {
  const tache = (tuile: string, id: string, force: number, x = 0.5, y = 0.5): CandidatGabarit => ({
    id,
    tuile,
    x,
    y,
    force,
  });

  it("4 par classe et par tuile, 8 par tuile, 12 en tout ; une classe pleine n'arrête pas les autres", () => {
    const a = [
      ...Array.from({ length: 10 }, (_, i) => tache("0/0", "voiture", 100 - i)),
      ...Array.from({ length: 10 }, (_, i) => tache("0/0", "homme", 90 - i)),
      ...Array.from({ length: 10 }, (_, i) => tache("0/0", "pirogue", 80 - i)),
    ];
    const b = Array.from({ length: 10 }, (_, i) => tache("1/0", "voiture", 50 - i, 1.5));
    const c = Array.from({ length: 10 }, (_, i) => tache("2/0", "voiture", 40 - i, 2.5));
    const gardes = choisirGabarits([...c, ...b, ...a], { x: 1.5, y: 0.5 });
    assert.deepEqual(
      gardes.map((g) => `${g.tuile} ${g.id} ${g.force}`),
      [
        "0/0 voiture 100",
        "0/0 voiture 99",
        "0/0 voiture 98",
        "0/0 voiture 97",
        "0/0 homme 90",
        "0/0 homme 89",
        "0/0 homme 88",
        "0/0 homme 87",
        "1/0 voiture 50",
        "1/0 voiture 49",
        "1/0 voiture 48",
        "1/0 voiture 47",
      ],
    );
  });

  it("à contraste égal, la plus proche du centre d'abord ; plus nette, une tache lointaine passe devant", () => {
    // Centre décalé (x ≠ y) : un x pris pour un y se verrait.
    const centre = { x: 1.4, y: 1.6 };
    // Dans l'ordre du balayage (ligne par ligne) : cet ordre-là ne doit plus compter.
    const taches = [
      tache("1/1", "voiture", 40, 1.5, 1.2), // à 0,17 (carré de la distance)
      tache("1/1", "voiture", 40, 1.1, 1.5), // à 0,10
      tache("1/1", "voiture", 40, 1.45, 1.55), // à 0,005
      tache("1/1", "voiture", 40, 1.85, 1.85), // à 0,265 : la 5e voiture de la tuile, écartée
      tache("1/1", "voiture", 40, 1.4, 1.9), // à 0,09
      tache("2/2", "voiture", 41, 2.9, 2.9), // loin, mais plus nette
    ];
    assert.deepEqual(
      choisirGabarits(taches, centre).map((g) => [g.x, g.y]),
      [
        [2.9, 2.9],
        [1.45, 1.55],
        [1.4, 1.9],
        [1.1, 1.5],
        [1.5, 1.2],
      ],
    );
  });

  it("rend les candidats eux-mêmes, sans toucher la liste reçue ; rien à choisir, rien de rendu", () => {
    const faible = { ...tache("0/0", "homme", 25), lat: 12.1, lon: 15.1, cls: "detection" };
    const fort = { ...tache("0/0", "voiture", 70), lat: 12.2, lon: 15.2, cls: "reconnaissance" };
    const recue = [faible, fort];
    const gardes = choisirGabarits(recue, { x: 0.5, y: 0.5 });
    assert.equal(gardes[0], fort);
    assert.equal(gardes[1], faible);
    assert.deepEqual(recue, [faible, fort]);
    assert.equal(recue[0], faible);
    assert.deepEqual(choisirGabarits([], { x: 0, y: 0 }), []);
  });
});
