/**
 * Règle le poste et ouvre la liaison avec son antenne 1090 AU LANCEMENT du serveur construit.
 *
 * La liaison s'ouvrait au premier affichage de la console. Or l'assistant, les commandes du poste
 * et le bot lisent l'image sans console ouverte : après un redémarrage, ils trouvaient une antenne
 * pas encore branchée. poste.env est lu d'abord : l'adresse de l'antenne peut y être réglée, et la
 * liaison ne la lit qu'une fois. Un bot Signal activé par le chef reprend de même son écoute, sans
 * attendre qu'une console s'ouvre. Le serveur de développement n'exécute pas ce plugin (vérifié) :
 * là, src/server.ts lit poste.env, la console ouvre la liaison et relance le bot, comme avant.
 */
import { definePlugin } from "nitro";
import { chargerEtAnnoncer } from "../../src/lib/config-poste";
import { assurerBot } from "../../src/lib/vigilair/bot-signal.server";
import { ecouterAntenne } from "../../src/lib/vigilair/rx1090.server";

export default definePlugin(() => {
  chargerEtAnnoncer();
  ecouterAntenne();
  void assurerBot();
});
