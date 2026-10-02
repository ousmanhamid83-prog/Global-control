import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { signOut } from "@/lib/auth/client";
import { SIGN_IN_PATH } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  EJECTED_MSG,
  ensureMyStaff,
  type StaffProfile,
  type StaffRole,
  type StaffTeam,
} from "./staff";

type StaffState = {
  profile: StaffProfile | null;
  loading: boolean;
  role: StaffRole | null;
  team: StaffTeam | null;
  isSuperadmin: boolean;
  canDelete: boolean;
  canArmEw: boolean;
  applyProfile: (p: StaffProfile) => void;
};

const StaffContext = createContext<StaffState>({
  profile: null,
  loading: true,
  role: null,
  team: null,
  isSuperadmin: false,
  canDelete: false,
  canArmEw: false,
  applyProfile: () => undefined,
});

export function StaffProvider({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPending) return;
    if (!user) {
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
  }, [user?.id, isPending]);

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

export function useStaff(): StaffState {
  return useContext(StaffContext);
}
