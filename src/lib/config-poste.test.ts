import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chargerConfigPoste } from "./config-poste.ts";

function fichier(contenu: string): string {
  const chemin = join(mkdtempSync(join(tmpdir(), "poste-")), "poste.env");
  writeFileSync(chemin, contenu);
  return chemin;
}

describe("poste.env : les réglages du poste chargés au démarrage", () => {
  it("LIT les réglages AFRICONTROL_*, guillemets ôtés, commentaires et lignes vides ignorés", () => {
    const env: Record<string, string | undefined> = {};
    const lues = chargerConfigPoste(
      fichier(
        "# écrit par preparer-poste\n\nAFRICONTROL_IA=http://127.0.0.1:11434/v1\r\n" +
          'AFRICONTROL_IA_MODELE = "qwen2.5:7b"\n' +
          "AFRICONTROL_ITINERAIRE='http://127.0.0.1:5810'\n",
      ),
      env,
    );
    assert.deepEqual(lues, ["AFRICONTROL_IA", "AFRICONTROL_IA_MODELE", "AFRICONTROL_ITINERAIRE"]);
    assert.deepEqual(env, {
      AFRICONTROL_IA: "http://127.0.0.1:11434/v1",
      AFRICONTROL_IA_MODELE: "qwen2.5:7b",
      AFRICONTROL_ITINERAIRE: "http://127.0.0.1:5810",
    });
  });

  it("LE LANCEMENT GARDE LA MAIN : une variable déjà posée n'est pas écrasée", () => {
    const env: Record<string, string | undefined> = { AFRICONTROL_IA: "http://10.0.0.9:11434/v1" };
    const lues = chargerConfigPoste(fichier("AFRICONTROL_IA=http://127.0.0.1:11434/v1\n"), env);
    assert.deepEqual(lues, []);
    assert.equal(env.AFRICONTROL_IA, "http://10.0.0.9:11434/v1");
  });

  it("RÈGLE LE POSTE, PAS NODE NI LE RÉSEAU : toute autre clé est ignorée", () => {
    const env: Record<string, string | undefined> = {};
    const lues = chargerConfigPoste(
      fichier(
        "NODE_OPTIONS=--require ./x.js\nHTTPS_PROXY=http://evil:8080\nPORT=9\nAFRICONTROL_1090=off\n",
      ),
      env,
    );
    assert.deepEqual(lues, ["AFRICONTROL_1090"]);
    assert.deepEqual(env, { AFRICONTROL_1090: "off" });
  });

  it("PAS DE FICHIER : rien n'est chargé, rien ne casse", () => {
    const env: Record<string, string | undefined> = {};
    assert.deepEqual(chargerConfigPoste(join(tmpdir(), "absent-poste.env"), env), []);
    assert.deepEqual(env, {});
  });
});
