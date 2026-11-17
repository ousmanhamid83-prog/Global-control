import { useMemo, useState } from "react";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PaintFilters } from "@/components/vigilair/paint-filters";
import { PLATFORM_BY_ID, originLabel } from "@/lib/vigilair/catalog";
import { originTone } from "@/lib/vigilair/format";
import { friendLabel, isFriend } from "@/lib/vigilair/friends";
import { iffModesLine } from "@/lib/vigilair/iff";
import {
  BDS_NOTES,
  DF_CATALOGUE,
  MODE_S_DOCTRINE,
  MODE_S_NOTE,
  collectWaterfall,
  countModeS,
  surveillanceLabel,
} from "@/lib/vigilair/mode-s";
import { sortTracks, trackVisible, useVigilair } from "@/lib/vigilair/store";
import type { ModeSReply, Track } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

type Tab = "image" | "modes";

const TABS: { id: Tab; label: string }[] = [
  { id: "image", label: "Image 1090" },
  { id: "modes", label: "Mode S" },
];

/** Transpondeurs entendus sur 1090 MHz. Le poste écoute : il n'interroge pas et n'émet pas. */
export function IffView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const [tab, setTab] = useState<Tab>("image");

  const live = sortTracks(tracks.filter((t) => trackVisible(t, selectedId)));
  const iffTracks = live.filter((t) => t.iff);
  const selected =
    live.find((t) => t.id === selectedId) ??
    iffTracks.find((t) => t.locked) ??
    iffTracks[0] ??
    null;
  const ms = countModeS(live);
  const waterfall = useMemo(() => collectWaterfall(live), [live]);
  const mlat = live.filter((t) => t.posSource === "mlat").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Transpondeurs · 1090 MHz</h1>
          <p className="text-xs text-muted-foreground">{MODE_S_NOTE}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PaintFilters />
          <Badge tone="ok" className="gap-1">
            <EyeOff className="size-3" />
            Silencieux
          </Badge>
        </div>
      </div>

      <div className="grid gap-px border-b border-border bg-border grid-cols-3">
        <Kpi label="ADS-B (position émise)" value={String(ms.adsb)} />
        <Kpi label="Mode S sans ADS-B" value={String(ms.modes)} />
        <Kpi label="Position MLAT du réseau" value={String(mlat)} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "h-11 shrink-0 rounded-md px-3 text-sm transition-colors duration-150",
              tab === t.id
                ? "bg-secondary text-fg"
                : "text-muted-foreground hover:bg-secondary hover:text-fg",
            )}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-border border-b-0 border-r">
          <p className="sticky top-0 z-10 bg-surface px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pistes entendues
          </p>
          <ul>
            {iffTracks.length === 0 ? (
              <li className="px-3 py-6 text-xs text-muted-foreground">
                Aucun transpondeur entendu sous le filtre courant.
              </li>
            ) : (
              iffTracks.map((t) => {
                const active = t.id === selected?.id;
                const plat = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => lockTrack(t.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left text-sm",
                        active ? "bg-secondary" : "hover:bg-secondary/50",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{t.callsign}</span>
                        {t.iff ? <Badge>{surveillanceLabel(t.iff.surveillance)}</Badge> : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        {isFriend(t) && t.friendKind ? (
                          <Badge tone="ok">{friendLabel(t.friendKind)}</Badge>
                        ) : (
                          <Badge tone={originTone(t.origin)}>
                            {t.origin ? originLabel(t.origin) : "—"}
                          </Badge>
                        )}
                        {t.posSource === "mlat" ? <Badge>MLAT réseau</Badge> : null}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {plat ? plat.name : "—"} · {t.iff ? iffModesLine(t.iff) : ""}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <section className="min-h-0 overflow-y-auto p-4">
          {tab === "image" ? <ImageTab selected={selected} waterfall={waterfall} /> : null}
          {tab === "modes" ? <ModeSTab selected={selected} /> : null}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

function ImageTab({ selected, waterfall }: { selected: Track | null; waterfall: ModeSReply[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Dernières positions ADS-B entendues</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Une ligne par appareil : son dernier squitter de position (DF17), à l'heure de la mesure.
          Les trames brutes de l'antenne, toutes formes confondues, sont dans Capteurs · Antenne.
        </p>
      </div>
      <ol className="space-y-1 font-mono text-xs">
        {waterfall.length === 0 ? (
          <li className="text-muted-foreground">
            Aucune position ADS-B dans la fenêtre. Un drone sans transpondeur n'apparaît pas ici.
          </li>
        ) : (
          waterfall.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)] gap-2 rounded-sm bg-secondary/50 px-2 py-1.5"
            >
              <span className="text-muted-foreground">
                {new Date(r.at).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Africa/Ndjamena",
                })}
              </span>
              <span>{r.df}</span>
              <span className="truncate">
                {r.icao24} · {r.payload}
                <span className="text-muted-foreground"> · {r.siteName}</span>
              </span>
            </li>
          ))
        )}
      </ol>
      {selected ? <SelectedDecode track={selected} /> : null}
    </div>
  );
}

function ModeSTab({ selected }: { selected: Track | null }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {MODE_S_DOCTRINE.map((d) => (
          <article key={d.id} className="rounded-md border border-border bg-surface p-3 hud">
            <h3 className="text-sm font-medium">{d.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.body}</p>
          </article>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Catalogue DF
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-2 py-2 font-medium">DF</th>
                <th className="px-2 py-2 font-medium">UF</th>
                <th className="px-2 py-2 font-medium">Nom</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Rôle</th>
              </tr>
            </thead>
            <tbody>
              {DF_CATALOGUE.map((d) => (
                <tr key={d.df} className="border-b border-border/60">
                  <td className="px-2 py-2 font-mono">{d.df}</td>
                  <td className="px-2 py-2 font-mono">{d.uf ?? "—"}</td>
                  <td className="px-2 py-2">{d.name}</td>
                  <td className="px-2 py-2">
                    {d.kind === "squitter" ? "squitter" : d.kind === "acas" ? "ACAS" : "sollicité"}
                  </td>
                  <td className="max-w-[18rem] px-2 py-2 text-muted-foreground">{d.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Registres BDS (EHS / ADS-B)
        </h3>
        <ul className="grid gap-2 grid-cols-2">
          {BDS_NOTES.map((b) => (
            <li key={b.id} className="rounded-md border border-border bg-surface p-3 hud">
              <p className="font-mono text-xs text-muted-foreground">BDS {b.id}</p>
              <p className="text-sm font-medium">{b.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{b.body}</p>
            </li>
          ))}
        </ul>
      </div>
      {selected ? <SelectedDecode track={selected} /> : null}
    </div>
  );
}

function SelectedDecode({ track }: { track: Track }) {
  const iff = track.iff;
  const plat = PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  return (
    <div className="rounded-md border border-border bg-surface p-3 hud">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
          <p className="text-sm font-semibold">
            {plat ? `${plat.manufacturer} ${plat.name}` : track.callsign}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {isFriend(track) && track.friendKind ? (
            <Badge tone={track.friendKind === "civil" ? "default" : "ok"}>
              {track.friendKind === "civil" ? "CIVIL" : `AMI ${friendLabel(track.friendKind)}`}
            </Badge>
          ) : null}
          {iff ? <Badge>{surveillanceLabel(iff.surveillance)}</Badge> : <Badge>sans transpondeur</Badge>}
        </div>
      </div>
      {iff ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {iffModesLine(iff)}
          {iff.icao24 ? ` · OACI ${iff.icao24}` : ""}
          {track.posSource === "mlat" ? " · position MLAT du réseau" : ""}
        </p>
      ) : null}
    </div>
  );
}
