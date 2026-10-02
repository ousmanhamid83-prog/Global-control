import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanFlames } from "./flame.ts";
import { parseEsriFirms } from "./firms.ts";
import { mineById, mineCamera } from "./mines.ts";
import { formatFireAge, lockFire, fireAgeMs } from "./fire-clock.ts";
import { treatContact } from "./treat.ts";
import { emptyFlags, planSteward, weeklyDue } from "./steward.ts";
import { collectSigintAlerts } from "./sigint-alerts.ts";

describe("photo réelle N'Djamena z17", () => {
  it("ne voit pas de feu voiture dans la mosaïque", () => {
    const rgba = readFileSync(new URL("./fixtures/ndjamena-z17.rgba", import.meta.url));
    const src = new Uint8ClampedArray(rgba);
    const scan = scanFlames(src, 256, 1.2);
    assert.equal(scan.feuVehicule, 0);
    assert.equal(scan.feuNaturel, 0);
  });
});

describe("mine à 1,2 m", () => {
  it("cadre Kouri Bana en visible ident", () => {
    const mine = mineById("kouri");
    assert.ok(mine);
    const cam = mineCamera(mine!);
    assert.equal(cam.mapScale, "ident");
    assert.equal(cam.satLayer, "vis");
    assert.equal(cam.viewOrigin.lat, mine!.lat);
    assert.equal(cam.viewOrigin.lon, mine!.lon);
  });
});

describe("détection feu à la seconde", () => {
  it("compte depuis la première seconde et ne repart pas de zéro", () => {
    const t0 = 1_700_000_000_000;
    assert.equal(lockFire("f-test", t0), t0);
    assert.equal(lockFire("f-test", t0 + 5000), t0);
    assert.equal(fireAgeMs("f-test", t0 + 1000), 1000);
    assert.equal(formatFireAge(1000), "1 s");
    assert.equal(formatFireAge(0), "0 s");
    assert.equal(formatFireAge(90_000), "1 min 30 s");
  });
});

describe("traitement 1090", () => {
  it("croise le squitter avec le METAR, le SIGMET et le GNSS", () => {
    const out = treatContact(
      {
        id: "live-abc",
        callsign: "TAR123",
        lat: 12.2,
        lon: 15.1,
        altM: 800,
        nic: 3,
        nacp: 4,
        squawk: "2314",
        icao24: "ABC123",
        mode: "ADS-B",
      },
      {
        metar: [
          {
            icao: "FTTJ",
            name: "N'Djamena",
            raw: "METAR FTTJ",
            tempC: 34,
            dewC: 20,
            windDir: 40,
            windKt: 8,
            visM: 8000,
            qnh: 1012,
            wx: null,
            cat: "VFR",
            lat: 12.13,
            lon: 15.03,
            obsAt: null,
          },
        ],
        sigmets: [
          {
            fir: "FTTT",
            firName: "N'Djamena",
            hazard: "TURB",
            qualifier: null,
            raw: "SIGMET",
            coords: [
              { lat: 12, lon: 15 },
              { lat: 13, lon: 15 },
              { lat: 13, lon: 16 },
              { lat: 12, lon: 16 },
            ],
            validFrom: null,
            validTo: null,
            inAo: true,
          },
        ],
        jam: [{ lat: 12, lon: 16, n: 4, bad: 1, pct: 25, level: "high" }],
      },
    );
    assert.equal(out.verdict, "GNSS bord dégradé");
    assert.match(out.xpdr, /ABC123/);
    assert.match(out.metar, /FTTJ/);
    assert.match(out.sigmet, /TURB/);
    assert.match(out.gnss, /NIC 3/);
  });
});

describe("intendant", () => {
  it("bascule l'IR si la photo dépasse 60 min, et n'arme l'hebdo qu'au créneau", () => {
    const mondayFive = Date.UTC(2026, 9, 5, 5, 10);
    assert.equal(new Date(mondayFive).getUTCDay(), 1);
    const flags = { ...emptyFlags(), photo: true, hebdo: true };
    const late = planSteward({
      now: mondayFive,
      visAt: new Date(mondayFive - 70 * 60 * 1000).toISOString(),
      satLayer: "vis",
      heldIr: false,
      firms: 2,
      firmsSilent: false,
      flags,
      weeklyDay: 1,
      weeklyHour: 5,
      lastWeeklyAt: 0,
    });
    assert.equal(late.some((a) => a.id === "vis-ir"), true);
    assert.equal(late.some((a) => a.id === "weekly"), true);
    assert.equal(
      weeklyDue({ now: mondayFive, weeklyDay: 1, weeklyHour: 6, lastWeeklyAt: 0 }),
      false,
    );
    const back = planSteward({
      now: mondayFive,
      visAt: new Date(mondayFive - 20 * 60 * 1000).toISOString(),
      satLayer: "ir",
      heldIr: true,
      firms: 1,
      firmsSilent: false,
      flags: { ...emptyFlags(), photo: true },
      weeklyDay: 1,
      weeklyHour: 5,
      lastWeeklyAt: mondayFive,
    });
    assert.equal(back.some((a) => a.id === "ir-vis"), true);
    assert.equal(back.some((a) => a.id === "weekly"), false);
  });
});

describe("alertes SIGINT", () => {
  it("ouvre un verrou une seule fois et ignore le reste", () => {
    const warned = new Set<string>();
    const base = {
      id: "t1",
      callsign: "T01",
      lat: 12.1,
      lon: 15.0,
      threat: "elevee" as const,
      now: 1_700_000_000_000,
      warned,
    };
    const first = collectSigintAlerts({
      ...base,
      streams: [
        { id: "aco", label: "Acoustique BPF", state: "lock", detail: "lock" },
        { id: "ew", label: "Brouillage", state: "denied", detail: "n'émet pas" },
        { id: "c2", label: "Source", state: "scan", detail: "en cours" },
      ],
    });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.domain, "sigint");
    assert.equal(first[0]?.level, "moderee");
    const again = collectSigintAlerts({
      ...base,
      streams: [{ id: "aco", label: "Acoustique BPF", state: "lock", detail: "lock" }],
    });
    assert.equal(again.length, 0);
  });
});

describe("VIIRS Esri", () => {
  it("garde le point chaud réel du théâtre et jette la confiance basse", () => {
    const rows = parseEsriFirms({
      features: [
        {
          attributes: {
            latitude: 12.90047,
            longitude: 13.88522,
            confidence: "high",
            frp: 73.65,
            satellite: "N21",
            hours_old: 2,
            bright_ti4: 367,
            daynight: "D",
          },
        },
        {
          attributes: {
            latitude: 10,
            longitude: 20,
            confidence: "low",
            frp: 4,
            satellite: "N21",
            hours_old: 1,
            bright_ti4: 300,
            daynight: "D",
          },
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source, "NASA FIRMS");
    assert.equal(rows[0]?.kind, "feu");
    assert.match(rows[0]?.body ?? "", /375 m/);
    assert.ok(Math.abs((rows[0]?.lat ?? 0) - 12.90047) < 0.02);
  });
});
