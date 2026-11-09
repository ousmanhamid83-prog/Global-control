import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { alignerCopies, etatIntegrite, rapatrierAnciennes } from "./controle-copies.server.ts";
import {
  ajouterFichierPoste,
  compresserJournaliers,
  copieDe,
  defautsCopies,
  ecrireFichierPoste,
  empreintes,
  journalEmpreintes,
  noterEmpreinte,
} from "./disque-poste.server.ts";
import {
  cleDuPoste,
  hacherTexte,
  ligneEmpreinte,
  lireEmpreintes,
} from "./empreintes-poste.server.ts";

// Chaque essai dans un poste neuf : ses empreintes sont relues par dossier du serveur.
const depart = process.cwd();
let dossier = "";
beforeEach(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "controle-copies-"));
  process.chdir(dossier);
  delete process.env.AFRICONTROL_COPIES;
});
afterEach(() => {
  process.chdir(depart);
  rmSync(dossier, { recursive: true, force: true });
  delete process.env.AFRICONTROL_COPIES;
});

const ici = (...p: string[]) => path.join(dossier, ...p);
const autre = () => ici("autre-disque");
const quoi = "copie du trafic reçu";
const trafic = () => ici("data", "trafic", "1090ES-2026-11-09.jsonl");
const routes = () => ici("data", "routes.json");
const lu = (f: string) => readFileSync(f);
const texte = (f: string) => readFileSync(f, "utf8");
const defaut = (q: string) => defautsCopies().find((d) => d.quoi === q);

/** Ce que le poste garde déjà, doublé dans data/copies : registre, archive, trafic du jour, relevé
 * d'un jour passé (compressé), phonie, et le journal des empreintes. Et ce qui n'est pas à doubler :
 * un secret, la clé du poste, un compressé inachevé (coupé en pleine compression). */
async function garder(): Promise<string[]> {
  await ecrireFichierPoste(routes(), '[{"id":1}]');
  await ecrireFichierPoste(ici("recordings", "index.json"), "[]");
  for (const l of ["a", "b", "c"]) await ajouterFichierPoste(trafic(), `${l}\n`, quoi);
  fs.mkdirSync(ici("data", "releve"), { recursive: true });
  writeFileSync(ici("data", "releve", "releve-2026-11-01.jsonl.gz"), gzipSync("{}\n"));
  writeFileSync(ici("data", "releve", "releve-2026-11-02.jsonl.gz.part"), "inachevé");
  fs.mkdirSync(ici("recordings", "atc"), { recursive: true });
  writeFileSync(ici("recordings", "atc", "atc-fini.mp3"), "phonie");
  writeFileSync(ici("data", "base.secret"), "secret");
  return [
    routes(),
    ici("recordings", "index.json"),
    trafic(),
    ici("data", "releve", "releve-2026-11-01.jsonl.gz"),
    ici("recordings", "atc", "atc-fini.mp3"),
    journalEmpreintes(),
  ];
}

describe("contrôle des copies : un dossier changé reçoit tout ce qui était gardé", () => {
  it("TOUT Y EST RECOPIÉ — le trafic du jour en entier, pas ses seules lignes nouvelles — puis plus rien jusqu'au lendemain ; ni un secret ni la clé du poste, jamais", async () => {
    const gardes = await garder();
    process.env.AFRICONTROL_COPIES = autre(); // le serveur relancé sur le nouveau dossier
    await ajouterFichierPoste(trafic(), "d\n", quoi);
    assert.equal(texte(copieDe(trafic(), autre())), "d\n", "sans recopie : la suite seule");
    assert.equal(await alignerCopies("2026-11-09", autre()), 6);
    for (const f of gardes) assert.ok(lu(copieDe(f, autre())).equals(lu(f)), f);
    for (const f of ["base.secret", "empreintes.cle"]) {
      assert.ok(fs.existsSync(ici("data", f)), f);
      assert.ok(!fs.existsSync(copieDe(ici("data", f), autre())), `${f} : pas copié`);
    }
    const inacheve = ici("data", "releve", "releve-2026-11-02.jsonl.gz.part");
    assert.ok(!fs.existsSync(copieDe(inacheve, autre())), "pas un compressé inachevé");
    assert.equal(await alignerCopies("2026-11-09", autre()), 0, "le même jour : rien à refaire");
    await ajouterFichierPoste(trafic(), "e\n", quoi);
    assert.equal(
      await alignerCopies("2026-11-10", autre()),
      0,
      "le lendemain : relu, rien ne manque",
    );
    assert.equal(texte(copieDe(trafic(), autre())), "a\nb\nc\nd\ne\n");
  });

  it("LE DOSSIER VIDÉ OU UNE AUTRE CLÉ, LE MÊME JOUR : reconnu à sa marque, tout recopié ; une copie effacée à la main, rattrapée le lendemain", async () => {
    await garder();
    process.env.AFRICONTROL_COPIES = autre();
    assert.equal(await alignerCopies("2026-11-09", autre()), 6);
    rmSync(autre(), { recursive: true });
    assert.equal(await alignerCopies("2026-11-09", autre()), 6, "vidé : tout");
    rmSync(copieDe(routes(), autre()));
    writeFileSync(path.join(autre(), "recopie-faite"), "la marque d'une autre clé\n");
    assert.equal(await alignerCopies("2026-11-09", autre()), 1, "une autre marque : tout relu");
    rmSync(copieDe(ici("recordings", "index.json"), autre()));
    assert.equal(await alignerCopies("2026-11-09", autre()), 0, "même jour, même marque : rien");
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
    assert.equal(texte(trafic()), "a\nb\nc\nd\ne\n");
    assert.equal(texte(copieDe(trafic(), autre())), "a\nb\nc\nd\ne\n");
  });

  it("DOSSIER DES COPIES INJOIGNABLE (clé retirée) : rien de faux, une erreur — refait en entier quand il répond", async () => {
    await garder();
    process.env.AFRICONTROL_COPIES = autre();
    fs.mkdirSync(path.dirname(autre()), { recursive: true });
    writeFileSync(autre(), ""); // un fichier à la place du dossier
    await assert.rejects(alignerCopies("2026-11-09", autre()));
    rmSync(autre());
    assert.equal(await alignerCopies("2026-11-09", autre()), 6);
  });
});

describe("contrôle des copies : au contenu, par les empreintes scellées du poste", () => {
  it("UNE VIEILLE CLÉ REBRANCHÉE : la copie a la même taille que le registre, un contenu plus ancien — recopiée", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    await ecrireFichierPoste(routes(), '[{"id":2}]'); // même taille
    assert.equal(texte(copieDe(routes())), '[{"id":2}]');
    writeFileSync(copieDe(routes()), '[{"id":1}]'); // la copie d'avant, sur la vieille clé
    assert.equal(await alignerCopies("2026-11-09"), 1);
    assert.equal(texte(copieDe(routes())), '[{"id":2}]');
    assert.equal(texte(routes()), '[{"id":2}]', "le registre du poste intact");
  });

  it("LE DISQUE DU POSTE ABÎME UN REGISTRE, À TAILLE ÉGALE : réparé depuis sa copie, relu, et dit", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    writeFileSync(routes(), '[{"id":7}]'); // un octet changé sur le disque du poste
    assert.equal(await alignerCopies("2026-11-09"), 0, "rien recopié par-dessus la bonne copie");
    assert.equal(texte(routes()), '[{"id":1}]', "réparé");
    assert.equal(texte(copieDe(routes())), '[{"id":1}]');
    assert.equal(etatIntegrite().reparees[0]?.f, "data/routes.json");
    assert.equal(defaut("intégrité des fichiers gardés"), undefined);
  });

  it("ABÎMÉ DES DEUX CÔTÉS, DIFFÉREMMENT : rien n'est écrasé, c'est dit ; MODIFIÉ À L'IDENTIQUE HORS DU POSTE : rescellé, dit une fois", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    writeFileSync(routes(), '[{"id":7}]');
    writeFileSync(copieDe(routes()), '[{"id":8}]');
    await alignerCopies("2026-11-09");
    assert.equal(texte(routes()), '[{"id":7}]', "rien d'écrasé");
    assert.equal(texte(copieDe(routes())), '[{"id":8}]');
    assert.deepEqual(etatIntegrite().abimees, ["data/routes.json"]);
    assert.match(defaut("intégrité des fichiers gardés")?.raison ?? "", /data\/routes\.json/);
    writeFileSync(copieDe(routes()), '[{"id":7}]'); // pareils des deux côtés, jamais scellé
    await alignerCopies("2026-11-10");
    assert.deepEqual(etatIntegrite().abimees, []);
    assert.equal(defaut("intégrité des fichiers gardés"), undefined);
    assert.equal(etatIntegrite().rescellees[0]?.f, "data/routes.json");
    const avant = etatIntegrite().rescellees.length;
    await alignerCopies("2026-11-11");
    assert.equal(etatIntegrite().rescellees.length, avant, "rescellé : plus rien à dire");
  });

  it("RELANCÉ LE MÊME JOUR : les registres (petits) sont relus au contenu à chaque contrôle, sans attendre le contrôle progressif du lendemain", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    await alignerCopies("2026-11-09");
    writeFileSync(copieDe(routes()), '[{"id":9}]'); // même taille, abîmée depuis
    const marque = path.join(ici("data", "copies"), "recopie-faite");
    writeFileSync(
      marque,
      JSON.stringify({ ...(JSON.parse(texte(marque)) as object), id: "relancé" }),
    );
    assert.equal(await alignerCopies("2026-11-09"), 1);
    assert.equal(texte(copieDe(routes())), '[{"id":1}]');
  });

  it("COUPÉ ENTRE L'EMPREINTE ET L'ÉCRITURE : le registre est resté à sa version d'avant — pas d'alerte, elle est rescellée", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    await noterEmpreinte(routes(), hacherTexte('[{"id":2}]')); // l'écriture n'a jamais eu lieu
    const reparees = etatIntegrite().reparees.length;
    const rescellees = etatIntegrite().rescellees.length;
    assert.equal(await alignerCopies("2026-11-09"), 0);
    assert.equal(etatIntegrite().reparees.length, reparees);
    assert.equal(etatIntegrite().rescellees.length, rescellees);
    assert.deepEqual(etatIntegrite().abimees, []);
    assert.equal(texte(routes()), '[{"id":1}]');
    const [derniere] = (await empreintes()).index.get("data/routes.json") ?? [];
    assert.equal(derniere?.h, hacherTexte('[{"id":1}]').h, "la version présente, rescellée");
  });

  it("JOURNAL OUVERT (trafic du jour), copie de même taille au contenu différent : recopiée — le poste y écrit, il fait foi", async () => {
    for (const l of ["a", "b"]) await ajouterFichierPoste(trafic(), `${l}\n`, quoi);
    writeFileSync(copieDe(trafic()), "a\nX\n");
    assert.equal(await alignerCopies("2026-11-09"), 1);
    assert.equal(texte(copieDe(trafic())), "a\nb\n");
    const rescellees = etatIntegrite().rescellees.length;
    await ajouterFichierPoste(trafic(), "c\n", quoi);
    assert.equal(await alignerCopies("2026-11-10"), 0, "il a grandi : rien de faux");
    assert.equal(
      etatIntegrite().rescellees.length,
      rescellees,
      "jamais scellé : il s'écrit encore",
    );
    assert.deepEqual(etatIntegrite().abimees, []);
  });

  it("LE JOURNAL DES EMPREINTES IMPOSSIBLE À ÉCRIRE : le registre n'est pas écrit — jamais une version non scellée, que le contrôle prendrait pour une corruption", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    rmSync(journalEmpreintes());
    fs.mkdirSync(journalEmpreintes()); // un dossier à sa place : rien ne s'y ajoute
    await assert.rejects(ecrireFichierPoste(routes(), '[{"id":2}]'));
    assert.equal(texte(routes()), '[{"id":1}]');
  });

  it("UN DISQUE DES COPIES QUI ÉCRIT FAUX : la recopie est relue, elle ne passe pas — c'est dit, rien n'est cru fait", async () => {
    await ecrireFichierPoste(routes(), '[{"id":1}]');
    rmSync(copieDe(routes()));
    const vrai = fs.promises.copyFile;
    fs.promises.copyFile = async (de, vers, mode) => {
      await vrai(de, vers, mode);
      if (String(vers).includes(`${path.sep}copies${path.sep}`)) writeFileSync(vers, '[{"id":0}]');
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(alignerCopies("2026-11-09"), /relu différent/);
    } finally {
      fs.promises.copyFile = vrai;
      syncBuiltinESMExports();
    }
    assert.equal(await alignerCopies("2026-11-09"), 1, "le disque répare : recopiée, relue");
    assert.equal(texte(copieDe(routes())), '[{"id":1}]');
  });

  it("GROS FICHIERS (au-delà de 1 Mio) : à la taille entre deux passages ; relus par le contrôle progressif, borné, repris où il s'était arrêté", async () => {
    const atc = ici("recordings", "atc");
    fs.mkdirSync(atc, { recursive: true });
    const segments = ["atc-1.mp3", "atc-2.mp3", "atc-3.mp3"].map((n) => path.join(atc, n));
    for (const [i, f] of segments.entries()) {
      const contenu = Buffer.alloc(1_200_000, i + 1);
      writeFileSync(f, contenu);
      fs.mkdirSync(path.dirname(copieDe(f)), { recursive: true });
      writeFileSync(copieDe(f), contenu);
    }
    const abimee = Buffer.alloc(1_200_000, 3);
    abimee[600_000] = 0; // même taille : passe la taille, pas le contenu
    writeFileSync(copieDe(segments[2]!), abimee);
    const budget = 4 * 2 ** 20; // deux segments relus des deux côtés par passage
    assert.equal(await alignerCopies("2026-11-09", undefined, budget), 0, "jour 1 : 1 et 2");
    assert.ok(!lu(copieDe(segments[2]!)).equals(lu(segments[2]!)), "pas encore atteint");
    assert.equal(await alignerCopies("2026-11-10", undefined, budget), 1, "jour 2 : repris au 3");
    assert.ok(lu(copieDe(segments[2]!)).equals(lu(segments[2]!)));
    // Relancé le même jour (une autre marque, le même jour) : le contrôle progressif ne repasse pas.
    const marque = path.join(ici("data", "copies"), "recopie-faite");
    const lue = JSON.parse(texte(marque)) as { id: string };
    writeFileSync(marque, JSON.stringify({ ...lue, id: "relancé" }));
    writeFileSync(copieDe(segments[1]!), abimee.fill(2, 0, 10)); // même taille, au tour suivant
    assert.equal(await alignerCopies("2026-11-10", undefined, budget), 0, "pas deux fois par jour");
    assert.equal(await alignerCopies("2026-11-11", undefined, budget), 1, "le lendemain, si");
    writeFileSync(copieDe(segments[0]!), Buffer.alloc(10)); // taille fausse : vue sans attendre
    assert.equal(await alignerCopies("2026-11-12", undefined, 0), 1);
    assert.ok(lu(copieDe(segments[0]!)).equals(lu(segments[0]!)));
  });

  it("EMPREINTES TRAFIQUÉES dans le journal : sceau faux, écartées et comptées, c'est dit ; le fichier est rescellé sur le poste", async () => {
    const cle = Buffer.alloc(32, 9);
    fs.mkdirSync(ici("data"), { recursive: true });
    writeFileSync(ici("data", "empreintes.cle"), `${cle.toString("hex")}\n`);
    writeFileSync(routes(), '[{"id":1}]');
    const vraie = { f: "data/routes.json", ...hacherTexte('[{"id":1}]') };
    const trafiquee = JSON.parse(ligneEmpreinte(cle, vraie)) as { h: string };
    trafiquee.h = hacherTexte('[{"id":666}]').h; // l'empreinte d'un autre contenu, sceau d'origine
    writeFileSync(journalEmpreintes(), `\n${JSON.stringify(trafiquee)}`);
    await alignerCopies("2026-11-09");
    assert.equal(etatIntegrite().fausses, 1);
    assert.match(defaut("empreintes des fichiers gardés")?.raison ?? "", /1 empreinte/);
    assert.equal(texte(routes()), '[{"id":1}]', "rien réparé d'après une empreinte fausse");
    assert.equal((await empreintes()).index.get("data/routes.json")?.[0]?.h, vraie.h);
  });

  it("LA COMPRESSION SCELLE le compressé d'un fichier gardé (sa version finie) ; pas celui d'une copie", async () => {
    await ajouterFichierPoste(ici("data", "trafic", "1090ES-2026-11-05.jsonl"), "{}\n", quoi);
    const d = ici("data", "trafic");
    await compresserJournaliers([d, copieDe(d)], "2026-11-08");
    const index = (await empreintes()).index;
    const gz = lu(ici("data", "trafic", "1090ES-2026-11-05.jsonl.gz"));
    assert.equal(index.get("data/trafic/1090ES-2026-11-05.jsonl.gz")?.[0]?.t, gz.length);
    assert.equal([...index.keys()].filter((k) => k.includes("copies")).length, 0);
  });
});

describe("empreintes scellées : le journal et la clé du poste", () => {
  it("RELECTURE : les deux dernières versions de chaque fichier ; un sceau faux compté et écarté ; une ligne coupée ignorée, sans avaler la suivante", () => {
    const cle = Buffer.alloc(32, 1);
    const v = (h: string) => ({ f: "data/a.json", t: 2, h: h.repeat(64) });
    const journal =
      ligneEmpreinte(cle, v("1")) +
      ligneEmpreinte(cle, v("2")) +
      '\n{"f":"data/a.json","t":2,"h":"33' + // coupée en pleine écriture
      ligneEmpreinte(cle, v("3")) +
      ligneEmpreinte(Buffer.alloc(32, 2), v("4")) + // une autre clé
      ["f", "t", "h"]
        .map((champ) => {
          const e = JSON.parse(ligneEmpreinte(cle, v("5"))) as Record<string, unknown>;
          e[champ] = champ === "t" ? 3 : champ === "f" ? "data/b.json" : "6".repeat(64);
          return `\n${JSON.stringify(e)}`; // le sceau d'origine sur un champ changé
        })
        .join("");
    const { index, fausses, coupees } = lireEmpreintes(cle, journal);
    assert.deepEqual(
      index.get("data/a.json")?.map((e) => e.h[0]),
      ["3", "2"],
    );
    assert.equal(fausses, 4);
    assert.equal(coupees, 1);
    assert.equal(index.has("data/b.json"), false);
  });

  it("CLÉ DU POSTE : tirée une fois, lisible du seul compte du serveur, jamais tirée par-dessus ; abîmée, mise de côté et une neuve tirée", () => {
    const f = ici("data", "empreintes.cle");
    const a = cleDuPoste(f);
    assert.equal(a?.length, 32);
    if (process.platform !== "win32") assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.ok(cleDuPoste(f)?.equals(a!), "relue, pas retirée");
    writeFileSync(f, "abîmée\n");
    const b = cleDuPoste(f);
    assert.equal(b?.length, 32);
    assert.ok(!b!.equals(a!));
    assert.equal(
      fs.readdirSync(ici("data")).filter((n) => n.startsWith("empreintes.cle.abimee-")).length,
      1,
    );
  });
});

describe("rapatriement des anciennes copies (le dossier des copies a changé de disque)", () => {
  /** Un ancien dossier des copies : une copie de la base, un segment doublé, une copie de registre. */
  function ancien(d: string): string[] {
    const fichiers = [
      ["jour-2026-11-01", "base", "PG_VERSION"],
      ["jour-2026-11-01", "base", "backup_label"],
      ["ecritures", "000000010000000000000001"],
      ["fichiers", "data", "routes.json"],
    ].map((p) => path.join(d, ...p));
    for (const [i, f] of fichiers.entries()) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, `contenu ${i}\n`.repeat(100 * (i + 1)));
    }
    return fichiers;
  }
  const archives = () =>
    fs.readdirSync(autre()).filter((n) => n.startsWith("ancien-dossier-") && !n.endsWith(".part"));
  const registre = () => JSON.parse(texte(ici("data", "copies-dossier.json"))) as unknown;

  it("data/copies → UN AUTRE DISQUE : tout rapatrié sous ancien-dossier-<date>, à l'identique, puis retiré de l'ancien dossier ; rien à refaire ensuite", async () => {
    const vieux = ancien(ici("data", "copies"));
    const contenus = vieux.map(lu);
    process.env.AFRICONTROL_COPIES = autre();
    const bilan = await rapatrierAnciennes(autre());
    assert.equal(bilan?.fichiers, 4);
    assert.equal(archives().length, 1);
    for (const [i, f] of vieux.entries()) {
      const rel = path.relative(ici("data", "copies"), f);
      assert.ok(lu(path.join(autre(), archives()[0]!, rel)).equals(contenus[i]!), rel);
    }
    assert.ok(!fs.existsSync(ici("data", "copies")), "l'ancien dossier, vidé, retiré");
    assert.deepEqual(registre(), { dossier: autre(), precedent: null, archive: null });
    assert.equal(etatIntegrite().rapatriement?.fichiers, 4);
    assert.equal(await rapatrierAnciennes(autre()), null, "rien à refaire");
    assert.equal(archives().length, 1);
  });

  it("COUPÉ APRÈS LE RENOMMAGE : repris — l'archive revérifiée, l'ancien dossier vidé, pas de seconde archive", async () => {
    const vieux = ancien(ici("data", "copies"));
    process.env.AFRICONTROL_COPIES = autre();
    const archive = path.join(autre(), "ancien-dossier-2026-11-09T10-00-00-000Z");
    fs.cpSync(ici("data", "copies"), archive, { recursive: true });
    await ecrireFichierPoste(
      ici("data", "copies-dossier.json"),
      JSON.stringify({ dossier: autre(), precedent: ici("data", "copies"), archive }),
    );
    // Renommée, mais l'arrêt est venu avant que l'ancien dossier se vide.
    assert.equal((await rapatrierAnciennes(autre()))?.fichiers, vieux.length);
    assert.deepEqual(archives(), [path.basename(archive)]);
    assert.ok(!fs.existsSync(ici("data", "copies")));
  });

  it("RECOPIÉ DIFFÉRENT (le nouveau disque écrit faux) : rien n'est retiré de l'ancien dossier, pas d'archive, l'erreur est dite ; repris proprement ensuite", async () => {
    const vieux = ancien(ici("data", "copies"));
    process.env.AFRICONTROL_COPIES = autre();
    const vrai = fs.promises.cp;
    fs.promises.cp = (async (de: string, vers: string, o: fs.CopyOptions) => {
      await vrai(de, vers, o);
      const seg = path.join(vers, "ecritures", "000000010000000000000001");
      const b = readFileSync(seg);
      b[0]! ^= 0xff;
      writeFileSync(seg, b);
    }) as typeof vrai;
    syncBuiltinESMExports();
    try {
      await assert.rejects(rapatrierAnciennes(autre()), /recopié différent/);
    } finally {
      fs.promises.cp = vrai;
      syncBuiltinESMExports();
    }
    for (const f of vieux) assert.ok(fs.existsSync(f), `${f} : gardé`);
    assert.deepEqual(archives(), []);
    assert.equal((await rapatrierAnciennes(autre()))?.fichiers, vieux.length);
    assert.equal(archives().length, 1);
  });

  it("LE NOUVEAU DOSSIER DANS L'ANCIEN (data/copies/disque2) : rien n'est rapatrié — jamais un dossier recopié dans lui-même", async () => {
    ancien(ici("data", "copies"));
    const dedans = ici("data", "copies", "disque2");
    process.env.AFRICONTROL_COPIES = dedans;
    assert.equal(await rapatrierAnciennes(dedans), null);
    assert.ok(fs.existsSync(ici("data", "copies", "jour-2026-11-01")), "rien de retiré");
  });

  it(
    "WINDOWS : le même dossier écrit autrement (majuscules) n'est pas un autre dossier",
    { skip: process.platform !== "win32" },
    async () => {
      process.env.AFRICONTROL_COPIES = autre();
      await ecrireFichierPoste(
        ici("data", "copies-dossier.json"),
        JSON.stringify({ dossier: autre().toUpperCase(), precedent: null, archive: null }),
      );
      assert.equal(await rapatrierAnciennes(autre()), null);
    },
  );

  it("ANCIEN DOSSIER INJOIGNABLE (clé retirée) : une erreur, le rapatriement reste en attente ; fait quand il répond — d'un dossier choisi à un autre", async () => {
    const cleE = ici("cle-E", "AfriControl-copies");
    process.env.AFRICONTROL_COPIES = autre();
    await ecrireFichierPoste(
      ici("data", "copies-dossier.json"),
      JSON.stringify({ dossier: cleE, precedent: null, archive: null }),
    );
    await assert.rejects(rapatrierAnciennes(autre()));
    assert.equal((registre() as { precedent: string }).precedent, cleE, "en attente");
    ancien(cleE);
    assert.equal((await rapatrierAnciennes(autre()))?.fichiers, 4);
    assert.deepEqual(registre(), { dossier: autre(), precedent: null, archive: null });
  });
});
