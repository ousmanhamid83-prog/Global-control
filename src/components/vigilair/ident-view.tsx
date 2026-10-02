import { RadarMap } from "@/components/vigilair/radar-map";
import { IffBadge, PaintFilters } from "@/components/vigilair/paint-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  classLabel,
  idStateLabel,
  originLabel,
  PLATFORM_BY_ID,
} from "@/lib/vigilair/catalog";
import { STEALTH_NOTE } from "@/lib/vigilair/ew";
import { originTone } from "@/lib/vigilair/format";
import { friendLabel, isFriend } from "@/lib/vigilair/friends";
import { AO, haversineKm } from "@/lib/vigilair/geo";
import { canRequestM4, iffModesLine, M4_STEALTH } from "@/lib/vigilair/iff";
import { sortTracks, trackVisible, useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";
import { Crosshair, EyeOff, Fingerprint } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function IdentView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const requestM4 = useVigilair((s) => s.requestM4);
  const live = sortTracks(tracks.filter((t) => trackVisible(t, selectedId)));
  const track = live.find((t) => t.id === selectedId) ?? live.find((t) => t.locked) ?? null;
  const m4 = track ? canRequestM4(track) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Identification · type Flightradar
          </h1>
          <p className="text-xs text-muted-foreground">
            Couverture 120 km FTTJ · 1090ES live / IFF Mode 4 · filtre
            menace · {STEALTH_NOTE}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PaintFilters />
          <Badge tone="ok" className="gap-1">
            <EyeOff className="size-3" />
            Silencieux
          </Badge>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)]">
        <section className="relative min-h-0 border-border border-b-0 border-r">
          <RadarMap
            tracks={live}
            selectedId={track?.id ?? null}
            scale="ident"
            fr24
            onSelect={(id) => lockTrack(id)}
          />
        </section>
        <aside className="min-h-0 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 font-medium">CS</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Orig.</th>
                <th className="px-2 py-2 font-medium">IFF</th>
                <th className="px-2 py-2 font-medium">Alt</th>
                <th className="px-2 py-2 font-medium">FTTJ</th>
              </tr>
            </thead>
            <tbody>
              {live.map((t) => {
                const plat =
                  PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
                const dist = haversineKm(t.lat, t.lon, AO.airport.lat, AO.airport.lon);
                const active = t.id === track?.id;
                return (
                  <tr
                    key={t.id}
                    className={cn(
                      "cursor-pointer border-b border-border/60",
                      active ? "bg-secondary" : "hover:bg-secondary/50",
                    )}
                    onClick={() => lockTrack(t.id)}
                  >
                    <td className="px-3 py-2 font-mono">
                      {t.locked ? "● " : ""}
                      {t.callsign}
                      {t.iff ? (
                        <span className="ml-1 text-muted-foreground">
                          {t.iff.squawk}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[7rem] truncate px-2 py-2">
                      {plat ? plat.name : classLabel(t.classGuess ?? "multirotor")}
                    </td>
                    <td className="px-2 py-2">
                      {isFriend(t) && t.friendKind ? (
                        <Badge tone="ok">{friendLabel(t.friendKind)}</Badge>
                      ) : (
                        <Badge tone={originTone(t.origin)}>
                          {t.origin ? originLabel(t.origin) : "—"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {t.iff ? <IffBadge m4={t.iff.m4} /> : <Badge>—</Badge>}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {Math.round(t.altM)}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {dist.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {track ? (
            <div className="space-y-2 border-t border-border p-4">
              <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
              <p className="text-sm font-semibold">
                {PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId]
                  ? `${PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId]!.manufacturer} ${PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId]!.name}`
                  : idStateLabel(track.idState)}
              </p>
              <p className="text-xs text-muted-foreground">
                Depuis {track.corridor ?? "—"} · {track.trail.length} plots · cap{" "}
                {Math.round(track.heading)}° · {Math.round(track.speedKmh)} km/h
              </p>
              {track.iff ? (
                <p className="text-xs text-muted-foreground">
                  {iffModesLine(track.iff)}
                  {track.iff.m4Site ? ` · ${track.iff.m4Site}` : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{M4_STEALTH}</p>
              )}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => lockTrack(track.locked ? null : track.id)}
                >
                  <Crosshair />
                  {track.locked ? "Relâcher le verrou" : "Verrouiller la trajectoire"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!m4?.ok}
                  onClick={() => requestM4(track.id)}
                >
                  <Fingerprint />
                  {track.iff?.m4 === "demande"
                    ? "Interrogation Mode 4…"
                    : track.iff?.m4 === "valid"
                      ? "Réinterroger Mode 4"
                      : "Demander Mode 4"}
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/iff">Pupitre IFF</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/trace">Traçabilité SRC → ARR</Link>
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}