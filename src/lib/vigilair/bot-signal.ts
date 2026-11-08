/**
 * Bot Signal du poste — la partie pure : lire ce que le relais signal-cli du poste a reçu, décider
 * de la suite, mettre la réponse en forme. Le bot n'écoute QUE les numéros autorisés au poste : un
 * inconnu n'a aucune réponse (rien ne lui confirme qu'un bot écoute), un groupe non plus (la
 * réponse irait à des gens qui n'ont pas été autorisés). Module pur, testable sous node.
 */
import { analyser, trouverCommande } from "./commandes-poste.ts";
import { IA_QUESTION_MAX } from "./ia-limites.ts";

/**
 * Un message texte reçu ; `expediteur` vide quand Signal ne donne pas le numéro (masqué).
 * `compte` : l'identifiant du compte Signal de l'expéditeur (sourceUuid), vide s'il manque.
 */
export type MessageRecu = {
  expediteur: string;
  compte: string;
  texte: string;
  groupe: boolean;
  at: number;
};

/**
 * Les messages texte d'une réception du relais : le tableau de GET /v1/receive/{numero} (mode
 * native ou normal), ou un message de sa websocket (mode json-rpc) mis en tableau. Chaque élément
 * porte une { envelope } : l'expéditeur est sourceNumber (null quand Signal ne donne pas le
 * numéro ; « source », champ déprécié, n'en dit pas plus), le texte dataMessage.message, et un
 * groupInfo marque un message de groupe. Accusés de réception, frappes et synchronisations n'ont
 * pas de texte : ignorés.
 */
export function messagesRecus(brut: unknown): MessageRecu[] {
  if (!Array.isArray(brut)) return [];
  const recus: MessageRecu[] = [];
  for (const item of brut) {
    const env = (item as { envelope?: Record<string, unknown> } | null)?.envelope;
    const dm = env?.dataMessage as { message?: unknown; groupInfo?: unknown } | undefined;
    const texte = typeof dm?.message === "string" ? dm.message.trim() : "";
    if (!texte) continue;
    recus.push({
      expediteur: typeof env?.sourceNumber === "string" ? env.sourceNumber : "",
      compte: typeof env?.sourceUuid === "string" ? env.sourceUuid : "",
      texte,
      groupe: dm?.groupInfo != null,
      at: Number(env?.timestamp) || 0,
    });
  }
  return recus;
}

/** « +235 66 00-12.34 », « 00235… » → « +23566001234 » ; null si ce n'est pas un numéro E.164. */
export function numeroE164(brut: string): string | null {
  const n = brut.replace(/[\s.-]/g, "").replace(/^00/, "+");
  return /^\+\d{6,15}$/.test(n) ? n : null;
}

/** « +235 66 00 12 34, 00235… ; +235… » → les numéros E.164 ; le reste écarté. */
export function listeAutorises(brut: string | undefined): Set<string> {
  const numeros = (brut ?? "").split(/[,;]/).map(numeroE164);
  return new Set(numeros.filter((n): n is string => n !== null));
}

/**
 * Un numéro ajouté par le chef depuis la console : le bot ne l'écoute qu'une fois activé.
 * `compte` : le compte Signal appairé à ce numéro par un code du chef (sourceUuid). Il le fait
 * reconnaître quand Signal masque le numéro et que personne ne peut le trouver par son numéro.
 */
export type NumeroBot = { numero: string; actif: boolean; ajouteA: number; compte?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les numéros que le bot écoute : ceux de poste.env, toujours ; ceux de la console, activés. */
export function autorisesEffectifs(poste: Set<string>, numeros: NumeroBot[]): Set<string> {
  return new Set([...poste, ...numeros.filter((n) => n.actif).map((n) => n.numero)]);
}

/** Les numéros de la console relus sur le disque : valides seulement, sans doublon. */
export function numerosValides(brut: unknown): NumeroBot[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: NumeroBot[] = [];
  for (const x of brut) {
    const lu = (x ?? {}) as { numero?: unknown; actif?: unknown; ajouteA?: unknown; compte?: unknown };
    const numero = numeroE164(String(lu.numero ?? ""));
    if (!numero || vus.has(numero)) continue;
    vus.add(numero);
    const compte = typeof lu.compte === "string" && UUID.test(lu.compte) ? { compte: lu.compte } : {};
    sortie.push({ numero, actif: lu.actif === true, ajouteA: Number(lu.ajouteA) || 0, ...compte });
  }
  return sortie;
}

/** Un code d'appairage vaut 5 minutes, et trois codes faux l'annulent. */
export const APPAIRAGE_MS = 5 * 60_000;
export const APPAIRAGE_ESSAIS = 3;

/** « appairer 123 456 », « /Appairer : 123-456 » → « 123456 » ; null si ce n'en est pas un. */
export function codeAppairage(texte: string): string | null {
  const m = /^\/?appairer\b[\s:]*([\d\s-]+)$/i.exec(texte.trim());
  const code = m ? m[1]!.replace(/[\s-]/g, "") : "";
  return /^\d{6}$/.test(code) ? code : null;
}

/** Identifiant d'un numéro pour l'écran, qui ne le montre jamais en clair (FNV-1a, 32 bits). */
export function idNumero(numero: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < numero.length; i++) h = Math.imul(h ^ numero.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Un numéro tel qu'il paraît au journal et à l'écran : « +235•••••234 ». */
export function masquer(numero: string): string {
  return numero.length > 7
    ? `${numero.slice(0, 4)}${"•".repeat(numero.length - 7)}${numero.slice(-3)}`
    : "•••";
}

export type Verdict = "ok" | "refus" | "silence";

/**
 * Au plus `max` messages par expéditeur sur une fenêtre glissante. Au-delà : un seul
 * avertissement (« refus »), puis le silence jusqu'à ce que la fenêtre se libère — un flot de
 * messages ne produit pas un flot de réponses.
 */
export function creerLimiteur(
  max: number,
  fenetreMs: number,
): (qui: string, maintenant: number) => Verdict {
  const vus = new Map<string, { t: number[]; prevenu: boolean }>();
  return (qui, maintenant) => {
    const e = vus.get(qui) ?? { t: [], prevenu: false };
    e.t = e.t.filter((x) => maintenant - x < fenetreMs);
    vus.set(qui, e);
    if (e.t.length < max) {
      e.t.push(maintenant);
      e.prevenu = false;
      return "ok";
    }
    const v = e.prevenu ? "silence" : "refus";
    e.prevenu = true;
    return v;
  };
}

export const AIDE_BOT =
  "Bot du poste AfriControl : envoyer une commande, par exemple « situation » ou /situation. La liste : /aide.";
export const TROP_DE_COMMANDES = "Trop de commandes en une minute : réessayer dans un instant.";

/**
 * Au-delà, une commande est périmée : elle attendait sur les serveurs de Signal pendant que le bot
 * était coupé. L'exécuter répondrait à une question que plus personne ne pose.
 */
export const PERIME_MS = 5 * 60_000;

function heureZ(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} Z`;
}

/**
 * « Situation », « Météo. », « piste TST101 » : sur un téléphone, on tape le nom de la commande
 * sans la barre oblique. Le premier mot, s'il nomme une commande, en fait une ; sinon null.
 */
export function commandeSansBarre(texte: string): string | null {
  const [mot = "", ...reste] = texte.trim().split(/\s+/);
  const c = trouverCommande(mot.replace(/[.!?,;:]+$/, ""));
  return c ? `/${[c.nom, ...reste].join(" ")}` : null;
}

export type Decision =
  | { action: "ignorer"; raison: string }
  | { action: "repondre"; texte: string }
  | { action: "executer"; commande: string };

/** Que faire d'un message reçu. */
export function decider(
  m: MessageRecu,
  autorises: Set<string>,
  limite: (qui: string, maintenant: number) => Verdict,
  maintenant: number,
): Decision {
  if (!m.expediteur) {
    return {
      action: "ignorer",
      raison:
        "numéro masqué par Signal, inconnu du bot : si c'est un numéro autorisé, régler sur son téléphone Signal › Confidentialité › Numéro de téléphone › « Qui peut me trouver par mon numéro » : « Tout le monde »",
    };
  }
  if (!autorises.has(m.expediteur)) return { action: "ignorer", raison: "numéro non autorisé" };
  if (m.groupe) return { action: "ignorer", raison: "message de groupe" };
  const v = limite(m.expediteur, maintenant);
  if (v === "refus") return { action: "repondre", texte: TROP_DE_COMMANDES };
  if (v === "silence") return { action: "ignorer", raison: "trop de commandes" };
  if (m.at > 0 && maintenant - m.at > PERIME_MS) {
    return {
      action: "repondre",
      texte: `Message envoyé à ${heureZ(m.at)}, arrivé au poste à ${heureZ(maintenant)} : trop ancien, non exécuté. Le renvoyer s'il vaut encore.`,
    };
  }
  const commande = m.texte.startsWith("/") ? m.texte : commandeSansBarre(m.texte);
  if (!commande) return { action: "repondre", texte: AIDE_BOT };
  return { action: "executer", commande: commande.slice(0, IA_QUESTION_MAX) };
}

/** Commandes qui ne lisent pas le relevé des capteurs : son âge n'a rien à y faire. */
const SANS_RELEVE = new Set(["aide", "notice", "recherche"]);

/** « /meteo », « /piste TST101 » lisent le relevé ; « /aide », une commande inconnue, non. */
export function litLeReleve(texte: string): boolean {
  const a = analyser(texte);
  return a != null && "commande" in a && !SANS_RELEVE.has(a.commande.nom);
}

/**
 * Au-delà de cet âge, ou absent, le relevé Internet est attendu neuf plutôt que lu : une réponse
 * vieille de plusieurs heures (poste resté sans console) ne dirait rien d'utile. Pas si un relevé
 * a abouti ou échoué depuis aussi longtemps : hors ligne, chaque commande n'attend pas pour rien.
 */
export const RELEVE_VIEUX_MS = 120_000;

export function attendreReleve(ageMs: number | null, depuisTentativeMs: number): boolean {
  return (ageMs == null || ageMs >= RELEVE_VIEUX_MS) && depuisTentativeMs >= RELEVE_VIEUX_MS;
}

/** « 45 s », « 12 min », « 3 h ». */
export function dureeLisible(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
}

/**
 * Sous une commande réussie qui a lu le relevé : la ligne qui dit que sa part Internet a été
 * attendue, ou qu'elle est vieille ou absente (sans console ouverte, personne ne l'a rafraîchie) ;
 * null quand elle est fraîche et n'a pas fait attendre. `attenduMs` : l'attente du relevé neuf.
 */
export function noteReleve(
  r: { ok: boolean; commande: string | null },
  releve: { ageMs: number | null; frais: boolean; attenduMs?: number },
): string | null {
  if (!r.ok || r.commande == null || SANS_RELEVE.has(r.commande)) return null;
  const attendu = releve.attenduMs ?? 0;
  if (releve.frais) {
    return attendu >= 1000
      ? `Relevé Internet neuf, attendu ${dureeLisible(attendu)} : le poste n'en avait pas de récent.`
      : null;
  }
  if (attendu > 0) {
    return `Relevé Internet attendu ${dureeLisible(attendu)} sans réponse : vérifier la liaison Internet du poste (/capteurs).`;
  }
  return releve.ageMs == null
    ? "Pas encore de relevé Internet au poste : le premier est en cours, pour la commande suivante."
    : `Relevé Internet du poste vieux de ${dureeLisible(releve.ageMs)} : un nouveau est en cours, pour la commande suivante.`;
}

/** Longueur maximale d'une réponse du bot, en caractères. */
export const REPONSE_MAX = 3500;

/** La réponse envoyée au téléphone : les lignes de la commande, et son temps sur le poste. */
export function reponseBot(lignes: string[], ms: number): string {
  const corps = lignes.join("\n");
  const coupe =
    corps.length > REPONSE_MAX
      ? `${corps.slice(0, REPONSE_MAX - 1)}…\n(réponse tronquée : la suite à la console)`
      : corps;
  return `${coupe}\n— poste AfriControl, ${ms.toLocaleString("fr-FR")} ms`;
}
