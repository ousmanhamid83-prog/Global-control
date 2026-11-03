// Le serveur construit contient PLUSIEURS copies de live-feeds : les fonctions serveur sont
// découpées dans un module à part, et ce qu'importent les commandes, l'agent et la relève en est
// une autre. Un état gardé en variable de module existait donc en double : le relevé remplissait
// le sien, les autres lisaient le leur, toujours vide. Mesuré en ligne : METAR FTTJ à la console,
// « non reçu » à /meteo. L'état vit maintenant sur globalThis ; ces tests gardent la règle.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./with-app-env.mjs";

const SOURCE = readFileSync(join(projectRoot(), "src/lib/vigilair/live-feeds.ts"), "utf8");
const SERVEUR = join(projectRoot(), ".output", "server");

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : nom.endsWith(".mjs") ? [chemin] : [];
  });
}

test("live-feeds : aucune variable de module (let) — l'état du relevé est sur globalThis", () => {
  assert.deepEqual(SOURCE.match(/^let .*$/gm) ?? [], []);
  assert.ok(SOURCE.includes("__afriReleve"), "état partagé du relevé");
});

test(
  "serveur construit : chaque copie de peekLiveCache lit l'état partagé",
  { skip: !existsSync(SERVEUR) && "pas de serveur construit (.output)" },
  () => {
    const copies = fichiers(SERVEUR)
      .map((f) => readFileSync(f, "utf8"))
      .filter((code) => code.includes("function peekLiveCache"));
    assert.ok(copies.length >= 1, "peekLiveCache introuvable dans le serveur construit");
    for (const code of copies) assert.ok(code.includes("__afriReleve"), "copie qui lit un état à elle");
  },
);
