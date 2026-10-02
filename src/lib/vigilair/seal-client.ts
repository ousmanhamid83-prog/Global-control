/** Modal sceau chef — mot de passe pour les actes irréversibles. */

import { confirmChefSeal, SEAL_REQUIRED } from "./seal";

type Waiter = {
  resolve: (password: string | null) => void;
};

const g = globalThis as typeof globalThis & {
  __vigilairSealWait__?: Waiter | null;
  __vigilairSealListeners__?: Set<() => void>;
  __vigilairSealUntil__?: number;
};

function listeners(): Set<() => void> {
  return (g.__vigilairSealListeners__ ??= new Set());
}

export function sealModalOpen(): boolean {
  return Boolean(g.__vigilairSealWait__);
}

export function subscribeSealModal(fn: () => void): () => void {
  listeners().add(fn);
  return () => listeners().delete(fn);
}

export function askChefPassword(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    g.__vigilairSealWait__ = { resolve };
    for (const fn of listeners()) fn();
  });
}

export function finishChefPassword(password: string | null): void {
  const w = g.__vigilairSealWait__;
  g.__vigilairSealWait__ = null;
  for (const fn of listeners()) fn();
  w?.resolve(password);
}

export async function withChefSeal<T>(fn: () => Promise<T>): Promise<T> {
  const fresh = (g.__vigilairSealUntil__ ?? 0) > Date.now();
  if (fresh) {
    try {
      return await fn();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "";
      if (!msg.includes("Sceau chef")) throw ex;
    }
  }
  const password = await askChefPassword();
  if (!password) throw new Error("Sceau chef annulé");
  const r = await confirmChefSeal({ data: { password } });
  g.__vigilairSealUntil__ = r.until;
  return fn();
}

export function isSealRequired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Sceau chef") || msg.includes(SEAL_REQUIRED);
}
