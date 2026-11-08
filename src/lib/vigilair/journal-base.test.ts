import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import {
  effacerDuJournal,
  genresDuJournal,
  GENRE_EFFACEMENT,
  pageDuJournal,
} from "./journal-base.ts";

// La vraie base : PGLite en mémoire, avec les migrations du poste.
let pg: PGlite;
let sql: Sql;

before(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  pg = new PGlite({ parsers: { 20: Number } });
  await pg.waitReady;
  const dossier = path.join(import.meta.dirname, "..", "..", "..", "migrations");
  for (const f of readdirSync(dossier)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await pg.exec(readFileSync(path.join(dossier, f), "utf8"));
  }
  const run = async <T>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows;
  sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0]!;
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as Sql;
  sql.query = (text: string, params: unknown[] = []) => run(text, params);
});

/** Le journal d'une journée : [id, agent, genre, heure]. Deux entrées à la même microseconde. */
const JOURNEE: [string, string, string, string][] = [
  ["e1", "chef", "releve", "2026-11-08 06:00:00+00"],
  ["e2", "agent1", "login", "2026-11-08 07:00:00+00"],
  ["e3", "chef", "recherche", "2026-11-08 08:00:00+00"],
  ["e4", "agent1", "recherche", "2026-11-08 09:00:00.123456+00"],
  ["e5", "chef", "recherche", "2026-11-08 09:00:00.123456+00"],
  ["e6", "agent1", "registre", "2026-11-08 10:00:00+00"],
  ["e7", "chef", GENRE_EFFACEMENT, "2026-11-08 11:00:00+00"],
];

beforeEach(async () => {
  await pg.exec("delete from ops_log; delete from security_incidents;");
  for (const [id, qui, genre, at] of JOURNEE) {
    await pg.query(
      `insert into ops_log (id, user_id, actor, role, team, kind, title, detail, created_at)
       values ($1, $2, $2, 'operateur', 'cop', $3, $3, '', $4)`,
      [id, qui, genre, at],
    );
  }
  await pg.query(
    `insert into security_incidents (id, actor, kind, title, detail, work_recap) values ('i1', 'agent1', 'copy', 'copie', '', '')`,
  );
});

const ids = (p: { entrees: { id: string }[] }) => p.entrees.map((e) => e.id);
const tous = { userId: null, genre: null, avant: null };

describe("journal : lu par pages, des plus récentes aux plus anciennes", () => {
  it("PAGES : ni trou ni doublon, même à la même microseconde ; plus de suite à la fin", async () => {
    const p1 = await pageDuJournal(sql, { ...tous, limite: 3 });
    assert.deepEqual(ids(p1), ["e7", "e6", "e5"]);
    const p2 = await pageDuJournal(sql, { ...tous, avant: p1.suite, limite: 3 });
    assert.deepEqual(ids(p2), ["e4", "e3", "e2"]);
    const p3 = await pageDuJournal(sql, { ...tous, avant: p2.suite, limite: 3 });
    assert.deepEqual(ids(p3), ["e1"]);
    assert.equal(p3.suite, null);
    const juste = await pageDuJournal(sql, { ...tous, limite: 7 });
    assert.equal(juste.entrees.length, 7);
    assert.equal(juste.suite, null, "pile 7 : pas de page vide à demander");
  });

  it("FILTRES : un agent, un genre, ou les deux", async () => {
    assert.deepEqual(ids(await pageDuJournal(sql, { ...tous, userId: "agent1", limite: 10 })), [
      "e6",
      "e4",
      "e2",
    ]);
    assert.deepEqual(ids(await pageDuJournal(sql, { ...tous, genre: "recherche", limite: 10 })), [
      "e5",
      "e4",
      "e3",
    ]);
    assert.deepEqual(
      ids(await pageDuJournal(sql, { ...tous, userId: "chef", genre: "recherche", limite: 10 })),
      ["e5", "e3"],
    );
    const p = await pageDuJournal(sql, { ...tous, genre: "recherche", limite: 1 });
    assert.deepEqual(
      ids(await pageDuJournal(sql, { ...tous, genre: "recherche", avant: p.suite, limite: 5 })),
      ["e4", "e3"],
    );
  });

  it("GENRES : combien de chaque", async () => {
    assert.deepEqual(await genresDuJournal(sql), [
      { genre: "recherche", n: 3 },
      { genre: GENRE_EFFACEMENT, n: 1 },
      { genre: "login", n: 1 },
      { genre: "registre", n: 1 },
      { genre: "releve", n: 1 },
    ]);
  });
});

describe("journal : effacé par le chef", () => {
  it("UNE ENTRÉE : elle seule ; ce qui a été retiré est dit (combien, genre, heure)", async () => {
    assert.deepEqual(await effacerDuJournal(sql, { id: "e4" }), {
      n: 1,
      genre: "recherche",
      de: "2026-11-08 09:00:00.123456+00",
      a: "2026-11-08 09:00:00.123456+00",
    });
    assert.deepEqual(ids(await pageDuJournal(sql, { ...tous, limite: 10 })), [
      "e7",
      "e6",
      "e5",
      "e3",
      "e2",
      "e1",
    ]);
  });

  it("UN GENRE : toutes ses entrées, de la première à la dernière ; les autres restent", async () => {
    assert.deepEqual(await effacerDuJournal(sql, { genre: "recherche" }), {
      n: 3,
      genre: "recherche",
      de: "2026-11-08 08:00:00+00",
      a: "2026-11-08 09:00:00.123456+00",
    });
    assert.deepEqual(ids(await pageDuJournal(sql, { ...tous, limite: 10 })), [
      "e7",
      "e6",
      "e2",
      "e1",
    ]);
  });

  it("JAMAIS UNE TRACE D'EFFACEMENT, ni une à une ni par genre ; rien d'inconnu", async () => {
    const rien = { n: 0, genre: null, de: null, a: null };
    assert.deepEqual(await effacerDuJournal(sql, { id: "e7" }), rien);
    assert.deepEqual(await effacerDuJournal(sql, { genre: GENRE_EFFACEMENT }), rien);
    assert.deepEqual(await effacerDuJournal(sql, { id: "inconnu" }), rien);
    assert.equal((await pageDuJournal(sql, { ...tous, limite: 10 })).entrees.length, 7);
  });

  it("SANS CIBLE : refusé, rien n'est effacé — une requête vide n'efface pas tout le journal", async () => {
    for (const cible of [{}, { id: "" }, { genre: "" }] as never[]) {
      await assert.rejects(effacerDuJournal(sql, cible), /sans cible/);
    }
    assert.equal((await pageDuJournal(sql, { ...tous, limite: 10 })).entrees.length, 7);
  });

  it("LES PREUVES CHAÎNÉES restent : un incident de sécurité n'est pas une entrée du journal", async () => {
    await effacerDuJournal(sql, { genre: "login" });
    await effacerDuJournal(sql, { genre: "registre" });
    assert.deepEqual((await pg.query("select id from security_incidents")).rows, [{ id: "i1" }]);
  });
});
