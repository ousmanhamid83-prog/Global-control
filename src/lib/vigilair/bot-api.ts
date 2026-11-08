/**
 * Bot Signal du poste depuis la console : lire son état, l'activer ou le couper. Lire : tout agent
 * connecté. Activer ou couper : le chef de division seul, et chaque bascule est écrite au journal
 * des opérations (qui, quand, avec quel réglage).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ActionNumero, EtatBot, InscriptionBot } from "./bot-signal.server";

export const lireBotSignal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<EtatBot> => {
    const srv = await import("./bot-signal.server");
    // Au démarrage du serveur construit, le plugin du poste relance un bot actif ; le serveur de
    // développement n'exécute pas ce plugin : la première lecture de l'état s'en charge.
    await srv.assurerBot();
    return srv.lireEtatBot();
  });

const LIBELLE_ACTION: Record<ActionNumero, string> = {
  ajouter: "ajouté, coupé : activable sur demande du chef",
  activer: "activé par le chef",
  couper: "coupé par le chef",
  retirer: "retiré de la liste",
};

/** Numéros de la console : le chef seul les ajoute, active, coupe ou retire ; journalisé. */
export const gererNumeroBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { action?: string; valeur?: string }) => {
    if (!raw?.action || !(raw.action in LIBELLE_ACTION)) throw new Error("Action inconnue");
    return { action: raw.action as ActionNumero, valeur: String(raw.valeur ?? "").slice(0, 40) };
  })
  .handler(async ({ data, context }): Promise<EtatBot> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./bot-signal.server");
    const { etat, numero } = await srv.gererNumero(data.action, data.valeur);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "bot",
      title: `Bot Signal : ${numero} ${LIBELLE_ACTION[data.action]}`,
      detail:
        etat.enregistrement === "fichier"
          ? "Enregistré sur le poste (data/bot-signal.json) ; effet au message suivant."
          : "Disque en lecture seule : valable jusqu'au redémarrage du serveur.",
      // Un numéro activé peut tirer des réponses du poste : à voir au journal.
      severity: data.action === "activer" ? "warn" : "info",
    });
    return etat;
  });

/**
 * Inscription du numéro propre au bot chez Signal (captcha, puis code reçu) : le chef seul. Le
 * journal dit qui, quel numéro (masqué) et l'issue — jamais le captcha ni le code.
 */
export const inscrireBotSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (raw: {
      etape?: string;
      numero?: string;
      captcha?: string;
      voix?: boolean;
      code?: string;
      pin?: string;
      nom?: string;
    }): InscriptionBot => {
      const numero = String(raw?.numero ?? "").slice(0, 24);
      if (raw?.etape === "code") {
        return { etape: "code", numero, captcha: String(raw.captcha ?? "").slice(0, 4000), voix: raw.voix === true };
      }
      if (raw?.etape === "valider") {
        return {
          etape: "valider",
          numero,
          code: String(raw.code ?? "").slice(0, 12),
          pin: String(raw.pin ?? "").slice(0, 32),
          nom: String(raw.nom ?? "").slice(0, 26),
        };
      }
      throw new Error("Étape inconnue");
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string; etat: EtatBot }> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const srv = await import("./bot-signal.server");
    const r = await srv.inscrireBot(data);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "bot",
      title:
        data.etape === "code"
          ? `Bot Signal : code d'inscription demandé pour ${r.numero}${r.ok ? "" : " — refusé"}`
          : `Bot Signal : inscription de ${r.numero} ${r.ok ? "validée" : "refusée"}`,
      detail: r.message,
      // Un numéro inscrit devient la voix du poste sur Signal, un refus peut cacher une erreur de
      // saisie ou une tentative : les deux sont à voir au journal.
      severity: r.ok && data.etape === "code" ? "info" : "warn",
    });
    return { ok: r.ok, message: r.message, etat: r.etat };
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
