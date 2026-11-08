import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
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
  programmerSauvegardes,
  sauvegarder,
  secretDuPoste,
} from "./base-poste.server.ts";

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
  it("PARAMÈTRES : « -F » (fsync coupé) retiré, fsync rétabli, le WAL forcé par fsync", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    assert.ok(PGlite.defaultStartParams.includes("-F"), "PGLite coupe fsync par défaut");
    const p = parametresDurables(PGlite.defaultStartParams);
    assert.ok(!p.includes("-F"));
    assert.deepEqual(p.slice(-4), ["-c", "fsync=on", "-c", "wal_sync_method=fsync"]);
    assert.deepEqual(
      p.slice(0, -4),
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

describe("base du poste : sauvegarde et reprise", () => {
  const ouvrirDurable = async (dossier?: string) => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    if (!dossier) throw new Error("base sur disque attendue");
    return ouvrirPgliteDurable(PGlite, NodeFS, dossier, {});
  };
  const lignes = async (dossier: string) => {
    const copie = `${dossier}-lue`;
    rmSync(copie, { recursive: true, force: true });
    (await import("node:fs")).cpSync(dossier, copie, { recursive: true });
    const pg = await ouvrirDurable(copie);
    const r = (await pg.query<{ v: string }>("select v from t order by v")).rows.map((x) => x.v);
    await pg.close();
    return r;
  };

  it("SAUVEGARDE : copie lisible, sans postmaster.pid, remplacée à la suivante ; programmée seulement si vieille d'un jour", async () => {
    const dossier = path.join(racine, `poste${(n += 1)}`, "data", "base");
    mkdirSync(path.dirname(dossier), { recursive: true });
    const pg = await ouvrirDurable(dossier);
    try {
      await pg.exec("create table t (v text); insert into t values ('un')");
      await programmerSauvegardes(pg, dossier);
      const sauvegarde = `${dossier}.sauvegarde`;
      assert.ok(!existsSync(path.join(sauvegarde, "postmaster.pid")));
      assert.deepEqual(await lignes(sauvegarde), ["un"]);
      const avant = statSync(sauvegarde).mtimeMs;
      await pg.exec("insert into t values ('deux')");
      await programmerSauvegardes(pg, dossier);
      assert.equal(statSync(sauvegarde).mtimeMs, avant, "moins d'un jour : pas refaite");
      const lsn = (await pg.query<{ l: string }>("select pg_current_wal_lsn()::text as l")).rows[0]!.l;
      const forces = await compterFsync(async () => {
        const r = await sauvegarder(pg, dossier);
        assert.ok(r.ms >= r.attenteMs && r.attenteMs >= 0, JSON.stringify(r));
      });
      assert.ok(forces.fichiers >= 500, `sauvegarde forcée sur le disque : ${forces.fichiers} fichiers`);
      // Sur un disque dur (5 à 10 ms par fsync), 1 000 fsync synchrones figeraient le serveur 5 à
      // 10 s ; sur ce disque-ci, trop peu pour le voir au minuteur : on vérifie la façon.
      assert.ok(forces.asynchrones >= 500, `${forces.asynchrones} fsync sans figer le serveur`);
      const point = await pg.query<{ ok: boolean }>(
        "select redo_lsn >= $1::pg_lsn as ok from pg_control_checkpoint()",
        [lsn],
      );
      assert.deepEqual(point.rows, [{ ok: true }], "un CHECKPOINT avant la copie : rien d'avant à rejouer");
      assert.deepEqual(await lignes(sauvegarde), ["deux", "un"]);
      assert.ok(!existsSync(`${sauvegarde}.part`));
    } finally {
      await pg.close();
    }
  });

  it("SANS FIGER LE SERVEUR : la copie se fait sous le verrou des requêtes — une requête lancée pendant la copie l'attend — et le serveur tourne", async () => {
    const dossier = path.join(racine, `poste${(n += 1)}`, "data", "base");
    mkdirSync(path.dirname(dossier), { recursive: true });
    const pg = await ouvrirDurable(dossier);
    await pg.exec("create table t (v text); insert into t values ('un')");
    const promesses = fs.promises as unknown as { cp: (...a: unknown[]) => Promise<void> };
    const vraiCp = promesses.cp;
    let requete: Promise<boolean> | null = null;
    let copieFaite = false;
    promesses.cp = async (...a) => {
      // Sans le verrou, la requête finirait pendant ces 100 ms.
      requete = pg.query("select 1").then(() => copieFaite);
      await new Promise((r) => setTimeout(r, 100));
      await vraiCp(...a);
      copieFaite = true;
    };
    syncBuiltinESMExports();
    // Le plus grand retard d'un minuteur de 5 ms : le plus long gel de tout le serveur.
    let prevu = performance.now() + 5;
    let gel = 0;
    const minuteur = setInterval(() => {
      const t = performance.now();
      gel = Math.max(gel, t - prevu);
      prevu = t + 5;
    }, 5);
    try {
      const r = await sauvegarder(pg, dossier);
      assert.equal(await requete, true, "la requête lancée pendant la copie a attendu sa fin");
      assert.ok(r.attenteMs >= 100, JSON.stringify(r));
      assert.ok(gel < r.ms / 4, `serveur figé ${gel.toFixed(0)} ms pendant une sauvegarde de ${r.ms} ms`);
    } finally {
      clearInterval(minuteur);
      promesses.cp = vraiCp;
      syncBuiltinESMExports();
      await pg.close();
    }
    assert.deepEqual(await lignes(`${dossier}.sauvegarde`), ["un"]);
  });

  it("REPRISE : base illisible → sa sauvegarde reprise, l'illisible gardée à côté, une entrée au journal ; sans sauvegarde, base neuve", async () => {
    const poste = path.join(racine, `poste${(n += 1)}`);
    const dossier = path.join(poste, "data", "base");
    let pg = await ouvrirBase(ouvrirDurable, undefined, poste);
    await pg.exec("create table t (v text); insert into t values ('avant la sauvegarde')");
    await sauvegarder(pg, dossier);
    await pg.exec("insert into t values ('après la sauvegarde')");
    await pg.close();
    rmSync(`${dossier}.verrou`); // le serveur s'arrête
    rmSync(path.join(dossier, "global", "pg_control")); // base abîmée

    pg = await ouvrirBase(ouvrirDurable, undefined, poste);
    try {
      const e = etatBase();
      assert.ok(e?.mode === "disque" && e.reprise, JSON.stringify(e));
      // La raison écrite par Postgres, que PGLite taisait (« Aborted() »).
      assert.match(
        e.reprise,
        /^Base illisible au démarrage \(could not open file "global\/pg_control": No such file or directory\) : reprise de la sauvegarde du \d\d\/\d\d\/\d{4} /,
      );
      const cote = readdirSync(path.join(poste, "data")).filter((x) => x.startsWith("base.illisible-"));
      assert.equal(cote.length, 1);
      assert.ok(e.reprise.endsWith(path.join(poste, "data", cote[0]!)));
      assert.ok(existsSync(path.join(poste, "data", cote[0]!, "PG_VERSION")), "l'illisible gardée telle quelle");
      assert.deepEqual((await pg.query<{ v: string }>("select v from t")).rows, [{ v: "avant la sauvegarde" }]);
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

    rmSync(`${dossier}.verrou`);
    rmSync(`${dossier}.sauvegarde`, { recursive: true });
    rmSync(path.join(dossier, "global", "pg_control"));
    pg = await ouvrirBase(ouvrirDurable, undefined, poste);
    try {
      const e = etatBase();
      assert.ok(e?.mode === "disque" && /: base neuve, sans sauvegarde ; /.test(e.reprise ?? ""), JSON.stringify(e));
      await pg.exec("create table t (v text)");
      assert.equal(readdirSync(path.join(poste, "data")).filter((x) => x.startsWith("base.illisible-")).length, 2);
    } finally {
      await pg.close();
    }
  });
});
