// Point d'entrée serveur : celui du framework, à deux différences près — un client qui abandonne sa
// requête n'y est plus compté comme une erreur (voir lib/depart-client), et le serveur autonome
// s'arrête vraiment sur SIGTERM ou Ctrl+C (voir lib/arret-serveur).
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { armerArret, delaiArret, filetArretUtile } from "./lib/arret-serveur";
import { departSansErreur } from "./lib/depart-client";

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
