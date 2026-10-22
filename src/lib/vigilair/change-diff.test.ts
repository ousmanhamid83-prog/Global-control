import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allBlobs,
  blobStats,
  diffHeatmap,
  foregroundDiff,
  frameHeading,
  initBackground,
  mergeNearbyBlobs,
  presenceHint,
  updateBackground,
} from "./change-diff.ts";

/** Fabrique une image RGBA pleine d'une couleur. */
function fill(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a[i * 4] = r;
    a[i * 4 + 1] = g;
    a[i * 4 + 2] = b;
    a[i * 4 + 3] = 255;
  }
  return a;
}

test("images identiques : aucun changement", () => {
  const w = 8;
  const h = 8;
  const img = fill(w, h, 120, 110, 90);
  const res = diffHeatmap(img, fill(w, h, 120, 110, 90), w, h);
  assert.equal(res.changedFrac, 0);
  assert.equal(res.compared, w * h);
  assert.ok(res.overlay.every((v) => v === 0));
});

test("un bloc modifié est allumé, le reste non", () => {
  const w = 10;
  const h = 10;
  const before = fill(w, h, 100, 100, 100);
  const after = fill(w, h, 100, 100, 100);
  // modifie un carré 3×3 en haut à gauche (piste/engin apparu)
  let touched = 0;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const p = (y * w + x) * 4;
      after[p] = 220;
      after[p + 1] = 210;
      after[p + 2] = 190;
      touched++;
    }
  }
  const res = diffHeatmap(before, after, w, h, { threshold: 30 });
  assert.equal(res.compared, w * h);
  // exactement les 9 pixels du bloc sont marqués
  let lit = 0;
  for (let i = 0; i < w * h; i++) if (res.overlay[i * 4 + 3] > 0) lit++;
  assert.equal(lit, touched);
  assert.ok(Math.abs(res.changedFrac - 9 / 100) < 1e-9);
  // le pixel (0,0) est teinté, un pixel du fond (9,9) ne l'est pas
  assert.ok(res.overlay[3] > 0);
  assert.equal(res.overlay[(99 * 4) + 3], 0);
});

test("zone sans donnée (quasi-noir) jamais comptée comme changement", () => {
  const w = 4;
  const h = 4;
  // before tout noir (pas de passage), after lumineux → ce n'est PAS un changement, c'est une absence de donnée
  const before = fill(w, h, 0, 0, 0);
  const after = fill(w, h, 200, 200, 200);
  const res = diffHeatmap(before, after, w, h);
  assert.equal(res.compared, 0);
  assert.equal(res.changedFrac, 0);
  assert.ok(res.overlay.every((v) => v === 0));
});

test("différence sous le seuil ignorée (bruit d'illumination)", () => {
  const w = 6;
  const h = 6;
  const before = fill(w, h, 100, 100, 100);
  const after = fill(w, h, 110, 108, 112); // ~ +8/canal, sous le seuil 30
  const res = diffHeatmap(before, after, w, h, { threshold: 30 });
  assert.equal(res.changedFrac, 0);
});

/** Pose un rectangle « changé » (after ≠ before) dans un cadre uni. */
function withRect(w: number, h: number, x0: number, y0: number, rw: number, rh: number) {
  const before = fill(w, h, 100, 100, 100);
  const after = fill(w, h, 100, 100, 100);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const p = (y * w + x) * 4;
      after[p] = 230;
      after[p + 1] = 220;
      after[p + 2] = 200;
    }
  }
  return { before, after };
}

test("diffHeatmap renvoie un masque quand on le demande", () => {
  const { before, after } = withRect(10, 10, 1, 1, 3, 2);
  const res = diffHeatmap(before, after, 10, 10, { threshold: 30, mask: true });
  assert.ok(res.mask instanceof Uint8Array);
  assert.equal(res.mask!.reduce((s, v) => s + v, 0), 6); // 3×2 pixels changés
  // sans l'option, pas de masque
  assert.equal(diffHeatmap(before, after, 10, 10, { threshold: 30 }).mask, undefined);
});

test("blobStats regroupe une zone connexe et donne sa boîte + centre", () => {
  const { before, after } = withRect(12, 12, 2, 3, 4, 2); // 1 zone 4×2 = 8 px
  const { mask } = diffHeatmap(before, after, 12, 12, { threshold: 30, mask: true });
  const st = blobStats(mask!, 12, 12, 1);
  assert.equal(st.count, 1);
  assert.equal(st.totalChanged, 8);
  assert.ok(st.largest);
  assert.equal(st.largest!.area, 8);
  assert.equal(st.largest!.x0, 2);
  assert.equal(st.largest!.x1, 5);
  assert.equal(st.largest!.y0, 3);
  assert.equal(st.largest!.y1, 4);
});

test("blobStats sépare deux zones disjointes et garde la plus grande", () => {
  const before = fill(16, 16, 100, 100, 100);
  const after = fill(16, 16, 100, 100, 100);
  const paint = (x0: number, y0: number, rw: number, rh: number) => {
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        const p = (y * 16 + x) * 4;
        after[p] = 230; after[p + 1] = 220; after[p + 2] = 200;
      }
  };
  paint(1, 1, 2, 2); // 4 px
  paint(10, 10, 3, 3); // 9 px (plus grande)
  const { mask } = diffHeatmap(before, after, 16, 16, { threshold: 30, mask: true });
  const st = blobStats(mask!, 16, 16, 1);
  assert.equal(st.count, 2);
  assert.equal(st.totalChanged, 13);
  assert.equal(st.largest!.area, 9);
});

test("blobStats ignore les taches sous minArea (bruit)", () => {
  const before = fill(16, 16, 100, 100, 100);
  const after = fill(16, 16, 100, 100, 100);
  const p = (2 * 16 + 2) * 4; // 1 pixel isolé
  after[p] = 230; after[p + 1] = 220; after[p + 2] = 200;
  const { mask } = diffHeatmap(before, after, 16, 16, { threshold: 30, mask: true });
  assert.equal(blobStats(mask!, 16, 16, 4).count, 0); // sous minArea=4
  assert.equal(blobStats(mask!, 16, 16, 1).count, 1);
});

test("presenceHint : géométrie vers indice prudent, jamais une identité", () => {
  // zone large et allongée au centre-bas → indice « véhicule possible » (≥ 4 % du cadre)
  const wide = presenceHint({ area: 600, x0: 10, y0: 60, x1: 50, y1: 74, cx: 30, cy: 67 }, 100, 100);
  assert.ok(wide.aspect >= 1.3);
  assert.equal(wide.where, "bas-gauche");
  assert.match(wide.hint, /véhicule possible/);
  // zone minuscule → mouvement ténu
  assert.equal(presenceHint({ area: 20, x0: 0, y0: 0, x1: 4, y1: 4, cx: 2, cy: 2 }, 100, 100).hint, "mouvement ténu");
  // rien
  assert.equal(presenceHint(null, 100, 100).hint, "aucune zone nette");
});

test("allBlobs renvoie toutes les zones ≥ minArea", () => {
  const before = fill(16, 16, 100, 100, 100);
  const after = fill(16, 16, 100, 100, 100);
  const paint = (x0: number, y0: number, rw: number, rh: number) => {
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        const p = (y * 16 + x) * 4;
        after[p] = 230; after[p + 1] = 220; after[p + 2] = 200;
      }
  };
  paint(1, 1, 2, 2);
  paint(10, 10, 3, 3);
  const { mask } = diffHeatmap(before, after, 16, 16, { threshold: 30, mask: true });
  const blobs = allBlobs(mask!, 16, 16, 1);
  assert.equal(blobs.length, 2);
});

test("mergeNearbyBlobs recolle deux bandes proches en une cible", () => {
  // deux bandes séparées de 3 px (départ + arrivée d'un même mobile) → une seule zone après fusion
  const bands = [
    { area: 30, x0: 10, y0: 40, x1: 15, y1: 65, cx: 12, cy: 52 },
    { area: 30, x0: 18, y0: 40, x1: 23, y1: 65, cx: 20, cy: 52 },
  ];
  assert.equal(mergeNearbyBlobs(bands, 4).length, 1);
  // avec un gap nul, elles restent séparées (écart de 3 px > 0)
  assert.equal(mergeNearbyBlobs(bands, 0).length, 2);
  // deux vraies cibles éloignées ne fusionnent pas
  const far = [
    { area: 30, x0: 5, y0: 5, x1: 10, y1: 10, cx: 7, cy: 7 },
    { area: 30, x0: 90, y0: 90, x1: 95, y1: 95, cx: 92, cy: 92 },
  ];
  assert.equal(mergeNearbyBlobs(far, 6).length, 2);
});

/** Scène sombre avec un carré clair à (sx,sy) de taille sz. */
function scene(w: number, h: number, sx: number, sy: number, sz: number): Uint8ClampedArray {
  const a = fill(w, h, 20, 20, 20);
  for (let y = sy; y < sy + sz; y++)
    for (let x = sx; x < sx + sz; x++) {
      const p = (y * w + x) * 4;
      a[p] = 235; a[p + 1] = 235; a[p + 2] = 235;
    }
  return a;
}

test("foregroundDiff : un objet absent du fond = UNE seule zone à sa position (pas deux bandes)", () => {
  const W = 40, H = 40;
  const empty = fill(W, H, 20, 20, 20);
  const bg = initBackground(empty, W, H); // fond = scène vide
  const cur = scene(W, H, 10, 10, 8); // objet apparu
  const fg = foregroundDiff(bg, cur, W, H, { threshold: 30, mask: true });
  const st = blobStats(fg.mask!, W, H, 1);
  assert.equal(st.count, 1); // une seule zone, pas un départ + une arrivée
  assert.equal(st.largest!.area, 64); // 8×8, l'objet entier (pas une bande)
});

test("updateBackground : une scène statique fond dans le fond (plus de détection)", () => {
  const W = 24, H = 24;
  const bg = initBackground(fill(W, H, 20, 20, 20), W, H);
  const newScene = scene(W, H, 6, 6, 6);
  // on « montre » la même scène longtemps : le fond doit converger vers elle
  for (let k = 0; k < 120; k++) updateBackground(bg, newScene, 0.1);
  const fg = foregroundDiff(bg, newScene, W, H, { threshold: 30 });
  assert.ok(fg.changedFrac < 0.01); // quasi plus rien d'« avant-plan »
});

test("updateBackground sélectif : un objet d'avant-plan persiste plus longtemps", () => {
  const W = 24, H = 24;
  const bg = initBackground(fill(W, H, 20, 20, 20), W, H);
  const obj = scene(W, H, 6, 6, 6);
  for (let k = 0; k < 8; k++) {
    const fg = foregroundDiff(bg, obj, W, H, { threshold: 30, mask: true });
    updateBackground(bg, obj, 0.1, fg.mask, 0.1); // fgFactor 0.1 : objet mis à jour 10× plus lentement
  }
  // après 8 trames, l'objet est encore détecté (n'a pas fondu)
  const fg = foregroundDiff(bg, obj, W, H, { threshold: 30 });
  assert.ok(fg.changedFrac > 0.03);
});

test("frameHeading : sens écran sur 8 secteurs, dy vers le bas", () => {
  assert.equal(frameHeading(0, 0), "immobile");
  assert.equal(frameHeading(5, 0), "droite"); // +x
  assert.equal(frameHeading(-5, 0), "gauche"); // -x
  assert.equal(frameHeading(0, -5), "haut"); // -y (image : vers le haut)
  assert.equal(frameHeading(0, 5), "bas"); // +y (vers le bas)
  assert.equal(frameHeading(5, -5), "haut-droite");
  assert.equal(frameHeading(-5, 5), "bas-gauche");
});
