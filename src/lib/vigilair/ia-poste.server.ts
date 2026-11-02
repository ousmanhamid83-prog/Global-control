/**
 * IA du poste — CÔTÉ SERVEUR, vers un serveur de modèle SUR LE RÉSEAU DU POSTE, jamais vers un
 * service public. L'assistant, le briefing et le compte rendu de quart lui envoient la question de
 * l'opérateur, un résumé de l'image live et les bulletins du journal (indicatifs, plateformes,
 * coordonnées) : rien de cela ne doit quitter le poste. Avant, tout partait chez DeepSeek, avec
 * repli chez xAI.
 *
 *   AFRICONTROL_IA=http://127.0.0.1:11434/v1   serveur compatible OpenAI : Ollama, llama.cpp
 *                                              (llama-server), vLLM, LM Studio…
 *   AFRICONTROL_IA_MODELE=qwen2.5:7b           modèle (facultatif : sinon le premier qu'il annonce)
 *   AFRICONTROL_IA_CLE=…                       jeton, si le serveur en exige un (facultatif)
 *
 * Une adresse hors du réseau du poste (voir reseau-poste) est refusée avant tout envoi.
 */
import { env } from "../env.server.ts";
import { annoterReponse } from "./ia-garde-fou.ts";
import { RESEAU_POSTE_EXEMPLES, serveurPoste } from "./reseau-poste.ts";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Un modèle local sur un processeur peut être lent : on lui laisse le temps de rédiger. */
const DELAI_REPONSE_MS = 120_000;

function adresseIa(): { base: string } | { erreur: string; reglee: boolean } {
  const s = serveurPoste(env("AFRICONTROL_IA"));
  if ("base" in s) return s;
  return s.refus === "absente"
    ? { erreur: "IA du poste non réglée (AFRICONTROL_IA au lancement du serveur)", reglee: false }
    : {
        erreur: `AFRICONTROL_IA refusée : le serveur d'IA doit être sur le réseau du poste (${RESEAU_POSTE_EXEMPLES}). Rien n'a été envoyé.`,
        reglee: true,
      };
}

/** Pourquoi l'IA ne sert pas (non réglée, ou réglée hors du poste) ; null si elle est prête. */
export function iaIndisponible(): { erreur: string; reglee: boolean } | null {
  const a = adresseIa();
  return "base" in a ? null : a;
}

function entetes(): Record<string, string> {
  const cle = env("AFRICONTROL_IA_CLE");
  return { "Content-Type": "application/json", ...(cle ? { Authorization: `Bearer ${cle}` } : {}) };
}

async function modele(base: string): Promise<string> {
  const choisi = env("AFRICONTROL_IA_MODELE");
  if (choisi) return choisi;
  const res = await fetch(`${base}/models`, {
    headers: entetes(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`serveur d'IA ${res.status} (liste des modèles)`);
  const corps = (await res.json()) as { data?: { id?: string }[] };
  const id = corps.data?.find((m) => m.id)?.id;
  if (!id) throw new Error("le serveur d'IA n'annonce aucun modèle : régler AFRICONTROL_IA_MODELE");
  return id;
}

/** Un échange avec l'IA du poste. Renvoie le texte, ou lève une erreur parlante. */
export async function iaChat(
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const a = adresseIa();
  if (!("base" in a)) throw new Error(a.erreur);
  const res = await fetch(`${a.base}/chat/completions`, {
    method: "POST",
    headers: entetes(),
    body: JSON.stringify({
      model: await modele(a.base),
      max_tokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.2,
      stream: false,
      messages,
    }),
    signal: AbortSignal.timeout(DELAI_REPONSE_MS),
  });
  if (!res.ok) throw new Error(`serveur d'IA ${res.status}`);
  const corps = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const texte = corps.choices?.[0]?.message?.content?.trim() ?? "";
  if (!texte) throw new Error("réponse vide du serveur d'IA");
  return texte;
}

/**
 * Un échange avec l'IA du poste, passé au garde-fou : tout indicatif, adresse ICAO,
 * immatriculation ou groupe codé que la réponse cite sans qu'il figure dans les messages envoyés
 * est signalé en clair sous la réponse (voir ia-garde-fou). Pour tout ce que l'opérateur lit
 * comme un fait : assistant, briefing, compte rendu de quart.
 */
export async function iaChatVerifie(
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const texte = await iaChat(messages, opts);
  return annoterReponse(texte, messages.map((m) => m.content).join("\n"));
}

/** Bouton « Tester le serveur » : réglé ? sur le poste ? répond ? avec quel modèle ? */
export async function iaCheck(): Promise<{
  configured: boolean;
  ok: boolean;
  error: string | null;
  modele: string | null;
}> {
  const a = adresseIa();
  if (!("base" in a)) {
    return { configured: a.reglee, ok: false, error: a.reglee ? a.erreur : null, modele: null };
  }
  try {
    const m = await modele(a.base);
    await iaChat([{ role: "user", content: "Réponds exactement : OK" }], { maxTokens: 5 });
    return { configured: true, ok: true, error: null, modele: m };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "échec",
      modele: null,
    };
  }
}
