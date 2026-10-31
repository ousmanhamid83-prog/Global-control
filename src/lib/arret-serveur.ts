/**
 * Arrêt du serveur autonome. Sur SIGTERM ou Ctrl+C, le serveur HTTP (srvx) ferme l'écoute et laisse
 * finir les requêtes en cours, puis rend la main sans jamais appeler process.exit : le processus ne
 * s'éteint que lorsque plus rien ne tourne. Un flux qui ne peut pas être détaché de la boucle
 * d'événements — un récepteur GPS série, un enregistrement ATC en cours — le gardait vivant
 * indéfiniment, et un second Ctrl+C était ignoré : il fallait un kill -9.
 *
 * Filet : au premier signal, une minuterie détachée (unref) termine le processus une fois passé le
 * délai de fermeture de srvx. Elle ne retient rien : un serveur qui s'éteint seul s'éteint aussitôt.
 * Au second signal, l'opérateur insiste : arrêt immédiat.
 */

export type SignalArret = "SIGTERM" | "SIGINT";

export type ProcessusArret = {
  on(signal: SignalArret, ecouteur: () => void): unknown;
};

/** Code de sortie d'un arrêt forcé, selon l'usage POSIX : 128 + numéro du signal. */
const CODE_FORCE: Record<SignalArret, number> = { SIGINT: 130, SIGTERM: 143 };

export function armerArret(
  proc: ProcessusArret,
  sortir: (code: number) => void,
  delaiMs: number,
): void {
  let arme = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.on(signal, () => {
      if (arme) {
        sortir(CODE_FORCE[signal]);
        return;
      }
      arme = true;
      setTimeout(() => sortir(0), delaiMs).unref();
    });
  }
}

/** Délai de fermeture de srvx (SERVER_SHUTDOWN_TIMEOUT, 5 s par défaut), plus 2 s de marge. */
export function delaiArret(timeout: string | undefined): number {
  return ((Number.parseInt(timeout ?? "", 10) || 5) + 2) * 1000;
}

/**
 * Le filet ne sert que là où srvx retient les signaux : serveur construit (pas le serveur de
 * développement de Vite), hors Vercel (pas de srvx, la plateforme gère l'arrêt), et hors CI/TEST, où
 * srvx n'installe pas sa fermeture en douceur et où Node s'arrête donc déjà sur SIGTERM.
 */
export function filetArretUtile(dev: boolean, env: Record<string, string | undefined>): boolean {
  return !dev && !env.VERCEL && !env.CI && !env.TEST;
}
