import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { copieDe, defautsCopies } from "../disque-poste.server.ts";
import { jourPoste } from "./format.ts";
import type { LivePicture } from "./live-adsb";
import { fichierReleve, garderReleve } from "./releve-garde.server.ts";

let dossier = "";
const cwd = process.cwd();
before(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "releve-garde-"));
  process.chdir(dossier);
});
after(() => {
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 9, 10, 0, 0);

/** Un relevé : la météo `metar` de FTTJ, l'heure GPS `seconde` (recalculée à chaque relevé) ;
 * `inverse` : les mêmes listes, reçues dans l'autre ordre. */
const releve = (at: number, metar: string, seconde = 0, inverse = false): LivePicture => {
  const ordre = <T>(l: T[]) => (inverse ? [...l].reverse() : l);
  return {
    at,
    source: "essai",
    aircraft: [],
    localN: 0,
    sahelN: 0,
    emergencies: [],
    metar: ordre([
      { icao: "FTTJ", name: "FTTJ", raw: metar, obsAt: "2026-11-09T10:00:00Z" },
      {
        icao: "FTTA",
        name: "FTTA",
        raw: "METAR FTTA 091000Z 04006KT CAVOK 33/06 Q1010",
        obsAt: null,
      },
    ]),
    taf: [],
    space: {
      kp: 2,
      kpTime: "2026-11-09T09:00:00Z",
      gScale: "G0",
      note: "",
      gpsWeek: 2392,
      gpsTowS: seconde,
      xrayClass: "B",
      xrayFlux: null,
      xrayAt: null,
    },
    sigmets: [],
    jam: [],
    airport: null,
    alerts: [],
    solar: {
      sunrise: "05:50",
      sunset: "17:20",
      civilBegin: "",
      civilEnd: "",
      dayLengthMin: 690,
      nightOps: false,
    },
    sources: [],
    errors: [],
    phenomena: ordre([
      {
        id: "sig-FTTT-TS-121-150",
        kind: "sigmet",
        title: "SIGMET",
        body: "",
        lat: 12.1,
        lon: 15,
        at,
        theater: "sahel",
        level: "moderee",
        source: "SIGMET OACI",
      },
      {
        id: "gdacs-TC-1001346",
        kind: "cyclone",
        title: "Tropical Cyclone",
        body: "",
        lat: 15.8,
        lon: 80.2,
        at,
        theater: "monde",
        level: "critique",
        source: "GDACS",
      },
      {
        id: "gdacs-TC-1001345",
        kind: "cyclone",
        title: "Tropical Cyclone",
        body: "",
        lat: 16.4,
        lon: 81.8,
        at,
        theater: "monde",
        level: "critique",
        source: "GDACS",
      },
    ]),
  } as unknown as LivePicture;
};

const lignes = (f: string) =>
  readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .map(
      (l) =>
        JSON.parse(l) as {
          at: number;
          metar: { raw: string }[];
          space: Record<string, unknown>;
          phenomenes: unknown[];
        },
    );

describe("relevé Internet reçu : gardé sans limite quand il change, et doublé", () => {
  it("CE QUI N'A PAS CHANGÉ N'EST PAS RÉÉCRIT — ni l'ordre des listes, ni l'heure GPS, ni l'heure redonnée aux phénomènes ; un METAR nouveau : une ligne de sa seule rubrique ; doublé", async () => {
    await garderReleve(releve(T0, "METAR FTTJ 091000Z 05008KT CAVOK 31/08 Q1011", 10));
    await garderReleve(
      releve(T0 + 20_000, "METAR FTTJ 091000Z 05008KT CAVOK 31/08 Q1011", 30, true),
    );
    await garderReleve(releve(T0 + 40_000, "METAR FTTJ 091030Z 06010KT CAVOK 32/07 Q1010", 50));
    const f = fichierReleve(T0);
    assert.equal(f, path.join(dossier, "data", "releve", `releve-${jourPoste(T0)}.jsonl`));
    const l = lignes(f);
    assert.deepEqual(
      l.map((x) => x.at),
      [T0, T0 + 40_000],
    );
    assert.deepEqual(Object.keys(l[1]!).sort(), ["at", "metar"], "seule la rubrique changée");
    assert.equal(l[1]!.metar[1]!.raw, "METAR FTTJ 091030Z 06010KT CAVOK 32/07 Q1010");
    assert.equal("gpsTowS" in l[0]!.space, false, "l'heure GPS n'est pas une donnée reçue");
    assert.deepEqual(
      l[0]!.phenomenes.map((x) => (x as { id: string }).id),
      ["gdacs-TC-1001345", "gdacs-TC-1001346"],
      "les SIGMET redits en phénomènes : gardés tels que reçus, pas deux fois",
    );
    assert.equal(readFileSync(copieDe(f), "utf8"), readFileSync(f, "utf8"), "doublé");
  });

  it("DISQUE DU POSTE EN DÉFAUT (data/releve impossible) : le défaut est dit ; effacé quand l'écriture remarche", async () => {
    const quoi = "enregistrement du relevé Internet";
    rmSync(path.join(dossier, "data", "releve"), { recursive: true, force: true });
    writeFileSync(path.join(dossier, "data", "releve"), "");
    await garderReleve(releve(T0 + 60_000, "METAR FTTJ 091100Z 07012KT 9999 FEW040 33/07 Q1009"));
    assert.ok(
      defautsCopies().find((x) => x.quoi === quoi)?.raison,
      JSON.stringify(defautsCopies()),
    );
    rmSync(path.join(dossier, "data", "releve"));
    await garderReleve(releve(T0 + 80_000, "METAR FTTJ 091130Z 07012KT 9999 FEW040 33/07 Q1009"));
    assert.equal(
      defautsCopies().find((x) => x.quoi === quoi),
      undefined,
    );
    assert.equal(lignes(fichierReleve(T0)).at(-1)!.at, T0 + 80_000);
  });
});
