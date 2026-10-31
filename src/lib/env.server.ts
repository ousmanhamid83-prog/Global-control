export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * The auth switch as the server must apply it: the server's environment wins
 * (the deployer sets it), otherwise the value frozen into this build — the one
 * the browser bundle received. Without that fallback a standalone server
 * started outside the scripts' env wrapper (`node .output/server/index.mjs`)
 * enforced sign-in while the console, built with auth off, never offered one:
 * every server call was refused and the console showed an empty, silent sky.
 */
export function authSetting(): string | undefined {
  return env("VITE_AUTH_ENABLED") ?? import.meta.env?.VITE_AUTH_ENABLED;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience and gate endpoints key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}
