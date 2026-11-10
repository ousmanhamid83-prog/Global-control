// Les deux scripts de préparation du poste (Linux et Windows) doivent rester d'accord entre eux, avec
// le serveur qui lit poste.env et avec l'écran Division où l'on colle l'adresse du relais Signal.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

const cles = (texte, motif) => [...new Set([...texte.matchAll(motif)].map((m) => m[1]))].sort();
const clesSh = cles(SH, /^\s*regler (AFRICONTROL_[A-Z0-9_]+) /gm);
const clesPs1 = cles(PS1, /^\s*Regler "(AFRICONTROL_[A-Z0-9_]+)" /gm);

test("poste.env : les deux scripts écrivent les mêmes clés, et le serveur les lit toutes", () => {
  assert.deepEqual(clesSh, [
    "AFRICONTROL_1090",
    "AFRICONTROL_ANTENNE",
    "AFRICONTROL_ATC",
    "AFRICONTROL_COPIES",
    "AFRICONTROL_IA",
    "AFRICONTROL_IA_MODELE",
    "AFRICONTROL_ITINERAIRE",
    "AFRICONTROL_RECHERCHE",
  ]);
  assert.deepEqual(clesPs1, clesSh);
  for (const cle of clesSh) assert.ok(SERVEUR.includes(`"${cle}"`), `${cle} n'est lue nulle part`);
});

test("mêmes images Docker, mêmes ports, liés au seul poste (127.0.0.1)", () => {
  const image = (texte, motif) => texte.match(motif)?.[1];
  assert.equal(image(PS1, /\$OsrmImage = "([^"]+)"/), image(SH, /^OSRM_IMAGE=(\S+)/m));
  assert.equal(image(PS1, /\$SignalImage = "([^"]+)"/), image(SH, /^SIGNAL_IMAGE=(\S+)/m));
  assert.equal(image(PS1, /\$SearxngImage = "([^"]+)"/), image(SH, /^SEARXNG_IMAGE=(\S+)/m));
  assert.match(image(SH, /^SEARXNG_IMAGE=(\S+)/m), /^searxng\/searxng:\d{4}\.\d+\.\d+-[0-9a-f]+$/);
  for (const texte of [SH, PS1]) {
    assert.ok(texte.includes("-p 127.0.0.1:5810:5000"), "OSRM sur 127.0.0.1:5810");
    assert.ok(texte.includes("-p 127.0.0.1:8085:8080"), "relais Signal sur 127.0.0.1:8085");
    assert.ok(texte.includes("-p 127.0.0.1:8888:8080"), "moteur de recherche sur 127.0.0.1:8888");
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

test("recherche : JSON activé, clé du moteur gardée, /recherche laissée désactivée", () => {
  for (const texte of [SH, PS1]) {
    assert.ok(texte.includes("use_default_settings: true"), "réglages par défaut de SearXNG");
    assert.ok(/- json/.test(texte), "format JSON activé (sinon 403)");
    assert.ok(texte.includes("limiter: false"), "pas de limiteur : seul le poste l'interroge");
    assert.ok(
      texte.includes("search?q=test&format=json"),
      "essai en JSON, pas seulement « en vie »",
    );
    assert.ok(texte.includes("/recherche reste désactivée"), "le bilan le dit");
    assert.ok(texte.includes("-e GRANIAN_HOST=0.0.0.0"), "IPv4 : l'image plante sans IPv6");
  }
  // Écrit une seule fois : relancer ne change pas la clé.
  assert.ok(/if \[ ! -f data\/searxng\/settings\.yml \]/.test(SH));
  assert.ok(/if \(-not \(Test-Path \$reglages\)\)/.test(PS1));
  // Le serveur lit bien ce que le script écrit, et sur le réseau du poste seulement.
  assert.ok(SERVEUR.includes('env("AFRICONTROL_RECHERCHE")'));
});

test("script Windows en UTF-8 avec BOM : sans lui, PowerShell 5.1 lit les accents de travers", () => {
  assert.deepEqual([...PS1_OCTETS.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("script Linux : syntaxe bash valide", () => {
  const r = spawnSync("bash", ["-n", join(ICI, "preparer-poste.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("imagerie : les deux scripts confient tout au même script de mosaïque, zones répétables", () => {
  for (const texte of [SH, PS1]) {
    assert.ok(texte.includes("node scripts/poste/imagerie-poste.mjs"), "même script de mosaïque");
    assert.ok(
      texte.includes("https://shapps.dataspace.copernicus.eu/dashboard/#/account/settings"),
      "même marche à suivre pour le compte Copernicus",
    );
  }
  assert.ok(
    /--zone-imagerie\) IMAGERIE=1; ZONES_IMAGERIE\+=\(/.test(SH),
    "--zone-imagerie répétable",
  );
  assert.ok(/\[string\[\]\]\$ZoneImagerie/.test(PS1), "-ZoneImagerie en tableau côté Windows");
  // Les identifiants restent à l'opérateur : aucun script ne les écrit dans poste.env (voir aussi
  // le test des clés écrites, plus haut).
  assert.ok(!/regler AFRICONTROL_SENTINEL|Regler "AFRICONTROL_SENTINEL/.test(SH + PS1));
});

test("copies du poste : un autre disque interne que le sien, choisi seul sous Windows comme sous Linux", () => {
  assert.ok(/--copies\) COPIES=\$\{2:\?/.test(SH), "--copies côté Linux");
  assert.ok(PS1.includes('[string]$Copies = ""'), "-Copies côté Windows");
  // Windows : le plus de place libre sur un autre disque INTERNE — jamais une clé USB, qui part
  // avec celui qui l'emporte ; un autre volume du même disque ne compte pas.
  assert.ok(PS1.includes('BusType)" -eq "USB"') && PS1.includes("$d -eq $disque"));
  assert.ok(SH.includes('"${transport:-}" = usb') && SH.includes('[ "$amovible" != 0 ]'));
  // Les deux le disent quand les copies restent sur le disque du poste.
  for (const texte of [SH, PS1]) assert.ok(texte.includes("sa panne emporterait les deux"));
});

test("script Linux --copies : réglé dans poste.env, gardé ensuite, refusé s'il est impossible", async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  // Un poste à part : le script écrit poste.env à sa racine, pas dans ce dépôt.
  const poste = mkdtempSync(join(tmpdir(), "poste-copies-"));
  mkdirSync(join(poste, "scripts", "poste"), { recursive: true });
  copyFileSync(
    join(ICI, "preparer-poste.sh"),
    join(poste, "scripts", "poste", "preparer-poste.sh"),
  );
  const lancer = (...options) =>
    spawnSync(
      "bash",
      [
        join(poste, "scripts", "poste", "preparer-poste.sh"),
        "--sans-build",
        "--sans-ia",
        "--sans-relief",
        ...options,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
  const reglage = () =>
    readFileSync(join(poste, "poste.env"), "utf8").match(/^AFRICONTROL_COPIES=(.*)$/m)?.[1];
  try {
    const copies = join(poste, "autre-disque", "copies");
    let r = lancer("--copies", copies);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(reglage(), copies);
    assert.match(r.stdout, /✓ copies du poste dans /);
    // Ici, le même disque (ou un disque qui ne se lit pas : conteneur) — c'est dit, sans échouer.
    assert.match(r.stdout, /sur le même disque que lui|n'a pas pu être comparé/);
    r = lancer();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /AFRICONTROL_COPIES déjà réglé dans poste\.env \(.+\), gardé/);
    // Sans --copies ni réglage : un autre disque interne choisi seul s'il y en a un, sinon
    // data/copies — et c'est dit.
    rmSync(join(poste, "poste.env"));
    r = lancer();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /✓ copies du poste sur un autre disque interne, choisi seul : .+\/AfriControl-copies \(\d+ Go libres\)|✓ copies du poste dans data\/copies \(défaut\)/,
    );
    r = lancer("--copies", copies);
    r = lancer("--copies", "/proc/impossible/copies");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /✗ copies : \/proc\/impossible\/copies impossible à créer/);
    assert.equal(reglage(), copies, "le réglage d'avant reste");
  } finally {
    rmSync(poste, { recursive: true, force: true });
  }
});

test("script Linux --antenne / --recepteur-1090 / --phonie : réglés dans poste.env, le récepteur et le flux essayés, une position fausse refusée", async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { createServer } = await import("node:net");
  const http = await import("node:http");
  const poste = mkdtempSync(join(tmpdir(), "poste-antenne-"));
  mkdirSync(join(poste, "scripts", "poste"), { recursive: true });
  copyFileSync(
    join(ICI, "preparer-poste.sh"),
    join(poste, "scripts", "poste", "preparer-poste.sh"),
  );
  // Un récepteur 1090 qui sert de vraies trames brutes (entendues de 4D2023, l'enregistrement d'une
  // clé RTL-SDR), un autre qui répond sans rien servir, et un flux de phonie, ici sur la machine.
  const vraies = [
    "*8D4D2023586990A3359E5A546080;",
    "*8D4D202399108CAB287014ABB53C;",
    "*5D4D20237A55A6;",
  ];
  const recepteur = createServer((s) => {
    s.on("error", () => undefined); // le script essaie, puis raccroche
    s.end(`${vraies.join("\n")}\n`);
  });
  // Le mauvais port : dump1090 sert sur 30003 ses positions en SBS, pas de trames brutes.
  const sbs = createServer((s) => {
    s.on("error", () => undefined);
    s.end(
      "MSG,3,1,1,4D2023,1,2026/11/10,09:10:00.000,2026/11/10,09:10:00.000,AMC421,20750,,,36.99,13.84,,,0,0,0,0\n",
    );
  });
  // Un vrai récepteur sert sans fin : le script s'arrête à 20 trames, sans attendre 30 s.
  const flot = createServer((s) => {
    s.on("error", () => undefined);
    const minuterie = setInterval(() => s.write(`${vraies.join("\n")}\n`), 20);
    s.on("close", () => clearInterval(minuterie));
  });
  // Arrêté en force en pleine trame (coupure nette, RST).
  const coupe = createServer((s) => {
    s.on("error", () => undefined);
    s.write(`${vraies[0]}\n${vraies[2]}\n*8D4D202399108C`);
    setTimeout(() => s.resetAndDestroy(), 300);
  });
  const flux = http.createServer((_, r) => {
    r.writeHead(200, { "content-type": "audio/mpeg" });
    r.write(Buffer.alloc(4096));
  });
  await new Promise((r) => recepteur.listen(0, "127.0.0.1", r));
  await new Promise((r) => sbs.listen(0, "127.0.0.1", r));
  await new Promise((r) => flot.listen(0, "127.0.0.1", r));
  await new Promise((r) => coupe.listen(0, "127.0.0.1", r));
  await new Promise((r) => flux.listen(0, "127.0.0.1", r));
  const portR = recepteur.address().port;
  const portF = flux.address().port;
  const lancer = (...options) =>
    new Promise((fini) => {
      const p = spawn(
        "bash",
        [
          join(poste, "scripts", "poste", "preparer-poste.sh"),
          "--sans-build",
          "--sans-ia",
          "--sans-relief",
          "--copies",
          join(poste, "copies"),
          ...options,
        ],
        { env: { PATH: process.env.PATH } },
      );
      let sortie = "";
      p.stdout.on("data", (d) => (sortie += d));
      p.stderr.on("data", (d) => (sortie += d));
      p.on("close", (code) => fini({ code, sortie }));
    });
  const env = () => readFileSync(join(poste, "poste.env"), "utf8");
  try {
    let r = await lancer(
      "--antenne",
      "37.5,14.0",
      "--recepteur-1090",
      `127.0.0.1:${portR}`,
      "--phonie",
      `http://127.0.0.1:${portF}/atc.mp3`,
    );
    assert.equal(r.code, 0, r.sortie);
    assert.match(
      r.sortie,
      new RegExp(
        `✓ antenne 1090 : 3 trame\\(s\\) brute\\(s\\) reçue\\(s\\) de 127\\.0\\.0\\.1:${portR} en moins de \\d+ s, antenne à 37\\.5,14\\.0`,
      ),
    );
    assert.match(
      r.sortie,
      /✓ phonie : flux http:\/\/127\.0\.0\.1:\d+\/atc\.mp3 — enregistré à la demande/,
    );
    assert.match(env(), new RegExp(`^AFRICONTROL_1090=127\\.0\\.0\\.1:${portR}$`, "m"));
    assert.match(env(), /^AFRICONTROL_ANTENNE=37\.5,14\.0$/m);
    assert.match(
      env(),
      new RegExp(`^AFRICONTROL_ATC=http://127\\.0\\.0\\.1:${portF}/atc\\.mp3$`, "m"),
    );
    // Un vrai récepteur sert sans fin : 20 trames comptées, sans attendre les 30 s.
    r = await lancer(
      "--antenne",
      "37.5,14.0",
      "--recepteur-1090",
      `127.0.0.1:${flot.address().port}`,
    );
    assert.equal(r.code, 0, r.sortie);
    const [, n, secondes] =
      /✓ antenne 1090 : (\d+) trame\(s\) brute\(s\) reçue\(s\) de 127\.0\.0\.1:\d+ en moins de (\d+) s/.exec(
        r.sortie,
      ) ?? [];
    assert.equal(n, "20", r.sortie);
    assert.ok(Number(secondes) < 10, `${secondes} s`);
    // Coupé net en pleine trame : les deux trames entières comptées, pas la moitié de la troisième.
    r = await lancer(
      "--antenne",
      "37.5,14.0",
      "--recepteur-1090",
      `127.0.0.1:${coupe.address().port}`,
    );
    assert.equal(r.code, 0, r.sortie);
    assert.match(
      r.sortie,
      /✓ antenne 1090 : 2 trame\(s\) brute\(s\) reçue\(s\) de 127\.0\.0\.1:\d+ en/,
    );
    // Le port SBS au lieu des trames brutes : il répond, rien n'est compté, c'est dit.
    r = await lancer(
      "--antenne",
      "37.5,14.0",
      "--recepteur-1090",
      `127.0.0.1:${sbs.address().port}`,
    );
    assert.equal(r.code, 0, r.sortie);
    assert.match(
      r.sortie,
      /Antenne 1090 : 127\.0\.0\.1:\d+ répond mais n'a servi aucune trame brute en 30 s — le port des trames brutes \(30002 pour dump1090\) \?/,
    );
    assert.doesNotMatch(r.sortie, /✓ antenne 1090/);
    // Rien n'écoute : réglé quand même, et dit — le poste s'y raccroche seul.
    recepteur.close();
    flux.close();
    flux.closeAllConnections();
    r = await lancer(
      "--antenne",
      "12.1331,15.0339",
      "--recepteur-1090",
      `127.0.0.1:${portR}`,
      "--phonie",
      `http://127.0.0.1:${portF}/atc.mp3`,
    );
    assert.equal(r.code, 0, r.sortie);
    assert.match(
      r.sortie,
      /Antenne 1090 : rien n'écoute encore sur 127\.0\.0\.1:\d+ — le poste s'y raccroche seul/,
    );
    assert.match(r.sortie, /Phonie ATC : http:\/\/127\.0\.0\.1:\d+\/atc\.mp3 ne répond pas encore/);
    assert.match(env(), /^AFRICONTROL_ANTENNE=12\.1331,15\.0339$/m);
    // Une position fausse, une adresse qui n'est pas un flux : refusées, le bilan échoue.
    for (const [options, motif] of [
      [
        ["--antenne", "95,14", "--recepteur-1090", "127.0.0.1:1"],
        /✗ antenne 1090 : --antenne LAT,LON attendu/,
      ],
      [
        ["--antenne", "12,190", "--recepteur-1090", "127.0.0.1:1"],
        /✗ antenne 1090 : --antenne LAT,LON attendu/,
      ],
      [
        ["--antenne", "Ndjamena", "--recepteur-1090", "127.0.0.1:1"],
        /✗ antenne 1090 : --antenne LAT,LON attendu/,
      ],
      [["--phonie", "ftp://ailleurs/atc"], /✗ phonie : --phonie attend une adresse http\(s\):\/\//],
    ]) {
      r = await lancer(...options);
      assert.equal(r.code, 1, r.sortie);
      assert.match(r.sortie, motif);
    }
    assert.match(env(), /^AFRICONTROL_ANTENNE=12\.1331,15\.0339$/m, "le réglage d'avant reste");
  } finally {
    recepteur.close();
    sbs.close();
    flot.close();
    coupe.close();
    flux.close();
    rmSync(poste, { recursive: true, force: true });
  }
});

test("script Linux : la clé radio RTL-SDR reconnue dans /sys (0bda:2832, 0bda:2838), sans lsusb", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const fonction = SH.match(/^cle_rtl_sdr\(\) \{\n[\s\S]*?\n\}$/m)?.[0];
  assert.ok(fonction, "cle_rtl_sdr dans le script");
  const usb = mkdtempSync(join(tmpdir(), "usb-"));
  const branche = (nom, vendeur, produit) => {
    mkdirSync(join(usb, nom), { recursive: true });
    writeFileSync(join(usb, nom, "idVendor"), `${vendeur}\n`);
    writeFileSync(join(usb, nom, "idProduct"), `${produit}\n`);
  };
  const vue = () =>
    spawnSync("bash", ["-c", `${fonction}\ncle_rtl_sdr "$1"`, "essai", usb]).status === 0;
  try {
    branche("1-1", "046d", "c52b"); // une souris
    branche("1-2", "0bda", "8153"); // un autre périphérique Realtek (réseau)
    branche("1-4", "1234", "2838"); // le même numéro de produit, un autre fabricant
    assert.equal(vue(), false, "pas de clé radio");
    branche("1-3", "0bda", "2838");
    assert.equal(vue(), true, "RTL2832U 0bda:2838");
    rmSync(join(usb, "1-3"), { recursive: true });
    branche("2-1", "0bda", "2832");
    assert.equal(vue(), true, "RTL2832U 0bda:2832");
  } finally {
    rmSync(usb, { recursive: true, force: true });
  }
});

// PowerShell 7 si la machine l'a (pwsh, ou PWSH=chemin) ; sinon ces tests sont sautés.
const PWSH = process.env.PWSH ?? "pwsh";
const SANS_PWSH = spawnSync(PWSH, ["-NoProfile", "-Command", "exit 0"]).status !== 0;

test(
  'PowerShell : -Zone "a","b" lancé par -File donne bien deux zones',
  { skip: SANS_PWSH },
  () => {
    // Lancé par « powershell -File », -Zone "a","b" arrive en une seule chaîne de huit nombres :
    // c'est ainsi que le relief multi-zones échouait (« -Zone attend quatre degrés entiers »).
    const essai = [
      '$src = Get-Content -Raw "' + join(ICI, "preparer-poste.ps1") + '"',
      "$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$null, [ref]$null)",
      '$f = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Zones" }, $true)[0]',
      "Invoke-Expression $f.Extent.Text",
      '(Zones @("7,23,13,23,42,48,1,8")) -join " ; "',
      '(Zones @("7,23,13,23", "42,48,1,8")) -join " ; "',
      '(Zones @("11.6,12.7,14.5,15.6")) -join " ; "',
      '$null -eq (Zones @("7,23,13"))',
    ].join("\n");
    const r = spawnSync(PWSH, ["-NoProfile", "-Command", essai], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split(/\r?\n/), [
      "7,23,13,23 ; 42,48,1,8",
      "7,23,13,23 ; 42,48,1,8",
      "11.6,12.7,14.5,15.6",
      "True",
    ]);
  },
);

test(
  "PowerShell : TramesAntenne compte les vraies trames brutes — pas un port ouvert, ni le port SBS",
  { skip: SANS_PWSH },
  async () => {
    const { createServer } = await import("node:net");
    const serveur = (texte) =>
      createServer((s) => {
        s.on("error", () => undefined);
        s.end(texte);
      });
    // De vraies trames brutes entendues de 4D2023, puis le port SBS (positions, pas de trames).
    const vraies = serveur(
      "*8D4D2023586990A3359E5A546080;\r\n*8D4D202399108CAB287014ABB53C;\r\n*5D4D20237A55A6;\r\n",
    );
    const sbs = serveur(
      "MSG,3,1,1,4D2023,1,2026/11/10,09:10:00.000,,,AMC421,20750,,,36.99,13.84\n",
    );
    // Trente trames d'un coup : 20 comptées au plus, comme sous Linux.
    const salve = serveur("*8D4D2023586990A3359E5A546080;\n".repeat(30));
    // Un vrai récepteur sert sans fin : 20 comptées, sans attendre les 30 s.
    const flot = createServer((s) => {
      s.on("error", () => undefined);
      const minuterie = setInterval(() => s.write("*5D4D20237A55A6;\n"), 20);
      s.on("close", () => clearInterval(minuterie));
    });
    // Arrêté en force en pleine trame (coupure nette, RST) : les deux trames entières restent comptées.
    const coupe = createServer((s) => {
      s.on("error", () => undefined);
      s.write("*8D4D2023586990A3359E5A546080;\n*5D4D20237A55A6;\n*8D4D202399108C");
      setTimeout(() => s.resetAndDestroy(), 300);
    });
    // Antenne débranchée : le récepteur accepte et ne sert rien — 0 au bout du délai, sans bloquer.
    const muet = createServer((s) => s.on("error", () => undefined));
    for (const s of [vraies, sbs, salve, flot, coupe, muet]) {
      await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
    }
    const ferme = createServer();
    await new Promise((ok) => ferme.listen(0, "127.0.0.1", ok));
    const portFerme = ferme.address().port;
    await new Promise((ok) => ferme.close(ok));
    try {
      const essai = [
        '$src = Get-Content -Raw "' + join(ICI, "preparer-poste.ps1") + '"',
        "$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$null, [ref]$null)",
        '$f = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "TramesAntenne" }, $true)[0]',
        "Invoke-Expression $f.Extent.Text",
        `TramesAntenne "127.0.0.1" ${vraies.address().port}`,
        `TramesAntenne "127.0.0.1" ${sbs.address().port}`,
        `TramesAntenne "127.0.0.1" ${portFerme}`,
        `TramesAntenne "127.0.0.1" ${salve.address().port}`,
        `TramesAntenne "127.0.0.1" ${flot.address().port}`,
        `TramesAntenne "127.0.0.1" ${coupe.address().port}`,
        `TramesAntenne "127.0.0.1" ${muet.address().port} 2`,
      ].join("\n");
      const debut = Date.now();
      const r = await new Promise((ok) => {
        const p = spawn(PWSH, ["-NoProfile", "-Command", essai]);
        let sortie = "";
        p.stdout.on("data", (d) => (sortie += d));
        p.stderr.on("data", (d) => (sortie += d));
        p.on("close", (code) => ok({ code, sortie }));
      });
      assert.equal(r.code, 0, r.sortie);
      assert.deepEqual(r.sortie.trim().split(/\r?\n/), ["3", "0", "-1", "20", "20", "2", "0"]);
      // Un récepteur qui raccroche est vu aussitôt : pas 30 s d'attente par essai.
      assert.ok(Date.now() - debut < 25_000, `${Date.now() - debut} ms`);
    } finally {
      for (const s of [vraies, sbs, salve, flot, coupe, muet]) s.close();
    }
  },
);

test("script Linux --zone-imagerie : de bout en bout contre un faux compte Copernicus", async () => {
  const { createServer } = await import("node:http");
  const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  // Un poste à part : le script écrit poste.env et data/ à sa racine, jamais dans ce dépôt (lancé
  // ici, il y aurait réglé les copies sur un autre disque de la machine).
  const poste = mkdtempSync(join(tmpdir(), "poste-imagerie-"));
  for (const f of [
    "poste/preparer-poste.sh",
    "poste/imagerie-poste.mjs",
    "poste/imagerie-plan.mjs",
    "sentinel-rendu.mjs",
  ]) {
    mkdirSync(dirname(join(poste, "scripts", f)), { recursive: true });
    copyFileSync(join(ICI, "..", f), join(poste, "scripts", f));
  }
  const srv = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url === "/jeton") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "jeton", expires_in: 3600 }));
        return;
      }
      const jpeg = Buffer.alloc(5000, 7);
      jpeg.set([0xff, 0xd8, 0xff]);
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(jpeg);
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  try {
    const r = await new Promise((ok) => {
      const p = spawn(
        "bash",
        [
          join(poste, "scripts", "poste", "preparer-poste.sh"),
          "--sans-build",
          "--sans-ia",
          "--sans-relief",
        ].concat(["--zone-imagerie", "12.0,12.2,15.0,15.2"]),
        {
          env: {
            PATH: process.env.PATH,
            AFRICONTROL_SENTINEL_ID: "client",
            AFRICONTROL_SENTINEL_SECRET: "secret",
            AFRICONTROL_SENTINEL_TOKEN: `${base}/jeton`,
            AFRICONTROL_SENTINEL_API: `${base}/process`,
            AFRICONTROL_IMAGERIE_TUILES: dossier,
          },
        },
      );
      let sortie = "";
      p.stdout.on("data", (d) => (sortie += d));
      p.stderr.on("data", (d) => (sortie += d));
      p.on("close", (code) => ok({ code, sortie }));
    });
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /✓ imagerie : zooms 8 à 12 : (\d+) tuiles, dont \1 déjà là/);
    const n = Number(r.sortie.match(/zooms 8 à 12 : (\d+) tuiles/)[1]);
    const ecrites = readdirSync(dossier, { recursive: true }).filter((f) =>
      String(f).endsWith(".jpg"),
    );
    assert.equal(ecrites.length, n);
    assert.ok(existsSync(join(poste, "data")), "le script a travaillé dans le poste d'essai");
  } finally {
    await new Promise((ok) => srv.close(ok));
    rmSync(dossier, { recursive: true, force: true });
    rmSync(poste, { recursive: true, force: true });
  }
});
