/** Sentinelle DLP — une clé VA- est collée au premier poste. VIGILAIR n'émet pas. */

import { POSTE_LABEL } from "./privacy";

export type SentinelKind = "software" | "folder" | "machine";

export const KEY_MOVED_MSG =
  "Cette clé est déjà liée à un autre poste. Session refusée. Le chef de division a été alerté.";

export const EXFIL_MSG =
  "Copie du logiciel ou d'un dossier détectée. Session coupée. Incident documenté. Le chef de division a été alerté.";

export const SENTINEL_DOCTRINE = [
  {
    id: "bind",
    title: "Une clé, un poste",
    body: "La première machine qui présente une clé VA- la scelle. Empreinte SHA-256 du navigateur — pas d'adresse IP, pas de libellé d'écran ni de fuseau en clair. Un second poste avec la même clé = usurpation. Accès refusé, session coupée, alerte chef, dossier hashé.",
  },
  {
    id: "software",
    title: "Copie du logiciel",
    body: "Ctrl+S, enregistrer la page, inspection (F12), source (Ctrl+U). L'agent n'emporte pas VIGILAIR. Détection → coupure immédiate, alerte Telegram/Signal si configurés, PDF d'incident scellé SHA-256.",
  },
  {
    id: "folder",
    title: "Copie d'un dossier",
    body: "Presse-papiers massif, impression, extraction PDF en rafale, glisser-déposer. Un dossier de preuve ne quitte pas le COP. Même chaîne : alerte, déconnexion, documentation opposable.",
  },
  {
    id: "chef",
    title: "Chef de division",
    body: "Le chef n'est pas collé à un poste : il dote, il éjecte, il verse les preuves. Ses extraits PDF sont consignés, pas sanctionnés. Seuls les agents à clé VA- déclenchent la sentinelle.",
  },
  {
    id: "brute",
    title: "Force brute et spray de clés",
    body: "Cinq échecs e-mail / mot de passe ou clé VA- en dix minutes : verrou 15 min, alerte chef, COP figé, sessions agents coupées. Huit clés fausses en cinq minutes = spray. VIGILAIR ne riposte pas sur le réseau adverse : il coupe, consigne, alerte.",
  },
  {
    id: "identite",
    title: "Identité e-mail",
    body: "Chaque agent a un e-mail professionnel plus une clé VA-. L'e-mail n'est pas un mot de passe. La clé se scelle au premier poste. Un e-mail sans la bonne clé est un refus, pas une indication que le compte existe.",
  },
  {
    id: "anonymat",
    title: "Anonymat du chef et du COP",
    body: "Aucune police ni carte tierce depuis le navigateur : Google, NASA GIBS et EOX ne voient pas l'IP du poste. Les sessions n'enregistrent ni IP ni User-Agent. L'e-mail du chef n'apparaît pas sur le COP. VIGILAIR n'émet pas, ne riposte pas, ne révèle pas le super-administrateur à un opérateur ou un cybercriminel.",
  },
  {
    id: "sceau",
    title: "Sceau chef et inactivité",
    body: "Émettre une clé, éjecter, figer le COP, purger : le mot de passe chef est redemandé. Valable 5 minutes. Huit minutes sans geste : le poste se fige, mot de passe ou clé VA- pour reprendre. Un poste oublié n'est plus un COP ouvert.",
  },
  {
    id: "sessions",
    title: "Plafond de sessions et aperçu",
    body: "Chef : deux sessions (deux postes PC). Agent : une seule, collée à la machine. Les plus anciennes sont coupées. Si Chrome bloque les cookies dans l'aperçu, la session passe par un jeton interne — installez le poste sur le PC pour un cookie first-party.",
  },
] as const;

export async function machineFingerprint(): Promise<{
  fingerprint: string;
  machineLabel: string;
}> {
  if (typeof window === "undefined") {
    return { fingerprint: "", machineLabel: "serveur" };
  }
  const nav = window.navigator;
  const parts = [
    nav.userAgent,
    nav.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(window.screen.width),
    String(window.screen.height),
    String(window.devicePixelRatio),
    String(nav.hardwareConcurrency ?? 0),
    String((nav as Navigator & { deviceMemory?: number }).deviceMemory ?? 0),
    nav.platform,
  ];
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 28;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px IBM Plex Sans, sans-serif";
      ctx.fillStyle = "#c8ccd4";
      ctx.fillText("VIGILAIR-M4-SENTINELLE", 2, 4);
      parts.push(c.toDataURL());
    }
  } catch {
    parts.push("canvas-off");
  }
  const raw = parts.join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const fingerprint = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const machineLabel = POSTE_LABEL;
  return { fingerprint, machineLabel };
}

export function isSoftwareHotkey(e: KeyboardEvent): boolean {
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === "s" || k === "u" || k === "p") return true;
    if (e.shiftKey && (k === "i" || k === "j" || k === "c" || k === "k")) return true;
  }
  return e.key === "F12";
}
