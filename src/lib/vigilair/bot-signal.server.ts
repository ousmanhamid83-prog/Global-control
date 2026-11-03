/**
 * Bot Signal du poste — CÔTÉ SERVEUR : il écoute le relais signal-cli du poste, exécute les
 * commandes des numéros autorisés et répond à l'expéditeur seul.
 *
 *   AFRICONTROL_BOT_NUMERO=+235XXXXXXXX           numéro du téléphone du poste, lié au relais (QR)
 *   AFRICONTROL_BOT_AUTORISES=+235…,+235…         les seuls numéros que le bot écoute
 *   AFRICONTROL_BOT_RELAIS=http://127.0.0.1:8085  le relais (par défaut), sur le réseau du poste
 *
 * Coupé à la livraison : le chef de division l'active dans Capteurs › Outils, et l'état survit au
 * redémarrage (data/bot-signal.json). Le mode du relais, lu dans /v1/about, décide de l'écoute :
 *   - native ou normal : le bot relève le relais en continu (GET /v1/receive, qui attend 1 s).
 *     Un message envoyé pendant que le bot est coupé attend sur les serveurs de Signal ;
 *   - json-rpc : le relais pousse chaque message par une websocket, sans attente, et ses envois
 *     sont cinq fois plus rapides (mesuré : 49 ms contre 250 ms). Mais un message arrivé pendant
 *     que le bot est coupé est perdu : le relais 0.101 ne le garde pas.
 * Chaque commande exécutée va au journal des opérations, avec le numéro masqué.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.server.ts";
import {
  creerLimiteur,
  decider,
  listeAutorises,
  masquer,
  messagesRecus,
  numeroE164,
  reponseBot,
  type MessageRecu,
  type Verdict,
} from "./bot-signal.ts";
import type { ResultatCommande } from "./commandes-poste.server.ts";
import { RESEAU_POSTE_EXEMPLES, serveurPoste } from "./reseau-poste.ts";

/** Le relais installé par scripts/poste/preparer-poste --signal. */
export const RELAIS_DEFAUT = "http://127.0.0.1:8085";
/** Messages par numéro et par minute ; au-delà, un avertissement, puis le silence. */
export const BOT_PAR_MINUTE = 6;
/** Une relève (mode native) abandonnée au-delà ; le relais attend lui-même 1 s. */
const RELEVE_DELAI_MS = 30_000;
/** Plancher entre deux relèves : un relais qui répond aussitôt ne fait pas tourner le bot à vide. */
const RELEVE_MIN_MS = 250;
const ENVOI_DELAI_MS = 15_000;
/** Réponse du relais attendue : /v1/about, poignée de main de la websocket. */
const RELAIS_DELAI_MS = 5_000;
/** Attente du relevé Internet avant d'exécuter, quand aucune console ne l'a rafraîchi. */
const RELEVE_INTERNET_MS = 1_500;
/** Pause après un échec : 1 s, doublée à chaque échec, 30 s au plus. */
const PAUSE_MAX_MS = 30_000;
/** Une websocket fermée avant ce délai compte comme un échec (la pause s'allonge). */
const WS_STABLE_MS = 10_000;

export type EchangeBot = {
  at: number;
  /** Numéro masqué : « +235•••••234 ». */
  de: string;
  /** « /situation » ; « — » pour une réponse sans commande (aide, périmé, trop de messages). */
  commande: string;
  ok: boolean;
  /** Temps sur le poste : relevé rafraîchi au besoin, commande exécutée ; en ms. */
  ms: number;
  /** Temps de remise de la réponse au relais, en ms ; null si elle a échoué. */
  envoiMs: number | null;
  erreurEnvoi: string | null;
};

export type IgnoreBot = { at: number; de: string; raison: string };

export type CompteursBot = {
  recus: number;
  executees: number;
  reponses: number;
  ignores: number;
  echecsEnvoi: number;
};

export type EtatBot = {
  actif: boolean;
  /** « fichier » : enregistré sur le poste ; « memoire » : jusqu'au redémarrage. */
  enregistrement: "fichier" | "memoire";
  reglage: { numero: string; autorises: number; relais: string } | { erreur: string };
  /** Le bot écoute le relais en ce moment. */
  ecoute: boolean;
  /** Mode du relais lu dans /v1/about : native, normal, json-rpc. */
  mode: string | null;
  dernierContact: number | null;
  erreur: { at: number; texte: string } | null;
  compteurs: CompteursBot;
  echanges: EchangeBot[];
  ignores: IgnoreBot[];
};

/** Ce que le bot fait faire au poste : exécuter une commande, écrire au journal. */
export type Poste = {
  executer: (texte: string, expediteur: string) => Promise<ResultatCommande>;
  /** `de` : le numéro masqué, ou « numéro masqué ». */
  journal: (de: string, titre: string, detail: string, severite: "info" | "warn") => Promise<void>;
};

const posteReel: Poste = {
  async executer(texte, expediteur) {
    // Sans console ouverte, personne ne rafraîchit le relevé Internet : le bot le demande.
    await (await import("./live-feeds")).rafraichirReleve(RELEVE_INTERNET_MS);
    const { lancer } = await import("./commandes-poste.server");
    const { journalBot } = await import("./journal-poste.server");
    return lancer(texte, "bot", journalBot(expediteur));
  },
  async journal(de, titre, detail, severite) {
    const { insertOpsLog } = await import("./staff");
    await insertOpsLog({
      userId: "bot-signal",
      actor: `Bot Signal · ${de}`,
      role: "bot",
      team: "poste",
      kind: "bot",
      title: titre,
      detail,
      severity: severite,
    });
  },
};

type Interne = {
  chargement: Promise<void> | null;
  actif: boolean;
  enregistrement: "fichier" | "memoire";
  /** Change à chaque démarrage et à chaque arrêt : une écoute d'avant le voit et s'arrête. */
  gen: number;
  ecoute: boolean;
  mode: string | null;
  dernierContact: number | null;
  erreur: { at: number; texte: string } | null;
  compteurs: CompteursBot;
  echanges: EchangeBot[];
  ignores: IgnoreBot[];
  limite: (qui: string, maintenant: number) => Verdict;
  /** Un numéro non autorisé va au journal une fois par 10 min, pas à chaque message. */
  inconnus: (qui: string, maintenant: number) => Verdict;
  /**
   * Une file par numéro : ses messages passent l'un après l'autre (ses réponses partent dans
   * l'ordre), mais un /ia lent d'un numéro ne retient pas ceux des autres.
   */
  files: Map<string, Promise<void>>;
  socket: WebSocket | null;
};

// Sur globalThis : le serveur construit a plusieurs copies de ce module (plugin de démarrage,
// fonctions serveur) ; un seul bot doit écouter, et tous lisent le même état.
const g = globalThis as typeof globalThis & { __afriBot?: Interne };

function fichier(): string {
  return path.join(process.cwd(), "data", "bot-signal.json");
}

async function charger(e: Interne): Promise<void> {
  try {
    e.actif = (JSON.parse(await readFile(fichier(), "utf8")) as { actif?: unknown }).actif === true;
  } catch {
    // Pas de fichier, ou illisible : coupé, comme à la livraison.
  }
}

async function etat(): Promise<Interne> {
  const e = (g.__afriBot ??= {
    chargement: null,
    actif: false,
    enregistrement: "fichier",
    gen: 0,
    ecoute: false,
    mode: null,
    dernierContact: null,
    erreur: null,
    compteurs: { recus: 0, executees: 0, reponses: 0, ignores: 0, echecsEnvoi: 0 },
    echanges: [],
    ignores: [],
    limite: creerLimiteur(BOT_PAR_MINUTE, 60_000),
    inconnus: creerLimiteur(1, 10 * 60_000),
    files: new Map(),
    socket: null,
  });
  await (e.chargement ??= charger(e));
  return e;
}

async function enregistrer(e: Interne): Promise<void> {
  try {
    const f = fichier();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(`${f}.part`, `${JSON.stringify({ actif: e.actif })}\n`);
    await rename(`${f}.part`, f);
    e.enregistrement = "fichier";
  } catch {
    e.enregistrement = "memoire";
  }
}

type Conf = { base: string; numero: string; autorises: Set<string> };

function reglage(): Conf | { erreur: string } {
  const numero = numeroE164(env("AFRICONTROL_BOT_NUMERO") ?? "");
  if (!numero) {
    return {
      erreur:
        "Bot non réglé : AFRICONTROL_BOT_NUMERO, le numéro du téléphone du poste lié au relais Signal (+235…).",
    };
  }
  const autorises = listeAutorises(env("AFRICONTROL_BOT_AUTORISES"));
  if (autorises.size === 0) {
    return {
      erreur: "Aucun numéro autorisé : AFRICONTROL_BOT_AUTORISES (+235…, séparés par des virgules).",
    };
  }
  const s = serveurPoste(env("AFRICONTROL_BOT_RELAIS") ?? RELAIS_DEFAUT);
  if (!("base" in s)) {
    return {
      erreur: `AFRICONTROL_BOT_RELAIS refusée : le relais doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}).`,
    };
  }
  return { base: s.base, numero, autorises };
}

/** Erreur déjà dite en clair (réponse du relais) — à l'inverse d'un relais injoignable. */
class ErreurRelais extends Error {}

function noter(e: Interne, texte: string): void {
  e.erreur = { at: Date.now(), texte };
}

function contact(e: Interne): void {
  e.dernierContact = Date.now();
  e.erreur = null;
}

/** Le texte d'erreur d'une réponse du relais : son champ « error », sinon le corps brut. */
function lireErreur(corps: string): string {
  try {
    const j = JSON.parse(corps) as { error?: unknown } | null;
    if (typeof j?.error === "string") return j.error;
  } catch {
    // Corps non JSON : tel quel.
  }
  return corps;
}

function pasLie(conf: Conf): string {
  return `Le numéro ${masquer(conf.numero)} n'est pas lié au relais Signal : lier le téléphone du poste (${conf.base}/v1/qrcodelink?device_name=AfriControl).`;
}

/** En clair : la dernière ligne (signal-cli écrit d'abord ses journaux), numéros masqués. */
function erreurRelais(conf: Conf, statut: number | null, erreur: string): string {
  const derniere = (erreur.trim().split("\n").at(-1) ?? "").trim();
  if (/not registered|does not exist/i.test(derniere)) return pasLie(conf);
  const detail = derniere.replace(/\+\d{6,15}/g, masquer).slice(0, 160);
  return `Relais Signal${statut ? ` : HTTP ${statut}` : ""}${detail ? ` — ${detail}` : ""}.`;
}

function injoignable(conf: Conf, err: unknown): string {
  const x = err as { name?: unknown; message?: unknown; cause?: { code?: unknown } };
  const raison =
    x.name === "TimeoutError"
      ? "pas de réponse à temps"
      : typeof x.cause?.code === "string"
        ? x.cause.code
        : String(x.message);
  return `Relais Signal injoignable à ${conf.base} (${raison}).`;
}

function pause(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms).unref());
}

/** Remet la réponse au relais, pour l'expéditeur seul ; null si c'est fait, sinon pourquoi. */
async function envoyer(conf: Conf, destinataire: string, message: string): Promise<string | null> {
  try {
    const r = await fetch(`${conf.base}/v2/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, number: conf.numero, recipients: [destinataire] }),
      signal: AbortSignal.timeout(ENVOI_DELAI_MS),
    });
    return r.ok ? null : erreurRelais(conf, r.status, lireErreur(await r.text()));
  } catch (err) {
    return injoignable(conf, err);
  }
}

/** Le journal ne doit jamais retenir une réponse ni arrêter le bot : un échec y est noté. */
async function journaliser(
  e: Interne,
  poste: Poste,
  ...entree: Parameters<Poste["journal"]>
): Promise<void> {
  try {
    await poste.journal(...entree);
  } catch (err) {
    noter(e, `Journal des opérations : ${err instanceof Error ? err.message : "échec"}.`);
  }
}

async function traiterUn(e: Interne, conf: Conf, poste: Poste, m: MessageRecu): Promise<void> {
  const at = Date.now();
  e.compteurs.recus++;
  const de = m.expediteur ? masquer(m.expediteur) : "numéro masqué";
  const d = decider(m, conf.autorises, e.limite, at);
  if (d.action === "ignorer") {
    e.compteurs.ignores++;
    e.ignores = [{ at, de, raison: d.raison }, ...e.ignores].slice(0, 5);
    if (d.raison === "numéro non autorisé" && e.inconnus(m.expediteur, at) === "ok") {
      await journaliser(e, poste, de, "Bot Signal : numéro non autorisé", "Message ignoré, sans réponse.", "warn");
    }
    return;
  }
  let reponse = d.action === "repondre" ? d.texte : "";
  let commande = "—";
  let ok = true;
  let ms = 0;
  if (d.action === "executer") {
    const t0 = performance.now();
    let r: ResultatCommande;
    try {
      r = await poste.executer(d.commande, m.expediteur);
    } catch (err) {
      r = {
        ok: false,
        commande: null,
        lignes: [`La commande n'a pas abouti au poste (${err instanceof Error ? err.message : "erreur"}) : la passer à la console.`],
        ms: 0,
      };
    }
    ms = Math.round((performance.now() - t0) * 100) / 100;
    commande = r.commande ? `/${r.commande}` : d.commande.split(/\s/)[0]!;
    ok = r.ok;
    reponse = reponseBot(r.lignes, ms);
    e.compteurs.executees++;
  }
  const t1 = performance.now();
  const erreurEnvoi = await envoyer(conf, m.expediteur, reponse);
  if (erreurEnvoi) {
    e.compteurs.echecsEnvoi++;
    noter(e, erreurEnvoi);
  } else {
    e.compteurs.reponses++;
  }
  e.echanges = [
    {
      at,
      de,
      commande,
      ok,
      ms,
      envoiMs: erreurEnvoi ? null : Math.round(performance.now() - t1),
      erreurEnvoi,
    },
    ...e.echanges,
  ].slice(0, 10);
  if (d.action === "executer") {
    await journaliser(
      e,
      poste,
      de,
      `${commande} par le bot Signal`,
      `« ${d.commande.slice(0, 200)} » · ${ok ? "exécutée" : "refusée"} en ${ms.toLocaleString("fr-FR")} ms · réponse ${erreurEnvoi ? `non remise : ${erreurEnvoi}` : "remise au relais"}`,
      "info",
    );
  }
}

/** Chaque message à la file de son numéro ; coupé entre-temps, le bot n'exécute plus rien. */
function traiter(e: Interne, gen: number, conf: Conf, poste: Poste, recus: MessageRecu[]): void {
  for (const m of recus) {
    const suite = (e.files.get(m.expediteur) ?? Promise.resolve()).then(async () => {
      if (e.gen !== gen) return;
      // Un message qui plante (une commande boguée) est noté et ne coûte que lui : rejetée, la
      // file ne traiterait plus rien, et le bot relèverait les messages pour les perdre en silence.
      try {
        await traiterUn(e, conf, poste, m);
      } catch (err) {
        noter(e, `Bot Signal : ${err instanceof Error ? err.message : "erreur"}.`);
      }
    });
    e.files.set(m.expediteur, suite);
    // File vidée, file oubliée : la table ne grossit pas avec chaque numéro inconnu.
    void suite.then(() => {
      if (e.files.get(m.expediteur) === suite) e.files.delete(m.expediteur);
    });
  }
}

/** Une réponse JSON du relais ; sinon, ce n'est pas un relais signal-cli-rest-api qui répond. */
async function lireRelais(conf: Conf, chemin: string): Promise<unknown> {
  const r = await fetch(`${conf.base}${chemin}`, { signal: AbortSignal.timeout(RELAIS_DELAI_MS) });
  const corps = await r.text();
  if (!r.ok) throw new ErreurRelais(erreurRelais(conf, r.status, lireErreur(corps)));
  try {
    return JSON.parse(corps);
  } catch {
    // Un autre service sur ce port (le moteur de recherche, la console…) : pas un relais Signal.
    throw new ErreurRelais(
      `${conf.base}${chemin} ne répond pas comme un relais signal-cli-rest-api : vérifier AFRICONTROL_BOT_RELAIS.`,
    );
  }
}

async function modeRelais(conf: Conf): Promise<string> {
  const about = (await lireRelais(conf, "/v1/about")) as { mode?: unknown } | null;
  return typeof about?.mode === "string" ? about.mode : "normal";
}

/**
 * Le numéro du bot est-il lié au relais (/v1/accounts) ? Sans ce contrôle, un relais json-rpc
 * dont le numéro n'est pas lié garde la websocket ouverte, muette (vérifié sur le vrai 0.101) : le
 * bot paraîtrait à l'écoute, et rien n'arriverait jamais.
 */
async function verifierCompte(conf: Conf): Promise<void> {
  const comptes = (await lireRelais(conf, "/v1/accounts")) as string[];
  if (!comptes.includes(conf.numero)) throw new ErreurRelais(pasLie(conf));
}

/** Mode native ou normal : relever le relais en continu, tant que cette écoute est la bonne. */
async function relever(e: Interne, gen: number, conf: Conf, poste: Poste): Promise<void> {
  const url = `${conf.base}/v1/receive/${conf.numero}?timeout=1&ignore_attachments=true&ignore_stories=true`;
  while (e.gen === gen) {
    const t0 = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(RELEVE_DELAI_MS) });
    const corps = await r.text();
    if (!r.ok) throw new ErreurRelais(erreurRelais(conf, r.status, lireErreur(corps)));
    contact(e);
    let brut: unknown = [];
    try {
      brut = JSON.parse(corps);
    } catch {
      // Réponse illisible : rien de reçu cette fois.
    }
    traiter(e, gen, conf, poste, messagesRecus(brut));
    const reste = RELEVE_MIN_MS - (Date.now() - t0);
    if (reste > 0) await pause(reste);
  }
}

/**
 * Mode json-rpc : le relais pousse chaque message ; finie quand la websocket se ferme. Deux
 * pièges de la websocket de Node 22, vérifiés : une poignée de main refusée ne déclenche que
 * « error », jamais « close » (sans régler sur « error », le bot resterait pendu, l'air actif) ; et
 * close() sur une websocket encore en connexion redéclenche « error » — jamais close() là-dedans.
 */
function ecouterWs(e: Interne, gen: number, conf: Conf, poste: Poste): Promise<void> {
  return new Promise((fini, echoue) => {
    const ws = new WebSocket(`${conf.base.replace(/^http/, "ws")}/v1/receive/${conf.numero}`);
    e.socket = ws;
    let ouvertA = 0;
    // Une promesse ne se règle qu'une fois : les règlements suivants sont sans effet.
    const regler = (erreur: string | null) =>
      erreur === null || e.gen !== gen ? fini() : echoue(new ErreurRelais(erreur));
    // Poignée de main restée sans réponse : réglée d'abord, close() ensuite.
    const delai = setTimeout(() => {
      regler(`Relais Signal injoignable à ${conf.base} (websocket : pas de réponse à temps).`);
      ws.close();
    }, RELAIS_DELAI_MS);
    ws.onopen = () => {
      ouvertA = Date.now();
      clearTimeout(delai);
      contact(e);
    };
    ws.onmessage = (ev) => {
      let brut: unknown;
      try {
        brut = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const erreur = (brut as { error?: unknown } | null)?.error;
      if (typeof erreur === "string") return noter(e, erreurRelais(conf, null, erreur));
      contact(e);
      traiter(e, gen, conf, poste, messagesRecus([brut]));
    };
    ws.onerror = (ev) => {
      if (ouvertA) return; // websocket ouverte : « close » suit, et règle.
      const motif = String((ev as Event & { message?: unknown }).message ?? "erreur");
      regler(`Relais Signal injoignable à ${conf.base} (websocket : ${motif.replace(/\.$/, "")}).`);
    };
    ws.onclose = () =>
      regler(
        ouvertA && Date.now() - ouvertA >= WS_STABLE_MS
          ? null
          : "Relais Signal : websocket fermée aussitôt ouverte.",
      );
  });
}

/** L'écoute du relais, jusqu'à l'arrêt du bot ; elle reprend seule après une panne. */
async function ecouter(e: Interne, gen: number, poste: Poste): Promise<void> {
  let attente = 0;
  let echecA = 0;
  while (e.gen === gen) {
    const conf = reglage();
    if ("erreur" in conf) {
      // Rien à écouter avant que poste.env soit réglé et le serveur relancé.
      noter(e, conf.erreur);
      return;
    }
    try {
      e.mode = await modeRelais(conf);
      await verifierCompte(conf);
      if (e.mode.startsWith("json-rpc")) await ecouterWs(e, gen, conf, poste);
      else await relever(e, gen, conf, poste);
    } catch (err) {
      if (e.gen !== gen) return;
      noter(e, err instanceof ErreurRelais ? err.message : injoignable(conf, err));
      // Le relais a répondu depuis le dernier échec : une panne nouvelle repart d'une seconde.
      const repart = (e.dernierContact ?? 0) > echecA;
      attente = repart ? 1000 : Math.min(PAUSE_MAX_MS, Math.max(1000, attente * 2));
      echecA = Date.now();
      await pause(attente);
    }
  }
}

function demarrer(e: Interne, poste: Poste): void {
  const gen = ++e.gen;
  e.ecoute = true;
  void ecouter(e, gen, poste)
    // Garde-fou : une écoute en arrière-plan ne doit jamais faire tomber le serveur du poste.
    .catch((err: unknown) => noter(e, `Bot Signal arrêté : ${err instanceof Error ? err.message : "erreur"}.`))
    .finally(() => {
      if (e.gen === gen) e.ecoute = false;
    });
}

function arreter(e: Interne): void {
  e.gen++;
  e.ecoute = false;
  e.socket?.close();
}

export async function lireEtatBot(): Promise<EtatBot> {
  const e = await etat();
  const r = reglage();
  return {
    actif: e.actif,
    enregistrement: e.enregistrement,
    reglage:
      "erreur" in r
        ? { erreur: r.erreur }
        : { numero: masquer(r.numero), autorises: r.autorises.size, relais: r.base },
    ecoute: e.ecoute,
    mode: e.mode,
    dernierContact: e.dernierContact,
    erreur: e.erreur,
    compteurs: { ...e.compteurs },
    echanges: e.echanges,
    ignores: e.ignores,
  };
}

/** Au démarrage du serveur, et à chaque lecture de l'état : un bot actif écoute le relais. */
export async function assurerBot(poste: Poste = posteReel): Promise<void> {
  const e = await etat();
  if (e.actif && !e.ecoute) demarrer(e, poste);
}

/** Le chef active ou coupe le bot : effet immédiat, puis enregistré sur le poste. */
export async function basculerBot(actif: boolean, poste: Poste = posteReel): Promise<EtatBot> {
  const e = await etat();
  e.actif = actif;
  arreter(e);
  if (actif) demarrer(e, poste);
  await enregistrer(e);
  return lireEtatBot();
}
