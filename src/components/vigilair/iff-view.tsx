import { useMemo, useState } from "react";
import { Fingerprint, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IffBadge, PaintFilters } from "@/components/vigilair/paint-filters";
import { PLATFORM_BY_ID, originLabel } from "@/lib/vigilair/catalog";
import { formatCoord } from "@/lib/vigilair/geo";
import { originTone } from "@/lib/vigilair/format";
import { friendLabel, isFriend } from "@/lib/vigilair/friends";
import {
  canRequestM4,
  iffModesLine,
  m4Label,
  m4Tone,
  M4_STEALTH,
} from "@/lib/vigilair/iff";
import {
  BDS_NOTES,
  DF_CATALOGUE,
  M4_CRYPTO_STEALTH,
  M4_DOCTRINE,
  MODE_S_DOCTRINE,
  MODE_S_NOTE,
  collectWaterfall,
  countModeS,
  inferSurveillance,
  coveringRadarSites,
  surveillanceLabel,
} from "@/lib/vigilair/mode-s";
import { SENSOR_SITES } from "@/lib/vigilair/sensors";
import { sortTracks, trackVisible, useVigilair } from "@/lib/vigilair/store";
import type { ModeSReply, Track } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

type Tab = "image" | "m4" | "modes" | "mlat";

const TABS: { id: Tab; label: string }[] = [
  { id: "image", label: "Image 1090" },
  { id: "m4", label: "Mode 4" },
  { id: "modes", label: "Mode S" },
  { id: "mlat", label: "MLAT" },
];

export function IffView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const requestM4 = useVigilair((s) => s.requestM4);
  const [tab, setTab] = useState<Tab>("m4");

  const live = sortTracks(tracks.filter((t) => trackVisible(t, selectedId)));
  const iffTracks = live.filter((t) => t.iff);
  const selected =
    live.find((t) => t.id === selectedId) ??
    iffTracks.find((t) => t.locked) ??
    iffTracks[0] ??
    null;
  const ms = countModeS(live);
  const waterfall = useMemo(() => collectWaterfall(live), [live]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Pupitre IFF · interrogateur secondaire
          </h1>
          <p className="text-xs text-muted-foreground">
            Mode 4 crypto FATL · réponses Mode S · MLAT TDOA · {M4_STEALTH}
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

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Mode S ELS" value={String(ms.els)} />
        <Kpi label="Mode S EHS" value={String(ms.ehs)} />
        <Kpi label="ADS-B" value={String(ms.adsb)} />
        <Kpi label="MLAT" value={String(ms.mlat)} />
        <Kpi label="Usurp. DF17" value={String(ms.spoof)} tone={ms.spoof ? "crit" : undefined} />
        <Kpi label="Sans 1090" value={String(ms.none)} />
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

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[14rem_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
          <p className="sticky top-0 z-10 bg-surface px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pistes IFF
          </p>
          <ul>
            {iffTracks.length === 0 ? (
              <li className="px-3 py-6 text-xs text-muted-foreground">
                Aucun transpondeur corrélé sous le filtre courant.
              </li>
            ) : (
              iffTracks.map((t) => {
                const active = t.id === selected?.id;
                const plat =
                  PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
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
                        {t.iff ? <IffBadge m4={t.iff.m4} /> : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        {isFriend(t) && t.friendKind ? (
                          <Badge tone="ok">{friendLabel(t.friendKind)}</Badge>
                        ) : (
                          <Badge tone={originTone(t.origin)}>
                            {t.origin ? originLabel(t.origin) : "—"}
                          </Badge>
                        )}
                        {t.iff?.mlat?.spoofSuspect ? (
                          <Badge tone="crit">MLAT</Badge>
                        ) : t.iff ? (
                          <Badge>
                            {surveillanceLabel(inferSurveillance(t.iff))}
                          </Badge>
                        ) : null}
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
          {tab === "image" ? (
            <ImageTab
              selected={selected}
              waterfall={waterfall}
              onM4={() => selected && requestM4(selected.id)}
            />
          ) : null}
          {tab === "m4" ? (
            <Mode4Tab
              selected={selected}
              onM4={() => selected && requestM4(selected.id)}
            />
          ) : null}
          {tab === "modes" ? <ModeSTab selected={selected} /> : null}
          {tab === "mlat" ? <MlatTab selected={selected} /> : null}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "crit";
}) {
  return (
    <div className="bg-surface px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono text-lg tabular-nums",
          tone === "crit" && "text-crit",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ImageTab({
  selected,
  waterfall,
  onM4,
}: {
  selected: Track | null;
  waterfall: ModeSReply[];
  onM4: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Waterfall 1090 MHz</h2>
        <p className="mt-1 text-xs text-muted-foreground">{MODE_S_NOTE}</p>
      </div>
      <ol className="space-y-1 font-mono text-xs">
        {waterfall.length === 0 ? (
          <li className="text-muted-foreground">
            Pas de réponse Mode S dans la fenêtre. Un UAS sans transpondeur
            n'apparaît pas ici.
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
      {selected ? <SelectedDecode track={selected} onM4={onM4} /> : null}
    </div>
  );
}

function Mode4Tab({
  selected,
  onM4,
}: {
  selected: Track | null;
  onM4: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Chiffrement Mode 4 (Mark XII)</h2>
        <p className="mt-1 text-xs text-muted-foreground">{M4_CRYPTO_STEALTH}</p>
      </div>
      <ol className="grid gap-2 sm:grid-cols-3">
        <FlowStep n="1" title="Challenge 1030" body="ISLS + mot chiffré, interrogateur du site radar." />
        <FlowStep n="2" title="Calculateur crypto" body="KIR/KIT · clé du jour FATL. Jamais affichée." />
        <FlowStep n="3" title="Réponse 1090" body="Valide / invalide / timeout. Pas d'émission VIGILAIR." />
      </ol>
      <div className="space-y-3">
        {M4_DOCTRINE.map((d) => (
          <article key={d.id} className="rounded-md border border-border bg-surface p-3">
            <h3 className="text-sm font-medium">{d.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.body}</p>
          </article>
        ))}
      </div>
      {selected ? <SelectedDecode track={selected} onM4={onM4} /> : (
        <p className="text-xs text-muted-foreground">
          Sélectionnez une piste pour demander une interrogation Mode 4.
        </p>
      )}
    </div>
  );
}

function ModeSTab({ selected }: { selected: Track | null }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Réponses Mode S</h2>
        <p className="mt-1 text-xs text-muted-foreground">{MODE_S_NOTE}</p>
      </div>
      <div className="space-y-3">
        {MODE_S_DOCTRINE.map((d) => (
          <article key={d.id} className="rounded-md border border-border bg-surface p-3">
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
                    {d.kind === "squitter"
                      ? "squitter"
                      : d.kind === "acas"
                        ? "ACAS"
                        : "sollicité"}
                  </td>
                  <td className="max-w-[18rem] px-2 py-2 text-muted-foreground">
                    {d.body}
                  </td>
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
        <ul className="grid gap-2 sm:grid-cols-2">
          {BDS_NOTES.map((b) => (
            <li key={b.id} className="rounded-md border border-border bg-surface p-3">
              <p className="font-mono text-xs text-muted-foreground">BDS {b.id}</p>
              <p className="text-sm font-medium">{b.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{b.body}</p>
            </li>
          ))}
        </ul>
      </div>
      {selected?.iff?.replies && selected.iff.replies.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dernières réponses · {selected.callsign}
          </h3>
          <ol className="space-y-1 font-mono text-xs">
            {selected.iff.replies.map((r) => (
              <li
                key={r.id}
                className="rounded-sm bg-secondary/50 px-2 py-1.5"
              >
                {r.df}
                {r.bds ? ` BDS ${r.bds}` : ""} · {r.payload} · {r.siteName}
                {r.solicited ? " · UF" : " · squitter"}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function MlatTab({ selected }: { selected: Track | null }) {
  const mlat = selected?.iff?.mlat;
  const sites = selected
    ? coveringRadarSites(selected.lat, selected.lon)
    : [];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Multilatération TDOA</h2>
        <p className="mt-1 text-xs text-muted-foreground">{MODE_S_NOTE}</p>
      </div>
      {selected && mlat ? (
        <>
          <MlatSketch track={selected} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Item label="Fix MLAT" value={formatCoord(mlat.lat, mlat.lon)} mono />
            <Item
              label="Cinématique"
              value={formatCoord(selected.lat, selected.lon)}
              mono
            />
            <Item label="Sites" value={`${mlat.nSites} · ${mlat.sites.join(", ")}`} />
            <Item label="Résidu" value={`${mlat.residualKm.toFixed(2)} km`} mono />
            <Item label="Qualité" value={`${mlat.quality} %`} mono />
            <Item
              label="Écart ADS-B"
              value={
                mlat.adsbDeltaKm == null
                  ? "n/a (pas de DF17)"
                  : `${mlat.adsbDeltaKm.toFixed(1)} km`
              }
              mono
            />
          </dl>
          {mlat.spoofSuspect ? (
            <p className="rounded-md border border-crit/40 bg-crit/10 p-3 text-sm text-crit">
              Désaccord ADS-B / MLAT. Le squitter DF17 revendique une position
              GPS qui n'est pas le lieu d'émission 1090. Usurpation probable.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{mlat.note}</p>
          )}
          {selected.iff?.adsbClaim ? (
            <p className="text-xs text-muted-foreground">
              Position DF17 revendiquée{" "}
              <span className="font-mono">
                {formatCoord(selected.iff.adsbClaim.lat, selected.iff.adsbClaim.lon)}
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          MLAT exige un Mode S (ICAO24) et au moins trois sites radar dans le
          volume. Un UAS sans transpondeur, ou un squawk 3/A seul, ne produit
          pas de TDOA.
        </p>
      )}
      {selected ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sites radar en volume
          </h3>
          <ul className="space-y-1 text-sm">
            {sites.length === 0 ? (
              <li className="text-muted-foreground">Hors couverture radar 3D.</li>
            ) : (
              sites.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.d.toFixed(0)} km
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MlatSketch({ track }: { track: Track }) {
  const mlat = track.iff?.mlat;
  if (!mlat) return null;
  const w = 280;
  const h = 220;
  const cx = w / 2;
  const cy = h / 2;
  const scale = 0.35;
  const radars = SENSOR_SITES.filter(
    (s) => s.kind === "radar" && mlat.sites.some((n) => s.name === n),
  );
  const claim = track.iff?.adsbClaim;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-52 w-full max-w-sm rounded-md border border-border bg-bg"
      role="img"
      aria-label="Géométrie MLAT"
    >
      <circle cx={cx} cy={cy} r={70} fill="none" stroke="currentColor" opacity={0.12} />
      <circle cx={cx} cy={cy} r={36} fill="none" stroke="currentColor" opacity={0.12} />
      {radars.map((s) => {
        const dx = (s.lon - track.lon) * 90 * scale;
        const dy = (track.lat - s.lat) * 110 * scale;
        const x = cx + dx;
        const y = cy + dy;
        return (
          <g key={s.id}>
            <line
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.25}
            />
            <rect x={x - 3} y={y - 3} width={6} height={6} fill="currentColor" opacity={0.7} />
          </g>
        );
      })}
      {claim ? (
        <circle
          cx={cx + (claim.lon - track.lon) * 90 * scale}
          cy={cy + (track.lat - claim.lat) * 110 * scale}
          r={5}
          fill="none"
          stroke="var(--color-crit)"
          strokeWidth={1.4}
        />
      ) : null}
      <polygon
        points={`${cx},${cy - 6} ${cx + 5},${cy + 5} ${cx - 5},${cy + 5}`}
        fill="var(--color-ok)"
      />
    </svg>
  );
}

function SelectedDecode({
  track,
  onM4,
}: {
  track: Track;
  onM4: () => void;
}) {
  const m4 = canRequestM4(track);
  const iff = track.iff;
  const plat =
    PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
          <p className="text-sm font-semibold">
            {plat ? `${plat.manufacturer} ${plat.name}` : track.callsign}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {isFriend(track) && track.friendKind ? (
            <Badge tone="ok">AMI {friendLabel(track.friendKind)}</Badge>
          ) : null}
          {iff ? (
            <Badge tone={m4Tone(iff.m4)}>{m4Label(iff.m4)}</Badge>
          ) : (
            <Badge>sans IFF</Badge>
          )}
          {iff?.mlat?.spoofSuspect ? <Badge tone="crit">MLAT écart</Badge> : null}
        </div>
      </div>
      {iff ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {iffModesLine(iff)}
          {iff.icao24 ? ` · ICAO ${iff.icao24}` : ""}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {iff?.m4Note ?? M4_STEALTH}
      </p>
      <Button
        variant="outline"
        className="mt-3 w-full"
        disabled={!m4.ok}
        onClick={onM4}
      >
        <Fingerprint />
        {iff?.m4 === "demande"
          ? "Interrogation Mode 4…"
          : iff?.m4 && iff.m4 !== "absent"
            ? "Réinterroger Mode 4"
            : "Demander Mode 4"}
      </Button>
    </div>
  );
}

function FlowStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="font-mono text-xs text-muted-foreground">{n}</p>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function Item({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}
