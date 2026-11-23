/**
 * Règle le poste et ouvre la liaison avec son antenne 1090 AU LANCEMENT du serveur construit.
 *
 * La liaison s'ouvrait au premier affichage de la console. Or l'assistant, les commandes du poste
 * et le bot lisent l'image sans console ouverte : après un redémarrage, ils trouvaient une antenne
 * pas encore branchée. poste.env est lu d'abord : l'adresse de l'antenne peut y être réglée, et la
 * liaison ne la lit qu'une fois. Un bot Signal activé par le chef reprend de même son écoute, sans
 * attendre qu'une console s'ouvre. Le trafic reçu est enregistré dès le démarrage, console ouverte
 * ou non (enregistrerEnContinu), et la liaison de chaque drone qui en a une s'ouvre de même. Le serveur de développement n'exécute pas ce plugin (vérifié) :
 * là, src/server.ts lit poste.env, la console ouvre la liaison et relance le bot, comme avant.
 */
import { definePlugin } from "nitro";
import { filetArretUtile } from "../../src/lib/arret-serveur";
import { chargerEtAnnoncer } from "../../src/lib/config-poste";
import { assurerBot, suspendreBot } from "../../src/lib/vigilair/bot-signal.server";
import { listDronesServer } from "../../src/lib/vigilair/drones.server";
import { veillerEnContinu } from "../../src/lib/vigilair/drones-veille.server";
import { veillerCapteursEnContinu } from "../../src/lib/vigilair/ground-sensors.server";
import { enregistrerEnContinu } from "../../src/lib/vigilair/rejeu.server";
import { ecouterAntenne } from "../../src/lib/vigilair/rx1090.server";

export default definePlugin(() => {
  chargerEtAnnoncer();
  ecouterAntenne();
  enregistrerEnContinu();
  void assurerBot();
  // Le registre des drones lu, leurs liaisons s'ouvrent sans attendre une console ; la veille de
  // leurs pistes 1090ES tourne de même, et prévient le chef console fermée.
  void listDronesServer();
  veillerEnContinu();
  // Les capteurs sol : un silence au-delà de son délai est dit au chef, console fermée aussi.
  veillerCapteursEnContinu();
  // Le serveur qui s'arrête en douceur ne relève plus le relais Signal (voir suspendreBot). Là
  // seulement où srvx retient déjà les signaux : ailleurs (CI, tests), un écouteur de plus
  // empêcherait Node de s'arrêter sur SIGTERM.
  if (filetArretUtile(false, process.env)) {
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, suspendreBot);
  }
});
