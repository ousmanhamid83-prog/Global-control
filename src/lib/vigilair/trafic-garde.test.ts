import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { copieDe, defautsCopies } from "../disque-poste.server.ts";
import { jourPoste } from "./format.ts";
import type { LiveAc } from "./live-adsb";
import { currentPosteTape, fichierTrafic, recordFrame, traficGarde } from "./rejeu.server.ts";

let dossier = "";
const cwd = process.cwd();
before(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "trafic-garde-"));
  process.chdir(dossier);
});
after(() => {
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});

const avion = (hex: string, seenS = 1): LiveAc =>
  ({
    hex,
    flight: `AFR${hex.slice(0, 3)}`,
    flightTx: true,
    messages: 12,
    lat: 12.1331,
    lon: 15.0339,
    altM: 10_000,
    gsKmh: 820,
    track: 45,
    climbMs: 0,
    squawk: "1000",
    icaoType: "A320",
    reg: null,
    rssi: null,
    emergency: null,
    seenS,
    onGround: false,
    category: "A3",
    nic: 8,
    nacp: 9,
    sil: 3,
    military: false,
  }) as LiveAc;

const lignes = (f: string) =>
  readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { at: number; rows: unknown[][]; ac: Record<string, unknown[]> });

describe("trafic reçu : chaque image gardée sans limite, aussitôt, et doublée", () => {
  it("UNE LIGNE PAR IMAGE (15 s au plus) dans le fichier du jour du poste, et la même dans sa copie", async () => {
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    recordFrame(t0, [avion("3c6dd2"), avion("ffffff", 300)]);
    recordFrame(t0 + 5_000, [avion("3c6dd2")]); // trop tôt : la même image
    recordFrame(t0 + 15_000, [avion("3c6dd2"), avion("4ca7b1")]);
    await traficGarde();
    const f = fichierTrafic(t0);
    assert.equal(f, path.join(dossier, "data", "trafic", `1090ES-${jourPoste(t0)}.jsonl`));
    const l = lignes(f);
    assert.deepEqual(
      l.map((x) => x.at),
      [t0, t0 + 15_000],
    );
    assert.deepEqual(
      l[0]!.rows.map((r) => r[0]),
      ["3c6dd2"],
      "une position trop vieille n'est pas reçue",
    );
    assert.deepEqual(
      Object.keys(l[1]!.ac).sort(),
      ["3c6dd2", "4ca7b1"],
      "chaque ligne se lit seule",
    );
    assert.equal(l[1]!.ac["4ca7b1"]![0], "AFR4ca");
    assert.equal(readFileSync(copieDe(f), "utf8"), readFileSync(f, "utf8"), "doublée");
  });

  it("UN NOUVEAU JOUR DU POSTE (minuit à N'Djamena) : un nouveau fichier", async () => {
    const veille = Date.UTC(2026, 10, 9, 22, 59, 50); // 23:59:50 à N'Djamena
    recordFrame(veille, [avion("3c6dd2")]);
    recordFrame(veille + 20_000, [avion("3c6dd2")]);
    await traficGarde();
    assert.notEqual(fichierTrafic(veille), fichierTrafic(veille + 20_000));
    assert.ok(lignes(fichierTrafic(veille + 20_000)).some((x) => x.at === veille + 20_000));
  });

  it("DISQUE DU POSTE EN DÉFAUT (data/trafic impossible à créer) : le défaut est dit, l'image reste pour le rejeu ; effacé quand l'écriture remarche", async () => {
    const quoi = "enregistrement du trafic reçu";
    rmSync(path.join(dossier, "data", "trafic"), { recursive: true, force: true });
    writeFileSync(path.join(dossier, "data", "trafic"), ""); // un fichier à la place du dossier
    const t = Date.UTC(2026, 10, 10, 10, 0, 0);
    recordFrame(t, [avion("3c6dd2")]);
    await traficGarde();
    const d = defautsCopies().find((x) => x.quoi === quoi);
    assert.ok(d && d.raison.length > 0, JSON.stringify(defautsCopies()));
    assert.ok(
      currentPosteTape().frames.some((f) => f.at === t),
      "gardée en mémoire pour le rejeu",
    );
    rmSync(path.join(dossier, "data", "trafic"));
    recordFrame(t + 15_000, [avion("3c6dd2")]);
    await traficGarde();
    assert.equal(
      defautsCopies().find((x) => x.quoi === quoi),
      undefined,
      "effacé",
    );
    assert.ok(lignes(fichierTrafic(t + 15_000)).some((x) => x.at === t + 15_000));
  });
});
