/**
 * Journal des actions sensibles des commandes et de l'agent — CÔTÉ SERVEUR. Une recherche en ligne
 * fait sortir une requête du poste : qui l'a lancée, laquelle, et ce qui a été refusé va au journal
 * des opérations, comme les bascules du chef.
 */
import { masquer } from "./bot-signal";
import type { Journal } from "./recherche-poste.server";

type Auteur = { userId: string; actor: string; role: string; team: string };

async function ecrire(auteur: Auteur, ...[titre, detail, options]: Parameters<Journal>): Promise<void> {
  const { insertOpsLog } = await import("./staff");
  await insertOpsLog({
    ...auteur,
    kind: options?.genre ?? "recherche",
    title: titre,
    detail,
    severity: options?.severite ?? (titre.includes("refusée") ? "warn" : "info"),
  });
}

/** Le journal au nom d'un agent connecté de la console. */
export function journalDe(userId: string): Journal {
  return async (titre, detail, options) => {
    const { loadStaff } = await import("./staff");
    const agent = await loadStaff(userId);
    await ecrire(
      {
        userId,
        actor: agent?.label ?? "poste",
        role: agent?.role ?? "inconnu",
        team: agent?.team ?? "inconnue",
      },
      titre,
      detail,
      options,
    );
  };
}

/** Le journal au nom du bot Signal, pour une commande reçue d'un numéro autorisé. */
export function journalBot(expediteur: string): Journal {
  return (titre, detail, options) =>
    ecrire(
      { userId: "bot-signal", actor: `Bot Signal · ${masquer(expediteur)}`, role: "bot", team: "poste" },
      titre,
      detail,
      options,
    );
}
