import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { ouvrirPgliteDurable } from "./base-poste.server.ts";

// Coupure de courant simulée : seul ce qu'un fsync a forcé survit (garantie POSIX, pire cas : le
// système n'a rien écrit en tâche de fond). On intercepte le module fs de Node, dont se sert le
// NODEFS de PGLite : chaque écriture sous la base est notée en attente, un fsync la verse dans une
// copie « durable » — le disque d'après coupure. Les noms (création, renommage, suppression) sont
// pris comme durables aussitôt : hypothèse favorable. Le modèle est vérifié à chaque coupure :
// copie durable + écritures en attente = les vrais fichiers.

type Op = { pos: number; octets: Buffer } | { taille: number };
type Fs = Record<string, (...a: never[]) => unknown>;

function disqueDurable(reel: string, durable: string) {
  fs.rmSync(durable, { recursive: true, force: true });
  fs.cpSync(reel, durable, { recursive: true });
  const sous = (p: unknown) => typeof p === "string" && path.resolve(p).startsWith(reel + path.sep);
  const ombre = (p: string) => path.join(durable, path.relative(reel, path.resolve(p)));
  const chemins = new Map<number, string>();
  const attente = new Map<string, Op[]>();
  const f = fs as unknown as Fs;
  const noms = ["openSync", "writeSync", "ftruncateSync", "truncateSync", "fsyncSync", "fdatasyncSync", "closeSync", "renameSync", "unlinkSync", "mkdirSync"];
  const o: Fs = Object.fromEntries(noms.map((nom) => [nom, f[nom]!]));
  const appel = <R>(nom: string, args: unknown[]) => (o[nom] as (...a: unknown[]) => R).apply(fs, args);
  const noter = (p: string, op: Op) => attente.set(p, [...(attente.get(p) ?? []), op]);
  let ecritures = 0;
  let fsyncs = 0;
  let surEcriture: (rang: number) => void = () => undefined;

  const verser = (p: string) => {
    const ops = attente.get(p) ?? [];
    if (!ops.length) return;
    fs.mkdirSync(path.dirname(ombre(p)), { recursive: true });
    const fd = appel<number>("openSync", [ombre(p), fs.existsSync(ombre(p)) ? "r+" : "w+"]);
    for (const op of ops) {
      if ("taille" in op) appel("ftruncateSync", [fd, op.taille]);
      else appel("writeSync", [fd, op.octets, 0, op.octets.length, op.pos]);
    }
    appel("closeSync", [fd]);
    attente.set(p, []);
  };

  const remplacer = (nom: string, g: (...a: unknown[]) => unknown) => {
    f[nom] = g as Fs[string];
  };
  remplacer("openSync", (...a) => {
    const fd = appel<number>("openSync", a);
    const [p, flags] = a;
    if (sous(p)) {
      const r = path.resolve(p as string);
      chemins.set(fd, r);
      if (!fs.existsSync(ombre(r)) && fs.statSync(r).isFile()) {
        fs.mkdirSync(path.dirname(ombre(r)), { recursive: true });
        fs.closeSync(appel<number>("openSync", [ombre(r), "w"]));
      }
      const tronque = typeof flags === "number" ? flags & fs.constants.O_TRUNC : String(flags).startsWith("w");
      if (tronque) noter(r, { taille: 0 });
    }
    return fd;
  });
  remplacer("writeSync", (...a) => {
    const [fd, buffer, offset, length, position] = a as [number, ArrayBufferView, number, number, number];
    const p = chemins.get(fd);
    if (!p) return appel("writeSync", a);
    assert.equal(typeof position, "number", `écriture sans position sur ${p}`);
    noter(p, { pos: position, octets: Buffer.from(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length)) });
    const r = appel("writeSync", a);
    ecritures += 1;
    surEcriture(ecritures);
    return r;
  });
  remplacer("ftruncateSync", (...a) => {
    const p = chemins.get(a[0] as number);
    if (p) noter(p, { taille: (a[1] as number) ?? 0 });
    return appel("ftruncateSync", a);
  });
  remplacer("truncateSync", (...a) => {
    if (sous(a[0])) noter(path.resolve(a[0] as string), { taille: (a[1] as number) ?? 0 });
    return appel("truncateSync", a);
  });
  for (const nom of ["fsyncSync", "fdatasyncSync"]) {
    remplacer(nom, (...a) => {
      const r = appel(nom, a);
      const p = chemins.get(a[0] as number);
      if (p && fs.statSync(p).isFile()) {
        verser(p);
        fsyncs += 1;
      }
      return r;
    });
  }
  remplacer("closeSync", (...a) => {
    chemins.delete(a[0] as number);
    return appel("closeSync", a);
  });
  remplacer("renameSync", (...a) => {
    const r = appel("renameSync", a);
    const [x, y] = a as [string, string];
    if (sous(x) && sous(y)) {
      if (fs.existsSync(ombre(x))) appel("renameSync", [ombre(x), ombre(y)]);
      attente.set(path.resolve(y), attente.get(path.resolve(x)) ?? []);
      attente.delete(path.resolve(x));
      for (const [fd, p] of chemins) if (p === path.resolve(x)) chemins.set(fd, path.resolve(y));
    }
    return r;
  });
  remplacer("unlinkSync", (...a) => {
    const r = appel("unlinkSync", a);
    if (sous(a[0])) {
      fs.rmSync(ombre(a[0] as string), { force: true });
      attente.delete(path.resolve(a[0] as string));
    }
    return r;
  });
  remplacer("mkdirSync", (...a) => {
    const r = appel("mkdirSync", a);
    if (sous(a[0])) appel("mkdirSync", [ombre(a[0] as string), { recursive: true }]);
    return r;
  });
  syncBuiltinESMExports();

  return {
    stats: () => ({ ecritures, fsyncs }),
    surChaqueEcriture(g: (rang: number) => void) {
      surEcriture = g;
    },
    /** Les fichiers dont copie durable + attente ne redonne pas le vrai contenu. */
    ecarts(): string[] {
      const faux: string[] = [];
      const parcourir = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const r = path.join(d, e.name);
          if (e.isDirectory()) parcourir(r);
          else if (e.isFile()) {
            let m = fs.existsSync(ombre(r)) ? Buffer.from(fs.readFileSync(ombre(r))) : Buffer.alloc(0);
            for (const op of attente.get(r) ?? []) {
              const fin = "taille" in op ? op.taille : Math.max(m.length, op.pos + op.octets.length);
              const b = Buffer.alloc(fin);
              m.copy(b, 0, 0, Math.min(fin, m.length));
              if (!("taille" in op)) op.octets.copy(b, op.pos);
              m = b;
            }
            if (!m.equals(fs.readFileSync(r))) faux.push(path.relative(reel, r));
          }
        }
      };
      parcourir(reel);
      return faux;
    },
    coupure(dest: string) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(durable, dest, { recursive: true });
    },
    retirer() {
      for (const nom of noms) f[nom] = o[nom]!;
      syncBuiltinESMExports();
    },
  };
}

type Pg = {
  query<T>(sql: string, p?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};
type Ouvrir = (dossier: string) => Promise<Pg>;

const racine = fs.mkdtempSync(path.join(tmpdir(), "base-coupure-"));
after(() => fs.rmSync(racine, { recursive: true, force: true }));

/**
 * Une base écrite et fermée (le système a eu le temps de tout poser), puis `n` validations
 * confirmées une à une, CHECKPOINT au milieu, coupures aux écritures `aEcriture` et après les
 * validations `aValidation`. Chaque disque d'après coupure est rouvert par `ouvrir`.
 */
async function essai(
  nom: string,
  ouvrir: Ouvrir,
  n: number,
  aEcriture: number[],
  aValidation: number[],
): Promise<{ verdicts: string[]; ecarts: number; fsyncs: number }> {
  const travail = path.join(racine, nom);
  const base = path.join(travail, "base");
  fs.mkdirSync(travail, { recursive: true });
  let pg = await ouvrir(base);
  await pg.exec("create table t (i int primary key, txt text not null)");
  await pg.query("insert into t select g, 'avant' from generate_series(-10, -1) g");
  await pg.close();

  const disque = disqueDurable(base, path.join(travail, "durable"));
  const coupures: { nom: string; dest: string; confirmees: number }[] = [];
  let confirmees = 0;
  let ecarts = 0;
  const couper = (quand: string) => {
    ecarts += disque.ecarts().length;
    const dest = path.join(travail, `coupure-${coupures.length}`);
    disque.coupure(dest);
    coupures.push({ nom: quand, dest, confirmees });
  };
  disque.surChaqueEcriture((rang) => {
    if (aEcriture.includes(rang)) couper(`écriture n° ${rang}`);
  });
  try {
    pg = await ouvrir(base);
    for (let i = 1; i <= n; i++) {
      await pg.query("insert into t values ($1, $2)", [i, `ligne ${i} `.repeat(20)]);
      confirmees = i;
      if (i === Math.floor(n / 2)) {
        await pg.exec("checkpoint");
        couper(`après un CHECKPOINT (${i} confirmées)`);
      }
      if (aValidation.includes(i)) couper(`après la validation n° ${i}`);
    }
    await pg.close();
  } finally {
    disque.retirer();
  }
  const verdicts: string[] = [];
  for (const c of coupures) {
    let v: string;
    try {
      const p = await ouvrir(c.dest);
      const r = (await p.query<{ n: number; max: number }>(
        "select count(*)::int as n, coalesce(max(i), 0)::int as max from t where i > 0",
      )).rows[0]!;
      const avant = (await p.query<{ n: number }>("select count(*)::int as n from t where i < 0")).rows[0]!.n;
      await p.close();
      v = r.n >= c.confirmees && r.max === r.n && avant === 10 ? "sans perte" : `PERTE (${r.n}/${c.confirmees}, ${avant}/10)`;
    } catch {
      v = "ILLISIBLE";
    }
    verdicts.push(`${c.nom} : ${v}`);
  }
  return { verdicts, ecarts, fsyncs: disque.stats().fsyncs };
}

describe("base du poste : coupure de courant simulée", () => {
  it("TÉMOIN — PGLite tel qu'il était (fsync coupé) : la coupure abîme la base", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const ouvrir: Ouvrir = async (dossier) => {
      const pg = new PGlite({ dataDir: dossier });
      await pg.waitReady;
      return pg as unknown as Pg;
    };
    const r = await essai("temoin", ouvrir, 6, [], [5]);
    assert.equal(r.fsyncs, 0, "aucun fsync");
    assert.deepEqual(r.verdicts.filter((v) => v.endsWith("sans perte")), [], r.verdicts.join(" ; "));
  });

  it("LE POSTE (vrai fsync) : coupé au démarrage, en pleine écriture, après validation, après CHECKPOINT — rien de confirmé perdu", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const ouvrir: Ouvrir = async (dossier) =>
      (await ouvrirPgliteDurable(PGlite, NodeFS, dossier, {})) as unknown as Pg;
    const r = await essai("poste", ouvrir, 24, [1, 2, 37], [6, 24]);
    assert.equal(r.ecarts, 0, "le modèle colle aux vrais fichiers");
    assert.ok(r.fsyncs >= 24, `${r.fsyncs} fsync pour 24 validations`);
    assert.equal(r.verdicts.length, 6, r.verdicts.join(" ; "));
    for (const v of r.verdicts) assert.ok(v.endsWith("sans perte"), v);
  });
});
