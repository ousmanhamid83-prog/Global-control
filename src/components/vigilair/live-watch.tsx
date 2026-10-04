import { useEffect, useRef } from "react";
import { fetchLivePicture } from "@/lib/vigilair/live-feeds";
import { ingestLivePicture, useVigilair } from "@/lib/vigilair/store";

/** Antenne du poste qui parle : 3 s entre deux relevés ; sinon 12 s (sources Internet). */
const FAST_MS = 3_000;
const SLOW_MS = 12_000;

function nextDelay(): number {
  const rx = useVigilair.getState().livePicture?.sources.find((s) => s.id === "rx");
  return rx?.ok ? FAST_MS : SLOW_MS;
}

/** Poll 1090ES / METAR / NOAA — lecture seule, pas d'émission. */
export function LiveWatch() {
  // La requête en cours, partagée : un remontage (React en dev, retour de page) l'attend au lieu
  // de l'ignorer et de repartir sur le délai lent.
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let dead = false;
    let timer = 0;
    const pull = (): Promise<void> => {
      if (inFlight.current) return inFlight.current;
      if (dead || useVigilair.getState().clockMode === "replay") return Promise.resolve();
      // Une requête qui ne revient pas ne doit pas bloquer la boucle : 16 s et on repart.
      const watchdog = new Promise<void>((resolve) => window.setTimeout(resolve, 16_000));
      const req = fetchLivePicture()
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
        });
      const run = Promise.race([req, watchdog]).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = run;
      return run;
    };
    // Le délai suivant se décide sur la réponse reçue : 3 s si l'antenne vient de parler.
    const loop = () => {
      void pull().then(() => {
        if (!dead) timer = window.setTimeout(loop, nextDelay());
      });
    };
    loop();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
