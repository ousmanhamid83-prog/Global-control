/**
 * Fournisseur du contexte « agent de quart » : charge la fiche de l'agent connecté et coupe la
 * session quand l'accès a été retiré. Séparé du contexte (staff-context.ts) pour que ce fichier
 * n'exporte QUE son composant.
 */
import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "@/lib/auth/client";
import { SIGN_IN_PATH } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { EJECTED_MSG, ensureMyStaff, type StaffProfile } from "./staff";
import { StaffContext } from "./staff-context";

export function StaffProvider({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Seule l'IDENTITÉ compte ici : l'effet recharge la fiche agent, il n'a pas à rejouer parce qu'un
  // autre champ de la session a changé.
  const userId = user?.id;

  useEffect(() => {
    if (isPending) return;
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ensureMyStaff()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setProfile(null);
        const msg = err instanceof Error ? err.message : "";
        if (
          msg.includes("Accès retiré") ||
          msg === EJECTED_MSG ||
          msg.includes("clé unique") ||
          msg.includes("Mot de passe réservé")
        ) {
          const q = msg.includes("Accès retiré") ? "eject" : "denied";
          void signOut(`${SIGN_IN_PATH}?${q}=1`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isPending]);

  const isSuperadmin = profile?.role === "superadmin";

  return (
    <StaffContext.Provider
      value={{
        profile,
        loading,
        role: profile?.role ?? null,
        team: profile?.team ?? null,
        isSuperadmin,
        canDelete: isSuperadmin,
        canArmEw: isSuperadmin,
        applyProfile: setProfile,
      }}
    >
      {children}
    </StaffContext.Provider>
  );
}
