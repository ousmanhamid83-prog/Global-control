import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { planCliche } from "./cliche.ts";
import { composerCliche, type ServirTuile } from "./cliche.server.ts";

/** Une tuile JPEG réduite à ses en-têtes (SOI, SOF0 256 × 256, EOI), marquée de son adresse. */
function tuileJpeg(z: number, x: number, y: number): Uint8Array<ArrayBuffer> {
  const sof = [0xff, 0xc0, 0, 17, 8, 1, 0, 1, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...sof, z, x & 0xff, y & 0xff, 0xff, 0xd9]);
}
const SANS_IMAGERIE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Une carte qui rend de l'imagerie pour les cases données de chaque zoom (rang dans le plan, du
 * nord-ouest au sud-est), la tuile « sans imagerie » ailleurs, comme serveTile ; elle compte ses
 * appels.
 */
function carte(lat: number, lon: number, cases: Record<number, number[]>, via = "HIT:ESRI") {
  const appels: number[] = [];
  const servir: ServirTuile = async (z, x, y) => {
    appels.push(z);
    const rang = planCliche(lat, lon, z).tuiles.findIndex((t) => t.x === x && t.y === y);
    if (!cases[z]?.includes(rang)) {
      return new Response(SANS_IMAGERIE, { headers: { "X-AfriControl-Tile": "EMPTY" } });
    }
    return new Response(tuileJpeg(z, x, y), { headers: { "X-AfriControl-Tile": via } });
  };
  return { servir, appels };
}

const MNSTR31 = { lat: 34.53237, lon: 32.98022 };

describe("composerCliche : le zoom le plus fin où le lieu a de l'imagerie", () => {
  it("sous MNSTR31, en mer au sud d'Akrotiri : aucun zoom n'a la moitié du lieu, le plus fourni", async () => {
    // Mesuré le 24 novembre 2026 : 1 tuile sur 9 au zoom 14, 3 au 12, 3 au 11.
    const { servir } = carte(MNSTR31.lat, MNSTR31.lon, { 14: [0], 12: [0, 1, 4], 11: [0, 1, 2] });
    const c = await composerCliche(MNSTR31.lat, MNSTR31.lon, servir);
    assert.ok(c);
    // À égalité (3 au 12, 3 au 11), le plus fin.
    assert.equal(c.z, 12);
    assert.deepEqual(
      c.tuiles.map((t) => [t.col, t.lig]),
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    );
    assert.deepEqual(c.sources, ["Esri World Imagery"]);
    const plan = planCliche(MNSTR31.lat, MNSTR31.lon, 12);
    assert.deepEqual(c.marque, {
      fx: plan.marque.px / plan.cotePx,
      fy: plan.marque.py / plan.cotePx,
    });
    const h = createHash("sha256");
    for (const i of [0, 1, 4]) {
      const t = plan.tuiles[i]!;
      h.update(`${t.col},${t.lig}:`).update(tuileJpeg(12, t.x, t.y));
    }
    assert.equal(c.sha256, h.digest("hex"));
    // Un zoom plus large plus fourni l'emporte.
    const plusLarge = carte(MNSTR31.lat, MNSTR31.lon, { 14: [0], 12: [0, 1, 4], 11: [0, 1, 2, 3] });
    assert.equal((await composerCliche(MNSTR31.lat, MNSTR31.lon, plusLarge.servir))?.z, 11);
  });

  it("la moitié du lieu au moins : ce zoom, sans demander les suivants", async () => {
    const terre = carte(12.13, 15.03, { 14: [0, 1, 2, 3, 4], 12: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const c = await composerCliche(12.13, 15.03, terre.servir);
    assert.equal(c?.z, 14);
    assert.equal(c?.tuiles.length, 5);
    assert.deepEqual(terre.appels, new Array(9).fill(14));
    // 4 sur 9 ne font pas la moitié : le zoom 12, entier, passe devant.
    const quatre = carte(12.13, 15.03, { 14: [0, 1, 2, 3], 12: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const c12 = await composerCliche(12.13, 15.03, quatre.servir);
    assert.equal(c12?.z, 12);
    assert.equal(c12?.tuiles.length, 9);
    assert.deepEqual(quatre.appels, [...new Array(9).fill(14), ...new Array(9).fill(12)]);
  });

  it("rien nulle part, une carte injoignable ou en panne : pas de cliché, ou des cases grises", async () => {
    assert.equal(await composerCliche(MNSTR31.lat, MNSTR31.lon, carte(0, 0, {}).servir), null);
    const injoignable: ServirTuile = async () => new Response(null, { status: 502 });
    assert.equal(await composerCliche(MNSTR31.lat, MNSTR31.lon, injoignable), null);
    const enPanne: ServirTuile = async () => {
      throw new Error("timeout");
    };
    assert.equal(await composerCliche(MNSTR31.lat, MNSTR31.lon, enPanne), null);
    // Une réponse en erreur ne compte pas, même si elle porte des octets d'image.
    const erreurAvecImage: ServirTuile = async (z, x, y) =>
      new Response(tuileJpeg(z, x, y), { status: 503 });
    assert.equal(await composerCliche(MNSTR31.lat, MNSTR31.lon, erreurAvecImage), null);
    // Une tuile en panne au milieu des autres : sa case reste grise, le cliché part.
    const { servir } = carte(12.13, 15.03, { 14: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    let n = 0;
    const uneEnPanne: ServirTuile = (z, x, y) =>
      ++n === 5 ? Promise.reject(new Error("timeout")) : servir(z, x, y);
    const c = await composerCliche(12.13, 15.03, uneEnPanne);
    assert.equal(c?.tuiles.length, 8);
    assert.ok(!c?.tuiles.some((t) => t.col === 1 && t.lig === 1));
  });

  it("les sources en clair, sans doublon, dans l'ordre des tuiles ; une inconnue telle quelle", async () => {
    const lat = 12.13;
    const lon = 15.03;
    const viaDe = ["ESRI", "HIT:CLARITY", "HIT:ESRI", "XYZ", "CLARITY"];
    const servir: ServirTuile = async (z, x, y) => {
      const rang = planCliche(lat, lon, z).tuiles.findIndex((t) => t.x === x && t.y === y);
      if (rang >= viaDe.length) return new Response(SANS_IMAGERIE);
      return new Response(tuileJpeg(z, x, y), { headers: { "X-AfriControl-Tile": viaDe[rang]! } });
    };
    const c = await composerCliche(lat, lon, servir);
    assert.deepEqual(c?.sources, ["Esri World Imagery", "Esri Clarity", "XYZ"]);
    const sansEntete: ServirTuile = async (z, x, y) => new Response(tuileJpeg(z, x, y));
    assert.deepEqual((await composerCliche(lat, lon, sansEntete))?.sources, ["?"]);
  });
});
