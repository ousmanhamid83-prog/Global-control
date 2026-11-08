// Le serveur construit contient PLUSIEURS copies d'un même module : les fonctions serveur sont
// découpées dans un module à part, le plugin de démarrage en a une autre, et ce qu'importent les
// commandes, l'agent et la relève une troisième. Un état gardé en variable de module existait donc
// en double : le relevé remplissait le sien, les autres lisaient le leur, toujours vide. Mesuré en
// ligne : METAR FTTJ à la console, « non reçu » à /meteo. L'état vit maintenant sur globalThis —
// relevé, bascules des commandes, bot Signal (un seul bot doit écouter), décision du chef sur le
// relevé Internet, base du poste ; ces tests gardent la règle.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./with-app-env.mjs";

const SERVEUR = join(projectRoot(), ".output", "server");

/** Module serveur à état partagé → sa clé sur globalThis, et une fonction qui le signe au build. */
const MODULES = [
  ["src/lib/vigilair/live-feeds.ts", "__afriReleve", "function peekLiveCache"],
  ["src/lib/vigilair/commandes-poste.server.ts", "__afriCommandes", "function lireBascules"],
  ["src/lib/vigilair/bot-signal.server.ts", "__afriBot", "function assurerBot"],
  ["src/lib/vigilair/releve-internet.server.ts", "__afriReleveInternet", "function noterOrdre"],
  ["src/lib/base-poste.server.ts", "__afriBase", "function etatBase"],
];

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : nom.endsWith(".mjs") ? [chemin] : [];
  });
}

for (const [module, cle] of MODULES) {
  test(`${module} : aucune variable de module (let) — l'état est sur globalThis.${cle}`, () => {
    const source = readFileSync(join(projectRoot(), module), "utf8");
    assert.deepEqual(source.match(/^let .*$/gm) ?? [], []);
    assert.ok(source.includes(cle), `état partagé ${cle}`);
  });
}

test(
  "serveur construit : chaque copie de ces modules lit l'état partagé",
  { skip: !existsSync(SERVEUR) && "pas de serveur construit (.output)" },
  () => {
    const codes = fichiers(SERVEUR).map((f) => readFileSync(f, "utf8"));
    for (const [module, cle, signature] of MODULES) {
      const copies = codes.filter((code) => code.includes(signature));
      assert.ok(copies.length >= 1, `${module} introuvable dans le serveur construit`);
      for (const code of copies) assert.ok(code.includes(cle), `${module} : une copie lit un état à elle`);
    }
  },
);
