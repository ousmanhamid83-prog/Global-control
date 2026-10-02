/** Garde d'accès — brute-force, spray de clés, verrou COP. VIGILAIR n'émet pas. */

export const AUTH_FAIL_WINDOW_MS = 10 * 60_000;
export const AUTH_FAIL_LIMIT = 5;
export const AUTH_LOCK_MS = 15 * 60_000;
export const SPRAY_WINDOW_MS = 5 * 60_000;
export const SPRAY_LIMIT = 8;

export type CopLockState = {
  locked: boolean;
  reason: string;
  byLabel: string | null;
  at: string | null;
};

export type AuthAttemptRow = {
  id: string;
  kind: string;
  identityShown: string;
  ok: boolean;
  detail: string;
  at: string;
};

export const AUTH_FAIL_MSG =
  "Identifiants refusés. E-mail et clé / mot de passe ne correspondent pas.";
export const AUTH_LOCK_MSG =
  "Poste verrouillé 15 minutes : trop de tentatives. Le chef de division est alerté.";
export const COP_LOCK_MSG =
  "COP figé — tentative d'intrusion. Lecture seule. VIGILAIR ne riposte pas en réseau : il coupe, consigne, alerte.";

export function maskEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "••••";
  const u = e.slice(0, at);
  const d = e.slice(at + 1);
  const head = u.slice(0, 1);
  return `${head}•••@${d}`;
}

export function maskKey(key: string): string {
  const k = key.replace(/\s+/g, "").toUpperCase();
  if (k.length < 8) return "VA-••••";
  return `${k.slice(0, 7)}••••`;
}
