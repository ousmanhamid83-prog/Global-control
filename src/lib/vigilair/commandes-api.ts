/**
 * Commandes du poste depuis la console : lancer une commande, lire les bascules, en changer une.
 * Lancer : tout agent connecté. Activer ou désactiver : le chef de division seul, et chaque
 * changement est écrit au journal des opérations (qui, quoi, quand).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { LIBELLE_CANAL, type Canal } from "./commandes-poste";
import type { EtatBascules, ResultatCommande } from "./commandes-poste.server";
import { IA_QUESTION_MAX } from "./ia-limites";

export const lancerCommande = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { texte?: string }) => ({
    texte: String(raw?.texte ?? "").slice(0, IA_QUESTION_MAX),
  }))
  .handler(async ({ data }): Promise<ResultatCommande> => {
    const srv = await import("./commandes-poste.server");
    return srv.lancer(data.texte, "console");
  });

export const lireCommandes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<EtatBascules> => {
    const srv = await import("./commandes-poste.server");
    return srv.lireBascules();
  });

export const basculerCommande = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { nom?: string; canal?: string; actif?: boolean }) => {
    if (raw?.canal !== "console" && raw?.canal !== "bot") throw new Error("Canal inconnu");
    if (typeof raw.actif !== "boolean") throw new Error("Bascule invalide");
    return { nom: String(raw.nom ?? ""), canal: raw.canal as Canal, actif: raw.actif };
  })
  .handler(async ({ data, context }): Promise<EtatBascules> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./commandes-poste.server");
    const etat = await srv.basculer(data.nom, data.canal, data.actif);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "commande",
      title: `/${data.nom} ${data.actif ? "activée" : "désactivée"} pour ${LIBELLE_CANAL[data.canal]}`,
      detail:
        etat.enregistrement === "fichier"
          ? "Enregistré sur le poste (data/commandes-poste.json)."
          : "Disque en lecture seule : valable jusqu'au redémarrage du serveur.",
      severity: "info",
    });
    return etat;
  });
