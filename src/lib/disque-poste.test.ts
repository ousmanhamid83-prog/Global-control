import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { after, before, beforeEach, describe, it } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  ajouterFichierPoste,
  alignerCopies,
  choisirCopies,
  compresserArbre,
  compresserFichiers,
  compresserJournaliers,
  copieDe,
  defautsCopies,
  ecrireFichierPoste,
  lireFichierPoste,
  listeJson,
  placeDisques,
  restaurerArbre,
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

describe("disque du poste : la place regagnée, sans jamais rien risquer", () => {
  const arch = () => path.join(dossier, "data", "archives");
  const remplir = () => {
    fs.mkdirSync(path.join(arch(), "sous"), { recursive: true });
    writeFileSync(path.join(arch(), "a.txt"), "ligne du journal\n".repeat(20_000));
    writeFileSync(
      path.join(arch(), "b.bin"),
      Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)),
    );
    writeFileSync(path.join(arch(), "sous", "c.txt"), "relevé\n".repeat(5000));
    writeFileSync(path.join(arch(), "garde.txt"), "lisible");
  };
  const lu = (f: string) => readFileSync(f);

  it("COMPRESSÉ, RELU, ALORS SEULEMENT L'ORIGINAL EFFACÉ — restauré à l'identique ; déjà fait, rien à refaire", async () => {
    remplir();
    const avant = {
      a: lu(path.join(arch(), "a.txt")),
      b: lu(path.join(arch(), "b.bin")),
      c: lu(path.join(arch(), "sous", "c.txt")),
    };
    const gagne = await compresserArbre(arch(), (n) => n === "garde.txt");
    assert.ok(gagne > 300_000, `${gagne} octets gagnés`);
    assert.ok(
      !fs.existsSync(path.join(arch(), "a.txt")) && fs.existsSync(path.join(arch(), "a.txt.gz")),
    );
    assert.ok(fs.existsSync(path.join(arch(), "sous", "c.txt.gz")));
    assert.equal(readFileSync(path.join(arch(), "garde.txt"), "utf8"), "lisible", "gardé tel quel");
    assert.equal(await compresserArbre(arch(), (n) => n === "garde.txt"), 0, "rien à refaire");
    const rendu = path.join(dossier, "data", "rendu");
    await restaurerArbre(arch(), rendu);
    assert.ok(lu(path.join(rendu, "a.txt")).equals(avant.a));
    assert.ok(lu(path.join(rendu, "b.bin")).equals(avant.b));
    assert.ok(lu(path.join(rendu, "sous", "c.txt")).equals(avant.c));
    assert.equal(readFileSync(path.join(rendu, "garde.txt"), "utf8"), "lisible");
  });

  it("UN COMPRESSÉ ABÎMÉ EN ÉCRITURE (disque défaillant) — un octet faux, ou un compressé valide d'autre chose : relu différent, jeté ; l'original reste", async () => {
    // Le disque écrit un octet faux dans le compressé, ou un bloc d'autre chose, valide.
    const vrai = fs.createWriteStream;
    for (const panne of ["octet faux", "autre contenu"]) {
      remplir();
      const original = lu(path.join(arch(), "a.txt"));
      fs.createWriteStream = ((p: fs.PathLike, o?: unknown) => {
        const flux = vrai(p, o as never);
        if (!String(p).endsWith(".gz.part")) return flux;
        let fait = false;
        return new Writable({
          write(morceau: Buffer, _e, suite) {
            const b = Buffer.from(morceau);
            if (panne === "autre contenu") return suite();
            if (!fait && b.length > 40) {
              b[40]! ^= 0xff;
              fait = true;
            }
            flux.write(b, suite);
          },
          final(suite) {
            if (panne === "autre contenu") flux.write(gzipSync("un vieux bloc relu par le disque"));
            flux.end(suite);
          },
        });
      }) as unknown as typeof vrai;
      syncBuiltinESMExports();
      try {
        await assert.rejects(compresserFichiers(arch(), ["a.txt"]), Error, panne);
      } finally {
        fs.createWriteStream = vrai;
        syncBuiltinESMExports();
      }
      assert.ok(lu(path.join(arch(), "a.txt")).equals(original), `${panne} : l'original intact`);
      assert.ok(
        !fs.existsSync(path.join(arch(), "a.txt.gz")) &&
          !fs.existsSync(path.join(arch(), "a.txt.gz.part")),
        panne,
      );
    }
  });

  it("COUPÉ ENTRE LE RENOMMAGE ET L'EFFACEMENT (les deux sont là) : l'original prime à la relecture ; la compression se refait", async () => {
    remplir();
    writeFileSync(path.join(arch(), "a.txt.gz"), gzipSync("une autre version"));
    writeFileSync(path.join(arch(), "b.bin.gz.part"), "compressé inachevé");
    const rendu = path.join(dossier, "data", "rendu");
    await restaurerArbre(arch(), rendu);
    assert.ok(
      lu(path.join(rendu, "a.txt")).equals(lu(path.join(arch(), "a.txt"))),
      "l'original prime",
    );
    assert.ok(!fs.existsSync(path.join(rendu, "b.bin.gz.part")));
    const original = lu(path.join(arch(), "a.txt"));
    await compresserFichiers(arch(), ["a.txt"]);
    assert.ok(
      gunzipSync(lu(path.join(arch(), "a.txt.gz"))).equals(original),
      "le compressé refait",
    );
  });

  it("JOURNALIERS : ceux d'avant hier et plus vieux compressés, au poste comme dans les copies ; hier et aujourd'hui laissés", async () => {
    const trafic = path.join(dossier, "data", "trafic");
    for (const jour of ["2026-11-05", "2026-11-07", "2026-11-08", "2026-11-09"]) {
      await ajouterFichierPoste(
        path.join(trafic, `1090ES-${jour}.jsonl`),
        `{"jour":"${jour}"}\n`,
        "copie du trafic reçu",
      );
    }
    assert.ok((await compresserJournaliers([trafic, copieDe(trafic)], "2026-11-08")) !== 0);
    for (const d of [trafic, copieDe(trafic)]) {
      assert.deepEqual(fs.readdirSync(d).sort(), [
        "1090ES-2026-11-05.jsonl.gz",
        "1090ES-2026-11-07.jsonl.gz",
        "1090ES-2026-11-08.jsonl",
        "1090ES-2026-11-09.jsonl",
      ]);
    }
    assert.equal(
      gunzipSync(lu(path.join(trafic, "1090ES-2026-11-05.jsonl.gz"))).toString(),
      '{"jour":"2026-11-05"}\n',
    );
  });

  it("ORIGINAL COMPRESSÉ PENDANT QUE SA COPIE ÉTAIT EN DÉFAUT : au retour, sa copie devient le compressé entier", async () => {
    const quoi = "copie du trafic reçu";
    const trafic = path.join(dossier, "data", "trafic");
    const vieux = path.join(trafic, "1090ES-2026-11-01.jsonl");
    await ajouterFichierPoste(vieux, "a\n", quoi);
    const cle = path.join(dossier, "data", "copies");
    fs.renameSync(cle, `${cle}-retiree`);
    writeFileSync(cle, "");
    await ajouterFichierPoste(vieux, "b\n", quoi);
    assert.ok(defautsCopies().some((d) => d.quoi === quoi));
    await compresserFichiers(trafic, ["1090ES-2026-11-01.jsonl"]);
    rmSync(cle);
    fs.renameSync(`${cle}-retiree`, cle);
    await ajouterFichierPoste(path.join(trafic, "1090ES-2026-11-03.jsonl"), "c\n", quoi);
    assert.equal(
      defautsCopies().find((d) => d.quoi === quoi),
      undefined,
    );
    assert.equal(gunzipSync(lu(`${copieDe(vieux)}.gz`)).toString(), "a\nb\n", "entière");
    assert.ok(!fs.existsSync(copieDe(vieux)), "l'ancienne copie, incomplète, retirée");
  });
});

describe("disque du poste : copies changées de dossier (un autre disque, une autre clé)", () => {
  const quoi = "copie du trafic reçu";
  const ici = (...p: string[]) => path.join(dossier, ...p);
  const trafic = () => ici("data", "trafic", "1090ES-2026-11-09.jsonl");
  const autre = () => ici("autre-disque");
  const lu = (f: string) => readFileSync(f);
  beforeEach(() => {
    rmSync(ici("recordings"), { recursive: true, force: true });
    rmSync(autre(), { recursive: true, force: true });
  });
  /** Ce que le poste garde déjà, doublé dans data/copies : registre, archive, trafic du jour, relevé
   * d'un jour passé (compressé), phonie. Et ce qui n'est pas à doubler : un secret, un compressé
   * inachevé (coupé en pleine compression). */
  async function garder(): Promise<string[]> {
    await ecrireFichierPoste(ici("data", "routes.json"), '[{"id":1}]');
    await ecrireFichierPoste(ici("recordings", "index.json"), "[]");
    for (const l of ["a", "b", "c"]) await ajouterFichierPoste(trafic(), `${l}\n`, quoi);
    fs.mkdirSync(ici("data", "releve"), { recursive: true });
    writeFileSync(ici("data", "releve", "releve-2026-11-01.jsonl.gz"), gzipSync("{}\n"));
    writeFileSync(ici("data", "releve", "releve-2026-11-02.jsonl.gz.part"), "inachevé");
    fs.mkdirSync(ici("recordings", "atc"), { recursive: true });
    writeFileSync(ici("recordings", "atc", "atc-fini.mp3"), "phonie");
    writeFileSync(ici("data", "base.secret"), "secret");
    return [
      ici("data", "routes.json"),
      ici("recordings", "index.json"),
      trafic(),
      ici("data", "releve", "releve-2026-11-01.jsonl.gz"),
      ici("recordings", "atc", "atc-fini.mp3"),
    ];
  }

  it("TOUT CE QUI ÉTAIT DÉJÀ GARDÉ Y EST RECOPIÉ — le trafic du jour en entier, pas ses seules lignes nouvelles — puis plus rien jusqu'au lendemain ; un secret, jamais", async () => {
    const gardes = await garder();
    process.env.AFRICONTROL_COPIES = autre(); // le serveur relancé sur le nouveau dossier
    await ajouterFichierPoste(trafic(), "d\n", quoi);
    assert.equal(
      readFileSync(copieDe(trafic(), autre()), "utf8"),
      "d\n",
      "sans recopie : la suite seule",
    );
    assert.equal(await alignerCopies("2026-11-09", autre()), 5);
    for (const f of gardes) assert.ok(lu(copieDe(f, autre())).equals(lu(f)), f);
    assert.ok(!fs.existsSync(copieDe(ici("data", "base.secret"), autre())), "pas le secret");
    const inacheve = ici("data", "releve", "releve-2026-11-02.jsonl.gz.part");
    assert.ok(!fs.existsSync(copieDe(inacheve, autre())), "pas un compressé inachevé");
    assert.equal(await alignerCopies("2026-11-09", autre()), 0, "le même jour : rien à refaire");
    await ajouterFichierPoste(trafic(), "e\n", quoi);
    assert.equal(
      await alignerCopies("2026-11-10", autre()),
      0,
      "le lendemain : parcouru, rien ne manque",
    );
    assert.equal(readFileSync(copieDe(trafic(), autre()), "utf8"), "a\nb\nc\nd\ne\n");
  });

  it("LE DOSSIER DES COPIES VIDÉ OU UNE AUTRE CLÉ, LE MÊME JOUR : reconnu à sa marque, tout recopié ; une copie effacée à la main, rattrapée le lendemain", async () => {
    await garder();
    assert.equal(await alignerCopies("2026-11-09", autre()), 5);
    rmSync(autre(), { recursive: true });
    assert.equal(await alignerCopies("2026-11-09", autre()), 5, "vidé : tout");
    const cle = fs.readFileSync(path.join(autre(), "recopie-faite"), "utf8");
    rmSync(copieDe(ici("data", "routes.json"), autre()));
    writeFileSync(path.join(autre(), "recopie-faite"), `${cle}une autre clé\n`);
    assert.equal(await alignerCopies("2026-11-09", autre()), 1, "une autre marque : tout parcouru");
    rmSync(copieDe(ici("recordings", "index.json"), autre()));
    assert.equal(
      await alignerCopies("2026-11-09", autre()),
      0,
      "même jour, même marque : pas parcouru",
    );
    assert.equal(await alignerCopies("2026-11-10", autre()), 1, "le lendemain : rattrapée");
  });

  it("UNE LIGNE AJOUTÉE PENDANT LA RECOPIE de son fichier : après elle, jamais perdue entre l'ancienne copie et la nouvelle", async () => {
    await garder();
    process.env.AFRICONTROL_COPIES = autre();
    await ajouterFichierPoste(trafic(), "d\n", quoi); // la copie n'a que « d » : à recopier
    const vrai = fs.promises.copyFile;
    let ajout: Promise<void> | null = null;
    fs.promises.copyFile = async (de, vers, mode) => {
      await vrai(de, vers, mode);
      if (String(de) === trafic() && !ajout) {
        // Copié, pas encore renommé sur l'ancienne copie : une ligne arrive.
        ajout = ajouterFichierPoste(trafic(), "e\n", quoi);
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    syncBuiltinESMExports();
    try {
      await alignerCopies("2026-11-09", autre());
    } finally {
      fs.promises.copyFile = vrai;
      syncBuiltinESMExports();
    }
    await ajout;
    assert.equal(readFileSync(trafic(), "utf8"), "a\nb\nc\nd\ne\n");
    assert.equal(readFileSync(copieDe(trafic(), autre()), "utf8"), "a\nb\nc\nd\ne\n");
  });

  it("DOSSIER DES COPIES INJOIGNABLE (clé retirée) : rien de faux, une erreur — refaite en entier quand il répond", async () => {
    await garder();
    fs.mkdirSync(path.dirname(autre()), { recursive: true });
    writeFileSync(autre(), ""); // un fichier à la place du dossier
    await assert.rejects(alignerCopies("2026-11-09", autre()));
    rmSync(autre());
    assert.equal(await alignerCopies("2026-11-09", autre()), 5);
  });
});
