// Les deux scripts de préparation du poste (Linux et Windows) doivent rester d'accord entre eux, avec
// le serveur qui lit poste.env et avec l'écran Division où l'on colle l'adresse du relais Signal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const SH = readFileSync(join(ICI, "preparer-poste.sh"), "utf8");
const PS1_OCTETS = readFileSync(join(ICI, "preparer-poste.ps1"));
const PS1 = PS1_OCTETS.toString("utf8");

function sources(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [readFileSync(chemin, "utf8")] : [];
  });
}
const SERVEUR = sources(join(RACINE, "src")).join("\n");

const clesSh = [...SH.matchAll(/^\s*regler (AFRICONTROL_[A-Z_]+) /gm)].map((m) => m[1]).sort();
const clesPs1 = [...PS1.matchAll(/^\s*Regler "(AFRICONTROL_[A-Z_]+)" /gm)].map((m) => m[1]).sort();

test("poste.env : les deux scripts écrivent les mêmes clés, et le serveur les lit toutes", () => {
  assert.deepEqual(clesSh, ["AFRICONTROL_IA", "AFRICONTROL_IA_MODELE", "AFRICONTROL_ITINERAIRE"]);
  assert.deepEqual(clesPs1, clesSh);
  for (const cle of clesSh) assert.ok(SERVEUR.includes(`"${cle}"`), `${cle} n'est lue nulle part`);
});

test("mêmes images Docker, mêmes ports, liés au seul poste (127.0.0.1)", () => {
  const image = (texte, motif) => texte.match(motif)?.[1];
  assert.equal(image(PS1, /\$OsrmImage = "([^"]+)"/), image(SH, /^OSRM_IMAGE=(\S+)/m));
  assert.equal(image(PS1, /\$SignalImage = "([^"]+)"/), image(SH, /^SIGNAL_IMAGE=(\S+)/m));
  for (const texte of [SH, PS1]) {
    assert.ok(texte.includes("-p 127.0.0.1:5810:5000"), "OSRM sur 127.0.0.1:5810");
    assert.ok(texte.includes("-p 127.0.0.1:8085:8080"), "relais Signal sur 127.0.0.1:8085");
    assert.ok(texte.includes("AFRICONTROL_ITINERAIRE") && texte.includes("http://127.0.0.1:5810"));
  }
});

test("relais Signal : l'adresse donnée par les scripts est celle que Division attend", () => {
  const division = readFileSync(join(RACINE, "src/components/vigilair/division-view.tsx"), "utf8");
  const attendue = division.match(
    /placeholder="(http:\/\/127\.0\.0\.1:8085\/v2\/send\?[^"]+)"/,
  )?.[1];
  assert.ok(attendue, "exemple d'adresse du relais dans Division");
  const debut = attendue.split("?")[0];
  for (const texte of [SH, PS1]) {
    const donnee = texte.match(
      /(http:\/\/127\.0\.0\.1:8085\/v2\/send\?number=\S+&recipients=\S+)"/,
    )?.[1];
    assert.ok(donnee?.startsWith(`${debut}?number=+235`), donnee);
  }
});

test("relief : les noms de tuiles des scripts sont ceux que le serveur lit", () => {
  const motif = SERVEUR.match(/const NOM_TUILE = \/(.+)\/;/)?.[1];
  assert.ok(motif, "motif des tuiles dans geo-poste.server.ts");
  const nomServeur = new RegExp(motif);
  const nomSh = (ns, lat, ew, lon) =>
    `Copernicus_DSM_COG_30_${ns}${String(lat).padStart(2, "0")}_00_${ew}${String(lon).padStart(3, "0")}_00_DEM`;
  // Le format printf du script Linux et le format -f du script Windows, appliqués à FTTJ et à un
  // degré carré de l'hémisphère sud-ouest.
  assert.ok(SH.includes("'Copernicus_DSM_COG_30_%s%02d_00_%s%03d_00_DEM'"));
  assert.ok(PS1.includes('"Copernicus_DSM_COG_30_{0}{1:D2}_00_{2}{3:D3}_00_DEM"'));
  // Un degré carré sur chaque continent habité : le format des deux scripts doit produire un nom
  // que le serveur accepte, où que ce soit sur Terre.
  const partout = [
    nomSh("N", 12, "E", 15), // Tchad (Afrique)
    nomSh("N", 45, "E", 6), // Alpes (Europe)
    nomSh("N", 27, "E", 86), // Himalaya (Asie)
    nomSh("N", 39, "W", 107), // Rocheuses (Amérique du Nord)
    nomSh("S", 14, "W", 73), // Andes (Amérique du Sud)
    nomSh("S", 34, "E", 150), // Sydney (Océanie)
  ];
  for (const nom of partout) assert.match(`${nom}.tif`, nomServeur);
  // Défaut Tchad quand aucune zone n'est passée, dans les deux scripts.
  assert.ok(SH.includes('ZONES=("7,23,13,23")'), "défaut Tchad côté Linux");
  assert.ok(PS1.includes('$Zone = @("7,23,13,23")'), "défaut Tchad côté Windows");
});

test("relief multi-continents : --zone est répétable, avec un garde-fou sur les gros lots", () => {
  // Linux : --zone accumule dans un tableau ; Windows : -Zone est un tableau de chaînes.
  assert.ok(/--zone\) ZONES\+=\(/.test(SH), "--zone répétable côté Linux");
  assert.ok(/\[string\[\]\]\$Zone/.test(PS1), "-Zone en tableau côté Windows");
  // Les deux dédupliquent les tuiles (deux zones qui se chevauchent n'en téléchargent pas deux).
  assert.ok(/declare -A a_prendre/.test(SH), "déduplication côté Linux");
  assert.ok(/HashSet\[string\]/.test(PS1), "déduplication côté Windows");
  // Garde-fou : au-delà de 2000 tuiles, on prévient avant de lancer des dizaines de Go.
  assert.ok(SH.includes("2000") && PS1.includes("2000"), "garde-fou sur un très gros lot");
});

test("script Windows en UTF-8 avec BOM : sans lui, PowerShell 5.1 lit les accents de travers", () => {
  assert.deepEqual([...PS1_OCTETS.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("script Linux : syntaxe bash valide", () => {
  const r = spawnSync("bash", ["-n", join(ICI, "preparer-poste.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
