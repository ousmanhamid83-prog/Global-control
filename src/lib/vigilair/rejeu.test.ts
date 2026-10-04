import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { indexTape, rejeuClock, tapeAt, tapeUsable, type RejeuTape, type TapeRow } from "./rejeu.ts";

const T0 = Date.UTC(2026, 9, 4, 17, 53, 25);

function row(hex: string, lat: number, lon: number, lag = 0, over: Partial<Record<number, unknown>> = {}): TapeRow {
  const r: TapeRow = [hex, lat, lon, 11000, 840, 90, 0, "1234", null, 8, 9, 0, lag];
  for (const [k, v] of Object.entries(over)) (r as unknown[])[Number(k)] = v;
  return r;
}

function tape(frames: RejeuTape["frames"]): RejeuTape {
  return {
    kind: "archive",
    source: "test",
    from: frames[0]!.at,
    to: frames.at(-1)!.at,
    ac: { "06a1b2": ["QTR1404", "B788", "A7-BCA", "A5", 0], "0100e1": ["MSR777", "A320", "SU-GCA", "A3", 0] },
    frames,
  };
}

describe("rejeu réel", () => {
  const tp = tape([
    { at: T0, rows: [row("06a1b2", 30, 31)] },
    { at: T0 + 30_000, rows: [row("06a1b2", 30, 31.1), row("0100e1", 25, 32, 0, { 8: "7700" })] },
  ]);

  it("à mi-chemin entre deux relevés réels : position interpolée, rien d'inventé ailleurs", () => {
    const pts = tapeAt(tp, T0 + 15_000);
    assert.equal(pts.length, 1, "l'avion du second relevé n'existe pas encore");
    const p = pts[0]!;
    assert.equal(p.ac.hex, "06a1b2");
    assert.equal(p.ac.flight, "QTR1404");
    assert.equal(p.ac.icaoType, "B788");
    assert.ok(Math.abs(p.ac.lon - 31.05) < 1e-9);
    assert.equal(p.ac.via, "reseau");
  });

  it("le retard d'une position en cache la replace à sa vraie heure", () => {
    // Relevé vu à T0+30 s mais vieux de 10 s : la position date de T0+20 s.
    const lagged = tape([
      { at: T0, rows: [row("06a1b2", 30, 31)] },
      { at: T0 + 30_000, rows: [row("06a1b2", 30, 31.2, 10)] },
    ]);
    const p = tapeAt(lagged, T0 + 10_000)[0]!;
    assert.ok(Math.abs(p.ac.lon - 31.1) < 1e-9);
  });

  it("après son dernier relevé, l'avion file 45 s au plus puis disparaît", () => {
    const idx = indexTape(tp);
    const coasting = tapeAt(tp, T0 + 60_000, idx).find((p) => p.ac.hex === "06a1b2");
    assert.ok(coasting, "encore là 30 s après");
    assert.ok(coasting!.ac.lon > 31.1, "il a avancé vers l'est (cap 090)");
    assert.equal(tapeAt(tp, T0 + 80_000, idx).find((p) => p.ac.hex === "06a1b2"), undefined);
  });

  it("l'urgence enregistrée est rejouée telle quelle", () => {
    const p = tapeAt(tp, T0 + 31_000).find((x) => x.ac.hex === "0100e1");
    assert.equal(p?.ac.emergency, "7700");
  });

  it("un même relevé revu deux fois (cache réseau) ne coupe pas la piste", () => {
    const dup = tape([
      { at: T0, rows: [row("06a1b2", 30, 31)] },
      { at: T0 + 30_000, rows: [row("06a1b2", 30, 31, 30)] },
      { at: T0 + 60_000, rows: [row("06a1b2", 30, 31.2)] },
    ]);
    const p = tapeAt(dup, T0 + 50_000)[0];
    assert.ok(p, "toujours suivie entre les deux vrais relevés");
    assert.ok(p!.ac.lon > 31.15 && p!.ac.lon < 31.2);
  });

  it("une bande de moins de 3 minutes ne vaut pas rejeu", () => {
    assert.equal(tapeUsable(tp), false);
    const long = tape(Array.from({ length: 8 }, (_, i) => ({ at: T0 + i * 30_000, rows: [row("06a1b2", 30, 31 + i * 0.1)] })));
    assert.equal(tapeUsable(long), true);
  });

  it("heure d'origine lisible en Z", () => {
    assert.equal(rejeuClock(T0), "04/10 17:53:25 Z");
  });
});
