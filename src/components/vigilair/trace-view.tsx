import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadarMap } from "@/components/vigilair/radar-map";
import { PLATFORM_BY_ID, originLabel } from "@/lib/vigilair/catalog";
import { formatCoord, formatCoordShort, haversineKm } from "@/lib/vigilair/geo";
import { formatDate, originTone } from "@/lib/vigilair/format";
import { evidenceOf, evidenceText, SAR_NOTE, SCENE_NOTE } from "@/lib/vigilair/trace";
import { SAT_CREDIT, tileRef } from "@/lib/vigilair/tiles";
import { sortTracks, useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

export function TraceView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const select = useVigilair((s) => s.select);
  const live = sortTracks(tracks.filter((t) => t.idState !== "perdu"));
  const track = live.find((t) => t.id === selectedId) ?? live[0] ?? null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (track && track.id !== selectedId) select(track.id);
  }, [track, selectedId, select]);

  const plat = track
    ? PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId]
    : undefined;
  const ev = track ? evidenceOf(track) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Traçabilité</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Lancement SRC → route → arrêt ARR, coordonnées au mètre, gonio de la
          source de commandement TEL. Fond Sentinel-2 (mosaïque 2023) et appui
          Sentinel-1 SAR. Dossier PDF hashé depuis le journal.
        </p>
      </header>

      <div className="grid gap-4 grid-cols-[220px_minmax(0,1fr)_320px]">
        <ul className="divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface hud">
          {live.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              Aucune piste en cours.
            </li>
          ) : null}
          {live.map((t) => {
            const p = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-3 text-left text-sm",
                    track?.id === t.id ? "bg-secondary" : "hover:bg-secondary/50",
                  )}
                >
                  <span className="font-mono text-xs">{t.callsign}</span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">
                    {p ? `${p.manufacturer} ${p.name}` : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative overflow-hidden rounded-lg border border-border h-[28rem]">
            <RadarMap
              tracks={live}
              selectedId={track?.id ?? null}
              onSelect={select}
            />
          </div>
          <p className="text-xs text-muted-foreground">{SAT_CREDIT}</p>
          <p className="text-xs text-muted-foreground">{SCENE_NOTE}</p>
          <p className="text-xs text-muted-foreground">{SAR_NOTE}</p>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 hud">
          {!track ? (
            <p className="text-sm text-muted-foreground">Aucune piste.</p>
          ) : (
            <>
              <div>
                <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
                <h2 className="text-base font-semibold">
                  {plat ? `${plat.manufacturer} ${plat.name}` : "Non identifié"}
                </h2>
                <Badge tone={originTone(track.origin)} className="mt-2">
                  {track.origin ? originLabel(track.origin) : "Origine indéterminée"}
                </Badge>
              </div>
              <ol className="space-y-3 border-l border-border pl-3">
                <Fix
                  k="Zone d'envoi (SRC)"
                  lat={track.launchFix?.lat}
                  lon={track.launchFix?.lon}
                  at={track.launchFix?.at}
                  note={track.launchFix?.method}
                  tile={
                    track.launchFix
                      ? tileRef(track.launchFix.lat, track.launchFix.lon)
                      : undefined
                  }
                />
                <Fix
                  k="Source de commandement (TEL)"
                  lat={track.pilotFix?.lat}
                  lon={track.pilotFix?.lon}
                  note={
                    track.pilotFix
                      ? `${track.pilotFix.method} · ${Math.round(track.pilotFix.quality)} %`
                      : "Non géolocalisée"
                  }
                  tile={
                    track.pilotFix
                      ? tileRef(track.pilotFix.lat, track.pilotFix.lon)
                      : undefined
                  }
                  dist={
                    track.pilotFix
                      ? haversineKm(
                          track.pilotFix.lat,
                          track.pilotFix.lon,
                          track.lat,
                          track.lon,
                        )
                      : undefined
                  }
                />
                <Fix
                  k="Position actuelle"
                  lat={track.lat}
                  lon={track.lon}
                  note={`${Math.round(track.altM)} m · ${Math.round(track.speedKmh)} km/h · cap ${Math.round(track.heading)}°`}
                  dist={
                    track.launchFix
                      ? haversineKm(
                          track.launchFix.lat,
                          track.launchFix.lon,
                          track.lat,
                          track.lon,
                        )
                      : undefined
                  }
                  distLabel="depuis SRC"
                />
                <Fix
                  k={track.stopFix?.predicted ? "Arrêt prévu (ARR?)" : "Arrêt constaté (ARR)"}
                  lat={track.stopFix?.lat}
                  lon={track.stopFix?.lon}
                  at={track.stopFix?.at}
                  note={track.stopFix?.method}
                  tile={
                    track.stopFix
                      ? tileRef(track.stopFix.lat, track.stopFix.lon)
                      : undefined
                  }
                />
              </ol>
              <p className="text-xs text-muted-foreground">
                {track.trail.length} plots · {ev?.launchTile ?? "—"} · {SAT_CREDIT}
              </p>
              <Button
                className="w-full"
                variant="outline"
                onClick={async () => {
                  const text = evidenceText(track);
                  try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <Copy />
                {copied ? "Preuve copiée" : "Copier la fiche de preuve"}
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/audio">Écoute SIGINT</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Fix({
  k,
  lat,
  lon,
  at,
  note,
  tile,
  dist,
  distLabel = "de l'objet",
}: {
  k: string;
  lat?: number;
  lon?: number;
  at?: number;
  note?: string;
  tile?: string;
  dist?: number;
  distLabel?: string;
}) {
  return (
    <li>
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className="font-mono text-xs tabular-nums">
        {lat != null && lon != null ? formatCoord(lat, lon) : "—"}
      </p>
      {lat != null && lon != null ? (
        <p className="font-mono text-xs text-muted-foreground">
          {formatCoordShort(lat, lon)}
        </p>
      ) : null}
      {at ? (
        <p className="text-xs text-muted-foreground">{formatDate(at)}</p>
      ) : null}
      {dist != null ? (
        <p className="font-mono text-xs text-muted-foreground">
          {dist.toFixed(2)} km {distLabel}
        </p>
      ) : null}
      {tile ? (
        <p className="font-mono text-xs text-muted-foreground">Sentinel {tile}</p>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </li>
  );
}
