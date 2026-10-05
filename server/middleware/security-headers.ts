/**
 * En-têtes de sécurité défensifs sur chaque réponse du poste. Durcissement, pas évasion :
 *  - X-Content-Type-Options: nosniff — pas de reniflage de type MIME.
 *  - Referrer-Policy: no-referrer — l'URL du poste ne part dans aucun en-tête Referer vers un tiers.
 *  - Permissions-Policy — géoloc, caméra, micro, USB, paiement coupés : le poste ne s'en sert pas,
 *    donc aucune page ni script embarqué ne peut les réclamer.
 *  - X-DNS-Prefetch-Control: off — pas de prérésolution DNS opportuniste.
 *
 * Pas de X-Frame-Options ni de frame-ancestors : le poste s'affiche légitimement dans un cadre
 * d'aperçu de la plateforme. Les appels aux sources externes (1090ES, météo…) partent du serveur,
 * jamais du navigateur de l'opérateur : son adresse IP n'est pas exposée aux agrégateurs.
 */
interface SecEvent {
  url: URL;
  req: { method: string };
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy":
    "geolocation=(), camera=(), microphone=(), usb=(), payment=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
};

export default async function securityHeadersMiddleware(
  _event: SecEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(k)) headers.set(k, v);
    }
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
  return result;
}
