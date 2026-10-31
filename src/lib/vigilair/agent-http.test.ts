import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UA_POSTE } from "./agent-http.ts";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

test("UA : nomme le logiciel, ne dit ni la mission, ni le lieu, ni l'opérateur", () => {
  assert.match(UA_POSTE, /^AfriControl\/\d+$/);
  assert.doesNotMatch(
    UA_POSTE,
    /uas|drone|d[ée]tection|djamena|fttj|tchad|chad|\bcop\b|milit|op[ée]rat|tiles|read-only/i,
  );
});

test("UA : aucun module n'écrit son propre User-Agent en dur", () => {
  const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  assert.ok(sources.length > 50, `sources lues : ${sources.length}`);
  const enDur: string[] = [];
  for (const f of sources) {
    readFileSync(join(SRC, f), "utf8")
      .split("\n")
      .forEach((ligne, i) => {
        if (/["']?user-agent["']?\s*:\s*["'`]/i.test(ligne)) enDur.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(enDur, [], "chaque requête sortante passe par UA_POSTE");
});
