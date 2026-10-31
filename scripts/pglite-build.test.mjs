import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./with-app-env.mjs";

// Sans DATABASE_URL, le poste tourne sur PGLite, qui charge au démarrage des fichiers posés À CÔTÉ
// de son module (new URL("./pglite.data", import.meta.url)). Fondu dans le bundle serveur, il les
// cherchait dans .output/server/_libs/ où rien ne les copiait : en production, la base ne démarrait
// pas et chaque appel au journal, au quart ou aux registres échouait, pendant que l'écran affichait
// un quart « vacant ». Ces tests gardent les deux moitiés du contrat.

const PGLITE = "@electric-sql/pglite";
const FICHIERS_DE_DEMARRAGE = ["pglite.data", "pglite.wasm", "initdb.wasm"];

function moduleDePglite() {
  const pkg = JSON.parse(
    readFileSync(join(projectRoot(), "node_modules", PGLITE, "package.json"), "utf8"),
  );
  const entree = pkg.exports?.["."]?.import?.default ?? pkg.exports?.["."]?.import ?? pkg.module;
  assert.equal(typeof entree, "string", "point d'entrée ESM de PGLite introuvable");
  return join(projectRoot(), "node_modules", PGLITE, entree);
}

test("PGLite charge ses fichiers de démarrage depuis le dossier de son propre module", () => {
  const entree = moduleDePglite();
  const code = readFileSync(entree, "utf8");
  for (const fichier of FICHIERS_DE_DEMARRAGE) {
    assert.ok(
      code.includes(`new URL("./${fichier}",import.meta.url)`) ||
        code.includes(`new URL("${fichier}",import.meta.url)`),
      `${fichier} n'est plus chargé à côté du module : revoir le traçage de PGLite`,
    );
    assert.ok(existsSync(join(dirname(entree), fichier)), `${fichier} absent du paquet`);
  }
});

test("le build serveur livre PGLite comme paquet tracé, avec ses fichiers", () => {
  const config = readFileSync(join(projectRoot(), "vite.config.ts"), "utf8");
  const trace = config.match(/traceDeps:\s*\[([^\]]*)\]/);
  assert.ok(trace, "traceDeps absent de la configuration Nitro");
  assert.match(trace[1], /["']@electric-sql\/pglite\*?["']/);
});
