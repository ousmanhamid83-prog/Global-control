/**
 * Bot Signal du poste — CÔTÉ SERVEUR : il écoute le relais signal-cli du poste, exécute les
 * commandes des numéros autorisés et répond à l'expéditeur seul.
 *
 *   AFRICONTROL_BOT_NUMERO=+235XXXXXXXX           numéro propre au bot, inscrit par le relais (sinon
 *                                                 inscrit depuis la console : Capteurs › Outils)
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
import { randomInt, timingSafeEqual } from "node:crypto";
import { ecrireFichierPoste, lireFichierPoste } from "../disque-poste.server.ts";
import path from "node:path";
import { env } from "../env.server.ts";
import {
  APPAIRAGE_ESSAIS,
  APPAIRAGE_MS,
  autorisesEffectifs,
  codeAppairage,
  creerLimiteur,
  decider,
  idNumero,
  listeAutorises,
  litLeReleve,
  masquer,
  messagesRecus,
  noteReleve,
  numeroE164,
  numerosValides,
  reponseBot,
  type MessageRecu,
  type NumeroBot,
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
/**
 * Un appel qui lance signal-cli (envoi, liste des comptes) : ≈ 250 ms d'habitude, mais plus de 5 s
 * au tout premier appel d'un relais qui démarre sur une machine chargée (vu à l'essai).
 */
const SIGNAL_CLI_DELAI_MS = 15_000;
/** Réponse du relais lui-même, sans signal-cli : /v1/about, poignée de main de la websocket. */
const RELAIS_DELAI_MS = 5_000;
/** Pause après un échec : 1 s, doublée à chaque échec, 30 s au plus. */
const PAUSE_MAX_MS = 30_000;
/** Une websocket fermée avant ce délai compte comme un échec (la pause s'allonge). */
const WS_STABLE_MS = 10_000;
/**
 * Au plus une recherche des numéros autorisés chez Signal par période : un flot de messages
 * masqués ne lance pas un flot de recherches.
 */
const RECHERCHE_MIN_MS = 30_000;

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

/** Un numéro autorisé tel que l'écran le montre : masqué, avec d'où il vient. */
export type NumeroEcran = {
  /** Identifiant opaque, pour activer, couper ou retirer sans montrer le numéro. */
  id: string;
  numero: string;
  actif: boolean;
  /** « poste.env » : toujours écouté ; « console » : ajouté par le chef, activable sur demande. */
  source: "poste.env" | "console";
  /** Trouvé chez Signal à la dernière recherche du bot ; null : pas encore cherché. */
  surSignal: boolean | null;
  /** Un téléphone y est appairé par un code du chef : reconnu même numéro masqué. */
  appaire: boolean;
};

export type EtatBot = {
  actif: boolean;
  /** « fichier » : enregistré sur le poste ; « memoire » : jusqu'au redémarrage. */
  enregistrement: "fichier" | "memoire";
  /** `autorises` : les numéros écoutés en ce moment (poste.env et console activés). */
  reglage: { numero: string; autorises: number; relais: string } | { erreur: string };
  /** D'où vient le numéro du bot : poste.env, ou inscrit depuis la console ; null sans numéro. */
  sourceNumero: "poste.env" | "console" | null;
  numeros: NumeroEcran[];
  /** Appairage demandé par le chef, encore valable — sans le code, que seul le chef a vu. */
  appairage: { numero: string; expireA: number } | null;
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

/**
 * Attente au plus d'un relevé Internet neuf, quand le poste n'en a pas de récent : le premier à
 * froid a pris 7,4 à 9,4 s à travers le proxy du poste d'essai.
 */
const RELEVE_ATTENTE_MS = 12_000;

const posteReel: Poste = {
  async executer(texte, expediteur) {
    // Sans console ouverte, personne ne relève Internet. Vu au premier essai réel : juste après le
    // démarrage, deux réponses « pas encore de relevé ». Une commande qui lit le relevé attend donc
    // le neuf quand il manque ou a plus de 2 min ; sinon elle répond aussitôt et dit son âge.
    const releve = await (await import("./live-feeds")).releveInternetPourBot(
      litLeReleve(texte) ? RELEVE_ATTENTE_MS : 0,
    );
    const { lancer } = await import("./commandes-poste.server");
    const { journalBot } = await import("./journal-poste.server");
    const r = await lancer(texte, "bot", journalBot(expediteur));
    const note = noteReleve(r, releve);
    return note ? { ...r, lignes: [...r.lignes, note] } : r;
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
  /** Numéros ajoutés par le chef (data/bot-signal.json) ; ceux de poste.env n'y sont pas. */
  numeros: NumeroBot[];
  /** Numéro propre au bot, inscrit chez Signal depuis la console ; poste.env l'emporte. */
  numeroBot: string | null;
  enregistrement: "fichier" | "memoire";
  /** Change à chaque démarrage et à chaque arrêt : une écoute d'avant le voit et s'arrête. */
  gen: number;
  /** Le serveur s'arrête : plus aucune nouvelle relève (voir suspendreBot). */
  fermeture: boolean;
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
  /** Numéros autorisés trouvés (ou non) chez Signal à la dernière recherche du bot. */
  surSignal: Map<string, boolean>;
  /** Heure de la dernière recherche (ms) ; 0 : à refaire dès que besoin. */
  rechercheA: number;
  /** Code d'appairage demandé par le chef : un seul à la fois, en mémoire seulement. */
  appairage: { numero: string; code: string; expireA: number; essais: number } | null;
};

// Sur globalThis : le serveur construit a plusieurs copies de ce module (plugin de démarrage,
// fonctions serveur) ; un seul bot doit écouter, et tous lisent le même état.
const g = globalThis as typeof globalThis & { __afriBot?: Interne };

function fichier(): string {
  return path.join(process.cwd(), "data", "bot-signal.json");
}

async function charger(e: Interne): Promise<void> {
  // Illisible : sa copie ; ni l'un ni l'autre : coupé, sans numéro de console, comme à la livraison.
  const lu = await lireFichierPoste(
    fichier(),
    (t) => JSON.parse(t) as { actif?: unknown; numeros?: unknown; numeroBot?: unknown } | null,
  );
  if (!lu) return;
  e.actif = lu.actif === true;
  e.numeros = numerosValides(lu.numeros);
  e.numeroBot = numeroE164(String(lu.numeroBot ?? ""));
}

async function etat(): Promise<Interne> {
  const e = (g.__afriBot ??= {
    chargement: null,
    actif: false,
    numeros: [],
    numeroBot: null,
    enregistrement: "fichier",
    gen: 0,
    fermeture: false,
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
    surSignal: new Map(),
    rechercheA: 0,
    appairage: null,
  });
  await (e.chargement ??= charger(e));
  return e;
}

async function enregistrer(e: Interne): Promise<void> {
  try {
    await ecrireFichierPoste(
      fichier(),
      `${JSON.stringify({ actif: e.actif, numeros: e.numeros, numeroBot: e.numeroBot }, null, 2)}\n`,
    );
    e.enregistrement = "fichier";
  } catch {
    e.enregistrement = "memoire";
  }
}

/** `autorisesPoste` : ceux de poste.env ; les numéros de la console se lisent au message près. */
type Conf = { base: string; numero: string; autorisesPoste: Set<string> };

function reglage(e: Interne): Conf | { erreur: string } {
  const numero = numeroE164(env("AFRICONTROL_BOT_NUMERO") ?? "") ?? e.numeroBot;
  if (!numero) {
    return {
      erreur:
        "Bot non réglé : pas encore de numéro propre au bot. L'inscrire ci-dessous (chef de division), ou AFRICONTROL_BOT_NUMERO dans poste.env (+235…).",
    };
  }
  const autorisesPoste = listeAutorises(env("AFRICONTROL_BOT_AUTORISES"));
  if (autorisesPoste.size === 0 && e.numeros.length === 0) {
    return {
      erreur:
        "Aucun numéro autorisé : en ajouter un ci-dessous (chef de division), ou AFRICONTROL_BOT_AUTORISES dans poste.env (+235…, séparés par des virgules).",
    };
  }
  const s = serveurPoste(env("AFRICONTROL_BOT_RELAIS") ?? RELAIS_DEFAUT);
  if (!("base" in s)) {
    return {
      erreur: `AFRICONTROL_BOT_RELAIS refusée : le relais doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}).`,
    };
  }
  return { base: s.base, numero, autorisesPoste };
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
  return `Le numéro ${masquer(conf.numero)} n'est pas inscrit au relais Signal (${conf.base}) : l'inscrire dans Capteurs › Outils › Bot Signal › Numéro propre au bot (chef de division).`;
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
      signal: AbortSignal.timeout(SIGNAL_CLI_DELAI_MS),
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

/**
 * Le bot cherche chez Signal les numéros qu'il écoute (/v1/search). Signal ne joint plus le numéro
 * d'un expéditeur qui le cache — le réglage par défaut depuis 2024 : le compte du bot l'apprend
 * par cette recherche, comme un téléphone par ses contacts, et le relais le joint ensuite à ses
 * messages. Introuvable (« Qui peut me trouver par mon numéro : Personne »), c'est dit à l'écran.
 */
async function chercherAutorises(e: Interne, conf: Conf): Promise<void> {
  e.rechercheA = Date.now();
  const numeros = [...autorisesEffectifs(conf.autorisesPoste, e.numeros)];
  if (numeros.length === 0) return;
  const q = numeros.map((n) => `numbers=${encodeURIComponent(n)}`).join("&");
  const lu = await lireRelais(conf, `/v1/search/${conf.numero}?${q}`, SIGNAL_CLI_DELAI_MS);
  const trouves = new Set(
    (Array.isArray(lu) ? lu : [])
      .filter((x: { registered?: unknown } | null) => x?.registered === true)
      .map((x: { number?: unknown }) => x.number),
  );
  for (const n of numeros) e.surSignal.set(n, trouves.has(n));
}

/** En arrière-plan : une recherche qui échoue laisse l'état « pas encore cherché », sans plus. */
function chercherSansAttendre(e: Interne, conf: Conf): void {
  chercherAutorises(e, conf).catch(() => {});
}

/**
 * Le numéro d'un expéditeur masqué, si le compte du bot le connaît (relais, /v1/contacts) ; la
 * recherche des autorisés est refaite d'abord, au plus une fois par RECHERCHE_MIN_MS : un numéro
 * que son titulaire vient de rendre trouvable compte dès son message suivant. null sinon.
 */
async function numeroDuCompte(e: Interne, conf: Conf, compte: string): Promise<string | null> {
  try {
    if (Date.now() - e.rechercheA >= RECHERCHE_MIN_MS) await chercherAutorises(e, conf);
    const connus = await lireRelais(conf, `/v1/contacts/${conf.numero}?all_recipients=true`, SIGNAL_CLI_DELAI_MS);
    const c = (Array.isArray(connus) ? connus : []).find(
      (x: { uuid?: unknown } | null) => x?.uuid === compte,
    ) as { number?: unknown } | undefined;
    return typeof c?.number === "string" ? numeroE164(c.number) : null;
  } catch {
    // Relais en panne : le message reste masqué, ignoré comme tel.
    return null;
  }
}

/** Comparaison en temps constant : la durée d'un refus ne dit rien du code. */
function codesEgaux(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function noterIgnore(e: Interne, at: number, de: string, raison: string): void {
  e.compteurs.ignores++;
  e.ignores = [{ at, de, raison }, ...e.ignores].slice(0, 5);
}

/**
 * « appairer 123456 » : le compte Signal qui envoie le bon code, dans les 5 minutes, est appairé
 * au numéro de la console pour lequel le chef l'a demandé. Un code faux, ou sans appairage en
 * cours, n'a pas de réponse : rien ne confirme à un inconnu qu'un bot écoute.
 */
async function appairer(e: Interne, conf: Conf, poste: Poste, recu: MessageRecu, code: string, at: number): Promise<void> {
  const de = recu.expediteur ? masquer(recu.expediteur) : "numéro masqué";
  const a = e.appairage;
  if (!a || at > a.expireA || !e.numeros.some((x) => x.numero === a.numero)) {
    e.appairage = null;
    return noterIgnore(e, at, de, "code d'appairage sans appairage en cours : le chef en demande un dans la console");
  }
  if (!codesEgaux(code, a.code)) {
    a.essais++;
    const annule = a.essais >= APPAIRAGE_ESSAIS;
    if (annule) e.appairage = null;
    noterIgnore(e, at, de, annule ? `code d'appairage faux : appairage annulé (${APPAIRAGE_ESSAIS} essais)` : "code d'appairage faux");
    await journaliser(
      e,
      poste,
      de,
      `Bot Signal : code d'appairage faux pour ${masquer(a.numero)}`,
      `Essai ${a.essais} sur ${APPAIRAGE_ESSAIS}${annule ? " : appairage annulé" : ""}. Aucun code n'est journalisé.`,
      "warn",
    );
    return;
  }
  e.appairage = null;
  // Un compte n'est appairé qu'à un numéro : l'appairer ici le retire d'ailleurs.
  e.numeros = e.numeros.map(({ compte, ...x }) =>
    x.numero === a.numero ? { ...x, compte: recu.compte } : compte === recu.compte ? x : { ...x, ...(compte ? { compte } : {}) },
  );
  await enregistrer(e);
  const actif = e.numeros.some((x) => x.numero === a.numero && x.actif);
  const t1 = performance.now();
  const erreurEnvoi = await envoyer(
    conf,
    recu.compte,
    `Téléphone appairé au poste AfriControl : le bot le reconnaît désormais comme ${masquer(a.numero)}${
      actif ? ". Envoyer « aide » pour la liste des commandes." : ", coupé : le chef l'active dans la console."
    }`,
  );
  if (erreurEnvoi) {
    e.compteurs.echecsEnvoi++;
    noter(e, erreurEnvoi);
  } else {
    e.compteurs.reponses++;
  }
  e.echanges = [
    { at, de: masquer(a.numero), commande: "appairage", ok: true, ms: 0, envoiMs: erreurEnvoi ? null : Math.round(performance.now() - t1), erreurEnvoi },
    ...e.echanges,
  ].slice(0, 10);
  await journaliser(
    e,
    poste,
    masquer(a.numero),
    `Bot Signal : ${masquer(a.numero)} appairé à un compte Signal`,
    `Par le code du chef ; numéro ${recu.expediteur ? `visible : ${de}` : "masqué par Signal"}. Réponse ${erreurEnvoi ? `non remise : ${erreurEnvoi}` : "remise au relais"}.`,
    "warn",
  );
}

async function traiterUn(e: Interne, conf: Conf, poste: Poste, recu: MessageRecu): Promise<void> {
  const at = Date.now();
  e.compteurs.recus++;
  // Pas en groupe : le code y serait lu par tous ; le message va alors au refus des groupes.
  const code = recu.groupe ? null : codeAppairage(recu.texte);
  if (code && recu.compte) return appairer(e, conf, poste, recu, code, at);
  // Numéro masqué : un compte appairé par le chef, sinon ce que le compte du bot en sait.
  const m =
    recu.expediteur || !recu.compte
      ? recu
      : {
          ...recu,
          expediteur:
            e.numeros.find((x) => x.compte === recu.compte)?.numero ??
            (await numeroDuCompte(e, conf, recu.compte)) ??
            "",
        };
  const de = m.expediteur ? masquer(m.expediteur) : "numéro masqué";
  // Lus au message près : un numéro que le chef active ou coupe compte dès le message suivant.
  const d = decider(m, autorisesEffectifs(conf.autorisesPoste, e.numeros), e.limite, at);
  if (d.action === "ignorer") {
    // Un numéro de la console coupé par le chef n'est pas un intrus : dit, pas journalisé.
    const coupe = d.raison === "numéro non autorisé" && e.numeros.some((n) => n.numero === m.expediteur);
    const raison = coupe
      ? "numéro coupé par le chef : l'activer dans Capteurs › Outils › Bot Signal"
      : d.raison;
    noterIgnore(e, at, de, raison);
    if (raison === "numéro non autorisé" && e.inconnus(m.expediteur, at) === "ok") {
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
  // Numéro masqué par Signal : la réponse va à son compte, que le relais joint toujours.
  const erreurEnvoi = await envoyer(conf, recu.expediteur || recu.compte, reponse);
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
async function lireRelais(conf: Conf, chemin: string, delaiMs: number): Promise<unknown> {
  const r = await fetch(`${conf.base}${chemin}`, { signal: AbortSignal.timeout(delaiMs) });
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
  const about = (await lireRelais(conf, "/v1/about", RELAIS_DELAI_MS)) as { mode?: unknown } | null;
  return typeof about?.mode === "string" ? about.mode : "normal";
}

/**
 * Le numéro du bot est-il lié au relais (/v1/accounts) ? Sans ce contrôle, un relais json-rpc
 * dont le numéro n'est pas inscrit garde la websocket ouverte, muette (vérifié sur le vrai 0.101) : le
 * bot paraîtrait à l'écoute, et rien n'arriverait jamais.
 */
async function verifierCompte(conf: Conf): Promise<void> {
  const comptes = (await lireRelais(conf, "/v1/accounts", SIGNAL_CLI_DELAI_MS)) as string[];
  if (!comptes.includes(conf.numero)) throw new ErreurRelais(pasLie(conf));
}

/** Une écoute continue tant qu'elle est la bonne et que le serveur ne ferme pas. */
function vivante(e: Interne, gen: number): boolean {
  return e.gen === gen && !e.fermeture;
}

/** Mode native ou normal : relever le relais en continu, tant que cette écoute est vivante. */
async function relever(e: Interne, gen: number, conf: Conf, poste: Poste): Promise<void> {
  const url = `${conf.base}/v1/receive/${conf.numero}?timeout=1&ignore_attachments=true&ignore_stories=true`;
  while (vivante(e, gen)) {
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
    // Une promesse ne se règle qu'une fois : les règlements suivants sont sans effet. Un échec
    // après la coupure du bot ou du serveur n'est pas dit : l'écoute le voit et s'arrête.
    const regler = (erreur: string | null) =>
      erreur === null ? fini() : echoue(new ErreurRelais(erreur));
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
  while (vivante(e, gen)) {
    const conf = reglage(e);
    if ("erreur" in conf) {
      // Rien à écouter avant que poste.env soit réglé et le serveur relancé.
      noter(e, conf.erreur);
      return;
    }
    try {
      e.mode = await modeRelais(conf);
      await verifierCompte(conf);
      // Coupé pendant ces deux appels : ni recherche ni websocket pour une écoute finie.
      if (!vivante(e, gen)) return;
      // Sans attendre : en json-rpc, un message arrivé avant l'ouverture de la websocket est perdu.
      chercherSansAttendre(e, conf);
      if (e.mode.startsWith("json-rpc")) await ecouterWs(e, gen, conf, poste);
      else await relever(e, gen, conf, poste);
    } catch (err) {
      if (!vivante(e, gen)) return;
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
  // L'erreur d'avant appartient à l'ancien réglage (« pas encore de numéro » juste après
  // l'inscription) : la nouvelle écoute dira la sienne.
  e.erreur = null;
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
  const r = reglage(e);
  const poste = listeAutorises(env("AFRICONTROL_BOT_AUTORISES"));
  return {
    actif: e.actif,
    enregistrement: e.enregistrement,
    reglage:
      "erreur" in r
        ? { erreur: r.erreur }
        : {
            numero: masquer(r.numero),
            autorises: autorisesEffectifs(r.autorisesPoste, e.numeros).size,
            relais: r.base,
          },
    sourceNumero: numeroE164(env("AFRICONTROL_BOT_NUMERO") ?? "")
      ? "poste.env"
      : e.numeroBot
        ? "console"
        : null,
    numeros: [
      ...[...poste].map((n) => ({
        id: idNumero(n),
        numero: masquer(n),
        actif: true,
        source: "poste.env" as const,
        surSignal: e.surSignal.get(n) ?? null,
        appaire: false,
      })),
      ...e.numeros.map((n) => ({
        id: idNumero(n.numero),
        numero: masquer(n.numero),
        actif: n.actif,
        source: "console" as const,
        surSignal: e.surSignal.get(n.numero) ?? null,
        appaire: n.compte != null,
      })),
    ],
    appairage:
      e.appairage && Date.now() <= e.appairage.expireA
        ? { numero: masquer(e.appairage.numero), expireA: e.appairage.expireA }
        : null,
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

/**
 * Le serveur s'arrête (SIGTERM, Ctrl+C) : plus aucune nouvelle relève. Sans cela, pendant ses
 * secondes de fermeture, il prenait au relais des messages qu'il n'avait plus le temps de traiter
 * (vu à l'essai : un message perdu). La relève en cours va à son terme et ses messages sont
 * traités ; l'état enregistré ne change pas : le bot reprend au prochain démarrage.
 */
export function suspendreBot(): void {
  const e = g.__afriBot;
  if (!e) return;
  e.fermeture = true;
  e.socket?.close();
}

export type InscriptionBot =
  | { etape: "code"; numero: string; captcha: string; voix: boolean }
  | { etape: "valider"; numero: string; code: string; pin: string; nom: string };

/** Délai d'une étape d'inscription : le relais parle aux serveurs de Signal. */
const INSCRIPTION_DELAI_MS = 45_000;

/** Ce que Signal ou le relais a répondu à l'inscription, en clair. */
function erreurInscription(statut: number, corps: string): string {
  const derniere = (lireErreur(corps).trim().split("\n").at(-1) ?? "").trim();
  if (/captcha/i.test(derniere)) {
    return "Signal refuse le captcha (expiré ou invalide) : en refaire un sur signalcaptchas.org et le recoller aussitôt.";
  }
  if (statut === 429 || /rate ?limit/i.test(derniere)) {
    return "Signal limite les demandes pour ce numéro : réessayer dans quelques heures.";
  }
  if (/verif|code/i.test(derniere)) {
    return "Code refusé : vérifier les six chiffres reçus, ou redemander un code.";
  }
  if (/lock|pin/i.test(derniere)) {
    return "Ce numéro a un verrou d'inscription : saisir son code PIN Signal.";
  }
  return `Relais Signal : HTTP ${statut}${derniere ? ` — ${derniere.replace(/\+\d{6,15}/g, masquer).slice(0, 160)}` : ""}.`;
}

/**
 * Le chef inscrit chez Signal le numéro PROPRE au bot, par le relais du poste : aucun téléphone
 * relié. Un appareil relié voit tous les messages du compte de ce téléphone ; un numéro propre ne
 * reçoit que ce qu'on écrit au bot, et ses clés restent sur le poste. Étape « code » : Signal
 * exige un captcha (signalcaptchas.org) puis envoie un code par SMS ou par appel. Étape
 * « valider » : le code ; le numéro devient celui du bot, profil nommé, écoute relancée.
 * Attention : un numéro déjà utilisé par Signal sur un téléphone en est déconnecté.
 */
export async function inscrireBot(
  i: InscriptionBot,
  poste: Poste = posteReel,
): Promise<{ ok: boolean; message: string; numero: string; etat: EtatBot }> {
  const e = await etat();
  const n = numeroE164(i.numero);
  const fin = async (ok: boolean, message: string) => ({
    ok,
    message,
    numero: n ? masquer(n) : "numéro invalide",
    etat: await lireEtatBot(),
  });
  if (!n) return fin(false, "Numéro invalide : au format +235… ou 00235…, indicatif du pays compris.");
  const s = serveurPoste(env("AFRICONTROL_BOT_RELAIS") ?? RELAIS_DEFAUT);
  if (!("base" in s)) {
    return fin(false, `AFRICONTROL_BOT_RELAIS refusée : le relais doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}).`);
  }
  const appel = async (chemin: string, methode: string, corps: unknown) => {
    try {
      const r = await fetch(`${s.base}${chemin}`, {
        method: methode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(INSCRIPTION_DELAI_MS),
      });
      return r.ok ? null : erreurInscription(r.status, await r.text());
    } catch (err) {
      return injoignable({ base: s.base, numero: n, autorisesPoste: new Set() }, err);
    }
  };
  if (i.etape === "code") {
    const captcha = i.captcha.trim();
    if (!captcha.startsWith("signalcaptcha://")) {
      return fin(false, "Captcha : coller le lien entier, qui commence par « signalcaptcha:// ».");
    }
    const refus = await appel(`/v1/register/${n}`, "POST", { captcha, use_voice: i.voix });
    return refus
      ? fin(false, refus)
      : fin(true, `Code demandé ${i.voix ? "par appel" : "par SMS"} au ${masquer(n)} : le saisir ci-dessous.`);
  }
  const code = i.code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return fin(false, "Code : les six chiffres reçus par SMS ou par appel.");
  const refus = await appel(`/v1/register/${n}/verify/${code}`, "POST", i.pin.trim() ? { pin: i.pin.trim() } : {});
  if (refus) return fin(false, refus);
  e.numeroBot = n;
  await enregistrer(e);
  const nom = i.nom.trim() || "AfriControl";
  const profil = await appel(`/v1/profiles/${n}`, "PUT", { name: nom });
  // Le bot écoute désormais son propre numéro.
  if (e.actif) {
    arreter(e);
    demarrer(e, poste);
  }
  return fin(
    true,
    `Numéro ${masquer(n)} inscrit chez Signal : c'est désormais celui du bot${profil ? ` (profil non nommé : ${profil})` : `, profil « ${nom} »`}.`,
  );
}

/**
 * Le chef demande un code pour appairer un téléphone à un numéro de la console : six chiffres
 * tirés au hasard, valables APPAIRAGE_MS, un seul à la fois (un nouveau remplace l'ancien). Le code
 * n'est rendu qu'à cet appel, pour l'écran du chef : ni enregistré, ni journalisé.
 */
export async function demanderAppairage(
  id: string,
): Promise<{ etat: EtatBot; numero: string; code: string; expireA: number }> {
  const e = await etat();
  const cible = e.numeros.find((x) => idNumero(x.numero) === id);
  if (!cible) throw new Error("Numéro introuvable parmi ceux de la console.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expireA = Date.now() + APPAIRAGE_MS;
  e.appairage = { numero: cible.numero, code, expireA, essais: 0 };
  return { etat: await lireEtatBot(), numero: masquer(cible.numero), code, expireA };
}

export type ActionNumero = "ajouter" | "activer" | "couper" | "retirer";

/**
 * Le chef gère les numéros de la console : ajouter (coupé : activable sur demande), activer,
 * couper, retirer. Effet au message suivant, puis enregistré sur le poste. `valeur` : le numéro
 * pour « ajouter », son identifiant d'écran sinon. Rend l'état et le numéro masqué, pour le journal.
 */
export async function gererNumero(
  action: ActionNumero,
  valeur: string,
): Promise<{ etat: EtatBot; numero: string }> {
  const e = await etat();
  if (action === "ajouter") {
    const n = numeroE164(valeur);
    if (!n) throw new Error("Numéro invalide : au format +235… ou 00235…, indicatif du pays compris.");
    if (listeAutorises(env("AFRICONTROL_BOT_AUTORISES")).has(n)) {
      throw new Error(`${masquer(n)} est déjà réglé dans poste.env : toujours écouté.`);
    }
    if (e.numeros.some((x) => x.numero === n)) throw new Error(`${masquer(n)} est déjà dans la liste.`);
    e.numeros = [...e.numeros, { numero: n, actif: false, ajouteA: Date.now() }];
    await enregistrer(e);
    return { etat: await lireEtatBot(), numero: masquer(n) };
  }
  const cible = e.numeros.find((x) => idNumero(x.numero) === valeur);
  if (!cible) throw new Error("Numéro introuvable parmi ceux de la console.");
  e.numeros =
    action === "retirer"
      ? e.numeros.filter((x) => x !== cible)
      : e.numeros.map((x) => (x === cible ? { ...x, actif: action === "activer" } : x));
  await enregistrer(e);
  // Activé : le bot le cherche aussitôt chez Signal, et l'écran dira s'il y est trouvable.
  const conf = reglage(e);
  if (action === "activer" && e.ecoute && !("erreur" in conf)) chercherSansAttendre(e, conf);
  return { etat: await lireEtatBot(), numero: masquer(cible.numero) };
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
