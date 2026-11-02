#!/usr/bin/env node
// Construit la mosaïque Sentinel-2 HORS LIGNE du poste, pour les zones choisies, avec le compte
// Copernicus de l'opérateur — le même que la console (AFRICONTROL_SENTINEL_ID / _SECRET, dans
// l'environnement ou dans poste.env). À lancer en ligne ; ensuite la console affiche ces tuiles sans
// réseau, sur n'importe quelle zone (voir src/lib/vigilair/mosaique-locale.server.ts).
//
//   node scripts/poste/imagerie-poste.mjs                    zone du poste (FTTJ ± 0,55°), z8 à z12
//   node scripts/poste/imagerie-poste.mjs --zone 11.6,12.7,14.5,15.6 --zone 13.2,13.9,20.5,21.2
//
//   --zone S,N,O,E   zone en degrés décimaux ; RÉPÉTABLE (plusieurs sites, n'importe quels continents)
//   --zmin N         zoom le plus large (défaut 8)
//   --zmax N         zoom le plus fin (défaut 12 ; 13 et 14 approchent les 10 m natifs, mais coûtent
//                    4 et 16 fois plus de requêtes)
//   --mois N         fenêtre du composite « moins nuageux », en mois (défaut 12)
//   --nuages P       couverture nuageuse maximale d'une scène, en % (défaut 20)
//   --essai          compter seulement (tuiles, requêtes, unités) : rien n'est demandé
//   --oui            passer le garde-fou des gros lots
//
// Une tuile = une requête au compte Copernicus. Le compte gratuit a un quota mensuel (de l'ordre de
// 10 000 requêtes selon le forum Copernicus : le tableau de bord du compte fait foi). À lancer
// depuis le dossier AfriControl, comme le serveur : poste.env y est lu, et les tuiles vont dans
// AFRICONTROL_IMAGERIE_TUILES, sinon public/sentinel — là où le serveur les cherche. Relancer
// reprend : une tuile déjà là n'est pas redemandée. Réception seule : le poste lit des images
// publiques, il ne commande rien.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CDSE_JETON, CDSE_PROCESS, corpsProcess, tuile3857 } from "../sentinel-rendu.mjs";
import { lireZone, planMosaique, UNITES_PAR_TUILE } from "./imagerie-plan.mjs";

const ZONE_POSTE = "11.6,12.7,14.5,15.6";
// Mesuré : un JPEG 256 px uni (zone sans donnée, rendue noire) pèse ~1,1 Ko ; la plus petite vraie
// tuile des packs livrés, 4,2 Ko. En dessous de ce seuil, la tuile n'est pas écrite : la console
// garde l'imagerie en ligne à cet endroit plutôt qu'un carré noir.
const VIDE = 2500;
const GROS_LOT = 2000;
const QUOTA_GRATUIT = 10000;

class Arret extends Error {}

/** --help : l'en-tête de ce fichier, comme le --help du script de préparation. */
function aide() {
  const lignes = readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const fin = lignes.findIndex((l) => !l.startsWith("//"));
  return lignes
    .slice(0, fin)
    .map((l) => l.replace(/^\/\/ ?/, ""))
    .join("\n");
}

function options(argv) {
  const o = { zones: [], zmin: 8, zmax: 12, mois: 12, nuages: 20, essai: false, oui: false };
  const entier = (nom, v, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Arret(`${nom} attend un entier de ${min} à ${max} (reçu : ${v})`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const suivant = () => {
      if (i + 1 >= argv.length) throw new Arret(`${a} attend une valeur`);
      return argv[++i];
    };
    if (a === "--zone") o.zones.push(suivant());
    else if (a === "--zmin") o.zmin = entier(a, suivant(), 0, 14);
    else if (a === "--zmax") o.zmax = entier(a, suivant(), 0, 14);
    else if (a === "--mois") o.mois = entier(a, suivant(), 1, 36);
    else if (a === "--nuages") o.nuages = entier(a, suivant(), 0, 100);
    else if (a === "--essai") o.essai = true;
    else if (a === "--oui") o.oui = true;
    else throw new Arret(`option inconnue : ${a}`);
  }
  if (o.zmin > o.zmax) throw new Arret(`--zmin (${o.zmin}) dépasse --zmax (${o.zmax})`);
  if (o.zones.length === 0) o.zones.push(ZONE_POSTE);
  try {
    o.zones = o.zones.map(lireZone);
  } catch (e) {
    throw new Arret(e.message);
  }
  return o;
}

/** Réglages AFRICONTROL_* : l'environnement d'abord, puis poste.env, lu comme le lit le serveur. */
function reglages() {
  const r = {};
  const fichier = join(process.cwd(), "poste.env");
  if (existsSync(fichier)) {
    for (const ligne of readFileSync(fichier, "utf8").split(/\r?\n/)) {
      const m = ligne.match(/^\s*(AFRICONTROL_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) r[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (cle.startsWith("AFRICONTROL_") && valeur?.trim()) r[cle] = valeur;
  }
  return r;
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function principal() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(aide());
    return 0;
  }
  const o = options(argv);
  const r = reglages();
  const dossier = r.AFRICONTROL_IMAGERIE_TUILES ?? join(process.cwd(), "public", "sentinel");
  const plan = planMosaique(o.zones, o.zmin, o.zmax);
  const fichier = (t) => join(dossier, String(t.z), String(t.x), `${t.y}.jpg`);
  const aFaire = plan.filter((t) => !existsSync(fichier(t)));
  console.log(`  zones : ${o.zones.map((z) => `${z.s},${z.n},${z.o},${z.e}`).join("  ")}`);
  console.log(
    `  zooms ${o.zmin} à ${o.zmax} : ${plan.length} tuiles, dont ${plan.length - aFaire.length} déjà là`,
  );
  console.log(
    `  à demander : ${aFaire.length} tuiles = ${aFaire.length} requêtes, ` +
      `${(aFaire.length * UNITES_PAR_TUILE).toFixed(1)} unités de traitement (estimation)`,
  );
  console.log(`  dossier : ${dossier}`);
  if (o.essai || aFaire.length === 0) return 0;

  if (aFaire.length > QUOTA_GRATUIT && !o.oui) {
    throw new Arret(
      `${aFaire.length} requêtes : plus que le quota mensuel d'un compte gratuit (de l'ordre de ` +
        `${QUOTA_GRATUIT}). Réduire les zones ou --zmax, ou --oui si le compte le permet.`,
    );
  }
  if (aFaire.length > GROS_LOT && !o.oui) {
    console.log(
      `  ATTENTION : ${aFaire.length} requêtes. Ctrl+C pour arrêter ; sinon ça continue dans 5 s…`,
    );
    await pause(5000);
  }
  const id = r.AFRICONTROL_SENTINEL_ID;
  const secret = r.AFRICONTROL_SENTINEL_SECRET;
  if (!id || !secret) {
    throw new Arret(
      "compte Copernicus non réglé : AFRICONTROL_SENTINEL_ID et AFRICONTROL_SENTINEL_SECRET " +
        "(client OAuth créé dans le tableau de bord du compte), dans poste.env ou l'environnement",
    );
  }
  const urlJeton = r.AFRICONTROL_SENTINEL_TOKEN ?? CDSE_JETON;
  const urlProcess = r.AFRICONTROL_SENTINEL_API ?? CDSE_PROCESS;
  const au = new Date();
  const du = new Date(au.getTime() - o.mois * 30.44 * 86_400_000);

  // Un seul jeton à la fois, renouvelé avant expiration ou sur un 401.
  let jeton = null;
  let enCours = null;
  const obtenirJeton = (forcer = false) => {
    if (!forcer && jeton && Date.now() < jeton.fin - 60_000) return Promise.resolve(jeton.valeur);
    enCours ??= (async () => {
      const res = await fetch(urlJeton, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: id,
          client_secret: secret,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Arret(
          `le compte Copernicus refuse les identifiants (HTTP ${res.status}) : vérifier ` +
            "AFRICONTROL_SENTINEL_ID et AFRICONTROL_SENTINEL_SECRET",
        );
      }
      const j = await res.json();
      if (!j.access_token) throw new Arret("réponse OAuth sans jeton");
      jeton = { valeur: j.access_token, fin: Date.now() + (j.expires_in ?? 3600) * 1000 };
      return jeton.valeur;
    })().finally(() => {
      enCours = null;
    });
    return enCours;
  };

  /** Une tuile : écrite, vide (pas de donnée), ou en échec avec la raison. */
  const prendre = async (t) => {
    for (let essai = 1; ; essai++) {
      let res;
      try {
        res = await fetch(urlProcess, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await obtenirJeton()}`,
            "Content-Type": "application/json",
            Accept: "image/jpeg",
          },
          body: JSON.stringify(
            corpsProcess({
              bbox: tuile3857(t.z, t.x, t.y),
              largeur: 256,
              hauteur: 256,
              du,
              au,
              nuagesMax: o.nuages,
              format: "image/jpeg",
            }),
          ),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (e instanceof Arret) throw e;
        if (essai >= 4) return { etat: "echec", raison: `réseau : ${e.message}` };
        await pause(2000 * essai);
        continue;
      }
      if (res.status === 429) {
        // Trop de requêtes à la minute : attendre ce que le service demande, puis reprendre.
        if (essai >= 8) return { etat: "echec", raison: "429 répétés" };
        const attente = Number(res.headers.get("retry-after"));
        await pause(Number.isFinite(attente) && attente >= 0 ? attente * 1000 : 2000 * essai);
        continue;
      }
      if (res.status === 401 && essai === 1) {
        await obtenirJeton(true);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Arret(
          `HTTP ${res.status} : le compte Copernicus refuse la requête (quota épuisé ou droits ` +
            "insuffisants : voir le tableau de bord du compte)",
        );
      }
      if (res.status >= 500 && essai < 4) {
        await pause(2000 * essai);
        continue;
      }
      if (!res.ok) {
        const texte = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
        return { etat: "echec", raison: `HTTP ${res.status} ${texte}` };
      }
      const octets = new Uint8Array(await res.arrayBuffer());
      if (octets[0] !== 0xff || octets[1] !== 0xd8) {
        return { etat: "echec", raison: "la réponse n'est pas une image JPEG" };
      }
      if (octets.length < VIDE) return { etat: "vide" };
      const chemin = fichier(t);
      mkdirSync(dirname(chemin), { recursive: true });
      writeFileSync(`${chemin}.part`, octets);
      renameSync(`${chemin}.part`, chemin);
      return { etat: "ecrite", octets: octets.length };
    }
  };

  // Un premier jeton avant tout : identifiants refusés ou réseau coupé, on le dit tout de suite.
  try {
    await obtenirJeton();
  } catch (e) {
    if (e instanceof Arret) throw e;
    throw new Arret(
      `compte Copernicus injoignable (${e.message}) : vérifier la connexion du poste`,
    );
  }
  const debut = Date.now();
  const compte = { ecrite: 0, vide: 0, echec: 0, octets: 0 };
  const raisons = new Map();
  let prochain = 0;
  let fatal = null;
  const ouvrier = async () => {
    while (!fatal && prochain < aFaire.length) {
      const t = aFaire[prochain++];
      try {
        const res = await prendre(t);
        compte[res.etat] += 1;
        compte.octets += res.octets ?? 0;
        if (res.raison) raisons.set(res.raison, (raisons.get(res.raison) ?? 0) + 1);
      } catch (e) {
        fatal = e;
      }
      const fait = compte.ecrite + compte.vide + compte.echec;
      process.stdout.write(`\r  tuile ${fait}/${aFaire.length} `);
    }
  };
  await Promise.all(Array.from({ length: 4 }, ouvrier));
  process.stdout.write("\n");
  const duree = Math.round((Date.now() - debut) / 1000);
  console.log(
    `  écrites : ${compte.ecrite} (${(compte.octets / 1e6).toFixed(1)} Mo) · sans donnée : ` +
      `${compte.vide} · en échec : ${compte.echec} · ${duree} s`,
  );
  for (const [raison, n] of raisons) console.log(`    ${n} × ${raison}`);
  if (fatal) throw fatal;
  if (compte.echec > 0) {
    console.log("  Relancer la même commande reprend les tuiles manquantes.");
    return 1;
  }
  return 0;
}

principal().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`  ✗ imagerie : ${e.message}`);
    process.exit(e instanceof Arret ? 2 : 1);
  },
);
