/**
 * Client DeepSeek — CÔTÉ SERVEUR UNIQUEMENT. La clé vit dans la variable d'environnement
 * AFRICONTROL_DEEPSEEK, jamais dans le code, le bundle navigateur, ni Git. Le navigateur ne reçoit
 * que la réponse texte ; la clé ne quitte jamais le serveur. API compatible OpenAI (DeepSeek).
 *
 *   AFRICONTROL_DEEPSEEK=sk-...   posée AU LANCEMENT du serveur. C'est un SECRET : surtout pas une
 *   variable VITE_ (celles-là partent dans le navigateur), ni le fichier .grok/app-env.json.
 *
 * Exemples de lancement (la clé reste dans l'environnement du serveur, pas dans un fichier livré) :
 *   AFRICONTROL_DEEPSEEK=sk-xxx PORT=8080 node .output/server/index.mjs
 *   AFRICONTROL_DEEPSEEK=sk-xxx npm run dev
 */

import { env } from "@/lib/env.server";

const API = "https://api.deepseek.com/chat/completions";

export function deepseekConfigured(): boolean {
  return Boolean(env("AFRICONTROL_DEEPSEEK"));
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Un échange DeepSeek. Renvoie le texte, ou lève une erreur parlante (jamais la clé). */
export async function deepseekChat(
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number; model?: string } = {},
): Promise<string> {
  const key = env("AFRICONTROL_DEEPSEEK");
  if (!key) throw new Error("AFRICONTROL_DEEPSEEK non configurée");
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model ?? "deepseek-chat",
      max_tokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.2,
      stream: false,
      messages,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("réponse DeepSeek vide");
  return text;
}

/** Vérifie que la clé obtient bien une réponse (bouton « Tester la clé »). */
export async function deepseekCheck(): Promise<{ configured: boolean; ok: boolean; error: string | null }> {
  if (!deepseekConfigured()) return { configured: false, ok: false, error: null };
  try {
    const t = await deepseekChat([{ role: "user", content: "Réponds exactement : OK" }], { maxTokens: 5 });
    return { configured: true, ok: Boolean(t), error: null };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : "échec" };
  }
}
