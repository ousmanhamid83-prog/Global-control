import { createFileRoute } from "@tanstack/react-router";

/**
 * Entrée des CAPTEURS SOL : un capteur (ou sa passerelle) dit son état au poste.
 *
 *   POST /api/capteur-sol   Authorization: Bearer <clé>   {"id":"…","etat":"alarme","detail":"zone 2"}
 *   GET  /api/capteur-sol?id=…&etat=ok&cle=<clé>          (appareils qui ne savent qu'appeler une URL)
 *
 * etat : ok, alarme ou hs. Corps JSON ou formulaire, 4 Kio au plus. Depuis le réseau du poste
 * seulement. Voir ground-sensors.server.
 */

const CORPS_MAX = 4096;

/** Le corps, lu jusqu'à CORPS_MAX octets ; null au-delà (rien de plus n'est gardé en mémoire). */
async function lireCorps(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const lecteur = request.body.getReader();
  const morceaux: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.byteLength;
    if (n > CORPS_MAX) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(n);
  let o = 0;
  for (const m of morceaux) {
    tout.set(m, o);
    o += m.byteLength;
  }
  return new TextDecoder().decode(tout);
}

async function recevoir(request: Request): Promise<Response> {
  const reponse = (statut: number, corps: unknown) =>
    Response.json(corps, { status: statut, headers: { "Cache-Control": "no-store" } });
  const champs: Record<string, unknown> = Object.fromEntries(new URL(request.url).searchParams);
  if (request.method === "POST") {
    const texte = await lireCorps(request);
    if (texte === null) return reponse(413, { erreur: "message trop long" });
    if (texte.trim()) {
      if ((request.headers.get("content-type") ?? "").includes("json")) {
        let v: unknown;
        try {
          v = JSON.parse(texte);
        } catch {
          return reponse(400, { erreur: "JSON illisible" });
        }
        if (!v || typeof v !== "object" || Array.isArray(v)) {
          return reponse(400, { erreur: "JSON : un objet attendu" });
        }
        Object.assign(champs, v);
      } else {
        Object.assign(champs, Object.fromEntries(new URLSearchParams(texte)));
      }
    }
  }
  const porteur = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const cle = porteur ?? (typeof champs.cle === "string" ? champs.cle : "");
  const { getRequestIP } = await import("@tanstack/react-start/server");
  const { recevoirMessage } = await import("@/lib/vigilair/ground-sensors.server");
  const r = await recevoirMessage(champs, cle, getRequestIP() ?? "");
  return reponse(r.statut, r.corps);
}

export const Route = createFileRoute("/api/capteur-sol")({
  server: {
    handlers: {
      GET: ({ request }) => recevoir(request),
      POST: ({ request }) => recevoir(request),
    },
  },
});
