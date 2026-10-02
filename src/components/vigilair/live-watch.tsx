import { useEffect, useRef } from "react";
import { fetchLivePicture } from "@/lib/vigilair/live-feeds";
import { ingestLivePicture, useVigilair } from "@/lib/vigilair/store";

/** Poll 1090ES / METAR / NOAA — lecture seule, pas d'émission. */
export function LiveWatch() {
  const inFlight = useRef(false);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (dead || inFlight.current) return;
      if (useVigilair.getState().clockMode === "replay") return;
      inFlight.current = true;
      const watchdog = window.setTimeout(() => {
        inFlight.current = false;
      }, 16_000);
      fetchLivePicture()
        .then((pic) => {
          ingestLivePicture(pic);
        })
        .catch((err: unknown) => {
          const st = useVigilair.getState();
          const pic = st.livePicture;
          const usable =
            pic != null &&
            (pic.aircraft.length > 0 ||
              pic.metar.length > 0 ||
              pic.taf.length > 0 ||
              pic.sigmets.length > 0 ||
              pic.airport != null ||
              pic.alerts.length > 0);
          if (usable) return;
          const msg = err instanceof Error ? err.message : "Flux 1090ES indisponible";
          useVigilair.setState({ liveError: msg.slice(0, 180) });
        })
        .finally(() => {
          window.clearTimeout(watchdog);
          inFlight.current = false;
        });
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
