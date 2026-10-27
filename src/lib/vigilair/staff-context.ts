/**
 * Contexte « agent de quart » : la fiche de l'agent connecté et ses droits, lus partout dans la
 * console. Le FOURNISSEUR vit à côté, dans staff-provider.tsx : ce module-ci ne contient que le
 * contexte et son hook, pour que les deux dizaines de vues qui lisent l'agent n'importent pas un
 * composant au passage.
 */
import { createContext, useContext } from "react";
import type { StaffProfile, StaffRole, StaffTeam } from "./staff";

export type StaffState = {
  profile: StaffProfile | null;
  loading: boolean;
  role: StaffRole | null;
  team: StaffTeam | null;
  isSuperadmin: boolean;
  canDelete: boolean;
  canArmEw: boolean;
  applyProfile: (p: StaffProfile) => void;
};

export const StaffContext = createContext<StaffState>({
  profile: null,
  loading: true,
  role: null,
  team: null,
  isSuperadmin: false,
  canDelete: false,
  canArmEw: false,
  applyProfile: () => undefined,
});

export function useStaff(): StaffState {
  return useContext(StaffContext);
}
