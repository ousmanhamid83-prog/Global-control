/**
 * Ce qu'une alerte laisse sortir du poste. Son détail — noms d'agents, récapitulatif de leur
 * travail, incidents de sécurité, zones, sites, indicatifs — ne part que vers un relais SUR LE
 * RÉSEAU DU POSTE (voir reseau-poste). Tout canal qui en sort ne reçoit qu'une alerte sans
 * contenu, le niveau et l'heure : Telegram, qui passe toujours par les serveurs de Telegram, et
 * tout webhook hors du réseau. Même l'identifiant interne reste au poste : il porte souvent un
 * indicatif ou un nom de site (« trk-ami-…-AFR123 », « site-Komé »).
 */
import { hoteSurPlace } from "./reseau-poste.ts";

export type AlerteChef = { id: string; title: string; body: string; level: string };

const MESSAGE_SANS_CONTENU = "Alerte au poste — détail dans la console.";

/** Heure UTC hh:mm, comme l'affiche la console. */
function heureZ(at: Date): string {
  return `${at.toISOString().slice(11, 16)} Z`;
}

/** Telegram passe toujours par les serveurs de Telegram : jamais de contenu. */
export function texteTelegram(alerte: AlerteChef, at: Date): string {
  return `AfriControl · ${alerte.level.toUpperCase()}\nAlerte au poste à ${heureZ(at)} — détail dans la console.`;
}

/** Corps envoyé au webhook : le détail s'il est sur le réseau du poste, sinon niveau et heure. */
export function corpsWebhook(
  alerte: AlerteChef,
  adresse: string,
  at: Date,
): Record<string, string> {
  const commun = { source: "AfriControl", level: alerte.level, at: at.toISOString() };
  return hoteSurPlace(adresse)
    ? { ...commun, id: alerte.id, title: alerte.title, body: alerte.body }
    : { ...commun, message: MESSAGE_SANS_CONTENU };
}
