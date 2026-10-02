import { useEffect } from "react";
import { listZones } from "@/lib/vigilair/zones-ops";
import { setLiveZones } from "@/lib/vigilair/zones";
import { useVigilair } from "@/lib/vigilair/store";

export function ZoneWatch() {
  useEffect(() => {
    let live = true;
    const tick = () => {
      listZones()
        .then((rows) => {
          if (!live) return;
          setLiveZones(rows);
          useVigilair.getState().setZones(rows);
        })
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 12_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
  return null;
}
