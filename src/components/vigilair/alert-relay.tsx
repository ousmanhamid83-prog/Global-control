import { useEffect, useRef } from "react";
import { pushInstantAlert } from "@/lib/vigilair/staff";
import { useVigilair } from "@/lib/vigilair/store";

/** Relais des alertes élevées / critiques vers Telegram et Signal. */
export function AlertRelay() {
  const alerts = useVigilair((s) => s.alerts);
  const sent = useRef(new Set<string>());

  useEffect(() => {
    for (const a of alerts) {
      if (sent.current.has(a.id)) continue;
      if (a.injected) continue;
      if (a.level !== "elevee" && a.level !== "critique") continue;
      sent.current.add(a.id);
      void pushInstantAlert({
        data: { id: a.id, title: a.title, body: a.body, level: a.level },
      }).catch(() => {
        sent.current.delete(a.id);
      });
    }
  }, [alerts]);

  return null;
}
