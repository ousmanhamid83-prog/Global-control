import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { haversineKm, headingBetween } from "./geo.ts";

const RAD = Math.PI / 180;

/**
 * L'oracle : le même azimut par une autre voie — des vecteurs. Le point visé est projeté sur le plan
 * tangent au départ, puis lu sur ses axes est et nord. Aucune formule partagée avec geo.ts.
 */
function azimutVectoriel(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const unitaire = (la: number, lo: number) => [
    Math.cos(la * RAD) * Math.cos(lo * RAD),
    Math.cos(la * RAD) * Math.sin(lo * RAD),
    Math.sin(la * RAD),
  ];
  const p = unitaire(lat1, lon1);
  const q = unitaire(lat2, lon2);
  const pq = p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  const t = [q[0]! - pq * p[0]!, q[1]! - pq * p[1]!, q[2]! - pq * p[2]!];
  const est = [-Math.sin(lon1 * RAD), Math.cos(lon1 * RAD), 0];
  const nord = [
    -Math.sin(lat1 * RAD) * Math.cos(lon1 * RAD),
    -Math.sin(lat1 * RAD) * Math.sin(lon1 * RAD),
    Math.cos(lat1 * RAD),
  ];
  const e = t[0]! * est[0]! + t[1]! * est[1]!;
  const n = t[0]! * nord[0]! + t[1]! * nord[1]! + t[2]! * nord[2]!;
  return (((Math.atan2(e, n) / RAD) % 360) + 360) % 360;
}

/** Tirages reproductibles. */
function tirages(graine: number) {
  let s = graine >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("relèvement : l'azimut initial du grand cercle, comme un écran radar", () => {
  it("500 paires de points tirés sur la Terre : l'azimut vectoriel au millionième de degré", () => {
    const hasard = tirages(80);
    for (let i = 0; i < 500; i++) {
      const lat1 = hasard() * 160 - 80;
      const lon1 = hasard() * 360 - 180;
      const lat2 = hasard() * 160 - 80;
      const lon2 = hasard() * 360 - 180;
      const a = headingBetween(lat1, lon1, lat2, lon2);
      const b = azimutVectoriel(lat1, lon1, lat2, lon2);
      const ecart = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
      assert.ok(ecart < 1e-6, `${lat1}, ${lon1} → ${lat2}, ${lon2} : ${a} ≠ ${b}`);
      assert.ok(a >= 0 && a < 360);
    }
  });

  it("les cas qui se vérifient de tête : les quatre directions, l'équateur, le méridien", () => {
    assert.equal(headingBetween(0, 0, 10, 0), 0);
    assert.equal(headingBetween(0, 0, 0, 90), 90);
    assert.equal(headingBetween(10, 0, 0, 0), 180);
    assert.equal(headingBetween(0, 0, 0, -90), 270);
    // Le point plein est, à 45° N et 90° de longitude : le grand cercle part vers le nord-est, à
    // atan(1 / sin 45°) = atan(√2) ≈ 54,74° — pas plein est.
    assert.ok(Math.abs(headingBetween(45, 0, 45, 90) - Math.atan(Math.SQRT2) / RAD) < 1e-9);
  });

  it("les vrais avions de l'essai : N'Djamena → Maroc, Dakar → Tunisie, à des milliers de km", () => {
    // Positions relevées sur le serveur construit ; l'ancien calcul à plat donnait 309° et 55°.
    assert.ok(Math.abs(headingBetween(12.1331, 15.0339, 31.00231, -8.86126) - 314.3) < 0.05);
    assert.ok(Math.abs(headingBetween(14.69, -17.44, 34.42608, 11.29954) - 47.5) < 0.05);
    assert.ok(Math.abs(haversineKm(12.1331, 15.0339, 31.00231, -8.86126) - 3227.1) < 0.05);
  });

  it("de près, rien ne change : un drone à 2 km, l'azimut d'avant au centième", () => {
    const aPlat = (la1: number, lo1: number, la2: number, lo2: number) => {
      const dx = (lo2 - lo1) * 111.32 * Math.cos(la1 * RAD);
      const dy = (la2 - la1) * 110.574;
      return (((Math.atan2(dx, dy) / RAD) % 360) + 360) % 360;
    };
    const a = headingBetween(12.1331, 15.0339, 12.145, 15.05);
    assert.ok(Math.abs(a - aPlat(12.1331, 15.0339, 12.145, 15.05)) < 0.2, String(a));
  });
});
