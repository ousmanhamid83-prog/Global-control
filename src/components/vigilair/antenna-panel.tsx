import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchReceiverFeed } from "@/lib/vigilair/live-feeds";
import type { ReceiverFeed, ReceiverStatus } from "@/lib/vigilair/rx1090.server";
import { formatAge, useWallClock } from "@/lib/vigilair/telemetry";
import { cn } from "@/lib/utils";

type Frame = ReceiverFeed["frames"][number];

const KEEP = 400;
const POLL_MS = 1000;

const zTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/**
 * Antenne 1090 du poste : état de la liaison dump1090 et écoute brute. Chaque trame entendue
 * s'affiche, décodée, sans filtre d'altitude ni de distance ; les rejets disent pourquoi.
 */
export function AntennaPanel() {
  const [status, setStatus] = useState<ReceiverStatus | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const wall = useWallClock();

  useEffect(() => {
    let dead = false;
    let busy = false;
    const pull = () => {
      if (dead || busy) return;
      busy = true;
      fetchReceiverFeed({ data: { after: after.current } })
        .then((feed) => {
          if (dead) return;
          setError(null);
          setStatus(feed.status);
          // Le serveur a redémarré : sa numérotation repart de zéro.
          if (feed.seq < after.current) after.current = 0;
          if (pausedRef.current) return;
          after.current = feed.seq;
          if (feed.frames.length) {
            setFrames((prev) => [...feed.frames.slice().reverse(), ...prev].slice(0, KEEP));
          }
        })
        .catch((e: unknown) => {
          if (!dead) setError(e instanceof Error ? e.message : "liaison serveur coupée");
        })
        .finally(() => {
          busy = false;
        });
    };
    pull();
    const id = window.setInterval(pull, POLL_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  const live =
    status?.enabled && status.connected && status.lastLineAt != null && wall - status.lastLineAt < 60_000;
  const tone = !status ? "default" : live ? "ok" : status.enabled ? "warn" : "default";
  const label = !status
    ? "…"
    : !status.enabled
      ? "coupée"
      : live
        ? "live"
        : status.connected
          ? "connectée · muette"
          : "injoignable";

  return (
    <div className="space-y-4">
      <section className="hud space-y-3 rounded-md border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Antenne 1090 du poste</h2>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <dl className="grid grid-cols-6 gap-3 font-mono text-[12px]">
          <Cell k="Récepteur" v={status?.endpoint ?? "—"} />
          <Cell k="Dernière trame" v={status?.lastLineAt ? `il y a ${formatAge(wall - status.lastLineAt)}` : "jamais"} />
          <Cell k="Débit" v={status ? `${status.msgPerS} msg/s` : "—"} />
          <Cell k="Avions entendus" v={status ? String(status.heard) : "—"} />
          <Cell k="Positionnés" v={status ? String(status.positioned) : "—"} />
          <Cell
            k="Antenne"
            v={status ? `${status.antenna.lat.toFixed(4)} ${status.antenna.lon.toFixed(4)}` : "—"}
          />
          <Cell k="Trames lues" v={status ? String(status.stats.lines) : "—"} />
          <Cell k="Décodées" v={status ? String(status.stats.decoded) : "—"} />
          <Cell k="CRC faux" v={status ? String(status.stats.crc) : "—"} warn={!!status?.stats.crc} />
          <Cell k="Adresse inconnue" v={status ? String(status.stats.unknownAddr) : "—"} />
          <Cell k="Positions" v={status ? String(status.stats.positions) : "—"} />
          <Cell
            k="Positions rejetées"
            v={status ? String(status.stats.rejectedPos) : "—"}
            warn={!!status?.stats.rejectedPos}
          />
        </dl>
        {status?.lastError ? <p className="font-mono text-xs text-warn">{status.lastError}</p> : null}
        {error ? <p className="font-mono text-xs text-crit">{error}</p> : null}
        {status && !live ? <Setup status={status} /> : null}
      </section>

      <section className="hud rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Écoute brute · port AVR</h2>
          <span className="flex items-center gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
              {frames.length} trames affichées · aucun filtre
            </span>
            <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
              {paused ? "Reprendre" : "Figer"}
            </Button>
          </span>
        </div>
        {frames.length ? (
          <ol className="h-[420px] overflow-y-auto font-mono text-[11px]" aria-live="off">
            {frames.map((f) => (
              <li
                key={f.seq}
                className={cn(
                  "grid grid-cols-[5.5rem_3rem_4.5rem_15rem_1fr] items-baseline gap-3 border-b border-border/50 py-1",
                  !f.ok && "text-muted-foreground",
                )}
              >
                <span className="tabular-nums text-muted-foreground">{zTime(f.at)} Z</span>
                <span className={f.ok ? "text-primary" : ""}>DF{f.df}</span>
                <span className="text-fg">{f.icao ?? "—"}</span>
                <span className="truncate text-muted-foreground" title={f.raw}>
                  {f.raw}
                </span>
                <span className={cn("min-w-0 truncate", f.ok ? "text-fg" : "text-warn")} title={f.text}>
                  {f.text}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="flex h-40 items-center justify-center font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
            {live ? "Liaison établie · en attente de trames" : "Aucune trame reçue"}
          </p>
        )}
      </section>
    </div>
  );
}

function Cell({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">{k}</dt>
      <dd className={cn("truncate tabular-nums", warn ? "text-warn" : "text-fg")} title={v}>
        {v}
      </dd>
    </div>
  );
}

function Setup({ status }: { status: ReceiverStatus }) {
  return (
    <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-3 text-xs text-muted-foreground">
      <p className="text-fg">Brancher le récepteur</p>
      <p>
        Sur la machine qui porte la clé SDR, lancer dump1090 avec le port brut AVR (et un port web qui ne
        prend pas 8080, celui de VIGILAIR) :
      </p>
      <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
        dump1090 --interactive --net --net-ro-port 30002 --net-http-port 8090 --aggressive
      </pre>
      <p>
        VIGILAIR s'y connecte seul ({status.enabled ? status.endpoint : "liaison coupée"}). Récepteur sur une
        autre machine : démarrer le poste avec <code className="text-fg">VIGILAIR_1090=adresse:30002</code>.
        Position de l'antenne : <code className="text-fg">VIGILAIR_ANTENNE=lat,lon</code>.
      </p>
    </div>
  );
}
