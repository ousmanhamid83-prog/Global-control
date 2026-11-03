/**
 * Bot Signal du poste depuis la console : lire son état, l'activer ou le couper. Lire : tout agent
 * connecté. Activer ou couper : le chef de division seul, et chaque bascule est écrite au journal
 * des opérations (qui, quand, avec quel réglage).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { EtatBot } from "./bot-signal.server";

export const lireBotSignal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<EtatBot> => {
    const srv = await import("./bot-signal.server");
    // Au démarrage du serveur construit, le plugin du poste relance un bot actif ; le serveur de
    // développement n'exécute pas ce plugin : la première lecture de l'état s'en charge.
    await srv.assurerBot();
    return srv.lireEtatBot();
  });

export const basculerBotSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { actif?: boolean }) => {
    if (typeof raw?.actif !== "boolean") throw new Error("Bascule invalide");
    return { actif: raw.actif };
  })
  .handler(async ({ data, context }): Promise<EtatBot> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./bot-signal.server");
    const etat = await srv.basculerBot(data.actif);
    const r = etat.reglage;
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "bot",
      title: `Bot Signal ${data.actif ? "activé" : "coupé"}`,
      detail: [
        "erreur" in r
          ? `Réglage incomplet : ${r.erreur}`
          : `${r.autorises} numéro(s) autorisé(s), relais ${r.relais}.`,
        etat.enregistrement === "fichier"
          ? "Enregistré sur le poste (data/bot-signal.json)."
          : "Disque en lecture seule : valable jusqu'au redémarrage du serveur.",
      ].join(" "),
      // Activé, le bot fait sortir des réponses du poste vers des téléphones : à voir au journal.
      severity: data.actif ? "warn" : "info",
    });
    return etat;
  });
