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
  Object.assign(relais, { ...DEPART, file: [], envois: [], retenues: [], comptes: [POSTE] });
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
        "Bot non réglé : AFRICONTROL_BOT_NUMERO, le numéro du téléphone du poste lié au relais Signal (+235…).",
    });
    process.env.AFRICONTROL_BOT_NUMERO = "00235 66 00 99 99";
    process.env.AFRICONTROL_BOT_AUTORISES = "pas-un-numéro";
    assert.deepEqual((await etat()).reglage, {
      erreur: "Aucun numéro autorisé : AFRICONTROL_BOT_AUTORISES (+235…, séparés par des virgules).",
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
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: true });
    // Redémarrage : l'écoute en cours s'arrête, l'état en mémoire disparaît, le fichier reste.
    g.__afriBot!.gen++;
    delete g.__afriBot;
    await dormir(300);
    relais.file.push(enveloppe(CHEF, "/meteo"));
    await assurerBot(f.poste);
    await attendreQue(() => relais.envois.length === 1);
    assert.equal((await etat()).ecoute, true);
    await basculerBot(false, f.poste);
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: false });
    delete g.__afriBot;
    const avant = relais.requetes;
    await assurerBot(f.poste);
    await dormir(300);
    assert.equal(relais.requetes, avant);
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
        "numéro masqué · numéro masqué par Signal : l'enregistrer dans les contacts du téléphone du poste",
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

  it("NUMÉRO DU POSTE NON LIÉ : le dit avec l'adresse du QR ; pause doublée, qui repart d'1 s après une reprise", async () => {
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
      `Le numéro +235•••••999 n'est pas lié au relais Signal : lier le téléphone du poste (${base}/v1/qrcodelink?device_name=AfriControl).`,
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
    const attendu = `Le numéro +235•••••999 n'est pas lié au relais Signal : lier le téléphone du poste (${base}/v1/qrcodelink?device_name=AfriControl).`;
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(attendu));
    assert.equal((await etat()).mode, "native", "le mode du relais reste affiché");
    relais.mode = "json-rpc";
    await basculerBot(true, fauxPoste().poste);
    await attendreQue(erreurVaut(attendu));
    await dormir(300);
    assert.equal(relais.releves, 0);
    assert.equal(relais.sockets.size, 0, "pas de websocket muette ouverte pour rien");
    // Le téléphone est lié ensuite : le bot le voit à son prochain essai, seul.
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
    assert.deepEqual(JSON.parse(readFileSync("data/bot-signal.json", "utf8")), { actif: true });
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
    await attendreQue(async () => /^Le numéro \+235•••••999 n'est pas lié/.test((await etat()).erreur?.texte ?? ""));
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
