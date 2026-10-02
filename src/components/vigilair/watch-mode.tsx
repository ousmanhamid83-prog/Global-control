import { useEffect, useRef } from "react";
import { computePosture } from "@/lib/vigilair/defense";
import { theaterRank } from "@/lib/vigilair/geo";
import { autoSatLayer, evaluateWatch } from "@/lib/vigilair/watch-mode";
import { useVigilair } from "@/lib/vigilair/store";

const TITLE_IDLE = "VIGILAIR";

/**
 * Contrôleur mode veille — survit aux routes.
 * COP reste live, couche jour/nuit, réveil sur menace, pas de gel idle.
 */
export function WatchMode() {
  const titleRef = useRef(TITLE_IDLE);

  useEffect(() => {
    let live = true;
    const tick = () => {
      if (!live) return;
      const st = useVigilair.getState();
      if (!st.watchMode) {
        if (document.title.startsWith("VIGILAIR · RÉVEIL")) {
          document.title = TITLE_IDLE;
        }
        return;
      }

      const tracks = st.tracks;
      const { posture } = computePosture(tracks);
      const unackedHot = st.alerts.filter(
        (a) => !a.acked && (a.level === "elevee" || a.level === "critique"),
      ).length;
      const uav = tracks.filter(
        (t) =>
          t.idState !== "perdu" &&
          (t.category ?? "").toUpperCase() === "B6",
      ).length;
      const intrusion = st.zonePicture.some((z) => z.level === "intrusion");
      const emergency = tracks.filter((t) => t.emergency && t.idState !== "perdu").length;

      const theaterHit = st.phenomena.filter(
        (p) =>
          theaterRank(p.theater) >= 3 &&
          (p.level === "elevee" || p.level === "critique"),
      ).length;
      const globeHit = st.phenomena.filter(
        (p) =>
          theaterRank(p.theater) < 3 &&
          (p.level === "elevee" || p.level === "critique"),
      ).length;

      const verdict = evaluateWatch({
        posture,
        unackedHot,
        uav,
        intrusion,
        emergency,
        theaterHit,
        globeHit,
      });
      st.applyWatchWake(verdict);

      const night = Boolean(st.livePicture?.solar?.nightOps);
      const next = autoSatLayer(night, st.satLayer, st.watchAutoLayer);
      if (next) useVigilair.setState({ satLayer: next });

      const woke = !useVigilair.getState().watchDimmed;
      const want = woke
        ? `VIGILAIR · RÉVEIL · ${verdict.reason}`
        : "VIGILAIR · VEILLE";
      if (document.title !== want) {
        document.title = want;
        titleRef.current = want;
      }
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      live = false;
      window.clearInterval(id);
      if (document.title.startsWith("VIGILAIR ·")) document.title = TITLE_IDLE;
    };
  }, []);

  return null;
}
