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

/**
 * Relais Signal du poste : le conteneur signal-cli-rest-api (scripts/poste/preparer-poste), dont
 * l'API attend POST /v2/send {message, number, recipients}. Adresse à coller dans Division :
 *   http://127.0.0.1:8085/v2/send?number=+235XXXXXXXX&recipients=+235YYYYYYYY
 * Du relais au téléphone, Signal chiffre de bout en bout : seuls les destinataires lisent le
 * détail. Un relais hors du réseau du poste ne reçoit, lui aussi, que le niveau et l'heure.
 */
export function estRelaisSignal(adresse: string): boolean {
  try {
    return new URL(adresse).pathname.replace(/\/+$/, "").endsWith("/v2/send");
  } catch {
    return false;
  }
}

/** Paramètre d'adresse brut : URLSearchParams lirait « +235… » comme « 235… » précédé d'un espace. */
function parametre(u: URL, nom: string): string {
  for (const morceau of u.search.slice(1).split("&")) {
    const [cle, valeur = ""] = morceau.split("=");
    if (cle === nom) return decodeURIComponent(valeur).trim();
  }
  return "";
}

/** Où et quoi envoyer pour le webhook réglé dans Division : relais Signal ou webhook générique. */
export function envoiWebhook(
  alerte: AlerteChef,
  adresse: string,
  at: Date,
): { url: string; corps: Record<string, unknown> } {
  if (!estRelaisSignal(adresse)) return { url: adresse, corps: corpsWebhook(alerte, adresse, at) };
  const u = new URL(adresse);
  const corps = {
    message: hoteSurPlace(adresse)
      ? `AfriControl · ${alerte.level.toUpperCase()}\n${alerte.title}\n${alerte.body}`
      : texteTelegram(alerte, at),
    number: parametre(u, "number"),
    recipients: parametre(u, "recipients")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  };
  u.search = "";
  return { url: u.toString(), corps };
}
