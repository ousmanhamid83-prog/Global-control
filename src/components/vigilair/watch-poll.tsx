import { useEffect } from "react";
import { currentWatch } from "@/lib/vigilair/watch-ops";
import { useVigilair } from "@/lib/vigilair/store";

/** Poll le quart ouvert. Monté au runtime, survit aux routes. */
export function WatchPoll() {
  useEffect(() => {
    let live = true;
    const tick = () => {
      currentWatch()
        .then((w) => {
          if (!live) return;
          useVigilair.setState({ watch: w, watchLoaded: true });
        })
        .catch(() => {
          if (!live) return;
          useVigilair.setState({ watchLoaded: true });
        });
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
  return null;
}
