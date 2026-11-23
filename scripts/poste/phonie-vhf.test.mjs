// Le pont phonie VHF du poste : ses réglages, la ligne de rtl_fm, et le pont lui-même avec le vrai
// lame et un rtl_fm d'essai (la clé radio manque ici) qui dit et sort ce que dit et sort le vrai.
// Le vrai rtl_fm, quand il est là, sert au cas de la clé absente : c'est sa vraie réponse.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARGUMENTS_LAME, argumentsRtlFm, lireArguments } from "./phonie-vhf.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const LAME = spawnSync("lame", ["--version"]).status === 0;
const VRAI_RTL_FM = spawnSync("bash", ["-c", "command -v rtl_fm"]).status === 0;
const SANS_LAME = !LAME && "lame absent (paquet lame)";

/** Un rtl_fm d'essai : ses arguments notés ; il dit ce que dit le vrai, et sort un 1 kHz à 12 kHz. */
const FAUX_RTL_FM = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const ici = path.dirname(process.argv[1]);
fs.appendFileSync(path.join(ici, "appels.txt"), JSON.stringify(process.argv.slice(2)) + "\\n");
if (fs.existsSync(path.join(ici, "absente"))) {
  process.stderr.write("No supported devices found.\\n");
  process.exit(1);
}
process.stderr.write("Found 1 device(s):\\n  0:  Realtek, RTL2838UHIDIR, SN: 00000001\\n\\nUsing device 0: Generic RTL2832U OEM\\nFound Rafael Micro R820T tuner\\nTuner gain set to automatic.\\nTuned to 118100000 Hz.\\n");
process.stdout.on("error", () => process.exit(0));
// Balayage de plusieurs fréquences, seuil fermé : le vrai rtl_fm ne sort alors rien.
const balaie = process.argv.filter((a) => a === "-f").length > 1;
let n = 0;
setInterval(() => {
  if (fs.existsSync(path.join(ici, "debranchee"))) {
    process.stderr.write("rtlsdr_read_async returned -5\\n");
    process.exit(1);
  }
  if (balaie) return;
  const b = Buffer.alloc(2400);
  for (let i = 0; i < 1200; i++, n++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 1000 * n) / 12000)), i * 2);
  process.stdout.write(b);
}, 100);
`;

const dossiers = [];
const ponts = [];
after(() => {
  for (const p of ponts) p.kill();
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

async function portLibre() {
  const s = net.createServer();
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  const port = s.address().port;
  await new Promise((ok) => s.close(ok));
  return port;
}

/** Lance le pont ; `fauxRtl` : le rtl_fm d'essai passe devant le vrai. */
async function pont(args, fauxRtl = true) {
  const dossier = mkdtempSync(join(tmpdir(), "phonie-vhf-"));
  dossiers.push(dossier);
  if (fauxRtl) {
    writeFileSync(join(dossier, "rtl_fm"), FAUX_RTL_FM);
    chmodSync(join(dossier, "rtl_fm"), 0o755);
  }
  const port = await portLibre();
  const p = spawn(
    process.execPath,
    [join(ICI, "phonie-vhf.mjs"), ...args, "--port", String(port)],
    {
      env: { ...process.env, PATH: `${dossier}:${process.env.PATH}` },
    },
  );
  ponts.push(p);
  let journal = "";
  p.stdout.on("data", (d) => (journal += d));
  p.stderr.on("data", (d) => (journal += d));
  const base = `http://127.0.0.1:${port}`;
  const etat = async () => {
    try {
      return await (await fetch(`${base}/etat`)).json();
    } catch {
      return null;
    }
  };
  return { p, dossier, base, etat, journal: () => journal };
}

async function attendre(quoi, vrai, ms = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await vrai();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`jamais : ${quoi}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Écoute le flux `ms` millisecondes comptées dès la demande, sur sa propre connexion ; rend le
 * statut et les octets reçus.
 */
function ecouter(base, ms) {
  return new Promise((fini, rate) => {
    const fin = setTimeout(() => req.destroy(), ms);
    const req = http.get(`${base}/phonie.mp3`, { agent: false }, (r) => {
      const morceaux = [];
      r.on("data", (m) => morceaux.push(m));
      r.on("error", () => undefined); // coupé au bout du temps : c'est voulu
      if (r.statusCode !== 200) {
        clearTimeout(fin);
        r.on("end", () =>
          fini({
            statut: r.statusCode,
            texte: Buffer.concat(morceaux).toString(),
            octets: Buffer.alloc(0),
          }),
        );
        return;
      }
      const rendre = () => {
        clearTimeout(fin);
        fini({ statut: 200, type: r.headers["content-type"], octets: Buffer.concat(morceaux) });
      };
      r.on("end", rendre);
      r.on("close", rendre);
    });
    req.on("error", (e) => (e.code === "ECONNRESET" ? undefined : rate(e)));
  });
}

/** La première trame MP3 : version, couche, fréquence, débit, mode. */
function enTete(mp3) {
  for (let i = 0; i + 3 < mp3.length; i++) {
    if (mp3[i] !== 0xff || (mp3[i + 1] & 0xe0) !== 0xe0) continue;
    const [b1, b2, b3] = [mp3[i + 1], mp3[i + 2], mp3[i + 3]];
    return {
      mpeg2: ((b1 >> 3) & 3) === 2,
      couche3: ((b1 >> 1) & 3) === 1,
      hz: [22050, 24000, 16000][(b2 >> 2) & 3],
      kbits: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][b2 >> 4],
      mono: ((b3 >> 6) & 3) === 3,
    };
  }
  return null;
}

/** Puissance d'une fréquence dans un son (Goertzel). */
function puissance(pcm, taux, f) {
  const c = 2 * Math.cos((2 * Math.PI * f) / taux);
  let s1 = 0;
  let s2 = 0;
  for (const x of pcm) {
    const s = x + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Le son d'un MP3, décodé par lame : échantillons 16 bits et leur fréquence. */
function decoder(mp3, dossier) {
  writeFileSync(join(dossier, "recu.mp3"), mp3);
  const d = spawnSync("lame", [
    "--decode",
    "--quiet",
    join(dossier, "recu.mp3"),
    join(dossier, "recu.wav"),
  ]);
  assert.equal(d.status, 0, String(d.stderr));
  const wav = readFileSync(join(dossier, "recu.wav"));
  const taux = wav.readUInt32LE(24);
  const debut = wav.indexOf("data") + 8;
  const pcm = [];
  for (let i = debut; i + 1 < wav.length; i += 2) pcm.push(wav.readInt16LE(i));
  return { taux, pcm };
}

test("réglages : fréquences des bandes de l'aviation (VHF, UHF militaire), une clé, un port ; le reste refusé avec sa raison", () => {
  assert.deepEqual(lireArguments(["--frequence", "118.1"]), {
    frequences: [118.1],
    cle: "0",
    port: 8001,
    gain: null,
    ppm: 0,
    silence: 0,
  });
  assert.deepEqual(
    lireArguments([
      "--frequence",
      "118,7",
      "--frequence",
      "136.975",
      "--silence",
      "30",
      "--cle",
      "00000002",
      "--port",
      "8011",
      "--gain",
      "40",
      "--ppm",
      "-12",
    ]),
    { frequences: [118.7, 136.975], cle: "00000002", port: 8011, gain: 40, ppm: -12, silence: 30 },
  );
  const refus = (args, re) => assert.throws(() => lireArguments(args), re);
  refus([], /au moins une fréquence/);
  // Toutes les bandes de l'aviation, en réception : VHF (radionavigation et communications), UHF
  // militaire ; leurs bords compris, jusqu'au dernier canal.
  for (const f of ["108", "117.975", "118", "121.5", "136.975", "225", "243", "399.975"]) {
    assert.deepEqual(lireArguments(["--frequence", f]).frequences, [Number(f)], f);
  }
  for (const f of ["107.975", "137", "156.8", "224.975", "400", "433.92", "88.5", "abc"]) {
    refus(
      ["--frequence", f],
      /hors des bandes de l'aviation \(108 à 136,975 MHz ; 225 à 399,975 MHz\)/,
    );
  }
  refus(["--frequence", "1090"], /1090 MHz : les transpondeurs, reçus par l'antenne 1090/);
  refus(["--frequence", "118.1", "--frequence", "119.7"], /balaie.*--silence/);
  refus(["--frequence", "118.1", "--cle", "1;reboot"], /clé/);
  refus(["--frequence", "118.1", "--port", "80"], /port/);
  refus(["--frequence", "118.1", "--gain", "60"], /gain/);
  refus(["--frequence", "118.1", "--ppm", "1.5"], /ppm/);
  refus(["--frequence", "118.1", "--silence", "-1"], /silence/);
  refus(["--frequence", "118.1", "--emettre", "1"], /option --emettre inconnue/);
  refus(["--frequence"], /attend une valeur/);
});

test("rtl_fm : AM, 12 kHz, la clé et les fréquences données, composante continue filtrée ; lame : MP3 16 kHz mono", () => {
  assert.deepEqual(argumentsRtlFm(lireArguments(["--frequence", "118.1", "--cle", "1"])), [
    "-d",
    "1",
    "-M",
    "am",
    "-f",
    "118.1M",
    "-s",
    "12k",
    "-l",
    "0",
    "-p",
    "0",
    "-E",
    "dc",
    "-",
  ]);
  assert.deepEqual(
    argumentsRtlFm(
      lireArguments([
        "--frequence",
        "118.1",
        "--frequence",
        "121.5",
        "--silence",
        "30",
        "--gain",
        "40",
        "--ppm",
        "3",
      ]),
    ),
    [
      "-d",
      "0",
      "-M",
      "am",
      "-f",
      "118.1M",
      "-f",
      "121.5M",
      "-s",
      "12k",
      "-l",
      "30",
      "-p",
      "3",
      "-g",
      "40",
      "-E",
      "dc",
      "-",
    ],
  );
  assert.deepEqual(ARGUMENTS_LAME.slice(0, 9), [
    "-r",
    "-s",
    "12",
    "--bitwidth",
    "16",
    "--signed",
    "--little-endian",
    "-m",
    "m",
  ]);
});

test("--verifier : les réglages dits, rien de lancé ; faux, code 2", () => {
  const bon = spawnSync(process.execPath, [
    join(ICI, "phonie-vhf.mjs"),
    "--verifier",
    "--frequence",
    "118.1",
    "--cle",
    "1",
  ]);
  assert.equal(bon.status, 0);
  assert.equal(String(bon.stdout), "phonie : 118.1 MHz, clé 1, port 8001\n");
  const faux = spawnSync(process.execPath, [
    join(ICI, "phonie-vhf.mjs"),
    "--verifier",
    "--frequence",
    "118.1",
    "--frequence",
    "119.7",
  ]);
  assert.equal(faux.status, 2);
  assert.match(String(faux.stderr), /demande un seuil/);
});

test("réglage faux : le pont s'arrête aussitôt, code 2, et dit pourquoi", () => {
  const r = spawnSync(process.execPath, [join(ICI, "phonie-vhf.mjs"), "--frequence", "145.5"]);
  assert.equal(r.status, 2);
  assert.match(String(r.stderr), /phonie : fréquence 145.5 hors des bandes de l.aviation/);
});

test(
  "le pont sert la phonie : MP3 16 kHz mono à 32 kbit/s, à deux auditeurs, et c'est bien le son de la clé",
  { skip: SANS_LAME },
  async () => {
    const b = await pont(["--frequence", "118.1", "--cle", "1"]);
    await attendre("à l'écoute", async () => (await b.etat())?.actif);
    // Deux auditeurs en même temps, chacun sur sa connexion : le pont les sert tous les deux.
    const tous = Promise.all([ecouter(b.base, 3000), ecouter(b.base, 3000)]);
    await attendre("deux auditeurs", async () => (await b.etat())?.auditeurs === 2, 2500);
    const [un, deux] = await tous;
    for (const e of [un, deux]) {
      assert.equal(e.statut, 200);
      assert.equal(e.type, "audio/mpeg");
      assert.ok(e.octets.length >= 6000, `${e.octets.length} octets en 3 s`);
    }
    assert.deepEqual(enTete(un.octets), {
      mpeg2: true,
      couche3: true,
      hz: 16000,
      kbits: 32,
      mono: true,
    });
    const { taux, pcm } = decoder(un.octets, b.dossier);
    assert.equal(taux, 16000);
    const ton = puissance(pcm, taux, 1000);
    const ailleurs = puissance(pcm, taux, 2500);
    assert.ok(
      ton > 100 * ailleurs,
      `1 kHz ${ton.toExponential(2)} contre ${ailleurs.toExponential(2)} à 2,5 kHz`,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(b.dossier, "appels.txt"), "utf8").split("\n")[0]),
      ["-d", "1", "-M", "am", "-f", "118.1M", "-s", "12k", "-l", "0", "-p", "0", "-E", "dc", "-"],
    );
    const e = await b.etat();
    assert.equal(e.erreur, null);
    assert.ok(e.octets > 6000);
    assert.match(b.journal(), /118\.1 MHz sur la clé 1 — à l'écoute/);
    // Servi au seul poste : rien n'écoute sur les autres adresses de la machine.
    const autre = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (autre) {
      await assert.rejects(fetch(b.base.replace("127.0.0.1", autre) + "/etat"));
    }
  },
);

test(
  "clé débranchée en pleine écoute : dite, les auditeurs relâchés, puis le pont se rebranche seul",
  { skip: SANS_LAME },
  async () => {
    const b = await pont(["--frequence", "118.1"]);
    await attendre("à l'écoute", async () => (await b.etat())?.actif);
    const flux = ecouter(b.base, 20_000);
    // lame rend ses premières trames après une seconde de son environ : on les attend.
    await attendre("du son servi", async () => (await b.etat())?.octets > 2000);
    writeFileSync(join(b.dossier, "debranchee"), "");
    const coupe = await attendre("débranchée dite", async () => {
      const e = await b.etat();
      return e && !e.actif && e.erreur ? e : null;
    });
    assert.equal(coupe.erreur, "rtlsdr_read_async returned -5");
    // L'auditeur est relâché tout de suite, sans attendre ses 20 s : le poste réessaie de son côté.
    const t0 = Date.now();
    const recu = await flux;
    assert.ok(Date.now() - t0 < 3000);
    assert.ok(recu.octets.length > 0);
    unlinkSync(join(b.dossier, "debranchee"));
    await attendre("rebranchée", async () => (await b.etat())?.actif);
    assert.equal((await ecouter(b.base, 1500)).statut, 200);
    assert.match(b.journal(), /rtlsdr_read_async returned -5 — nouvel essai dans 2 s/);
  },
);

test(
  "balayage de deux fréquences, seuil fermé : rtl_fm se tait, le pont comble de silence, le flux continue",
  { skip: SANS_LAME },
  async () => {
    const b = await pont(["--frequence", "118.1", "--frequence", "121.5", "--silence", "30"]);
    await attendre("à l'écoute", async () => (await b.etat())?.actif);
    const e = await ecouter(b.base, 3000);
    assert.equal(e.statut, 200);
    assert.ok(e.octets.length >= 3000, `${e.octets.length} octets en 3 s`);
    const { pcm } = decoder(e.octets, b.dossier);
    assert.ok(
      pcm.every((x) => Math.abs(x) < 50),
      "du silence",
    );
  },
);

test(
  "clé absente (le VRAI rtl_fm, sans clé branchée) : 503 et sa raison, réessais espacés",
  { skip: SANS_LAME || (!VRAI_RTL_FM && "rtl_fm absent (paquet rtl-sdr)") },
  async () => {
    const b = await pont(["--frequence", "118.1"], false);
    const e = await attendre("absente dite", async () => {
      const x = await b.etat();
      return x && x.erreur !== "pas encore lancé" ? x : null;
    });
    // Sur une machine où une vraie clé est branchée, ce cas ne se produit pas : on le dit.
    if (e.actif) return;
    assert.equal(e.erreur, "No supported devices found.");
    const r = await ecouter(b.base, 1000);
    assert.equal(r.statut, 503);
    assert.equal(r.texte, "phonie indisponible : No supported devices found.\n");
    await attendre("deuxième essai", async () => /nouvel essai dans 4 s/.test(b.journal()), 8000);
    assert.ok(!existsSync(join(b.dossier, "appels.txt")));
  },
);
