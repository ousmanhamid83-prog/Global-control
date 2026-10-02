import { useEffect } from "react";
import { registerPoste } from "@/lib/vigilair/poste";

export function PosteBoot() {
  useEffect(() => {
    registerPoste();
  }, []);
  return null;
}
