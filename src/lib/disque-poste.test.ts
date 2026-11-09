import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  ajouterFichierPoste,
  choisirCopies,
  copieDe,
  defautsCopies,
  ecrireFichierPoste,
  lireFichierPoste,
  listeJson,
  placeDisques,
} from "./disque-poste.server.ts";

let dossier = "";
const cwd = process.cwd();
before(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "disque-poste-"));
  process.chdir(dossier);
});
after(() => {
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(path.join(dossier, "data"), { recursive: true, force: true });
  delete process.env.AFRICONTROL_COPIES;
});

const registre = () => path.join(dossier, "data", "drones.json");

/** Compte les fichiers forcés sur le disque (FileHandle.sync) pendant `faire`. */
async function forces(faire: () => Promise<void>): Promise<string[]> {
  const vus: string[] = [];
  const temoin = await fs.promises.open(process.execPath, "r");
  const poignee = Object.getPrototypeOf(temoin) as { sync(this: FileHandle): Promise<void> };
  await temoin.close();
  const vrai = poignee.sync;
  poignee.sync = async function () {
    vus.push(String((await this.stat()).isDirectory() ? "dossier" : "fichier"));
    return vrai.call(this);
  };
  try {
    await faire();
  } finally {
    poignee.sync = vrai;
  }
  return vus;
}

describe("disque du poste : rien d'écrit à moitié, tout doublé aussitôt", () => {
  it("DOSSIER DES COPIES : AFRICONTROL_COPIES (relatif au dossier du serveur), sinon data/copies", () => {
    // Le dossier du serveur est toujours absolu (process.cwd()) : C:\srv\poste sous Windows.
    const srv = path.resolve("/srv/poste");
    assert.equal(choisirCopies(undefined, srv), path.join(srv, "data", "copies"));
    assert.equal(choisirCopies("  ", srv), path.join(srv, "data", "copies"));
    assert.equal(choisirCopies("E:/copies", srv), path.resolve(srv, "E:/copies"));
    assert.equal(choisirCopies("../usb", srv), path.resolve("/srv/usb"));
    assert.equal(
      copieDe(registre()),
      path.join(dossier, "data", "copies", "fichiers", "data", "drones.json"),
    );
  });

  it("ÉCRITURE : forcée sur le disque (fichier et dossier), sans .part laissé, et doublée dans copies/fichiers", async () => {
    const vus = await forces(() => ecrireFichierPoste(registre(), "[1]"));
    assert.ok(
      vus.filter((v) => v === "fichier").length >= 2,
      `fichier et sa copie forcés : ${vus}`,
    );
    if (process.platform !== "win32") assert.ok(vus.includes("dossier"), "le renommage forcé");
    assert.equal(readFileSync(registre(), "utf8"), "[1]");
    assert.equal(readFileSync(copieDe(registre()), "utf8"), "[1]");
    assert.ok(!fs.existsSync(`${registre()}.part`));
    await ecrireFichierPoste(registre(), "[1,2]");
    assert.equal(readFileSync(copieDe(registre()), "utf8"), "[1,2]", "la copie suit");
  });

  it("COUPÉ EN PLEINE ÉCRITURE (disque plein, arrêt) : l'ancien contenu reste entier, et sa copie aussi", async () => {
    await ecrireFichierPoste(registre(), '[{"id":"ancien"}]');
    const temoin = await fs.promises.open(process.execPath, "r");
    const poignee = Object.getPrototypeOf(temoin) as {
      writeFile(this: FileHandle, d: string): Promise<void>;
    };
    await temoin.close();
    const vrai = poignee.writeFile;
    poignee.writeFile = async function (d: string) {
      await vrai.call(this, d.slice(0, 5)); // la moitié, puis plus de place
      throw Object.assign(new Error("ENOSPC: plus de place"), { code: "ENOSPC" });
    };
    try {
      await assert.rejects(ecrireFichierPoste(registre(), '[{"id":"nouveau"}]'), /ENOSPC/);
    } finally {
      poignee.writeFile = vrai;
    }
    assert.equal(readFileSync(registre(), "utf8"), '[{"id":"ancien"}]', "jamais à moitié");
    assert.equal(readFileSync(copieDe(registre()), "utf8"), '[{"id":"ancien"}]');
  });

  it("RELECTURE : abîmé ou absent, sa copie ; les deux illisibles, null — jamais une liste vide qui écraserait tout", async () => {
    await ecrireFichierPoste(registre(), '[{"id":"a"}]');
    writeFileSync(registre(), '[{"id":'); // coupure d'avant : écrit à moitié
    assert.deepEqual(await lireFichierPoste(registre(), listeJson), [{ id: "a" }], "la copie");
    rmSync(registre());
    assert.deepEqual(
      await lireFichierPoste(registre(), listeJson),
      [{ id: "a" }],
      "absent : la copie",
    );
    writeFileSync(copieDe(registre()), "{}");
    assert.equal(await lireFichierPoste(registre(), listeJson), null, "ni l'un ni l'autre");
    assert.throws(() => listeJson("{}"), /liste/);
  });

  it("COPIE EN DÉFAUT (clé retirée) : l'écriture du poste est faite, le défaut dit ; au retour, tout ce qui a manqué est recopié en entier — alors seulement le défaut s'efface", async () => {
    const autre = path.join(dossier, "data", "routes.json");
    const trafic = path.join(dossier, "data", "trafic", "jour.jsonl");
    const quoi = (q: string) => defautsCopies().find((x) => x.quoi === q);
    fs.mkdirSync(path.join(dossier, "data"), { recursive: true });
    await ajouterFichierPoste(trafic, "a\n", "copie du trafic reçu");
    rmSync(path.join(dossier, "data", "copies"), { recursive: true });
    writeFileSync(path.join(dossier, "data", "copies"), ""); // plus de dossier des copies
    await ecrireFichierPoste(registre(), "[3]");
    await ecrireFichierPoste(autre, "[7]");
    const jetable = path.join(dossier, "data", "jetable.json");
    await ecrireFichierPoste(jetable, "[0]");
    rmSync(jetable); // effacé depuis : plus rien à recopier, le défaut ne doit pas rester pour lui
    await ajouterFichierPoste(trafic, "b\n", "copie du trafic reçu");
    assert.equal(readFileSync(registre(), "utf8"), "[3]");
    assert.equal(readFileSync(trafic, "utf8"), "a\nb\n");
    assert.ok(quoi("copie des registres")?.raison, JSON.stringify(defautsCopies()));
    assert.ok(quoi("copie du trafic reçu")?.raison, JSON.stringify(defautsCopies()));
    rmSync(path.join(dossier, "data", "copies"));
    fs.mkdirSync(path.dirname(copieDe(trafic)), { recursive: true });
    writeFileSync(copieDe(trafic), "a\n"); // la copie d'avant la panne, restée sur la clé
    await ecrireFichierPoste(registre(), "[4]");
    assert.equal(quoi("copie des registres"), undefined, "remise en route");
    assert.equal(readFileSync(copieDe(registre()), "utf8"), "[4]");
    assert.equal(readFileSync(copieDe(autre), "utf8"), "[7]", "le registre manqué, recopié");
    await ajouterFichierPoste(trafic, "c\n", "copie du trafic reçu");
    assert.equal(quoi("copie du trafic reçu"), undefined);
    assert.equal(
      readFileSync(copieDe(trafic), "utf8"),
      "a\nb\nc\n",
      "la ligne manquée aussi, sans trou",
    );
  });

  it("ÉCRITURES SIMULTANÉES D'UN MÊME REGISTRE : l'une après l'autre, dans l'ordre des appels — jamais mêlées, le fichier finit sur la dernière", async () => {
    const valeurs = Array.from({ length: 30 }, (_, i) =>
      JSON.stringify(Array.from({ length: 30 - i }, () => i)),
    );
    await Promise.all(valeurs.map((v) => ecrireFichierPoste(registre(), v)));
    assert.equal(readFileSync(registre(), "utf8"), valeurs.at(-1));
    assert.equal(readFileSync(copieDe(registre()), "utf8"), valeurs.at(-1));
  });

  it("AJOUT : chaque ligne forcée sur le disque et doublée, dans l'ordre", async () => {
    const f = path.join(dossier, "data", "trafic", "jour.jsonl");
    const vus = await forces(async () => {
      for (const n of [1, 2, 3]) await ajouterFichierPoste(f, `${n}\n`, "copie du trafic reçu");
    });
    assert.ok(vus.length >= 6, `${vus.length} forçages pour 3 lignes et leurs copies`);
    assert.equal(readFileSync(f, "utf8"), "1\n2\n3\n");
    assert.equal(readFileSync(copieDe(f), "utf8"), "1\n2\n3\n");
  });

  it("DOSSIER DES COPIES AILLEURS (un autre disque) : AFRICONTROL_COPIES suivi", async () => {
    const ailleurs = path.join(dossier, "autre-disque");
    process.env.AFRICONTROL_COPIES = ailleurs;
    try {
      await ecrireFichierPoste(registre(), "[5]");
      assert.equal(
        readFileSync(path.join(ailleurs, "fichiers", "data", "drones.json"), "utf8"),
        "[5]",
      );
    } finally {
      delete process.env.AFRICONTROL_COPIES;
    }
  });
  it("PLACE LIBRE : celle du disque du poste et de celui des copies, le même disque reconnu ; copies injoignables, rien d'inventé", async () => {
    await ecrireFichierPoste(registre(), "[]");
    const p = await placeDisques();
    assert.ok(p.poste && p.poste.total > 0 && p.poste.libre > 0 && p.poste.libre <= p.poste.total);
    assert.ok(p.copies && p.copies.total > 0);
    assert.equal(p.memeDisque, true, "data/copies : sur le disque du poste");
    process.env.AFRICONTROL_COPIES = path.join(dossier, "cle-absente");
    const q = await placeDisques();
    assert.equal(q.copies, null);
    assert.equal(q.memeDisque, false);
  });
});
