/**
 * Journal des actions sensibles des commandes et de l'agent — CÔTÉ SERVEUR. Une recherche en ligne
 * fait sortir une requête du poste : qui l'a lancée, laquelle, et ce qui a été refusé va au journal
 * des opérations, comme les bascules du chef.
 */
import type { Journal } from "./recherche-poste.server";

/** Le journal au nom d'un agent connecté de la console. */
export function journalDe(userId: string): Journal {
  return async (titre, detail) => {
    const { insertOpsLog, loadStaff } = await import("./staff");
    const agent = await loadStaff(userId);
    await insertOpsLog({
      userId,
      actor: agent?.label ?? "poste",
      role: agent?.role ?? "inconnu",
      team: agent?.team ?? "inconnue",
      kind: "recherche",
      title: titre,
      detail,
      severity: titre.includes("refusée") ? "warn" : "info",
    });
  };
}
