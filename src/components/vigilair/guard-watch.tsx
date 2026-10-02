import { useEffect } from "react";
import { copLockStatus } from "@/lib/vigilair/guard-ops";
import { useVigilair } from "@/lib/vigilair/store";

export function GuardWatch() {
  useEffect(() => {
    let live = true;
    const tick = () => {
      copLockStatus()
        .then((lock) => {
          if (!live) return;
          const prev = useVigilair.getState().copLock?.locked;
          useVigilair.getState().setCopLock(lock);
          if (lock.locked && !prev) {
            useVigilair.getState().setRunning(false);
            useVigilair.getState().setEwArmed(false);
          }
        })
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
  return null;
}