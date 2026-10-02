import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFlamePixel, scanFlames } from "./flame.ts";
import { parseFirms } from "./firms.ts";

function tile(
  S: number,
  base: [number, number, number],
  blobs: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[] = [],
) {
  const src = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    src[i * 4] = base[0];
    src[i * 4 + 1] = base[1];
    src[i * 4 + 2] = base[2];
    src[i * 4 + 3] = 255;
  }
  for (const b of blobs) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const o = (y * S + x) * 4;
        src[o] = b.rgb[0];
        src[o + 1] = b.rgb[1];
        src[o + 2] = b.rgb[2];
      }
    }
  }
  return scanFlames(src, S, 1.2);
}

const laterite: [number, number, number] = [176, 98, 62];
const flame: [number, number, number] = [245, 150, 40];

describe("feu à 1,2 m", () => {
  it("ne prend pas la latérite, un toit rouge, ni un engin jaune", () => {
    assert.equal(isFlamePixel(176, 98, 62), false);
    assert.equal(isFlamePixel(210, 90, 50), false);
    assert.equal(isFlamePixel(235, 200, 40), false);
    assert.equal(isFlamePixel(245, 150, 40), true);
    const soil = tile(64, laterite);
    const roof = tile(64, laterite, [{ x: 8, y: 8, w: 10, h: 6, rgb: [210, 90, 50] }]);
    const truck = tile(64, laterite, [{ x: 8, y: 20, w: 8, h: 4, rgb: [235, 200, 40] }]);
    assert.equal(soil.feuVehicule + soil.feuNaturel, 0);
    assert.equal(roof.feuVehicule + roof.feuNaturel, 0);
    assert.equal(truck.feuVehicule + truck.feuNaturel, 0);
  });

  it("classe une flamme de gabarit voiture et un front naturel", () => {
    const car = tile(64, laterite, [{ x: 12, y: 12, w: 4, h: 3, rgb: flame }]);
    assert.equal(car.feuVehicule, 1);
    assert.equal(car.feuNaturel, 0);
    assert.equal(car.blobs[0]?.kind, "vehicule");
    const front = tile(64, laterite, [{ x: 8, y: 30, w: 20, h: 6, rgb: flame }]);
    assert.equal(front.feuNaturel, 1);
    assert.equal(front.feuVehicule, 0);
    assert.equal(front.blobs[0]?.kind, "naturel");
  });
});

describe("parseFirms", () => {
  it("garde le point chaud du Tchad, jette la confiance basse, et fusionne le voisin", () => {
    const csv = [
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
      "12.40,15.10,330,0.4,0.4,2026-10-01,1430,N,VIIRS,h,2.0,290,18.2,D",
      "12.42,15.11,340,0.4,0.4,2026-10-01,1432,N,VIIRS,n,2.0,295,40.0,D",
      "14.00,1.00,300,0.4,0.4,2026-10-01,1430,N,VIIRS,l,2.0,280,2.0,D",
      "48.80,2.30,320,0.4,0.4,2026-10-01,1500,N,VIIRS,n,2.0,300,9.0,D",
    ].join("\n");
    const rows = parseFirms(csv, "VIIRS SNPP");
    assert.equal(rows.length, 2);
    const chad = rows.find((r) => r.theater === "tchad");
    assert.ok(chad);
    assert.equal(chad?.kind, "feu");
    assert.match(chad?.body ?? "", /375 m/);
    assert.match(chad?.body ?? "", /pas un feu de voiture/);
    assert.equal(chad?.source, "NASA FIRMS");
    assert.ok(rows.some((r) => r.theater === "monde"));
    assert.equal(rows.some((r) => Math.abs(r.lat - 14) < 0.01), false);
  });
});
