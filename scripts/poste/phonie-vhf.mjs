#!/usr/bin/env node
/**
 * Phonie VHF du poste : une clé radio RTL-SDR à l'écoute de la bande aéronautique (AM), le son servi
 * en MP3 sur 127.0.0.1, là où le poste l'enregistre à la demande (AFRICONTROL_ATC). RÉCEPTION
 * SEULE : une clé RTL-SDR ne sait pas émettre, et ce pont ne lui donne que sa fréquence d'écoute.
 *
 *   node scripts/poste/phonie-vhf.mjs --frequence 118.1 [--frequence 119.7 --silence 30]
 *                                     [--cle 0|NUMÉRO_DE_SÉRIE] [--port 8001] [--gain 40] [--ppm 0]
 *
 * rtl_fm (paquet rtl-sdr) démodule l'AM, lame (paquet lame) en fait du MP3, et ce pont le sert à
 * tous ceux qui l'écoutent : http://127.0.0.1:PORT/phonie.mp3 ; son état sur /etat. Plusieurs
 * fréquences : rtl_fm les balaie, ce qui demande un seuil de silence ; ses blancs sont comblés, pour
 * que le flux ne s'arrête pas. Clé absente ou débranchée : c'est dit (503, /etat), et il réessaie seul.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { pathToFileURL } from "node:url";

/** Échantillons par seconde sortis de rtl_fm : 12 kHz, la largeur d'un canal AM de la bande. */
const TAUX = 12_000;
const OCTETS_PAR_S = TAUX * 2;
/** Sans son de rtl_fm depuis ce temps (silence du balayage), le pont comble avec du silence. */
const BLANC_MS = 500;
const REESSAI_MIN_MS = 2000;
const REESSAI_MAX_MS = 30_000;

const AIDE =
  "node scripts/poste/phonie-vhf.mjs --frequence MHZ [--frequence MHZ … --silence N] [--cle N|SÉRIE] [--port 8001] [--gain DB] [--ppm N]";

/** Les réglages de la ligne de commande, vérifiés ; une erreur dit ce qui ne va pas. */
export function lireArguments(argv) {
  const r = { frequences: [], cle: "0", port: 8001, gain: null, ppm: 0, silence: 0 };
  for (let i = 0; i < argv.length; i++) {
    const nom = argv[i];
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${nom} attend une valeur — ${AIDE}`);
    i += 1;
    const n = Number(String(v).replace(",", "."));
    switch (nom) {
      case "--frequence":
        // La bande aéronautique en AM : 118 à 136,975 MHz.
        if (!(n >= 118 && n < 137)) {
          throw new Error(`fréquence ${v} hors de la bande aéronautique (118 à 136,975 MHz)`);
        }
        r.frequences.push(n);
        break;
      case "--cle":
        if (!/^[0-9A-Za-z_-]{1,32}$/.test(v))
          throw new Error(`clé ${v} : un numéro ou un numéro de série`);
        r.cle = v;
        break;
      case "--port":
        if (!(Number.isInteger(n) && n >= 1024 && n <= 65535))
          throw new Error(`port ${v} : 1024 à 65535`);
        r.port = n;
        break;
      case "--gain":
        if (!(n >= 0 && n <= 50))
          throw new Error(`gain ${v} : 0 à 50 dB (sans --gain : automatique)`);
        r.gain = n;
        break;
      case "--ppm":
        if (!(Number.isInteger(n) && Math.abs(n) <= 200))
          throw new Error(`ppm ${v} : un entier, -200 à 200`);
        r.ppm = n;
        break;
      case "--silence":
        if (!(Number.isInteger(n) && n >= 0 && n <= 10_000))
          throw new Error(`silence ${v} : un entier, 0 à 10000`);
        r.silence = n;
        break;
      default:
        throw new Error(`option ${nom} inconnue — ${AIDE}`);
    }
  }
  if (r.frequences.length === 0) throw new Error(`au moins une fréquence — ${AIDE}`);
  if (r.frequences.length > 1 && r.silence === 0) {
    throw new Error(
      "plusieurs fréquences : rtl_fm les balaie, ce qui demande un seuil (--silence 30, par exemple)",
    );
  }
  return r;
}

/** rtl_fm : AM, ces fréquences, 12 kHz, filtre de la composante continue (la porteuse). */
export function argumentsRtlFm(r) {
  return [
    "-d",
    r.cle,
    "-M",
    "am",
    ...r.frequences.flatMap((f) => ["-f", `${f}M`]),
    "-s",
    "12k",
    "-l",
    String(r.silence),
    "-p",
    String(r.ppm),
    ...(r.gain === null ? [] : ["-g", String(r.gain)]),
    "-E",
    "dc",
    "-",
  ];
}

/** lame : PCM brut de rtl_fm (16 bits, signé, petit-boutiste, mono, 12 kHz) → MP3 16 kHz, 32 kbit/s. */
export const ARGUMENTS_LAME = [
  "-r",
  "-s",
  "12",
  "--bitwidth",
  "16",
  "--signed",
  "--little-endian",
  "-m",
  "m",
  "--resample",
  "16",
  "-b",
  "32",
  "--quiet",
  "-",
  "-",
];

function lancer(r) {
  const etat = {
    frequences: r.frequences,
    cle: r.cle,
    actif: false,
    depuis: null,
    octets: 0,
    auditeurs: 0,
    erreur: "pas encore lancé",
  };
  const auditeurs = new Set();
  let reessaiMs = REESSAI_MIN_MS;
  let arret = false;
  let chaine = null;

  const dire = (texte) => console.log(`${new Date().toISOString()} phonie : ${texte}`);
  const finAuditeurs = () => {
    for (const a of auditeurs) a.end();
    auditeurs.clear();
    etat.auditeurs = 0;
  };

  function demarrer() {
    if (arret) return;
    const rtl = spawn("rtl_fm", argumentsRtlFm(r), { stdio: ["ignore", "pipe", "pipe"] });
    const lame = spawn("lame", ARGUMENTS_LAME, { stdio: ["pipe", "pipe", "pipe"] });
    const c = { rtl, lame, dernierSon: Date.now(), fini: false, blancs: null };
    chaine = c;
    let derniereLigne = "";
    const ecoute = () => {
      if (etat.actif) return;
      etat.actif = true;
      etat.depuis = Date.now();
      etat.erreur = null;
      dire(`${r.frequences.join(", ")} MHz sur la clé ${r.cle} — à l'écoute`);
    };
    rtl.stderr.on("data", (d) => {
      const lignes = String(d)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lignes.length) derniereLigne = lignes[lignes.length - 1];
      // La clé ouverte et accordée : à l'écoute, même si le balayage se tait encore.
      if (lignes.some((l) => l.startsWith("Tuned to"))) ecoute();
    });
    lame.stderr.on("data", (d) => {
      derniereLigne = `lame : ${String(d).trim()}`;
    });
    rtl.stdout.on("data", (pcm) => {
      c.dernierSon = Date.now();
      ecoute();
      lame.stdin.write(pcm);
    });
    // Le balayage se tait quand le seuil est fermé : sans son, du silence, pour que le flux continue.
    c.blancs = setInterval(() => {
      if (etat.actif && Date.now() - c.dernierSon > BLANC_MS) {
        lame.stdin.write(Buffer.alloc(OCTETS_PAR_S / 5));
      }
    }, 200);
    lame.stdout.on("data", (mp3) => {
      etat.octets += mp3.length;
      for (const a of auditeurs) a.write(mp3);
    });
    lame.stdin.on("error", () => undefined);
    const tomber = (qui, code) => {
      if (c.fini) return;
      c.fini = true;
      clearInterval(c.blancs);
      rtl.kill();
      lame.kill();
      const duree = etat.actif ? Date.now() - etat.depuis : 0;
      etat.actif = false;
      etat.erreur = derniereLigne || `${qui} arrêté (code ${code})`;
      finAuditeurs();
      if (arret) return;
      // Après une bonne écoute, on repart vite ; une clé absente, on espace les essais (2 à 30 s).
      const bonne = duree > REESSAI_MAX_MS;
      const dans = bonne ? REESSAI_MIN_MS : reessaiMs;
      reessaiMs = bonne ? REESSAI_MIN_MS : Math.min(reessaiMs * 2, REESSAI_MAX_MS);
      dire(`${etat.erreur} — nouvel essai dans ${Math.round(dans / 1000)} s`);
      setTimeout(demarrer, dans);
    };
    rtl.on("error", (e) => {
      derniereLigne = `rtl_fm introuvable (${e.code}) : installer le paquet rtl-sdr`;
      tomber("rtl_fm", e.code);
    });
    lame.on("error", (e) => {
      derniereLigne = `lame introuvable (${e.code}) : installer le paquet lame`;
      tomber("lame", e.code);
    });
    rtl.on("close", (code) => tomber("rtl_fm", code));
    lame.on("close", (code) => tomber("lame", code));
  }

  const serveur = http.createServer((req, res) => {
    const chemin = new URL(req.url ?? "/", "http://poste").pathname;
    if (chemin === "/etat") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(etat));
    }
    if (chemin !== "/phonie.mp3") return res.writeHead(404).end();
    if (!etat.actif) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "5" });
      return res.end(`phonie indisponible : ${etat.erreur}\n`);
    }
    res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
    // L'en-tête part tout de suite : l'auditeur sait qu'il est branché avant la première trame.
    res.flushHeaders();
    auditeurs.add(res);
    etat.auditeurs = auditeurs.size;
    res.on("close", () => {
      auditeurs.delete(res);
      etat.auditeurs = auditeurs.size;
    });
  });
  serveur.listen(r.port, "127.0.0.1", () => {
    dire(`flux sur http://127.0.0.1:${r.port}/phonie.mp3, état sur /etat`);
    demarrer();
  });
  const finir = () => {
    arret = true;
    if (chaine && !chaine.fini) {
      clearInterval(chaine.blancs);
      chaine.rtl.kill();
      chaine.lame.kill();
    }
    finAuditeurs();
    serveur.close(() => process.exit(0));
  };
  process.on("SIGTERM", finir);
  process.on("SIGINT", finir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // --verifier : les réglages lus et dits, rien de lancé (le script de préparation s'en sert).
  const verifier = process.argv[2] === "--verifier";
  let r;
  try {
    r = lireArguments(process.argv.slice(verifier ? 3 : 2));
  } catch (e) {
    console.error(`phonie : ${e.message}`);
    process.exit(2);
  }
  if (verifier) {
    console.log(`phonie : ${r.frequences.join(", ")} MHz, clé ${r.cle}, port ${r.port}`);
  } else {
    lancer(r);
  }
}
