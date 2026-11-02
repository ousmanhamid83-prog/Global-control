/**
 * Amorce la base embarquée AU LANCEMENT du serveur.
 *
 * Sans DATABASE_URL, la base est un Postgres compilé en WASM (PGLite) : sa création (initdb) est
 * ~1,3 s de calcul synchrone qui fige tout le processus. Le serveur construit ne charge
 * l'application qu'à la première requête, et la base partait au premier appel touchant
 * l'authentification : mesuré, une requête de l'opérateur restait alors bloquée 1,3 s, une fois,
 * en pleine utilisation. Les plugins Nitro s'exécutent une fois, au démarrage du processus : la
 * création a lieu là, avant que la console ne serve.
 *
 * Avec DATABASE_URL, rien à faire (ensureDbReady rend la main tout de suite). Un échec est
 * journalisé par lib/db, et la prochaine requête qui a besoin de la base retente.
 */
import { definePlugin } from "nitro";
import { ensureDbReady } from "../../src/lib/db";

export default definePlugin(() => {
  void ensureDbReady().catch(() => undefined);
});
