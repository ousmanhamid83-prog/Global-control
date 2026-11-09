import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  choisirBase,
  etatBase,
  ouvrirBase,
  noterReprise,
  ouvrirPgliteDurable,
  parametresDurables,
  prendreBase,
  programmerCopies,
  copierBase,
  etatCopies,
  secretDuPoste,
} from "./base-poste.server.ts";
import { defautsCopies } from "./disque-poste.server.ts";
import { jourPoste } from "./vigilair/format.ts";

const racine = mkdtempSync(path.join(tmpdir(), "base-poste-"));
after(() => rmSync(racine, { recursive: true, force: true }));
let n = 0;
const dossierNeuf = () => path.join(racine, `poste${(n += 1)}`, "data", "base");
/** Le dossier d'une base déjà là, avec le verrou `contenu` laissé par un autre. */
function avecVerrou(contenu: string): string {
  const dossier = dossierNeuf();
  mkdirSync(dossier, { recursive: true });
  writeFileSync(`${dossier}.verrou`, contenu);
  return dossier;
}
const verrou = (dossier: string) => JSON.parse(readFileSync(`${dossier}.verrou`, "utf8"));

/** `asynchrones` : ceux qui ne figent pas le serveur (FileHandle.sync), compris dans les autres. */
type Forcages = { fichiers: number; dossiers: number; asynchrones: number };

/**
 * Compte les fsync de Node pendant `faire` : synchrones (le crochet de NODEFS, appelé par Postgres)
 * et asynchrones (FileHandle.sync : base neuve, sauvegarde).
 */
async function compterFsync(faire: (appels: Forcages) => Promise<void>): Promise<Forcages> {
  const appels: Forcages = { fichiers: 0, dossiers: 0, asynchrones: 0 };
  const compter = (dossier: boolean) => {
    if (dossier) appels.dossiers += 1;
    else appels.fichiers += 1;
  };
  const vrai = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    compter(fs.fstatSync(fd).isDirectory());
    vrai(fd);
  };
  syncBuiltinESMExports();
  const temoin = await fs.promises.open(process.execPath, "r");
  const poignee = Object.getPrototypeOf(temoin) as { sync(this: FileHandle): Promise<void> };
  await temoin.close();
  const vraiSync = poignee.sync;
  poignee.sync = async function () {
    compter((await this.stat()).isDirectory());
    appels.asynchrones += 1;
    return vraiSync.call(this);
  };
  try {
    await faire(appels);
  } finally {
    fs.fsyncSync = vrai;
    syncBuiltinESMExports();
    poignee.sync = vraiSync;
  }
  return appels;
}

/** Un serveur local qui fait `accueil` à chaque connexion ; son port. */
async function ecoute(
  accueil: (s: import("node:net").Socket) => void,
): Promise<{ srv: Server; port: number }> {
  const srv = createServer(accueil);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, port: (srv.address() as AddressInfo).port };
}

/** Un autre processus du poste qui prend la base et reste vivant. */
async function autreServeur(dossier: string): Promise<ChildProcess> {
  const module = pathToFileURL(path.join(import.meta.dirname, "base-poste.server.ts")).href;
  const code = `const { prendreBase } = await import(${JSON.stringify(module)});
    const p = await prendreBase(${JSON.stringify(dossier)});
    console.log(p.ok ? "pris" : "refus");
    setInterval(() => {}, 1000);`;
  const enfant = spawn(process.execPath, [
    "--experimental-strip-types",
    "--no-warnings",
    "--input-type=module",
    "-e",
    code,
  ]);
  const ligne = await new Promise<string>((r) =>
    enfant.stdout!.once("data", (d) => r(String(d).trim())),
  );
  if (ligne !== "pris") {
    enfant.kill("SIGKILL");
    assert.fail(`l'autre serveur n'a pas pris la base : ${ligne}`);
  }
  return enfant;
}

describe("base du poste : où", () => {
  it("PAR DÉFAUT : data/base sous le dossier du serveur ; « memoire » : en mémoire ; un chemin : ce chemin", () => {
    assert.deepEqual(choisirBase(undefined, "/srv/poste"), {
      mode: "disque",
      dossier: path.resolve("/srv/poste/data/base"),
    });
    assert.deepEqual(choisirBase("  ", "/srv/poste"), {
      mode: "disque",
      dossier: path.resolve("/srv/poste/data/base"),
    });
    assert.deepEqual(choisirBase("archives/base", "/srv/poste"), {
      mode: "disque",
      dossier: path.resolve("/srv/poste/archives/base"),
    });
    assert.deepEqual(choisirBase("/mnt/disque2/base", "/srv/poste"), {
      mode: "disque",
      dossier: path.resolve("/mnt/disque2/base"),
    });
    const m = choisirBase("memoire", "/srv/poste");
    assert.ok(m.mode === "memoire" && /perdue à l'arrêt/.test(m.raison));
  });
});

describe("base du poste : un seul serveur par dossier", () => {
  it("PRISE : dossier créé, verrou au pid de ce serveur ; un second est refusé ; libérée, reprise", async () => {
    const dossier = dossierNeuf();
    const p = await prendreBase(dossier);
    assert.ok(p.ok);
    assert.ok(existsSync(dossier));
    assert.equal(verrou(dossier).pid, process.pid);
    const second = await prendreBase(dossier);
    assert.deepEqual(second, {
      ok: false,
      raison: `base déjà ouverte par un autre serveur du poste (pid ${process.pid})`,
      occupee: true,
    });
    p.liberer();
    assert.ok(!existsSync(`${dossier}.verrou`), "verrou retiré");
    const reprise = await prendreBase(dossier);
    assert.ok(reprise.ok);
    reprise.liberer();
  });

  it("LIBÉRER ne retire que son propre verrou, jamais celui d'un serveur qui a repris la base", async () => {
    const dossier = dossierNeuf();
    const p = await prendreBase(dossier);
    assert.ok(p.ok);
    const autre = JSON.stringify({ pid: 1, port: 1, jeton: "d".repeat(32) });
    writeFileSync(`${dossier}.verrou`, autre);
    p.liberer();
    assert.equal(readFileSync(`${dossier}.verrou`, "utf8"), autre);
  });

  it("UN AUTRE PROCESSUS VIVANT la tient : refusé ; TUÉ NET (kill -9) : reprise aussitôt", async () => {
    const dossier = dossierNeuf();
    const enfant = await autreServeur(dossier);
    try {
      const refus = await prendreBase(dossier);
      assert.deepEqual(refus, {
        ok: false,
        raison: `base déjà ouverte par un autre serveur du poste (pid ${enfant.pid})`,
        occupee: true,
      });
    } finally {
      const fin = new Promise((r) => enfant.once("exit", r));
      enfant.kill("SIGKILL");
      await fin;
    }
    const reprise = await prendreBase(dossier);
    assert.ok(reprise.ok, "le verrou d'un serveur tué est repris");
    assert.equal(verrou(dossier).pid, process.pid);
    reprise.liberer();
  });

  it("SERVEUR MORT dont le port a été repris par un programme muet : repris aussitôt, sans l'attendre", async () => {
    const enfant = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => enfant.once("exit", r));
    const sockets: import("node:net").Socket[] = [];
    const { srv, port } = await ecoute((s) => sockets.push(s));
    try {
      const dossier = avecVerrou(JSON.stringify({ pid: enfant.pid, port, jeton: "e".repeat(32) }));
      const p = await prendreBase(dossier, 2000);
      assert.ok(p.ok);
      p.liberer();
    } finally {
      for (const s of sockets) s.destroy();
      srv.close();
    }
  });

  it("PID REPRIS PAR UN AUTRE (machine redémarrée) : personne n'écoute plus sur le port : repris", async () => {
    const { srv, port } = await ecoute((s) => s.end());
    await new Promise((r) => srv.close(r));
    // Le verrou d'un serveur disparu : pid vivant (le nôtre, repris), port fermé. Le délai par
    // défaut : Windows met environ 2 s à refuser une connexion vers un port local fermé.
    const dossier = avecVerrou(JSON.stringify({ pid: process.pid, port, jeton: "a".repeat(32) }));
    const p = await prendreBase(dossier);
    assert.ok(p.ok);
    p.liberer();
  });

  it("UN AUTRE PROGRAMME sur le port, qui répond autre chose ou ferme sans un mot : repris", async () => {
    for (const accueil of [
      (s: import("node:net").Socket) =>
        s.write("HTTP/1.1 400 Bad Request\r\nConnection: keep-alive\r\n\r\n"),
      (s: import("node:net").Socket) => s.end(),
    ]) {
      const { srv, port } = await ecoute(accueil);
      try {
        const dossier = avecVerrou(
          JSON.stringify({ pid: process.pid, port, jeton: "b".repeat(32) }),
        );
        const p = await prendreBase(dossier, 2000);
        assert.ok(p.ok);
        p.liberer();
      } finally {
        srv.close();
      }
    }
  });

  it("UN SERVEUR MUET (il accepte, ne répond rien) : cru vivant — en mémoire plutôt que deux fois ouverte", async () => {
    const sockets: import("node:net").Socket[] = [];
    const { srv, port } = await ecoute((s) => sockets.push(s));
    try {
      const dossier = avecVerrou(JSON.stringify({ pid: process.pid, port, jeton: "c".repeat(32) }));
      const t0 = Date.now();
      const p = await prendreBase(dossier, 300);
      assert.equal(p.ok, false);
      assert.ok(Date.now() - t0 >= 280, "il a attendu sa réponse");
    } finally {
      for (const s of sockets) s.destroy();
      srv.close();
    }
  });

  it("VERROU ILLISIBLE (arrêt au moment de l'écrire) : relu, puis repris", async () => {
    const dossier = avecVerrou("");
    const p = await prendreBase(dossier, 300);
    assert.ok(p.ok);
    assert.equal(verrou(dossier).pid, process.pid);
    p.liberer();
  });

  it("DOSSIER IMPOSSIBLE À CRÉER (disque en lecture seule, un fichier à sa place) : refusé, et dit pourquoi", async () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    rmSync(poste, { recursive: true, force: true });
    writeFileSync(poste, "");
    const p = await prendreBase(path.join(poste, "data", "base"));
    assert.ok(!p.ok && /impossible à créer \(E[A-Z]+\)/.test(p.raison), JSON.stringify(p));
  });
});

describe("base du poste : ouverture", () => {
  it("SUR DISQUE (vrai PGLite) : ce qui est écrit est relu après fermeture et réouverture", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const poste = path.join(racine, `poste${(n += 1)}`);
    const ouvrir = async (dataDir?: string) => {
      const pg = new PGlite(dataDir ? { dataDir } : {});
      await pg.waitReady;
      return pg;
    };
    const pg = await ouvrirBase(ouvrir, undefined, poste);
    assert.deepEqual(etatBase(), { mode: "disque", dossier: path.join(poste, "data", "base") });
    await pg.exec(
      "create table journal (t text); insert into journal values ('relevé coupé par le chef')",
    );
    await pg.close();
    const pendant = await prendreBase(path.join(poste, "data", "base"), 300);
    assert.equal(pendant.ok, false, "le verrou reste tenu tant que le serveur tourne");
    const reouverte = new PGlite({ dataDir: path.join(poste, "data", "base") });
    await reouverte.waitReady;
    assert.deepEqual((await reouverte.query("select t from journal")).rows, [
      { t: "relevé coupé par le chef" },
    ]);
    await reouverte.close();
  });

  it("RELANCÉ AUSSITÔT ARRÊTÉ : le serveur précédent finit de s'arrêter ; attendu, puis la base est reprise", async () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    const dossier = path.join(poste, "data", "base");
    const precedent = await autreServeur(dossier);
    const sortie = new Promise((r) => precedent.once("exit", r));
    setTimeout(() => precedent.kill("SIGTERM"), 800);
    const t0 = Date.now();
    const ouvert = await ouvrirBase(
      async (dataDir?: string) => ({ dataDir }),
      undefined,
      poste,
      8000,
    );
    await sortie;
    assert.deepEqual(ouvert, { dataDir: dossier });
    assert.deepEqual(etatBase(), { mode: "disque", dossier });
    const ms = Date.now() - t0;
    assert.ok(ms >= 800 && ms < 4000, `repris ${ms} ms après, dès la sortie du précédent`);
  });

  it("REFUSÉE (déjà ouverte, dossier impossible) ou ILLISIBLE : en mémoire, la raison retenue", async () => {
    const ouverts: (string | undefined)[] = [];
    const ouvrir = async (dataDir?: string) => {
      ouverts.push(dataDir);
      return { dataDir };
    };
    const poste = path.join(racine, `poste${(n += 1)}`);
    const dossier = path.join(poste, "data", "base");
    const tenue = await prendreBase(dossier, 300);
    assert.ok(tenue.ok);
    const t0 = Date.now();
    assert.deepEqual(await ouvrirBase(ouvrir, undefined, poste, 1200), { dataDir: undefined });
    assert.ok(Date.now() - t0 >= 1000, "attendue avant de renoncer");
    assert.deepEqual(etatBase(), {
      mode: "memoire",
      raison: `base déjà ouverte par un autre serveur du poste (pid ${process.pid})`,
    });
    tenue.liberer();

    const illisible = async (dataDir?: string) => {
      if (dataDir) throw new Error("Aborted()");
      return { dataDir };
    };
    assert.deepEqual(await ouvrirBase(illisible, undefined, poste), { dataDir: undefined });
    const e = etatBase();
    assert.ok(
      e?.mode === "memoire" && e.raison.startsWith(`base de ${dossier} illisible (Aborted())`),
      JSON.stringify(e),
    );
    assert.ok(!existsSync(`${dossier}.verrou`), "verrou rendu : la base illisible n'est pas tenue");
    assert.ok(existsSync(dossier), "rien ne s'ouvrait, pas même une base neuve : la base remise en place");
    assert.deepEqual(readdirSync(path.dirname(dossier)).filter((x) => x.includes(".illisible-")), []);

    assert.deepEqual(await ouvrirBase(ouvrir, "memoire", poste), { dataDir: undefined });
    assert.equal(etatBase()?.mode, "memoire");
    assert.deepEqual(ouverts, [undefined, undefined], "jamais ouverte sur le dossier refusé");
  });
});

describe("base du poste : secret des sessions", () => {
  it("SUR DISQUE : tiré une fois, gardé à côté de la base, lisible du seul serveur ; le même au redémarrage", () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    const secret = secretDuPoste(undefined, poste);
    assert.match(secret ?? "", /^[0-9a-f]{64}$/);
    const fichier = path.join(poste, "data", "base.secret");
    assert.equal(readFileSync(fichier, "utf8"), `${secret}\n`);
    if (process.platform !== "win32") assert.equal(statSync(fichier).mode & 0o777, 0o600);
    assert.equal(secretDuPoste(undefined, poste), secret, "relu, pas retiré");
  });

  it("BASE EN MÉMOIRE, DISQUE REFUSÉ, FICHIER ABÎMÉ : pas de secret gardé (un par processus)", () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    assert.equal(secretDuPoste("memoire", poste), null);
    assert.ok(!existsSync(path.join(poste, "data")), "rien d'écrit pour une base en mémoire");
    writeFileSync(poste, "");
    assert.equal(secretDuPoste(undefined, poste), null, "un fichier à la place du dossier");
    const autre = path.join(racine, `poste${(n += 1)}`);
    mkdirSync(path.join(autre, "data"), { recursive: true });
    writeFileSync(path.join(autre, "data", "base.secret"), "abîmé\n");
    assert.equal(secretDuPoste(undefined, autre), null);
    assert.equal(
      readFileSync(path.join(autre, "data", "base.secret"), "utf8"),
      "abîmé\n",
      "jamais écrasé",
    );
  });
});

describe("base du poste : coupure de courant", () => {
  it("PARAMÈTRES : « -F » (fsync coupé) retiré, fsync rétabli, le WAL forcé par fsync, sans suivi du démarrage", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    assert.ok(PGlite.defaultStartParams.includes("-F"), "PGLite coupe fsync par défaut");
    const p = parametresDurables(PGlite.defaultStartParams);
    assert.ok(!p.includes("-F"));
    assert.deepEqual(p.slice(-6), [
      "-c",
      "fsync=on",
      "-c",
      "wal_sync_method=fsync",
      "-c",
      "log_startup_progress_interval=0",
    ]);
    assert.deepEqual(
      p.slice(0, -6),
      PGlite.defaultStartParams.filter((x) => x !== "-F"),
    );
  });

  it("VRAI FSYNC : base neuve forcée en entier, chaque validation et les dossiers passent par le fsync de Node", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const dossier = path.join(racine, `poste${(n += 1)}`, "data", "base");
    mkdirSync(path.dirname(dossier), { recursive: true });
    await compterFsync(async (appels) => {
      const pg = await ouvrirPgliteDurable(PGlite, NodeFS, dossier, {});
      try {
        const neuve = { ...appels };
        assert.ok(neuve.fichiers >= 500, `base neuve : ${neuve.fichiers} fichiers forcés`);
        assert.deepEqual((await pg.query("show fsync")).rows, [{ fsync: "on" }]);
        assert.deepEqual((await pg.query("show wal_sync_method")).rows, [{ wal_sync_method: "fsync" }]);
        await pg.exec("create table t (i int)");
        const avant = { ...appels };
        for (let i = 0; i < 5; i++) await pg.query("insert into t values ($1)", [i]);
        assert.ok(appels.fichiers - avant.fichiers >= 5, `${appels.fichiers - avant.fichiers} fsync pour 5 validations`);
        const avantPoint = { ...appels };
        await pg.exec("checkpoint");
        // Mesuré : le CHECKPOINT force aussi 6 dossiers (sauf sous Windows, sans fsync de dossier).
        if (process.platform !== "win32") {
          assert.ok(appels.dossiers - avantPoint.dossiers >= 1, `${appels.dossiers - avantPoint.dossiers} dossiers forcés au CHECKPOINT`);
        }
      } finally {
        await pg.close();
      }
    });
  });

  it(
    "WINDOWS : forcer un fichier ouvert en lecture seule est refusé (EPERM) — d'où l'ouverture en lecture-écriture",
    { skip: process.platform !== "win32" && "Windows seulement" },
    () => {
      const f = path.join(racine, "lecture-seule");
      writeFileSync(f, "x");
      const fd = fs.openSync(f, "r");
      try {
        assert.throws(() => fs.fsyncSync(fd), { code: "EPERM" });
      } finally {
        fs.closeSync(fd);
      }
    },
  );

  it("POSTMASTER.PID VIDE (coupure pendant son écriture) : retiré, la base s'ouvre ; PGLite seul refusait", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const dossier = path.join(racine, `poste${(n += 1)}`, "data", "base");
    mkdirSync(path.dirname(dossier), { recursive: true });
    let pg = await ouvrirPgliteDurable(PGlite, NodeFS, dossier, {});
    await pg.exec("create table t (i int); insert into t values (7)");
    await pg.close();
    writeFileSync(path.join(dossier, "postmaster.pid"), "");
    const brut = new PGlite({ dataDir: dossier });
    await assert.rejects(brut.waitReady, "PGLite seul : « lock file is empty »");
    writeFileSync(path.join(dossier, "postmaster.pid"), "");
    pg = await ouvrirPgliteDurable(PGlite, NodeFS, dossier, {});
    try {
      assert.deepEqual((await pg.query("select i from t")).rows, [{ i: 7 }]);
    } finally {
      await pg.close();
    }
  });
});

describe("base du poste : écritures doublées, copies à chaud, reprise", () => {
  const nouveauPoste = () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    const data = path.join(poste, "data");
    mkdirSync(data, { recursive: true });
    return { poste, dossier: path.join(data, "base"), copies: path.join(data, "copies"), registres: data };
  };
  /** Ouvre comme le serveur : vrai fsync, écritures doublées dans `copies`. */
  const ouvrirAvecCopies = (copies?: string) => async (dossier?: string) => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    if (!dossier) throw new Error("base sur disque attendue");
    return ouvrirPgliteDurable(PGlite, NodeFS, dossier, {}, copies);
  };
  /** Les lignes de t, lues sur une copie des fichiers (jamais sur l'original). */
  const lignes = async (dossier: string) => {
    const lue = `${dossier}-lue`;
    rmSync(lue, { recursive: true, force: true });
    fs.cpSync(dossier, lue, { recursive: true });
    const pg = await ouvrirAvecCopies()(lue);
    const r = (await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i);
    await pg.close();
    return r;
  };
  const de = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const inserer = async (pg: { query(s: string, p: unknown[]): Promise<unknown> }, a: number, b: number) => {
    for (let i = a; i <= b; i++) await pg.query("insert into t values ($1)", [i]);
  };
  const abimer = (dossier: string) => {
    rmSync(`${dossier}.verrou`, { force: true }); // le serveur s'est arrêté
    rmSync(path.join(dossier, "global", "pg_control"));
  };
  const REPRISE =
    /^Base illisible au démarrage \(could not open file "global\/pg_control": No such file or directory\) : reprise de la copie du \d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d \(heure du poste\), puis des écritures doublées qui l'ont suivie ; la base illisible est gardée dans /;

  it("ÉCRITURES DOUBLÉES : chaque validation refaite octet pour octet dans copies/ecritures, et forcée avant d'être confirmée", async () => {
    const { dossier, copies } = nouveauPoste();
    const pg = await ouvrirAvecCopies(copies)(dossier);
    try {
      await pg.exec("create table t (i int)");
      const { nom } = (await pg.query<{ nom: string }>("select pg_walfile_name(pg_current_wal_lsn()) as nom")).rows[0]!;
      const doublee = path.join(copies, "ecritures", nom);
      const ino = statSync(doublee).ino;
      const vrai = fs.fsyncSync;
      let forcees = 0;
      fs.fsyncSync = (fd) => {
        if (fs.fstatSync(fd).ino === ino) forcees += 1;
        vrai(fd);
      };
      syncBuiltinESMExports();
      try {
        await inserer(pg, 1, 5);
      } finally {
        fs.fsyncSync = vrai;
        syncBuiltinESMExports();
      }
      assert.ok(forcees >= 5, `${forcees} fsync de la copie pour 5 validations`);
      const { fin } = (
        await pg.query<{ fin: number }>(
          "select file_offset as fin from pg_walfile_name_offset(pg_current_wal_flush_lsn())",
        )
      ).rows[0]!;
      const original = readFileSync(path.join(dossier, "pg_wal", nom)).subarray(0, fin);
      assert.ok(fin > 0 && original.equals(readFileSync(doublee).subarray(0, fin)), "mêmes octets");
    } finally {
      await pg.close();
    }
  });

  it("COPIE À CHAUD : une validation pendant la copie n'attend pas ; la copie s'ouvre seule, registres joints, sans postmaster.pid", async () => {
    const { dossier, copies, registres } = nouveauPoste();
    writeFileSync(path.join(registres, "drones.json"), "[]");
    const pg = await ouvrirAvecCopies(copies)(dossier);
    try {
      await pg.exec("create table t (i int primary key)");
      await inserer(pg, 1, 10);
      const promesses = fs.promises as unknown as { cp: (...a: unknown[]) => Promise<void> };
      const vraiCp = promesses.cp;
      let sansAttendre: boolean | null = null;
      promesses.cp = async (...a) => {
        // Sous un verrou, cette validation attendrait la fin de la copie : 2 s au plus.
        sansAttendre = await Promise.race([
          pg.query("insert into t values (11)").then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
        ]);
        await vraiCp(...a);
      };
      syncBuiltinESMExports();
      try {
        assert.ok((await copierBase(pg, dossier, copies, "jour-essai", registres)) >= 0);
      } finally {
        promesses.cp = vraiCp;
        syncBuiltinESMExports();
      }
      assert.equal(sansAttendre, true, "une validation pendant la copie n'attend pas");
      const copie = path.join(copies, "jour-essai");
      assert.ok(existsSync(path.join(copie, "base", "backup_label")));
      assert.ok(!existsSync(path.join(copie, "base", "postmaster.pid")));
      assert.equal(readFileSync(path.join(copie, "fichiers", "drones.json"), "utf8"), "[]");
      assert.deepEqual(await lignes(path.join(copie, "base")), de(1, 11));
    } finally {
      await pg.close();
    }
  });

  it("UNE COPIE PAR JOUR, toutes gardées : faite si celle du jour manque, pas refaite ensuite", async () => {
    const { dossier, copies, registres } = nouveauPoste();
    const pg = await ouvrirAvecCopies(copies)(dossier);
    try {
      await pg.exec("create table t (i int)");
      await copierBase(pg, dossier, copies, "jour-2000-01-01", registres);
      await programmerCopies(pg, dossier, copies, registres);
      const jour = path.join(copies, `jour-${jourPoste(Date.now())}`, "base", "backup_label");
      const avant = statSync(jour).mtimeMs;
      await programmerCopies(pg, dossier, copies, registres);
      assert.equal(statSync(jour).mtimeMs, avant, "pas refaite le même jour");
      assert.ok(existsSync(path.join(copies, "jour-2000-01-01", "base", "backup_label")), "l'ancienne gardée");
    } finally {
      await pg.close();
    }
  });

  it("COPIE INACHEVÉE (serveur arrêté en pleine copie) : ni comptée dans la Division, ni essayée à la reprise", async () => {
    const { dossier, copies, registres } = nouveauPoste();
    const pg = await ouvrirAvecCopies(copies)(dossier);
    try {
      await pg.exec("create table t (i int)");
      await copierBase(pg, dossier, copies, "jour-1", registres);
      fs.cpSync(path.join(copies, "jour-1"), path.join(copies, "jour-2.part"), { recursive: true });
      const e = await etatCopies(copies);
      assert.equal(e.nombre, 1);
    } finally {
      await pg.close();
    }
  });

  it("REPRISE SANS PERTE : base illisible mise de côté, la copie la plus récente puis les écritures doublées — tout revient ; une entrée au journal", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 20);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    await inserer(pg, 21, 40);
    await pg.close();
    abimer(dossier);

    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      const e = etatBase();
      assert.ok(e?.mode === "disque" && e.reprise, JSON.stringify(e));
      assert.match(e.reprise, REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 40), "rien de perdu");
      const cote = readdirSync(path.join(poste, "data")).filter((x) => x.startsWith("base.illisible-"));
      assert.equal(cote.length, 1);
      assert.ok(e.reprise.endsWith(path.join(poste, "data", cote[0]!)));
      assert.ok(existsSync(path.join(poste, "data", cote[0]!, "PG_VERSION")), "l'illisible gardée telle quelle");
      await pg.exec(`create table ops_log (id text primary key, user_id text not null, actor text not null,
        role text not null, team text not null, kind text not null, title text not null,
        detail text not null, track_id text, severity text not null default 'info',
        created_at timestamptz not null default now())`);
      (globalThis as { __afriRepriseNotee?: boolean }).__afriRepriseNotee = undefined;
      await noterReprise(pg);
      await noterReprise(pg);
      assert.deepEqual(
        (await pg.query<{ kind: string; severity: string }>("select kind, severity from ops_log")).rows,
        [{ kind: "base", severity: "crit" }],
        "notée une fois",
      );
    } finally {
      await pg.close();
    }
  });

  it("LA COPIE LA PLUS RÉCENTE ILLISIBLE elle aussi : la précédente, puis les écritures doublées — rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 10);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    await inserer(pg, 11, 20);
    await copierBase(pg, dossier, copies, "jour-2", registres);
    await inserer(pg, 21, 30);
    await pg.close();
    rmSync(path.join(copies, "jour-2", "base", "global", "pg_control"));
    abimer(dossier);

    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 30));
    } finally {
      await pg.close();
    }
  });

  it("UNE COPIE ILLISIBLE ESSAYÉE (son journal perdu) : refusée, sans rien laisser derrière — ni minuterie de Postgres, ni ~180 Mo gardés", async () => {
    const { dossier, copies, registres } = nouveauPoste();
    const pg = await ouvrirAvecCopies(copies)(dossier);
    try {
      await pg.exec("create table t (i int)");
      await copierBase(pg, dossier, copies, "jour-1", registres);
    } finally {
      await pg.close();
    }
    const wal = path.join(copies, "jour-1", "base", "pg_wal");
    for (const f of readdirSync(wal)) if (/^[0-9A-F]{24}$/.test(f)) rmSync(path.join(wal, f));
    const minuteries = () => process.getActiveResourcesInfo().filter((x) => x === "Timeout").length;
    const avant = minuteries();
    await assert.rejects(ouvrirAvecCopies()(path.dirname(wal)), /could not locate required checkpoint record/);
    assert.equal(minuteries(), avant, "rien ne garde le Postgres raté en vie");
  });

  it("BASE ABSENTE (dossier effacé, disque du poste remplacé), SES COPIES LÀ : reprise de la copie et des écritures doublées — pas une base vierge par-dessus, rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 10);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    await inserer(pg, 11, 20);
    await pg.close();
    rmSync(`${dossier}.verrou`);
    rmSync(dossier, { recursive: true });
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match(
        (etatBase() as { reprise?: string }).reprise ?? "",
        /^Base absente au démarrage : reprise de la copie du .+ \(heure du poste\), puis des écritures doublées qui l'ont suivie$/,
      );
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 20));
      assert.equal(readdirSync(path.join(poste, "data")).filter((x) => x.startsWith("base.illisible-")).length, 0);
      await pg.exec(`create table ops_log (id text primary key, user_id text not null, actor text not null,
        role text not null, team text not null, kind text not null, title text not null,
        detail text not null, track_id text, severity text not null default 'info',
        created_at timestamptz not null default now())`);
      (globalThis as { __afriRepriseNotee?: boolean }).__afriRepriseNotee = undefined;
      await noterReprise(pg);
      assert.deepEqual((await pg.query<{ title: string }>("select title from ops_log")).rows, [
        { title: "Base absente au démarrage : le poste l'a reprise" },
      ]);
    } finally {
      await pg.close();
    }
  });

  it("BASE NEUVE FAUTE DE COPIE LISIBLE : l'ancienne génération (copies, écritures doublées) rangée dans copies/avant-…, jamais réécrite ; la nouvelle a sa copie du jour aussitôt", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    const jour = `jour-${jourPoste(Date.now())}`;
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 10);
    await copierBase(pg, dossier, copies, jour, registres);
    await inserer(pg, 11, 20);
    await pg.close();
    const empreinte = (d: string) =>
      Object.fromEntries(
        readdirSync(d)
          .sort()
          .map((f) => [f, createHash("sha256").update(readFileSync(path.join(d, f))).digest("hex")]),
      );
    const ecritures = empreinte(path.join(copies, "ecritures"));
    rmSync(path.join(copies, jour, "base", "global", "pg_control")); // la seule copie, illisible
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match(
        (etatBase() as { reprise?: string }).reprise ?? "",
        /: base neuve, aucune copie lisible ; l'ancienne génération \(copies, écritures doublées\) est rangée dans .+avant-.+ ; la base illisible est gardée dans /,
      );
      const rangees = readdirSync(copies).filter((x) => x.startsWith("avant-"));
      assert.equal(rangees.length, 1);
      const avant = path.join(copies, rangees[0]!);
      await pg.exec("create table t (i int primary key)");
      await inserer(pg, 100, 140);
      assert.deepEqual(empreinte(path.join(avant, "ecritures")), ecritures, "jamais réécrites");
      assert.ok(existsSync(path.join(avant, jour, "base", "backup_label")), "l'ancienne copie rangée");
      await programmerCopies(pg, dossier, copies, registres);
      assert.ok(existsSync(path.join(copies, jour, "base", "backup_label")), "la copie du jour de la nouvelle");
    } finally {
      await pg.close();
    }
  });

  it("SANS COPIE : base neuve, et dit ; l'illisible gardée", async () => {
    const { poste, dossier, copies } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int)");
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      const e = etatBase();
      assert.ok(e?.mode === "disque" && /: base neuve, sans copie ; /.test(e.reprise ?? ""), JSON.stringify(e));
      await pg.exec("create table t (i int)");
      assert.equal(readdirSync(path.join(poste, "data")).filter((x) => x.startsWith("base.illisible-")).length, 1);
    } finally {
      await pg.close();
    }
  });

  it("ÉCRITURES DOUBLÉES EN DÉFAUT (clé des copies retirée, disque plein) : la base continue, le défaut est dit ; la copie suivante les remet en route — rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 5);
    await copierBase(pg, dossier, copies, "jour-0", registres);
    // La clé des copies retirée : plus de dossier des écritures doublées.
    const doublees = path.join(copies, "ecritures");
    fs.renameSync(doublees, `${doublees}-retiree`);
    writeFileSync(doublees, "");
    await inserer(pg, 6, 10);
    assert.ok(defautsCopies().some((d) => d.quoi === "écritures doublées de la base"), "le défaut est dit");
    // Un autre segment du journal pendant la panne : jour-0 et les écritures doublées ont désormais
    // un trou ; seule la copie suivante, la plus récente, rend tout.
    await pg.query("select pg_switch_wal()");
    await inserer(pg, 11, 15);
    // La clé remise : la copie suivante remet le doublement en route.
    rmSync(doublees);
    fs.renameSync(`${doublees}-retiree`, doublees);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    assert.equal(defautsCopies().find((d) => d.quoi === "écritures doublées de la base"), undefined, "remises en route");
    await inserer(pg, 16, 20);
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 20));
    } finally {
      await pg.close();
    }
  });

  it("ÉCRITURES DOUBLÉES ABÎMÉES PENDANT L'ARRÊT (un segment effacé) : complétées à l'ouverture — rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 10);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    await inserer(pg, 11, 20);
    const { nom } = (await pg.query<{ nom: string }>("select pg_walfile_name(pg_current_wal_lsn()) as nom")).rows[0]!;
    await pg.close();
    rmSync(`${dossier}.verrou`);
    rmSync(path.join(copies, "ecritures", nom));
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await inserer(pg, 21, 30);
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 30));
    } finally {
      await pg.close();
    }
  });

  it("JOURNAL DE LA BASE ABÎMÉ PENDANT L'ARRÊT, là où elle n'en a plus besoin : elle s'ouvre, et ses écritures doublées saines ne sont pas écrasées — rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 10);
    await copierBase(pg, dossier, copies, "jour-1", registres);
    const lsn = async () =>
      (await pg.query<{ nom: string; o: number }>(
        "select pg_walfile_name(pg_current_wal_lsn()) as nom, (pg_current_wal_lsn() - '0/0'::pg_lsn)::bigint % 16777216 as o",
      )).rows[0]!;
    const a = await lsn();
    await pg.query("insert into t select generate_series(11, 2000)");
    const b = await lsn();
    assert.equal(a.nom, b.nom);
    await pg.close();
    rmSync(`${dossier}.verrou`);
    // Un secteur du disque de la base perdu : des pages pleines du journal, loin de sa fin.
    const page = 8192;
    const debut = (Math.floor(Number(a.o) / page) + 1) * page;
    const fin = (Math.floor(Number(b.o) / page) - 1) * page;
    assert.ok(fin - debut >= 4 * page, `${fin - debut} octets abîmés`);
    const fd = fs.openSync(path.join(dossier, "pg_wal", a.nom), "r+");
    fs.writeSync(fd, Buffer.alloc(fin - debut), 0, fin - debut, debut);
    fs.closeSync(fd);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    assert.equal((etatBase() as { reprise?: string }).reprise, undefined, "elle s'ouvre, sans reprise");
    await inserer(pg, 2001, 2005);
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 2005));
    } finally {
      await pg.close();
    }
  });

  it("PANNE EN PLEIN SEGMENT, PUIS ARRÊT AVANT LA COPIE SUIVANTE : le marqueur fait tout recopier à l'ouverture — rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await inserer(pg, 1, 5);
    await copierBase(pg, dossier, copies, "jour-0", registres);
    await inserer(pg, 6, 6);
    const { nom } = (await pg.query<{ nom: string }>("select pg_walfile_name(pg_current_wal_lsn()) as nom")).rows[0]!;
    const ino = statSync(path.join(copies, "ecritures", nom)).ino;
    const vrai = fs.writeSync;
    fs.writeSync = ((fd: number, ...a: unknown[]) => {
      if (fs.fstatSync(fd).ino === ino) throw Object.assign(new Error("ENOSPC: plus de place"), { code: "ENOSPC" });
      return (vrai as (...x: unknown[]) => number)(fd, ...a);
    }) as typeof fs.writeSync;
    syncBuiltinESMExports();
    try {
      // Des pages entières du journal pendant la panne : Postgres ne les réécrira plus, seul le
      // marqueur les fait recopier (une ou deux lignes tenaient dans une page réécrite ensuite).
      await pg.query("insert into t select generate_series(7, 2000)");
    } finally {
      fs.writeSync = vrai;
      syncBuiltinESMExports();
    }
    await pg.close();
    rmSync(`${dossier}.verrou`);
    const marqueur = `${dossier}.ecritures-en-panne`;
    assert.ok(existsSync(marqueur), "la panne survit à l'arrêt");
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    assert.ok(!existsSync(marqueur), "tout recopié à l'ouverture");
    await inserer(pg, 2001, 2005);
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 2005));
    } finally {
      await pg.close();
    }
  });
  it("CLÉ DES COPIES RETIRÉE PUIS REMISE LE MÊME JOUR : une copie de remise en route est prise sans attendre le lendemain — les écritures doublées repartent, rien de perdu", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await programmerCopies(pg, dossier, copies, registres); // la copie du jour
    fs.renameSync(copies, `${copies}-cle`); // la clé retirée : plus de dossier des copies
    writeFileSync(copies, "");
    await inserer(pg, 1, 10);
    await pg.query("select pg_switch_wal()");
    await inserer(pg, 11, 20);
    await programmerCopies(pg, dossier, copies, registres); // clé encore absente : rien de neuf
    rmSync(copies);
    fs.renameSync(`${copies}-cle`, copies);
    await programmerCopies(pg, dossier, copies, registres); // le contrôle des 5 min
    assert.equal(readdirSync(copies).filter((x) => x.startsWith("remise-")).length, 1, "une copie de remise en route");
    assert.equal(defautsCopies().find((d) => d.quoi === "écritures doublées de la base"), undefined);
    await inserer(pg, 21, 30);
    await pg.close();
    abimer(dossier);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      assert.match((etatBase() as { reprise?: string }).reprise ?? "", REPRISE);
      assert.deepEqual((await pg.query<{ i: number }>("select i from t order by i")).rows.map((x) => x.i), de(1, 30));
    } finally {
      await pg.close();
    }
  });

  it("PANNE PUIS ARRÊT, CLÉ REMISE AVANT LE REDÉMARRAGE : à l'ouverture le journal est recopié, puis une copie de remise en route aussitôt, même si celle du jour existe", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    let pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    await pg.exec("create table t (i int primary key)");
    await programmerCopies(pg, dossier, copies, registres);
    fs.renameSync(copies, `${copies}-cle`);
    writeFileSync(copies, "");
    await inserer(pg, 1, 10);
    await pg.close();
    rmSync(`${dossier}.verrou`);
    rmSync(copies);
    fs.renameSync(`${copies}-cle`, copies);
    pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      await programmerCopies(pg, dossier, copies, registres);
      assert.equal(readdirSync(copies).filter((x) => x.startsWith("remise-")).length, 1);
      await programmerCopies(pg, dossier, copies, registres);
      assert.equal(readdirSync(copies).filter((x) => x.startsWith("remise-")).length, 1, "une seule");
    } finally {
      await pg.close();
    }
  });
  it("DOSSIER DES ÉCRITURES DOUBLÉES CASSÉ, LE RESTE DES COPIES SAIN : la panne est dite, et pas une copie entière à chaque contrôle", async () => {
    const { poste, dossier, copies, registres } = nouveauPoste();
    const pg = await ouvrirBase(ouvrirAvecCopies(copies), undefined, poste);
    try {
      await pg.exec("create table t (i int primary key)");
      await programmerCopies(pg, dossier, copies, registres);
      const doublees = path.join(copies, "ecritures");
      rmSync(doublees, { recursive: true });
      writeFileSync(doublees, "");
      await inserer(pg, 1, 5);
      for (let k = 0; k < 3; k++) await programmerCopies(pg, dossier, copies, registres);
      assert.equal(readdirSync(copies).filter((x) => x.startsWith("remise-")).length, 0);
      assert.ok(defautsCopies().some((d) => d.quoi === "écritures doublées de la base"));
    } finally {
      await pg.close();
    }
  });
});
