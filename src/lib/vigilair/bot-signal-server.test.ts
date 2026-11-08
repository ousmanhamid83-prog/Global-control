import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { TROP_DE_COMMANDES } from "./bot-signal.ts";
import {
  BOT_PAR_MINUTE,
  RELAIS_DEFAUT,
  assurerBot,
  basculerBot,
  demanderAppairage,
  gererNumero,
  inscrireBot,
  lireEtatBot,
  suspendreBot,
  type EtatBot,
  type Poste,
} from "./bot-signal.server.ts";
import type { ResultatCommande } from "./commandes-poste.server.ts";

const POSTE = "+23566009999";
const CHEF = "+23566000001";
const AGENT = "+23566000002";
const INCONNU = "+23599999999";

// Faux relais signal-cli-rest-api : /v1/about, /v1/receive (HTTP en mode native, websocket en
// mode json-rpc), /v2/send — réponses copiées du vrai 0.101, sondé sur ce poste.
type Envoi = { message: string; number: string; recipients: string[] };
type Erreur = { statut: number; corps: string };
const DEPART = {
  mode: "native" as string | undefined,
  file: [] as unknown[],
  envois: [] as Envoi[],
  releves: 0,
  releveUrl: "",
  wsChemin: "",
  requetes: 0,
  erreurAbout: null as null | Erreur,
  corpsAbout: null as null | string,
  muetAbout: false,
  /** Numéros liés au relais (/v1/accounts) ; le vrai relais non lié répond []. */
  comptes: [POSTE] as string[],
  erreurReleve: null as null | Erreur,
  corpsReleve: null as null | string,
  /** Relèves retenues sans réponse, que le test libère quand il veut. */
  retenir: false,
  retenues: [] as ServerResponse[],
  erreurEnvoi: null as null | Erreur,
  refuserWs: false,
  muetWs: false,
  /** Poignées de main websocket acceptées depuis le début du test. */
  connexions: 0,
  /** Appels d'inscription reçus (chemin et corps), et réponse forcée s'il le faut. */
  inscriptions: [] as { methode: string; chemin: string; corps: Record<string, unknown> }[],
  erreurInscription: null as null | Erreur,
  erreurProfil: false,
  /** Recherches chez Signal (/v1/search) : numéros demandés ; ceux que Signal trouve. */
  recherches: [] as string[][],
  trouvables: [] as string[],
  /** Destinataires connus du compte du bot (/v1/contacts?all_recipients=true). */
  contacts: [] as { uuid: string; number: string }[],
  erreurContacts: false,
};
const relais = { ...DEPART, sockets: new Set<Socket>() };
let srv: Server;
let base = "";
let dossier = "";
const cwd = process.cwd();

const json = (res: ServerResponse, statut: number, corps: unknown) =>
  res.writeHead(statut, { "content-type": "application/json" }).end(JSON.stringify(corps));

before(async () => {
  dossier = mkdtempSync(path.join(tmpdir(), "bot-signal-"));
  process.chdir(dossier);
  srv = createServer((req, res) => {
    relais.requetes++;
    const u = new URL(req.url ?? "/", "http://relais");
    if (u.pathname === "/v1/about") {
      if (relais.muetAbout) return;
      if (relais.erreurAbout) return res.writeHead(relais.erreurAbout.statut).end(relais.erreurAbout.corps);
      if (relais.corpsAbout != null) return res.writeHead(200).end(relais.corpsAbout);
      return json(res, 200, { versions: ["v1", "v2"], build: 2, mode: relais.mode, version: "0.101" });
    }
    if (u.pathname === "/v1/accounts") return json(res, 200, relais.comptes);
    if (u.pathname.startsWith("/v1/search/")) {
      const numeros = u.searchParams.getAll("numbers");
      relais.recherches.push(numeros);
      return json(res, 200, numeros.map((n) => ({ number: n, registered: relais.trouvables.includes(n) })));
    }
    if (u.pathname.startsWith("/v1/contacts/") && u.searchParams.get("all_recipients") === "true") {
      if (relais.erreurContacts) return json(res, 400, { error: "contacts: échec" });
      return json(res, 200, relais.contacts.map((c) => ({ ...c, name: "", profile_name: "" })));
    }
    if (u.pathname.startsWith("/v1/register/") || u.pathname.startsWith("/v1/profiles/")) {
      let corps = "";
      req.on("data", (d) => (corps += d));
      req.on("end", () => {
        const lu = (corps ? JSON.parse(corps) : {}) as Record<string, unknown>;
        relais.inscriptions.push({ methode: req.method ?? "", chemin: u.pathname, corps: lu });
        if (relais.erreurInscription) {
          return res.writeHead(relais.erreurInscription.statut).end(relais.erreurInscription.corps);
        }
        if (relais.erreurProfil && u.pathname.startsWith("/v1/profiles/")) {
          return json(res, 500, { error: "profile update failed" });
        }
        const verif = u.pathname.match(/^\/v1\/register\/([^/]+)\/verify\/(\d+)$/);
        if (verif) {
          if (verif[2] !== "123456") return json(res, 400, { error: "Verification failed: wrong code" });
          relais.comptes.push(decodeURIComponent(verif[1]!));
          return res.writeHead(201).end();
        }
        if (u.pathname.startsWith("/v1/register/") && lu.captcha !== "signalcaptcha://bon") {
          return json(res, 400, { error: "Invalid captcha given" });
        }
        res.writeHead(u.pathname.startsWith("/v1/profiles/") ? 204 : 201).end();
      });
      return;
    }
    if (u.pathname.startsWith("/v1/receive/")) {
      relais.releves++;
      relais.releveUrl = req.url ?? "";
      if (relais.retenir) return void relais.retenues.push(res);
      if (relais.erreurReleve) return res.writeHead(relais.erreurReleve.statut).end(relais.erreurReleve.corps);
      if (relais.corpsReleve != null) return res.writeHead(200).end(relais.corpsReleve);
      return json(res, 200, relais.file.splice(0));
    }
    if (u.pathname === "/v2/send" && req.method === "POST") {
      let corps = "";
      req.on("data", (d) => (corps += d));
      req.on("end", () => {
        if (relais.erreurEnvoi) return res.writeHead(relais.erreurEnvoi.statut).end(relais.erreurEnvoi.corps);
        relais.envois.push(JSON.parse(corps) as Envoi);
        json(res, 201, { timestamp: String(Date.now()) });
      });
      return;
    }
    res.writeHead(404).end();
  });
  srv.on("upgrade", (req, socket: Socket) => {
    socket.on("error", () => {});
    if (relais.refuserWs) return socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    relais.sockets.add(socket);
    socket.on("close", () => relais.sockets.delete(socket));
    if (relais.muetWs) return;
    relais.connexions++;
    relais.wsChemin = req.url ?? "";
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    // Trame de fermeture du client : on répond par une fermeture, comme un vrai serveur.
    socket.on("data", (b: Buffer) => {
      if ((b[0]! & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0x00]));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

after(() => {
  srv.closeAllConnections();
  srv.close();
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});

/** Une trame texte poussée par la websocket du relais (non masquée, < 64 Kio). */
function pousserBrut(texte: string): void {
  const data = Buffer.from(texte);
  const n = data.length;
  const entete = n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 0xff]);
  for (const s of relais.sockets) s.write(Buffer.concat([entete, data]));
}
const pousser = (objet: unknown) => pousserBrut(JSON.stringify(objet));
/** Une trame texte en UTF-8 invalide : la websocket de Node la rejette (« error », puis « close »). */
const pousserInvalide = () => {
  for (const s of relais.sockets) s.write(Buffer.from([0x81, 0x02, 0xff, 0xfe]));
};

const g = globalThis as { __afriBot?: { gen: number } };

beforeEach(() => {
  process.env.AFRICONTROL_BOT_NUMERO = POSTE;
  process.env.AFRICONTROL_BOT_AUTORISES = `${CHEF}, ${AGENT}`;
  process.env.AFRICONTROL_BOT_RELAIS = base;
  Object.assign(relais, {
    ...DEPART,
    file: [],
    envois: [],
    retenues: [],
    comptes: [POSTE],
    inscriptions: [],
    recherches: [],
    trouvables: [],
    contacts: [],
  });
});

afterEach(async () => {
  await basculerBot(false, fauxPoste().poste);
  delete g.__afriBot;
  for (const r of relais.retenues) json(r, 200, []);
  rmSync(path.join(dossier, "data"), { recursive: true, force: true });
  await dormir(50);
});

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}

const etat = (): Promise<EtatBot> => lireEtatBot();

async function attendreQue(cond: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await dormir(10);
  }
  throw new Error(`délai dépassé : ${JSON.stringify(await etat())}`);
}

const erreurVaut = (texte: string) => async () => (await etat()).erreur?.texte === texte;

function enveloppe(de: string | null, message: string, extra: Record<string, unknown> = {}) {
  return {
    account: POSTE,
    envelope: {
      source: de ?? "6a1f0c2e-uuid",
      sourceNumber: de,
      sourceUuid: "6a1f0c2e-uuid",
      timestamp: Date.now(),
      dataMessage: { timestamp: Date.now(), message, ...extra },
    },
  };
}

function fauxPoste(executer?: Poste["executer"], journal?: Poste["journal"]) {
  const executees: [string, string][] = [];
  const ecrit: string[] = [];
  const poste: Poste = {
    executer:
      executer ??
      (async (texte, expediteur): Promise<ResultatCommande> => {
        executees.push([texte, expediteur]);
        return { ok: true, commande: texte.slice(1).split(" ")[0]!, lignes: [`réponse à ${texte}`], ms: 0.2 };
      }),
    journal:
      journal ??
      (async (de, titre, detail, severite) => void ecrit.push(`${severite} · ${de} · ${titre} · ${detail}`)),
  };
  return { poste, executees, journal: ecrit };
}

describe("bot Signal : réglage et activation", () => {
  it("LIVRÉ COUPÉ : rien n'écoute le relais tant que le chef ne l'active pas", async () => {
    await assurerBot(fauxPoste().poste);
    await dormir(300);
    assert.equal(relais.requetes, 0);
    const e = await etat();
    assert.equal(e.actif, false);
    assert.equal(e.ecoute, false);
    assert.deepEqual(e.reglage, { numero: "+235•••••999", autorises: 2, relais: base });
  });

  it("RÉGLAGE INCOMPLET : dit quoi régler, et rien ne part vers le relais", async () => {
    delete process.env.AFRICONTROL_BOT_NUMERO;
    assert.deepEqual((await etat()).reglage, {
      erreur:
        "Bot non réglé : pas encore de numéro propre au bot. L'inscrire ci-dessous (chef de division), ou AFRICONTROL_BOT_NUMERO dans poste.env (+235…).",
    });
    process.env.AFRICONTROL_BOT_NUMERO = "00235 66 00 99 99";
    process.env.AFRICONTROL_BOT_AUTORISES = "pas-un-numéro";
    assert.deepEqual((await etat()).reglage, {
      erreur:
        "Aucun numéro autorisé : en ajouter un ci-dessous (chef de division), ou AFRICONTROL_BOT_AUTORISES dans poste.env (+235…, séparés par des virgules).",
    });
    process.env.AFRICONTROL_BOT_AUTORISES = CHEF;
    delete process.env.AFRICONTROL_BOT_RELAIS;
    assert.deepEqual((await etat()).reglage, { numero: "+235•••••999", autorises: 1, relais: RELAIS_DEFAUT });
    process.env.AFRICONTROL_BOT_RELAIS = "https://signal.exemple.org";
    const e = await basculerBot(true, fauxPoste().poste);
    assert.ok("erreur" in e.reglage && /réseau du poste/.test(e.reglage.erreur));
    assert.equal(e.actif, true, "le chef l'a activé ; il attend son réglage");
    assert.equal(e.ecoute, false);
    assert.match(e.erreur!.texte, /^AFRICONTROL_BOT_RELAIS refusée/);
    assert.equal(relais.requetes, 0);
  });

  it("ÉTAT ENREGISTRÉ : actif au redémarrage, le bot reprend seul l'écoute ; coupé, il reste coupé", async () => {
    const f = fauxPoste();
    const e = await basculerBot(true, f.poste);
    assert.equal(e.enregistrement, "fichier");
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: true, numeros: [], numeroBot: null });
    // Redémarrage : l'écoute en cours s'arrête, l'état en mémoire disparaît, le fichier reste.
    g.__afriBot!.gen++;
    delete g.__afriBot;
    await dormir(300);
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await assurerBot(f.poste);
    await attendreQue(() => relais.envois.length === 1);
    assert.equal((await etat()).ecoute, true);
    await basculerBot(false, f.poste);
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: false, numeros: [], numeroBot: null });
    delete g.__afriBot;
    const avant = relais.requetes;
    await assurerBot(f.poste);
    await dormir(300);
    assert.equal(relais.requetes, avant);
  });

  it("NUMÉRO DE LA CONSOLE : ajouté coupé, activé sur demande du chef, effet au message suivant", async () => {
    const TROISIEME = "+23566000003";
    const f = fauxPoste();
    await basculerBot(true, f.poste);
    const ajout = await gererNumero("ajouter", "00235 66 00 00 03");
    assert.equal(ajout.numero, "+235•••••003");
    const n = ajout.etat.numeros.find((x) => x.source === "console")!;
    assert.deepEqual([n.numero, n.actif], ["+235•••••003", false]);
    assert.ok(!JSON.stringify(ajout.etat).includes(TROISIEME), "jamais en clair à l'écran");
    assert.equal((ajout.etat.reglage as { autorises: number }).autorises, 2, "poste.env seulement");
    assert.deepEqual(
      ajout.etat.numeros.filter((x) => x.source === "poste.env").map((x) => [x.numero, x.actif]),
      [
        ["+235•••••001", true],
        ["+235•••••002", true],
      ],
      "ceux de poste.env, listés, toujours écoutés",
    );
    // Coupé : ignoré, avec la raison, sans réponse ni journal (ce n'est pas un intrus).
    relais.file.push(enveloppe(TROISIEME, "/meteo"));
    await attendreQue(async () => (await etat()).compteurs.ignores === 1);
    assert.equal(
      (await etat()).ignores[0]!.raison,
      "numéro coupé par le chef : l'activer dans Capteurs › Outils › Bot Signal",
    );
    // Activé : servi dès le message suivant, sans redémarrage.
    const active = await gererNumero("activer", n.id);
    assert.equal((active.etat.reglage as { autorises: number }).autorises, 3);
    relais.file.push(enveloppe(TROISIEME, "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(relais.envois[0]!.recipients, [TROISIEME]);
    // Coupé de nouveau : ignoré. Retiré : un inconnu comme un autre, journalisé.
    await gererNumero("couper", n.id);
    relais.file.push(enveloppe(TROISIEME, "/meteo"));
    await attendreQue(async () => (await etat()).compteurs.ignores === 2);
    const retrait = await gererNumero("retirer", n.id);
    assert.equal(retrait.etat.numeros.filter((x) => x.source === "console").length, 0);
    relais.file.push(enveloppe(TROISIEME, "/meteo"));
    await attendreQue(() => f.journal.some((l) => l.includes("numéro non autorisé")));
    assert.equal(relais.envois.length, 1);
    assert.equal(f.journal.filter((l) => l.includes("numéro non autorisé")).length, 1, "seul le retiré compte");
  });

  it("NUMÉROS DE LA CONSOLE : enregistrés sur le poste, relus au redémarrage ; refus clairs", async () => {
    const f = fauxPoste();
    const { etat: e } = await gererNumero("ajouter", "+23566000003");
    await gererNumero("activer", e.numeros.find((x) => x.source === "console")!.id);
    const lu = JSON.parse(readFileSync("data/bot-signal.json", "utf8")) as { numeros: { numero: string; actif: boolean }[] };
    assert.deepEqual(lu.numeros.map((x) => [x.numero, x.actif]), [["+23566000003", true]]);
    delete g.__afriBot;
    assert.equal((await etat()).numeros.find((x) => x.source === "console")?.actif, true);
    await assert.rejects(gererNumero("ajouter", "66000003"), /Numéro invalide/);
    await assert.rejects(gererNumero("ajouter", "+235 66 00 00 03"), /déjà dans la liste/);
    await assert.rejects(gererNumero("ajouter", CHEF), /déjà réglé dans poste\.env/);
    await assert.rejects(gererNumero("couper", "00000000"), /introuvable/);
    // Sans poste.env, un numéro de la console suffit pour que le bot écoute et réponde.
    delete process.env.AFRICONTROL_BOT_AUTORISES;
    await basculerBot(true, f.poste);
    relais.file.push(enveloppe("+23566000003", "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(
      (await etat()).numeros.map((x) => [x.source, x.actif]),
      [["console", true]],
    );
  });

  it("NUMÉRO PROPRE AU BOT : inscrit depuis la console (captcha, code), enregistré, et le bot l'écoute", async () => {
    const BOT = "+23566000827";
    delete process.env.AFRICONTROL_BOT_NUMERO;
    const f = fauxPoste();
    const avant = await basculerBot(true, f.poste);
    assert.equal(avant.sourceNumero, null);
    assert.match((avant.reglage as { erreur: string }).erreur, /^Bot non réglé : pas encore de numéro propre au bot/);
    const code = await inscrireBot({ etape: "code", numero: "00235 66 00 08 27", captcha: " signalcaptcha://bon ", voix: false }, f.poste);
    assert.deepEqual([code.ok, code.numero], [true, "+235•••••827"]);
    assert.equal(code.message, "Code demandé par SMS au +235•••••827 : le saisir ci-dessous.");
    assert.deepEqual(relais.inscriptions[0], {
      methode: "POST",
      chemin: `/v1/register/${BOT}`,
      corps: { captcha: "signalcaptcha://bon", use_voice: false },
    });
    const ok = await inscrireBot({ etape: "valider", numero: BOT, code: "123-456", pin: "", nom: "" }, f.poste);
    assert.equal(ok.ok, true);
    assert.equal(ok.message, "Numéro +235•••••827 inscrit chez Signal : c'est désormais celui du bot, profil « AfriControl ».");
    assert.deepEqual(
      relais.inscriptions.slice(1).map((x) => [x.methode, x.chemin, JSON.stringify(x.corps)]),
      [
        ["POST", `/v1/register/${BOT}/verify/123456`, "{}"],
        ["PUT", `/v1/profiles/${BOT}`, '{"name":"AfriControl"}'],
      ],
    );
    assert.equal(ok.etat.sourceNumero, "console");
    assert.equal((ok.etat.reglage as { numero: string }).numero, "+235•••••827");
    // Vu sur le vrai relais : « pas encore de numéro » restait affiché sous l'inscription réussie.
    assert.equal(ok.etat.erreur, null, "l'erreur de l'ancien réglage n'est plus dite");
    assert.equal(
      (JSON.parse(readFileSync("data/bot-signal.json", "utf8")) as { numeroBot: string }).numeroBot,
      BOT,
    );
    // Le bot écoute désormais SON numéro et répond depuis lui.
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
    assert.equal(relais.envois[0]!.number, BOT);
    assert.equal(new URL(relais.releveUrl, base).pathname, `/v1/receive/${BOT}`);
    // poste.env, s'il en donne un, l'emporte.
    process.env.AFRICONTROL_BOT_NUMERO = POSTE;
    assert.equal((await etat()).sourceNumero, "poste.env");
  });

  it("INSCRIPTION : chaque refus dit quoi faire, sans rien enregistrer", async () => {
    const f = fauxPoste();
    const essai = (i: Parameters<typeof inscrireBot>[0]) => inscrireBot(i, f.poste).then((r) => [r.ok, r.message]);
    const code = { etape: "code" as const, numero: "+23566000827", captcha: "signalcaptcha://bon", voix: true };
    const valider = { etape: "valider" as const, numero: "+23566000827", code: "123456", pin: "", nom: "Bot" };
    assert.deepEqual(await essai({ ...code, numero: "66000827" }), [
      false,
      "Numéro invalide : au format +235… ou 00235…, indicatif du pays compris.",
    ]);
    assert.deepEqual(await essai({ ...code, captcha: "signal-hcaptcha.5fad…" }), [
      false,
      "Captcha : coller le lien entier, qui commence par « signalcaptcha:// ».",
    ]);
    assert.deepEqual(await essai({ ...code, captcha: "signalcaptcha://perime" }), [
      false,
      "Signal refuse le captcha (expiré ou invalide) : en refaire un sur signalcaptchas.org et le recoller aussitôt.",
    ]);
    assert.deepEqual(await essai(code), [true, "Code demandé par appel au +235•••••827 : le saisir ci-dessous."]);
    assert.deepEqual(await essai({ ...valider, code: "12345" }), [false, "Code : les six chiffres reçus par SMS ou par appel."]);
    assert.deepEqual(await essai({ ...valider, code: "654321" }), [
      false,
      "Code refusé : vérifier les six chiffres reçus, ou redemander un code.",
    ]);
    relais.erreurInscription = { statut: 429, corps: "" };
    assert.deepEqual(await essai(code), [false, "Signal limite les demandes pour ce numéro : réessayer dans quelques heures."]);
    relais.erreurInscription = { statut: 400, corps: JSON.stringify({ error: "Account is registration locked, pin required" }) };
    assert.deepEqual(await essai(valider), [false, "Ce numéro a un verrou d'inscription : saisir son code PIN Signal."]);
    relais.erreurInscription = { statut: 500, corps: JSON.stringify({ error: `boom pour +23566000827` }) };
    assert.deepEqual(await essai(code), [false, "Relais Signal : HTTP 500 — boom pour +235•••••827."]);
    relais.erreurInscription = null;
    // Avec le PIN : il part avec la validation.
    await essai({ ...valider, pin: " 4321 " });
    assert.deepEqual(relais.inscriptions.at(-2)!.corps, { pin: "4321" });
    // Profil refusé : le numéro est inscrit quand même, et l'écran le dit.
    relais.erreurProfil = true;
    assert.deepEqual(await essai(valider), [
      true,
      "Numéro +235•••••827 inscrit chez Signal : c'est désormais celui du bot (profil non nommé : Relais Signal : HTTP 500 — profile update failed.).",
    ]);
    relais.erreurProfil = false;
    // Relais hors du poste, ou injoignable : rien ne part, et c'est dit.
    process.env.AFRICONTROL_BOT_RELAIS = "https://signal.exemple.org";
    assert.match((await essai(code))[1] as string, /^AFRICONTROL_BOT_RELAIS refusée/);
    process.env.AFRICONTROL_BOT_RELAIS = base;
    const ferme = createServer();
    await new Promise<void>((ok) => ferme.listen(0, "127.0.0.1", ok));
    const port = (ferme.address() as AddressInfo).port;
    await new Promise<void>((ok) => ferme.close(() => ok()));
    process.env.AFRICONTROL_BOT_RELAIS = `http://127.0.0.1:${port}`;
    assert.deepEqual(await essai(code), [false, `Relais Signal injoignable à http://127.0.0.1:${port} (ECONNREFUSED).`]);
  });

  it("DISQUE EN LECTURE SEULE : la bascule vaut jusqu'au redémarrage, et le dit", async () => {
    writeFileSync("data", "un fichier là où le dossier devrait être");
    const e = await basculerBot(true, fauxPoste().poste);
    assert.equal(e.actif, true);
    assert.equal(e.enregistrement, "memoire");
    rmSync("data");
  });
});

describe("bot Signal : relais en mode native (relève continue)", () => {
  it("COMMANDE D'UN AUTORISÉ : exécutée, réponse à lui seul, au journal, numéros masqués", async () => {
    const f = fauxPoste();
    relais.file.push(enveloppe(CHEF, "/situation"));
    assert.equal((await basculerBot(true, f.poste)).actif, true);
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(f.executees, [["/situation", CHEF]]);
    const envoi = relais.envois[0]!;
    assert.equal(envoi.number, POSTE);
    assert.deepEqual(envoi.recipients, [CHEF]);
    assert.match(envoi.message, /^réponse à \/situation\n— poste AfriControl, [\d,]+ ms$/);
    const u = new URL(relais.releveUrl, base);
    assert.equal(u.pathname, `/v1/receive/${POSTE}`);
    assert.equal(u.searchParams.get("timeout"), "1");
    assert.equal(u.searchParams.get("ignore_attachments"), "true");
    assert.equal(u.searchParams.get("ignore_stories"), "true");
    await attendreQue(() => f.journal.length === 1);
    assert.match(
      f.journal[0]!,
      /^info · \+235•••••001 · \/situation par le bot Signal · « \/situation » · exécutée en [\d,]+ ms · réponse remise au relais$/,
    );
    const e = await etat();
    assert.equal(e.mode, "native");
    assert.equal(e.ecoute, true);
    assert.equal(e.erreur, null);
    assert.ok(e.dernierContact != null);
    assert.deepEqual(e.compteurs, { recus: 1, executees: 1, reponses: 1, ignores: 0, echecsEnvoi: 0 });
    const x = e.echanges[0]!;
    assert.deepEqual([x.de, x.commande, x.ok, x.erreurEnvoi], ["+235•••••001", "/situation", true, null]);
    assert.ok(typeof x.envoiMs === "number" && x.ms >= 0);
    assert.ok(!JSON.stringify(e).includes(CHEF), "aucun numéro en clair dans l'état");
  });

  it("INCONNU, GROUPE, NUMÉRO MASQUÉ : aucune réponse ; l'inconnu au journal une fois", async () => {
    const f = fauxPoste();
    relais.file.push(
      ...Array.from({ length: 4 }, () => enveloppe(INCONNU, "/situation")),
      enveloppe(CHEF, "/aide", { groupInfo: { groupId: "Zw==", type: "DELIVER" } }),
      enveloppe(null, "/aide"),
    );
    await basculerBot(true, f.poste);
    await attendreQue(async () => (await etat()).compteurs.ignores === 6);
    await dormir(300);
    assert.equal(relais.envois.length, 0);
    assert.deepEqual(f.executees, []);
    assert.deepEqual(f.journal, [
      "warn · +235•••••999 · Bot Signal : numéro non autorisé · Message ignoré, sans réponse.",
    ]);
    const ignores = (await etat()).ignores;
    assert.equal(ignores.length, 5, "les cinq derniers seulement");
    assert.deepEqual(
      [...new Set(ignores.map((i) => `${i.de} · ${i.raison}`))].sort(),
      [
        "+235•••••001 · message de groupe",
        "+235•••••999 · numéro non autorisé",
        "numéro masqué · numéro masqué par Signal, inconnu du bot : si c'est un numéro autorisé, régler sur son téléphone Signal › Confidentialité › Numéro de téléphone › « Qui peut me trouver par mon numéro » : « Tout le monde »",
      ],
    );
  });

  it(`TROP DE MESSAGES : ${BOT_PAR_MINUTE} exécutés par numéro, un avertissement, puis le silence`, async () => {
    const f = fauxPoste();
    for (const de of [CHEF, AGENT]) {
      for (let i = 0; i < BOT_PAR_MINUTE + 2; i++) relais.file.push(enveloppe(de, `/meteo ${i}`));
    }
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.envois.length === 2 * (BOT_PAR_MINUTE + 1));
    await attendreQue(async () => (await etat()).compteurs.ignores === 2);
    assert.equal(f.executees.length, 2 * BOT_PAR_MINUTE);
    assert.deepEqual(
      relais.envois
        .filter((x) => x.message === TROP_DE_COMMANDES)
        .map((x) => x.recipients[0])
        .sort(),
      [CHEF, AGENT],
    );
    assert.equal((await etat()).echanges.length, 10, "les dix derniers échanges");
  });

  it("UN NUMÉRO LENT NE RETIENT NI LA RELÈVE NI LES AUTRES ; chacun garde l'ordre de ses réponses", async () => {
    const f = fauxPoste(async (texte): Promise<ResultatCommande> => {
      if (texte.startsWith("/ia")) await dormir(1500);
      return { ok: true, commande: texte.slice(1).split(" ")[0]!, lignes: [texte], ms: 1 };
    });
    relais.file.push(enveloppe(AGENT, "/ia longue question"), enveloppe(AGENT, "/aide"));
    await basculerBot(true, f.poste);
    // Le /meteo du chef arrive à la relève SUIVANTE, pendant que le /ia tourne encore.
    await attendreQue(() => relais.releves >= 2);
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 3);
    assert.deepEqual(
      relais.envois.map((x) => `${x.recipients[0]} ${x.message.split("\n")[0]}`),
      [`${CHEF} /meteo`, `${AGENT} /ia longue question`, `${AGENT} /aide`],
    );
  });

  it("MESSAGE ARRIVÉ PENDANT QU'UN NUMÉRO ATTEND : il passe après les siens, dans l'ordre", async () => {
    const f = fauxPoste(async (texte): Promise<ResultatCommande> => {
      if (texte !== "/aide") await dormir(1000);
      return { ok: true, commande: texte.slice(1), lignes: [texte], ms: 1 };
    });
    relais.file.push(enveloppe(AGENT, "/ia"), enveloppe(AGENT, "/briefing"));
    await basculerBot(true, f.poste);
    // /ia fini, /briefing en cours : le /aide qui arrive maintenant doit l'attendre.
    await attendreQue(() => relais.envois.length === 1);
    relais.file.push(enveloppe(AGENT, "/aide"));
    await attendreQue(() => relais.envois.length === 3);
    assert.deepEqual(
      relais.envois.map((x) => x.message.split("\n")[0]),
      ["/ia", "/briefing", "/aide"],
    );
    const files = (g.__afriBot as unknown as { files: Map<string, unknown> }).files;
    await attendreQue(() => files.size === 0, 2000); // files vidées, oubliées
  });

  it("PÉRIMÉ : envoyé pendant que le bot était coupé — dit, pas exécuté", async () => {
    const f = fauxPoste();
    const vieux = enveloppe(CHEF, "/situation");
    vieux.envelope.timestamp = Date.now() - 10 * 60_000;
    relais.file.push(vieux);
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await basculerBot(true, f.poste);
    // Même numéro, même file : quand /meteo est au journal, le message périmé est fini.
    await attendreQue(() => f.journal.length === 1);
    assert.match(relais.envois[0]!.message, /trop ancien, non exécuté/);
    assert.deepEqual(f.executees, [["/meteo", CHEF]], "le périmé n'est pas exécuté");
    assert.equal((await etat()).echanges[1]!.commande, "—");
    assert.match(f.journal[0]!, /\/meteo par le bot Signal/, "rien d'exécuté, rien au journal pour le périmé");
    assert.equal((await etat()).erreur, null, "aucune erreur en chemin");
  });

  it("COMMANDE QUI PLANTE, RÉSULTAT MALFORMÉ : dits, et les messages suivants passent", async () => {
    let n = 0;
    const f = fauxPoste(async (): Promise<ResultatCommande> => {
      n++;
      if (n === 1) throw new Error("base indisponible");
      if (n === 2) return { ok: true, commande: "aide", lignes: null, ms: 0 } as unknown as ResultatCommande;
      return { ok: true, commande: "meteo", lignes: ["METAR FTTJ"], ms: 1 };
    });
    relais.file.push(enveloppe(CHEF, "/situation"), enveloppe(CHEF, "/aide"), enveloppe(CHEF, "/meteo"));
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.envois.length === 2);
    assert.match(
      relais.envois[0]!.message,
      /^La commande n'a pas abouti au poste \(base indisponible\) : la passer à la console\.\n— poste AfriControl/,
    );
    assert.match(relais.envois[1]!.message, /^METAR FTTJ\n/);
    const e = await etat();
    assert.deepEqual(
      e.echanges.map((x) => [x.commande, x.ok]),
      [
        ["/meteo", true],
        ["/situation", false],
      ],
    );
    assert.match(e.erreur!.texte, /^Bot Signal : /);
  });

  it("JOURNAL EN PANNE : la réponse part quand même, et la panne est dite", async () => {
    const f = fauxPoste(undefined, async () => {
      throw new Error("base en lecture seule");
    });
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await basculerBot(true, f.poste);
    await attendreQue(erreurVaut("Journal des opérations : base en lecture seule."));
    assert.equal(relais.envois.length, 1);
  });

  it("RÉPONSE REFUSÉE PAR LE RELAIS : comptée, dite (numéro masqué), et le bot continue", async () => {
    const f = fauxPoste();
    relais.erreurEnvoi = {
      statut: 400,
      corps: JSON.stringify({ error: `Failed to send message: Unregistered user "${CHEF}"` }),
    };
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await basculerBot(true, f.poste);
    await attendreQue(async () => (await etat()).compteurs.echecsEnvoi === 1);
    const attendu = 'Relais Signal : HTTP 400 — Failed to send message: Unregistered user "+235•••••001".';
    const e = await etat();
    assert.deepEqual([e.echanges[0]!.erreurEnvoi, e.echanges[0]!.envoiMs], [attendu, null]);
    assert.equal(e.erreur!.texte, attendu);
    await attendreQue(() => f.journal.length === 1);
    assert.ok(f.journal[0]!.endsWith(`réponse non remise : ${attendu}`), f.journal[0]);
    relais.erreurEnvoi = null;
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
  });

  it("NUMÉRO DU BOT NON INSCRIT : le dit, et où l'inscrire ; pause doublée, qui repart d'1 s après une reprise", async () => {
    relais.erreurReleve = {
      statut: 400,
      corps: JSON.stringify({
        error: `INFO  AccountsStore - Config file is in use by another instance, waiting…\nUser ${POSTE} is not registered.\n`,
      }),
    };
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(async () => (await etat()).erreur !== null);
    assert.equal(
      (await etat()).erreur!.texte,
      `Le numéro +235•••••999 n'est pas inscrit au relais Signal (${base}) : l'inscrire dans Capteurs › Outils › Bot Signal › Numéro propre au bot (chef de division).`,
    );
    // Échecs à 0 s, 1 s, 3 s, puis 7 s : trois relèves en 3,4 s, pas une par seconde.
    await dormir(3400);
    assert.equal(relais.releves, 3);
    assert.equal((await etat()).ecoute, true, "il réessaie seul");
    relais.erreurReleve = null;
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 1, 6000);
    assert.equal((await etat()).erreur, null);
    // Nouvelle panne après une reprise : un essai tout de suite, le suivant 1 s après — pas 8 s.
    const avant = relais.releves;
    relais.erreurReleve = { statut: 500, corps: "" };
    await dormir(1600);
    assert.equal(relais.releves - avant, 2);
    assert.equal((await etat()).erreur!.texte, "Relais Signal : HTTP 500.");
  });

  it("NUMÉRO ABSENT DES COMPTES DU RELAIS : dit aussitôt, sans relève ni websocket (les deux modes)", async () => {
    relais.comptes = [];
    const attendu = `Le numéro +235•••••999 n'est pas inscrit au relais Signal (${base}) : l'inscrire dans Capteurs › Outils › Bot Signal › Numéro propre au bot (chef de division).`;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(attendu));
    assert.equal((await etat()).mode, "native", "le mode du relais reste affiché");
    relais.mode = "json-rpc";
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(attendu));
    await dormir(300);
    assert.equal(relais.releves, 0);
    assert.equal(relais.sockets.size, 0, "pas de websocket muette ouverte pour rien");
    // Le numéro est inscrit ensuite : le bot le voit à son prochain essai, seul.
    relais.comptes = [POSTE];
    await attendreQue(() => relais.sockets.size === 1, 5000);
  });

  it("RELAIS EN ERREUR OU AUTRE SERVICE SUR LE PORT : dit tel quel", async () => {
    relais.erreurAbout = { statut: 503, corps: "maintenance\n" };
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut("Relais Signal : HTTP 503 — maintenance."));
    relais.erreurAbout = null;
    relais.corpsAbout = "<!doctype html><title>SearXNG</title>";
    await attendreQue(
      erreurVaut(
        `${base}/v1/about ne répond pas comme un relais signal-cli-rest-api : vérifier AFRICONTROL_BOT_RELAIS.`,
      ),
      5000,
    );
  });

  it("RELAIS INJOIGNABLE OU MUET : le dit", async () => {
    const ferme = createServer();
    await new Promise<void>((ok) => ferme.listen(0, "127.0.0.1", ok));
    const port = (ferme.address() as AddressInfo).port;
    await new Promise<void>((ok) => ferme.close(() => ok()));
    process.env.AFRICONTROL_BOT_RELAIS = `http://127.0.0.1:${port}`;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(`Relais Signal injoignable à http://127.0.0.1:${port} (ECONNREFUSED).`));
    process.env.AFRICONTROL_BOT_RELAIS = base;
    relais.muetAbout = true;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(`Relais Signal injoignable à ${base} (pas de réponse à temps).`), 8000);
  });

  it("RELAIS SANS MODE ANNONCÉ, RÉPONSE ILLISIBLE, RÉPONSE IMMÉDIATE : relevé quand même, sans boucle à vide", async () => {
    relais.mode = undefined;
    relais.corpsReleve = "<html>pas du JSON</html>";
    await basculerBot(true, fauxPoste().poste);
    await dormir(600);
    assert.ok(relais.releves >= 2 && relais.releves <= 4, `relèves en 600 ms : ${relais.releves}`);
    const e = await etat();
    assert.equal(e.mode, "normal");
    assert.equal(e.erreur, null);
    relais.corpsReleve = null;
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
  });

  it("ÉTAT LU PENDANT L'ÉCOUTE (la console qui l'affiche) : l'écoute n'est pas relancée", async () => {
    const f = fauxPoste();
    relais.retenir = true;
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.retenues.length === 1);
    for (let i = 0; i < 3; i++) await assurerBot(f.poste);
    relais.retenir = false;
    json(relais.retenues.shift()!, 200, [enveloppe(CHEF, "/meteo")]);
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(f.executees, [["/meteo", CHEF]], "la relève en cours n'a pas été abandonnée");
  });

  it("COUPÉ : plus aucune relève, et un message relevé pendant la coupure n'est pas exécuté", async () => {
    const f = fauxPoste();
    relais.retenir = true;
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.retenues.length === 1);
    assert.equal((await basculerBot(false, f.poste)).ecoute, false, "coupé : plus à l'écoute");
    json(relais.retenues.shift()!, 200, [enveloppe(CHEF, "/meteo")]);
    await dormir(500);
    assert.equal(relais.releves, 1);
    assert.equal(relais.envois.length, 0);
    assert.deepEqual(f.executees, []);
    assert.equal((await etat()).ecoute, false);
  });

  it("ARRÊT DU SERVEUR : la relève en cours va à son terme et répond, puis plus rien ; reste actif", async () => {
    const f = fauxPoste();
    relais.retenir = true;
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.retenues.length === 1);
    suspendreBot();
    relais.retenir = false;
    json(relais.retenues.shift()!, 200, [enveloppe(CHEF, "/meteo")]);
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(f.executees, [["/meteo", CHEF]], "le message déjà relevé n'est pas perdu");
    await dormir(500);
    assert.equal(relais.releves, 1, "plus aucune relève");
    await assurerBot(f.poste); // une console qui lit l'état pendant la fermeture
    await dormir(300);
    assert.equal(relais.releves, 1, "la lecture de l'état ne relance pas l'écoute");
    const e = await etat();
    assert.deepEqual([e.actif, e.ecoute, e.erreur], [true, false, null]);
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: true, numeros: [], numeroBot: null });
  });

  it("COUPÉ PENDANT UNE RELÈVE QUI ÉCHOUE : aucune panne affichée pour un bot coupé", async () => {
    relais.retenir = true;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(() => relais.retenues.length === 1);
    await basculerBot(false, fauxPoste().poste);
    relais.retenues.shift()!.writeHead(500).end("panne");
    await dormir(300);
    assert.equal((await etat()).erreur, null);
  });
});

describe("bot Signal : relais en mode json-rpc (websocket)", () => {
  it("MESSAGE POUSSÉ : exécuté sans relève, réponse à l'expéditeur ; coupé, la websocket se ferme", async () => {
    relais.mode = "json-rpc";
    const f = fauxPoste();
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.sockets.size === 1);
    assert.equal(relais.wsChemin, `/v1/receive/${POSTE}`);
    pousserBrut("{pas du JSON");
    pousser("pas une enveloppe");
    pousser(enveloppe(AGENT, "/situation"));
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(relais.envois[0]!.recipients, [AGENT]);
    assert.deepEqual(f.executees, [["/situation", AGENT]]);
    assert.equal((await etat()).mode, "json-rpc");
    assert.equal(relais.releves, 0, "pas de relève HTTP en json-rpc");
    pousser({ error: "Specified account does not exist" });
    await attendreQue(async () => /^Le numéro \+235•••••999 n'est pas inscrit/.test((await etat()).erreur?.texte ?? ""));
    pousser({ error: `Rate limit exceeded for ${CHEF}` });
    await attendreQue(erreurVaut("Relais Signal — Rate limit exceeded for +235•••••001."));
    await basculerBot(false, f.poste);
    await attendreQue(() => relais.sockets.size === 0);
  });

  it("WEBSOCKET COUPÉE PAR LE RELAIS : dit, reconnexion seule, puis connexion tenue", async () => {
    relais.mode = "json-rpc";
    const f = fauxPoste();
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.sockets.size === 1);
    for (const s of relais.sockets) s.destroy();
    await attendreQue(erreurVaut("Relais Signal : websocket fermée aussitôt ouverte."));
    await attendreQue(() => relais.connexions === 2 && relais.sockets.size === 1, 5000);
    const reconnecte = Date.now();
    pousser(enveloppe(CHEF, "/meteo"));
    await attendreQue(() => relais.envois.length === 1);
    // Au-delà du délai de poignée de main (5 s), la connexion ouverte tient.
    await dormir(5600 - (Date.now() - reconnecte));
    assert.equal(relais.sockets.size, 1);
    assert.equal((await etat()).erreur, null);
  });

  it("ARRÊT DU SERVEUR EN JSON-RPC : websocket fermée, sans reconnexion ni panne affichée", async () => {
    relais.mode = "json-rpc";
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(() => relais.sockets.size === 1);
    suspendreBot();
    await attendreQue(() => relais.sockets.size === 0);
    await dormir(1500);
    assert.equal(relais.connexions, 1, "pas de reconnexion");
    const e = await etat();
    assert.deepEqual([e.ecoute, e.erreur], [false, null]);
  });

  it("TRAME INVALIDE DU RELAIS : websocket fermée (pas « injoignable »), puis reconnexion", async () => {
    relais.mode = "json-rpc";
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(() => relais.sockets.size === 1);
    pousserInvalide();
    await attendreQue(erreurVaut("Relais Signal : websocket fermée aussitôt ouverte."));
    await attendreQue(() => relais.connexions === 2, 5000);
  });

  it("WEBSOCKET REFUSÉE, OU POIGNÉE DE MAIN SANS RÉPONSE : relais dit injoignable, le bot réessaie", async () => {
    relais.mode = "json-rpc";
    relais.refuserWs = true;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(
      erreurVaut(`Relais Signal injoignable à ${base} (websocket : Received network error or non-101 status code).`),
    );
    relais.refuserWs = false;
    relais.muetWs = true;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(`Relais Signal injoignable à ${base} (websocket : pas de réponse à temps).`), 8000);
    assert.equal((await etat()).ecoute, true);
  });
});

describe("bot Signal : numéro masqué par Signal (réglage par défaut depuis 2024)", () => {
  it("RECHERCHE À L'ÉCOUTE : les numéros écoutés cherchés chez Signal, trouvables ou non à l'écran", async () => {
    relais.trouvables = [CHEF];
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(() => relais.recherches.length === 1);
    assert.deepEqual([...relais.recherches[0]!].sort(), [CHEF, AGENT].sort());
    await attendreQue(async () => (await etat()).numeros.every((n) => n.surSignal !== null));
    assert.deepEqual(
      (await etat()).numeros.map((n) => [n.numero, n.surSignal]),
      [
        ["+235•••••001", true],
        ["+235•••••002", false],
      ],
    );
  });

  it("MASQUÉ, COMPTE CONNU DU BOT : reconnu, exécuté, réponse à son numéro ; une recherche par 30 s au plus", async () => {
    relais.contacts = [
      { uuid: "autre-uuid", number: AGENT },
      { uuid: "6a1f0c2e-uuid", number: CHEF },
    ];
    const f = fauxPoste();
    relais.file.push(enveloppe(null, "/meteo"), enveloppe(null, "Situation"));
    await basculerBot(true, f.poste);
    await attendreQue(() => relais.envois.length === 2);
    assert.deepEqual(f.executees, [
      ["/meteo", CHEF],
      ["/situation", CHEF],
    ]);
    // Numéro masqué : la réponse va au compte, que le relais joint toujours.
    assert.deepEqual(
      relais.envois.map((x) => x.recipients),
      [["6a1f0c2e-uuid"], ["6a1f0c2e-uuid"]],
    );
    assert.deepEqual(
      (await etat()).echanges.map((x) => x.de),
      ["+235•••••001", "+235•••••001"],
    );
    assert.equal(relais.recherches.length, 1, "celle de l'écoute suffit : moins de 30 s");
  });

  it("MASQUÉ, COMPTE INCONNU OU RELAIS EN PANNE : ignoré, dit pourquoi, et le bot continue", async () => {
    const f = fauxPoste();
    relais.file.push(enveloppe(null, "/meteo"));
    await basculerBot(true, f.poste);
    await attendreQue(async () => (await etat()).compteurs.ignores === 1);
    assert.match((await etat()).ignores[0]!.raison, /^numéro masqué par Signal, inconnu du bot/);
    relais.erreurContacts = true;
    relais.contacts = [{ uuid: "6a1f0c2e-uuid", number: CHEF }];
    relais.file.push(enveloppe(null, "/meteo"), enveloppe(CHEF, "/aide"));
    await attendreQue(async () => (await etat()).compteurs.ignores === 2 && relais.envois.length === 1);
    assert.deepEqual(f.executees, [["/aide", CHEF]]);
    assert.equal((await etat()).erreur, null, "une résolution manquée n'est pas une panne du bot");
  });

  it("ACTIVÉ PAR LE CHEF PENDANT L'ÉCOUTE : cherché aussitôt chez Signal ; ajouté coupé, non", async () => {
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(() => relais.recherches.length === 1);
    const ajout = await gererNumero("ajouter", "+23566000003");
    await dormir(100);
    assert.equal(relais.recherches.length, 1, "ajouté coupé : pas cherché");
    relais.trouvables = ["+23566000003"];
    await gererNumero("activer", ajout.etat.numeros.find((x) => x.source === "console")!.id);
    await attendreQue(() => relais.recherches.length === 2);
    assert.ok(relais.recherches[1]!.includes("+23566000003"));
    await attendreQue(async () => (await etat()).numeros.find((x) => x.source === "console")?.surSignal === true);
  });
});

describe("bot Signal : appairage d'un téléphone par un code du chef", () => {
  const TROIS = "+23566000003";
  const COMPTE = "6a1f0c2e-uuid";
  const g2 = globalThis as { __afriBot?: { appairage: { expireA: number } | null } };

  /** Bot actif, un numéro de la console activé ; rend son identifiant d'écran. */
  async function pret(f: ReturnType<typeof fauxPoste>): Promise<string> {
    await basculerBot(true, f.poste);
    const id = (await gererNumero("ajouter", TROIS)).etat.numeros.find((x) => x.source === "console")!.id;
    await gererNumero("activer", id);
    return id;
  }

  it("BON CODE DU TÉLÉPHONE MASQUÉ : appairé, réponse à son compte ; ses commandes valent ensuite celles du numéro", async () => {
    const f = fauxPoste();
    const id = await pret(f);
    const avant = Date.now();
    const a = await demanderAppairage(id);
    assert.match(a.code, /^\d{6}$/);
    assert.ok(a.expireA >= avant + 300_000 && a.expireA <= Date.now() + 300_000);
    assert.deepEqual(a.etat.appairage, { numero: "+235•••••003", expireA: a.expireA }, "sans le code");
    relais.file.push(enveloppe(null, `Appairer ${a.code.slice(0, 3)} ${a.code.slice(3)}`));
    await attendreQue(() => relais.envois.length === 1);
    assert.deepEqual(relais.envois[0]!.recipients, [COMPTE]);
    assert.equal(
      relais.envois[0]!.message,
      "Téléphone appairé au poste AfriControl : le bot le reconnaît désormais comme +235•••••003. Envoyer « aide » pour la liste des commandes.",
    );
    const e = await etat();
    assert.equal(e.appairage, null, "un code ne sert qu'une fois");
    assert.equal(e.numeros.find((x) => x.source === "console")!.appaire, true);
    assert.equal(e.echanges[0]!.commande, "appairage");
    const disque = JSON.parse(readFileSync("data/bot-signal.json", "utf8")) as { numeros: { compte?: string }[] };
    assert.equal(disque.numeros[0]!.compte, COMPTE);
    assert.ok(f.journal.includes(
      "warn · +235•••••003 · Bot Signal : +235•••••003 appairé à un compte Signal · Par le code du chef ; numéro masqué par Signal. Réponse remise au relais.",
    ));
    // Ses commandes ensuite : sous le numéro de la console, sans recherche au relais.
    const recherches = relais.recherches.length;
    relais.file.push(enveloppe(null, "meteo"));
    await attendreQue(() => relais.envois.length === 2);
    assert.deepEqual(f.executees, [["/meteo", TROIS]]);
    assert.deepEqual(relais.envois[1]!.recipients, [COMPTE]);
    assert.equal(relais.recherches.length, recherches);
    // Coupé par le chef : plus rien, même appairé.
    await gererNumero("couper", id);
    relais.file.push(enveloppe(null, "/meteo"));
    await attendreQue(async () => (await etat()).compteurs.ignores === 1);
    assert.match((await etat()).ignores[0]!.raison, /^numéro coupé par le chef/);
    assert.ok(f.journal.every((l) => !l.includes(a.code)), "jamais le code au journal");
  });

  it("CODES FAUX : sans réponse, journalisés sans le code ; au troisième, appairage annulé", async () => {
    const f = fauxPoste();
    const id = await pret(f);
    const { code } = await demanderAppairage(id);
    const faux = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) relais.file.push(enveloppe(null, `appairer ${faux}`));
    await attendreQue(async () => (await etat()).compteurs.ignores === 3);
    assert.equal((await etat()).appairage, null);
    assert.deepEqual(
      (await etat()).ignores.map((x) => x.raison),
      ["code d'appairage faux : appairage annulé (3 essais)", "code d'appairage faux", "code d'appairage faux"],
    );
    assert.deepEqual(
      f.journal.filter((l) => l.includes("code d'appairage faux")).map((l) => l.split(" · ").at(-1)),
      [
        "Essai 1 sur 3. Aucun code n'est journalisé.",
        "Essai 2 sur 3. Aucun code n'est journalisé.",
        "Essai 3 sur 3 : appairage annulé. Aucun code n'est journalisé.",
      ],
    );
    // Le bon code, après l'annulation : ne vaut plus.
    relais.file.push(enveloppe(null, `appairer ${code}`));
    await attendreQue(async () => (await etat()).compteurs.ignores === 4);
    assert.match((await etat()).ignores[0]!.raison, /^code d'appairage sans appairage en cours/);
    assert.equal(relais.envois.length, 0);
    assert.equal((await etat()).numeros.find((x) => x.source === "console")!.appaire, false);
    assert.ok(f.journal.every((l) => !l.includes(code) && !l.includes(faux)));
  });

  it("EXPIRÉ, EN GROUPE, OU REMPLACÉ PAR UN NOUVEAU : le code ne vaut pas", async () => {
    const f = fauxPoste();
    const id = await pret(f);
    const vieux = await demanderAppairage(id);
    g2.__afriBot!.appairage!.expireA = Date.now() - 1;
    assert.equal((await etat()).appairage, null, "expiré : plus affiché");
    relais.file.push(enveloppe(null, `appairer ${vieux.code}`));
    await attendreQue(async () => (await etat()).compteurs.ignores === 1);
    assert.match((await etat()).ignores[0]!.raison, /^code d'appairage sans appairage en cours/);
    const groupe = await demanderAppairage(id);
    relais.file.push(enveloppe(CHEF, `appairer ${groupe.code}`, { groupInfo: { groupId: "Zw==", type: "DELIVER" } }));
    await attendreQue(async () => (await etat()).compteurs.ignores === 2);
    assert.equal((await etat()).ignores[0]!.raison, "message de groupe");
    assert.notEqual((await etat()).appairage, null, "le code d'un groupe ne consomme rien");
    const nouveau = await demanderAppairage(id);
    if (nouveau.code !== groupe.code) {
      relais.file.push(enveloppe(null, `appairer ${groupe.code}`));
      await attendreQue(async () => (await etat()).compteurs.ignores === 3);
      assert.equal((await etat()).ignores[0]!.raison, "code d'appairage faux");
    }
    relais.file.push(enveloppe(null, `appairer ${nouveau.code}`));
    await attendreQue(() => relais.envois.length === 1);
    assert.equal((await etat()).numeros.find((x) => x.source === "console")!.appaire, true);
  });

  it("UN COMPTE, UN NUMÉRO : appairé à un autre numéro, il quitte le premier ; numéro inconnu refusé", async () => {
    const f = fauxPoste();
    const id3 = await pret(f);
    const id4 = (await gererNumero("ajouter", "+23566000004")).etat.numeros.find((x) => x.numero === "+235•••••004")!.id;
    relais.file.push(enveloppe(null, `appairer ${(await demanderAppairage(id3)).code}`));
    await attendreQue(() => relais.envois.length === 1);
    relais.file.push(enveloppe(null, `appairer ${(await demanderAppairage(id4)).code}`));
    await attendreQue(() => relais.envois.length === 2);
    assert.match(relais.envois[1]!.message, /comme \+235•••••004, coupé : le chef l'active dans la console\.$/);
    assert.deepEqual(
      (await etat()).numeros.filter((x) => x.source === "console").map((x) => [x.numero, x.appaire]),
      [
        ["+235•••••003", false],
        ["+235•••••004", true],
      ],
    );
    await assert.rejects(demanderAppairage("ffffffff"), /Numéro introuvable parmi ceux de la console/);
  });
});
