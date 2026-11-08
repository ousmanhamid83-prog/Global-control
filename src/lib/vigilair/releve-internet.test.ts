import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  basculerReleve,
  lireReleve,
  noterOrdre,
  releveInternetActif,
} from "./releve-internet.server.ts";

const g = globalThis as { __afriReleveInternet?: unknown };
let dossier = "";
const cwd = process.cwd();

before(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "releve-internet-"));
  process.chdir(dossier);
});
after(() => {
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => {
  // Un serveur qui redémarre : l'état est relu du disque.
  delete g.__afriReleveInternet;
  rmSync(path.join(dossier, "data"), { recursive: true, force: true });
});

const ecrire = (contenu: string) => {
  mkdirSync(path.join(dossier, "data"), { recursive: true });
  writeFileSync(path.join(dossier, "data", "releve-internet.json"), contenu);
};

describe("relevé Internet sur décision du chef", () => {
  it("LIVRÉ COUPÉ : sans fichier, rien ne sort du poste tant que le chef ne l'active pas", async () => {
    assert.equal(await releveInternetActif(), false);
    assert.deepEqual(await lireReleve(), { actif: false, enregistrement: "fichier", ordreA: null });
  });

  it("ACTIVÉ PAR LE CHEF : enregistré, et toujours activé après un redémarrage ; coupé de même", async () => {
    assert.equal((await basculerReleve(true)).actif, true);
    assert.deepEqual(JSON.parse(readFileSync("data/releve-internet.json", "utf8")), { actif: true });
    delete g.__afriReleveInternet;
    assert.equal(await releveInternetActif(), true, "relu du disque");
    await basculerReleve(false);
    delete g.__afriReleveInternet;
    assert.equal(await releveInternetActif(), false);
  });

  it("FICHIER ABÎMÉ : seul un « true » écrit active — un fichier abîmé n'ouvre rien en silence", async () => {
    for (const contenu of ["{pas du JSON", '{"actif":"oui"}', '{"actif":1}', "{}", "null"]) {
      delete g.__afriReleveInternet;
      ecrire(contenu);
      assert.equal(await releveInternetActif(), false, contenu);
    }
    delete g.__afriReleveInternet;
    ecrire('{"actif":true}');
    assert.equal(await releveInternetActif(), true);
  });

  it("DISQUE EN LECTURE SEULE : la bascule vaut jusqu'au redémarrage, et le dit", async () => {
    // « data » est un fichier : impossible d'y créer releve-internet.json.
    writeFileSync(path.join(dossier, "data"), "");
    const e = await basculerReleve(true);
    assert.deepEqual(e, { actif: true, enregistrement: "memoire", ordreA: null });
    assert.equal(await releveInternetActif(), true);
  });

  it("ORDRE DU CHEF : l'heure du dernier relevé fait à son ordre est gardée", async () => {
    await noterOrdre(1_794_140_000_000);
    assert.equal((await lireReleve()).ordreA, 1_794_140_000_000);
  });
});
