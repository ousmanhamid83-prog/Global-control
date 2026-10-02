import { useState, useSyncExternalStore } from "react";
import { authEnabled, signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useStaff } from "@/lib/vigilair/staff-context";

const subscribeToNothing = () => () => {};
const noGateOnServer = () => false;

/** Identité poste : grade / rôle, jamais l'e-mail du chef. */
export function PosteChip() {
  const { profile, isSuperadmin, loading } = useStaff();
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateOnServer,
  );

  if (loading && !profile) {
    return <div className="h-8 w-24 animate-pulse rounded-md bg-secondary" />;
  }

  const label = isSuperadmin ? "Chef de division" : (profile?.label?.trim() || "Poste");
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium text-fg">
        {initial}
      </span>
      <span className="max-w-36 truncate text-xs font-medium inline">{label}</span>
      {authEnabled && !gateSession ? (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut("/login").catch(() => setSigningOut(false));
          }}
          className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-fg hover:underline disabled:cursor-wait disabled:no-underline"
        >
          {signingOut ? "Fermeture…" : "Fermer"}
        </button>
      ) : null}
    </div>
  );
}
