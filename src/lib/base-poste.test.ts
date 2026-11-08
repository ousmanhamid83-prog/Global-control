import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import {
  choisirBase,
  etatBase,
  ouvrirBase,
  prendreBase,
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
    // Le verrou d'un serveur disparu : pid vivant (le nôtre, repris), port fermé.
    const dossier = avecVerrou(JSON.stringify({ pid: process.pid, port, jeton: "a".repeat(32) }));
    const p = await prendreBase(dossier, 2000);
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
