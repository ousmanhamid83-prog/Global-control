// Point d'entrée serveur : celui du framework, à trois différences près — les réglages du poste
// (poste.env) sont chargés au démarrage (voir lib/config-poste), un client qui abandonne sa requête
// n'y est plus compté comme une erreur (voir lib/depart-client), et le serveur autonome s'arrête
// vraiment sur SIGTERM ou Ctrl+C (voir lib/arret-serveur).
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { armerArret, delaiArret, filetArretUtile } from "./lib/arret-serveur";
import { chargerEtAnnoncer } from "./lib/config-poste";
import { departSansErreur } from "./lib/depart-client";

chargerEtAnnoncer();

if (filetArretUtile(import.meta.env.DEV, process.env)) {
  armerArret(
    process,
    (code) => process.exit(code),
    delaiArret(process.env.SERVER_SHUTDOWN_TIMEOUT),
  );
}

export default createServerEntry({
  fetch: (request, opts) => handler.fetch(departSansErreur(request), opts),
});
