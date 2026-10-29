// Point d'entrée serveur : celui du framework, à une différence près — un client qui abandonne sa
// requête n'y est plus compté comme une erreur (voir lib/depart-client).
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { departSansErreur } from "./lib/depart-client";

export default createServerEntry({
  fetch: (request, opts) => handler.fetch(departSansErreur(request), opts),
});
