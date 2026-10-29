/**
 * Un client qui s'en va n'est pas une panne du poste.
 *
 * Quand un navigateur abandonne une requête (page fermée, changement d'écran pendant un relevé ou
 * un envoi), le framework arrête le travail en levant la raison d'abandon du signal de la requête :
 * l'erreur réseau brute de Node (« Error: aborted », ECONNRESET). La couche HTTP l'écrivait alors
 * au journal comme une erreur 500 « non gérée », pile comprise — en développement comme en
 * production — et un corps de requête coupé net ajoutait un « Server Fn Error! ». Ces blocs ne
 * signalaient rien d'anormal et noyaient les vraies erreurs.
 *
 * La requête reçoit ici un signal dérivé dont la raison est une réponse 499 (« Client Closed
 * Request », convention nginx). Une réponse levée est une issue normale à chaque étage du
 * framework : le travail s'arrête toujours aussitôt, mais rien ne s'écrit. Une lecture du corps qui
 * échoue parce que le client est parti rend la même réponse. Toute autre erreur passe inchangée, et
 * reste écrite.
 */

/** Statut d'une requête que le client a abandonnée (convention nginx). */
export const CLIENT_PARTI = 499;

/** Les lectures du corps d'une requête (norme Fetch). */
const LECTURES_DU_CORPS = ["arrayBuffer", "blob", "bytes", "formData", "json", "text"] as const;

export function departSansErreur(request: Request): Request {
  const client = request.signal;
  const depart = new AbortController();
  const partir = () =>
    depart.abort(new Response(null, { status: CLIENT_PARTI, statusText: "Client Closed Request" }));
  if (client.aborted) partir();
  else client.addEventListener("abort", partir, { once: true });
  Object.defineProperty(request, "signal", { value: depart.signal });
  for (const nom of LECTURES_DU_CORPS) {
    const lecture = request[nom] as (() => Promise<unknown>) | undefined;
    // `bytes()` manque aux Node plus anciens : ne reprendre que ce que le moteur fournit.
    if (typeof lecture !== "function") continue;
    const lire = lecture.bind(request);
    Object.defineProperty(request, nom, {
      value: () =>
        lire().catch((erreur: unknown) => {
          throw depart.signal.aborted ? depart.signal.reason : erreur;
        }),
    });
  }
  return request;
}
