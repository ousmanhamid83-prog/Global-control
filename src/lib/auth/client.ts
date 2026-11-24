import { createAuthClient } from "better-auth/react";
import { runSignOut } from "../../../scripts/sign-out-plan.mjs";

/**
 * Better Auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*`, with local
 * email + password accounts (the template's federated sign-in was removed on
 * 24 November 2026, see `server.ts`). Where cookies are PARTITIONED or refused
 * (the live preview iframe, an Android WebView), the login page keeps the
 * session token (`persistBearerToken`) and the `onRequest` hook attaches it as
 * a bearer token; with cookie auth no token is stored, so nothing changes.
 *
 * To sign out call `signOut()` below, NOT `authClient.signOut()`: the raw call
 * leaves the bearer token in place, and `onRequest` keeps re-attaching it, so
 * the visitor stays signed in.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();
      if (token) ctx.headers.set("Authorization", `Bearer ${token}`);
      return ctx;
    },
  },
});

/**
 * True when sign-in UI should be shown — i.e. whenever `VITE_AUTH_ENABLED` is
 * not `"false"`. The shipped template sets it to `"false"`
 * (`.grok/app-env.json`), which selects the dev user (see `use-current-user`);
 * with the key removed, sign-in is real (local email + password).
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

// ── Bearer token where cookies are partitioned or refused ────────────────────
// The embedded preview iframe has partitioned cookies, so we keep the session's
// bearer token in sessionStorage and attach it to every Better Auth request (and
// to server functions, via `@/lib/auth/middleware`). Empty wherever cookies
// work, so the cookie path is untouched there.
const BEARER_KEY = "grok-auth.bearer-token";

let memoryBearer: string | null = null;

function readStore(store: Storage): string | null {
  try {
    return store.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

function writeStore(store: Storage, token: string | null): void {
  try {
    if (token) store.setItem(BEARER_KEY, token);
    else store.removeItem(BEARER_KEY);
  } catch {
    /* Chrome Android / WebView : stockage tiers refusé */
  }
}

/** The stored preview bearer token, or null. */
export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  if (memoryBearer) return memoryBearer;
  const fromSession = readStore(window.sessionStorage);
  if (fromSession) {
    memoryBearer = fromSession;
    return fromSession;
  }
  const fromLocal = readStore(window.localStorage);
  if (fromLocal) {
    memoryBearer = fromLocal;
    writeStore(window.sessionStorage, fromLocal);
    return fromLocal;
  }
  return null;
}

function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  memoryBearer = token;
  writeStore(window.sessionStorage, token);
  writeStore(window.localStorage, token);
}

/**
 * Persist the Better Auth session token when cookies are blocked (Android
 * WebView / aperçu iframe). Same key the middleware already reads.
 */
export function persistBearerToken(token: string | null): void {
  setBearerToken(token);
}

/**
 * The sandbox live preview runs this app inside an iframe on a
 * `*.grok-sandbox.com` host, where the stored bearer token IS the session: its
 * sign-out clears it locally (see `runSignOut`).
 */
function inLivePreview(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".grok-sandbox.com")
  );
}

/**
 * Sign out of THIS app's local session, clear the preview token, then redirect.
 *
 * Use this, never `authClient.signOut()` — see the note on `authClient`.
 * Sequencing lives in `scripts/sign-out-plan.mjs` so it can be unit-tested.
 *
 * **Rejects when deployed if the server never confirms.** There the session is
 * an HttpOnly cookie only the server can clear, so redirecting anyway would
 * report a sign-out that did not happen. `<UserButton />` handles that for you;
 * a hand-rolled control must catch it and let the visitor retry. In the live
 * preview the local clear is sufficient, so it always resolves.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    livePreview: inLivePreview(),
    hasBearer: Boolean(getBearerToken()),
    // Better Auth resolves with `{ error }` instead of rejecting, so surface a
    // failed response as a rejection for the sequence to act on.
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    clearToken: () => setBearerToken(null),
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}
