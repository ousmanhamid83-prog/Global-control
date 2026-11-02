// Le script de mosaïque contre un faux compte Copernicus (jeton OAuth + API Process) sur 127.0.0.1 :
// ce qu'il demande, ce qu'il écrit, comment il réagit aux refus, aux limites et aux tuiles vides.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { RENDU_VRAIES_COULEURS, tuile3857 } from "../sentinel-rendu.mjs";
import { lireZone, planMosaique } from "./imagerie-plan.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "imagerie-poste.mjs");
const ZONE = "12.0,12.2,15.0,15.2";
const PLAN = planMosaique([lireZone(ZONE)], 10, 11);

/** Octets qui commencent comme un JPEG (FF D8 FF), de la taille voulue. */
const jpeg = (taille, motif = 7) => {
  const b = Buffer.alloc(taille, motif);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
};

/** Faux compte Copernicus. `regle(req, corps, n)` décide de la réponse du n-ième appel Process. */
async function fauxCopernicus(regle) {
  const journal = { jetons: [], process: [] };
  const srv = createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      if (req.url === "/jeton") {
        const p = new URLSearchParams(corps);
        journal.jetons.push(Object.fromEntries(p));
        const refuse = p.get("client_secret") !== "secret-du-poste";
        res.writeHead(refuse ? 401 : 200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            refuse ? {} : { access_token: `jeton-${journal.jetons.length}`, expires_in: 3600 },
          ),
        );
        return;
      }
      const appel = {
        auth: req.headers.authorization,
        accept: req.headers.accept,
        corps: JSON.parse(corps),
      };
      journal.process.push(appel);
      const r = regle(appel, journal.process.length);
      res.writeHead(r.statut ?? 200, { "content-type": "image/jpeg", ...(r.entetes ?? {}) });
      res.end(r.octets ?? "");
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, journal, fermer: () => new Promise((ok) => srv.close(ok)) };
}

// Le script lit poste.env dans le dossier de lancement, comme le serveur : chaque lancement part
// d'un dossier temporaire, pour que le vrai poste.env d'un poste (et ses identifiants) ne serve
// jamais à un test.
const DOSSIER_NEUTRE = mkdtempSync(join(tmpdir(), "lancement-"));
after(() => rmSync(DOSSIER_NEUTRE, { recursive: true, force: true }));

function lancer(args, env, cwd = DOSSIER_NEUTRE) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let sortie = "";
    p.stdout.on("data", (d) => (sortie += d));
    p.stderr.on("data", (d) => (sortie += d));
    p.on("close", (code) => ok({ code, sortie }));
  });
}

const tuilesEcrites = (dossier) =>
  existsSync(dossier)
    ? readdirSync(dossier, { recursive: true }).filter((f) => String(f).endsWith(".jpg")).length
    : 0;

function environnement(base, dossier, secret = "secret-du-poste") {
  return {
    AFRICONTROL_SENTINEL_ID: "client-du-poste",
    AFRICONTROL_SENTINEL_SECRET: secret,
    AFRICONTROL_SENTINEL_TOKEN: `${base}/jeton`,
    AFRICONTROL_SENTINEL_API: `${base}/process`,
    AFRICONTROL_IMAGERIE_TUILES: dossier,
  };
}

test("ESSAI : compte les tuiles et les requêtes sans compte ni réseau", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  try {
    const r = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "11", "--essai"], {
      AFRICONTROL_IMAGERIE_TUILES: dossier,
    });
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, new RegExp(`zooms 10 à 11 : ${PLAN.length} tuiles, dont 0 déjà là`));
    assert.match(
      r.sortie,
      new RegExp(`à demander : ${PLAN.length} tuiles = ${PLAN.length} requêtes`),
    );
    assert.equal(tuilesEcrites(dossier), 0);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("SANS COMPTE : s'arrête et dit quoi régler (code 2)", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  try {
    const r = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "11"], {
      AFRICONTROL_IMAGERIE_TUILES: dossier,
    });
    assert.equal(r.code, 2);
    assert.match(r.sortie, /AFRICONTROL_SENTINEL_ID et AFRICONTROL_SENTINEL_SECRET/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("ZONE PAR DÉFAUT : celle du poste, FTTJ ± 0,55°", async () => {
  const r = await lancer(["--essai"], {});
  assert.equal(r.code, 0, r.sortie);
  assert.match(r.sortie, /zones : 11\.6,12\.7,14\.5,15\.6\n/);
  assert.match(r.sortie, /zooms 8 à 12 :/);
});

test("POSTE.ENV : lu comme le serveur (guillemets ôtés), l'environnement garde la main", async () => {
  const cop = await fauxCopernicus(() => ({ octets: jpeg(5000) }));
  const poste = (secret) => {
    const d = mkdtempSync(join(tmpdir(), "poste-"));
    writeFileSync(
      join(d, "poste.env"),
      [
        "# Réglages du poste",
        "AFRICONTROL_SENTINEL_ID=client-du-poste",
        `AFRICONTROL_SENTINEL_SECRET="${secret}"`,
        `AFRICONTROL_SENTINEL_TOKEN=${cop.base}/jeton`,
        `AFRICONTROL_SENTINEL_API=${cop.base}/process`,
      ].join("\n"),
    );
    return d;
  };
  const seul = poste("secret-du-poste");
  const contredit = poste("ancien-secret");
  try {
    const r = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "10"], {}, seul);
    assert.equal(r.code, 0, r.sortie);
    assert.ok(tuilesEcrites(join(seul, "public", "sentinel")) > 0, "public/sentinel du dossier");
    const r2 = await lancer(
      ["--zone", ZONE, "--zmin", "10", "--zmax", "10"],
      { AFRICONTROL_SENTINEL_SECRET: "secret-du-poste" },
      contredit,
    );
    assert.equal(r2.code, 0, `l'environnement l'emporte sur poste.env : ${r2.sortie}`);
  } finally {
    await cop.fermer();
    rmSync(seul, { recursive: true, force: true });
    rmSync(contredit, { recursive: true, force: true });
  }
});

test("--help : l'en-tête du script, sans rien lancer", async () => {
  const r = await lancer(["--help"], {});
  assert.equal(r.code, 0, r.sortie);
  assert.match(r.sortie, /^Construit la mosaïque Sentinel-2 HORS LIGNE/);
  assert.match(r.sortie, /--zone S,N,O,E/);
  assert.doesNotMatch(r.sortie, /^\/\/|^import /m, "ni les « // », ni le code");
});

test("MAUVAISE ZONE : l'erreur dit quoi corriger, rien n'est demandé (code 2)", async () => {
  const r = await lancer(["--zone", "12.2,12.0,15,15.2", "--essai"], {});
  assert.equal(r.code, 2);
  assert.match(r.sortie, /S < N et O < E/);
});

test("MOSAÏQUE : chaque tuile demandée telle que la console la demande, écrite à sa place ; reprise", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  const videe = PLAN[PLAN.length - 1];
  const bboxVide = JSON.stringify(tuile3857(videe.z, videe.x, videe.y));
  // 1er appel : 429 (attendre 0 s) ; 2e : 503 passager ; la tuile « videe » rend un JPEG uni
  // (zone sans donnée).
  const cop = await fauxCopernicus((appel, n) => {
    if (n === 1) return { statut: 429, entetes: { "retry-after": "0" } };
    if (n === 2) return { statut: 503 };
    if (JSON.stringify(appel.corps.input.bounds.bbox) === bboxVide) return { octets: jpeg(1100) };
    return { octets: jpeg(5000) };
  });
  try {
    const env = environnement(cop.base, dossier);
    const r = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "11"], env);
    assert.equal(r.code, 0, r.sortie);
    assert.match(
      r.sortie,
      new RegExp(`écrites : ${PLAN.length - 1} .* sans donnée : 1 · en échec : 0`),
    );
    assert.equal(tuilesEcrites(dossier), PLAN.length - 1);
    assert.ok(!existsSync(join(dossier, String(videe.z), String(videe.x), `${videe.y}.jpg`)));
    const t = PLAN[0];
    assert.deepEqual(
      readFileSync(join(dossier, String(t.z), String(t.x), `${t.y}.jpg`)),
      jpeg(5000),
    );
    // Ce qui est parti : un seul jeton (réutilisé), une requête par tuile plus la reprise du 429.
    assert.equal(cop.journal.jetons.length, 1);
    assert.deepEqual(cop.journal.jetons[0], {
      grant_type: "client_credentials",
      client_id: "client-du-poste",
      client_secret: "secret-du-poste",
    });
    assert.equal(
      cop.journal.process.length,
      PLAN.length + 2,
      "chaque tuile, plus 429 et 503 repris",
    );
    const bboxDemandees = new Set(
      cop.journal.process.map((a) => JSON.stringify(a.corps.input.bounds.bbox)),
    );
    for (const u of PLAN) assert.ok(bboxDemandees.has(JSON.stringify(tuile3857(u.z, u.x, u.y))));
    for (const a of cop.journal.process) {
      assert.equal(a.auth, "Bearer jeton-1");
      assert.equal(a.corps.evalscript, RENDU_VRAIES_COULEURS);
      assert.deepEqual(a.corps.output.responses[0].format, { type: "image/jpeg" });
      assert.equal(a.corps.output.width, 256);
      assert.equal(a.corps.input.data[0].dataFilter.maxCloudCoverage, 20);
      assert.equal(a.corps.input.data[0].dataFilter.mosaickingOrder, "leastCC");
      // Fenêtre par défaut : les 12 derniers mois, jusqu'à maintenant.
      const { from, to } = a.corps.input.data[0].dataFilter.timeRange;
      const jours = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      assert.ok(Math.abs(jours - 365.28) < 0.01, `${jours} jours`);
      assert.ok(Math.abs(Date.now() - Date.parse(to)) < 120_000, "jusqu'à maintenant");
    }
    // Relancer reprend : seule la tuile sans donnée est redemandée.
    const avant = cop.journal.process.length;
    const r2 = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "11"], env);
    assert.equal(r2.code, 0, r2.sortie);
    assert.match(r2.sortie, new RegExp(`dont ${PLAN.length - 1} déjà là`));
    assert.equal(cop.journal.process.length - avant, 1);
  } finally {
    await cop.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("JETON EXPIRÉ (401) : un nouveau jeton, puis la tuile", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  const cop = await fauxCopernicus((appel) =>
    appel.auth === "Bearer jeton-1" ? { statut: 401 } : { octets: jpeg(5000) },
  );
  try {
    const r = await lancer(
      ["--zone", ZONE, "--zmin", "10", "--zmax", "10"],
      environnement(cop.base, dossier),
    );
    assert.equal(r.code, 0, r.sortie);
    assert.equal(cop.journal.jetons.length, 2);
    assert.equal(tuilesEcrites(dossier), planMosaique([lireZone(ZONE)], 10, 10).length);
  } finally {
    await cop.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("REFUS DU COMPTE : identifiants refusés, ou quota épuisé (403) — arrêt net, code 2", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  const cop = await fauxCopernicus(() => ({ statut: 403 }));
  try {
    const mauvais = await lancer(
      ["--zone", ZONE, "--zmin", "10", "--zmax", "11"],
      environnement(cop.base, dossier, "faux-secret"),
    );
    assert.equal(mauvais.code, 2);
    assert.match(mauvais.sortie, /refuse les identifiants \(HTTP 401\)/);
    assert.doesNotMatch(mauvais.sortie, /injoignable/, "un refus n'est pas une panne de réseau");
    assert.equal(cop.journal.process.length, 0, "rien n'est demandé sans jeton");
    const quota = await lancer(
      ["--zone", ZONE, "--zmin", "10", "--zmax", "11"],
      environnement(cop.base, dossier),
    );
    assert.equal(quota.code, 2);
    assert.match(quota.sortie, /HTTP 403 : le compte Copernicus refuse la requête/);
    assert.ok(cop.journal.process.length <= 4, "les ouvriers s'arrêtent dès le refus");
    assert.equal(tuilesEcrites(dossier), 0);
  } finally {
    await cop.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("COMPTE INJOIGNABLE (réseau coupé) : dit tout de suite, sans s'acharner tuile par tuile", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  try {
    const debut = Date.now();
    const r = await lancer(["--zone", ZONE, "--zmin", "10", "--zmax", "11"], {
      ...environnement("http://127.0.0.1:1", dossier),
    });
    assert.equal(r.code, 2);
    assert.match(r.sortie, /compte Copernicus injoignable .* vérifier la connexion du poste/);
    assert.ok(Date.now() - debut < 5000, "pas d'essais répétés pour chaque tuile");
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("QUOTA : un lot plus gros qu'un mois de compte gratuit est refusé sans --oui", async () => {
  const grand = ["--zone", "0,20,0,20", "--zmin", "12", "--zmax", "12"];
  const sans = await lancer(grand, {});
  assert.equal(sans.code, 2);
  assert.match(sans.sortie, /plus que le quota mensuel d'un compte gratuit/);
  const avec = await lancer([...grand, "--oui"], {});
  assert.equal(avec.code, 2);
  assert.match(avec.sortie, /compte Copernicus non réglé/, "avec --oui, on passe au compte");
});

test("RÉPONSE QUI N'EST PAS UNE IMAGE : comptée en échec, rien d'écrit, code 1", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "mosaique-"));
  const cop = await fauxCopernicus(() => ({ octets: Buffer.from("<html>portail captif</html>") }));
  try {
    const r = await lancer(
      ["--zone", ZONE, "--zmin", "10", "--zmax", "10"],
      environnement(cop.base, dossier),
    );
    assert.equal(r.code, 1);
    assert.match(r.sortie, /la réponse n'est pas une image JPEG/);
    assert.match(r.sortie, /Relancer la même commande reprend/);
    assert.equal(tuilesEcrites(dossier), 0);
  } finally {
    await cop.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
