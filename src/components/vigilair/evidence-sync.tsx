import { useEffect } from "react";
import { bulletinToJournal, listBulletins } from "@/lib/vigilair/evidence-store";
import { useVigilair } from "@/lib/vigilair/store";

/** Charge le journal de division une fois le poste ouvert. */
export function EvidenceSync() {
  const hydrateJournal = useVigilair((s) => s.hydrateJournal);
  useEffect(() => {
    let live = true;
    listBulletins()
      .then((rows) => {
        if (live) hydrateJournal(rows.map(bulletinToJournal));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [hydrateJournal]);
  return null;
}
