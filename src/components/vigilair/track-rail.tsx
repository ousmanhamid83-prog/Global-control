import {
  classLabel,
  idStateLabel,
  originLabel,
  PLATFORM_BY_ID,
} from "@/lib/vigilair/catalog";
import { originTone, threatTone } from "@/lib/vigilair/format";
import { friendLabel, isFriend } from "@/lib/vigilair/friends";
import { passesPaintFilter, passesRailOrigin } from "@/lib/vigilair/iff";
import { sortTracks, threatOf, useVigilair, type FilterOrigin } from "@/lib/vigilair/store";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IffBadge, PaintFilters } from "@/components/vigilair/paint-filters";
import { cn } from "@/lib/utils";

const FILTERS: { id: FilterOrigin; label: string }[] = [
  { id: "ALL", label: "Tous" },
  { id: "CN", label: "CN" },
  { id: "TR", label: "TR" },
  { id: "RU", label: "RU" },
  { id: "IR", label: "IR" },
  { id: "AMI", label: "Amis" },
  { id: "LIVE", label: "1090" },
  { id: "XX", label: "Hors" },
];

export function TrackRail({ onPick }: { onPick?: (id: string) => void }) {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const originFilter = useVigilair((s) => s.originFilter);
  const search = useVigilair((s) => s.search);
  const showFriends = useVigilair((s) => s.showFriends);
  const showLive = useVigilair((s) => s.showLive);
  const threatFloor = useVigilair((s) => s.threatFloor);
  const iffFilter = useVigilair((s) => s.iffFilter);
  const select = useVigilair((s) => s.select);
  const setOriginFilter = useVigilair((s) => s.setOriginFilter);
  const setSearch = useVigilair((s) => s.setSearch);

  const instruction = useVigilair((s) => s.instruction);
  const liveN = tracks.filter((t) => t.feed === "adsb").length;
  const q = search.trim().toLowerCase();
  const visible = sortTracks(tracks).filter((t) => {
    if (
      !passesPaintFilter(t, {
        showFriends,
        showLive,
        threatFloor,
        iffFilter,
        selectedId,
      })
    ) {
      return false;
    }
    if (!passesRailOrigin(t, originFilter, showFriends)) return false;
    if (!q) return true;
    const plat = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? ""];
    const blob = `${t.callsign} ${plat?.name ?? ""} ${plat?.manufacturer ?? ""} ${t.origin ?? ""} ${t.friendKind ?? ""} ${t.iff?.squawk ?? ""} ${t.iff?.m4 ?? ""} AMI FATL ASECNA M4`.toLowerCase();
    return blob.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pistes
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {visible.length}
          </span>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Indicatif, type, constructeur"
          aria-label="Filtrer les pistes"
          className="h-11"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setOriginFilter(f.id)}
              className={cn(
                "h-9 rounded-sm px-2.5 text-xs transition-colors duration-150",
                originFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <PaintFilters variant="rail" />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {visible.length === 0 ? (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            {liveN === 0 && !instruction
              ? "Veille réelle. Les cellules 1090ES ont répondu : aucun squitter entendu sur FTTJ, Lagos, Niamey, Khartoum."
              : "Aucune piste sur ce filtre."}
          </li>
        ) : (
          visible.map((t) => {
            const plat =
              PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? ""] ??
              (t.idState === "hors-mandat"
                ? PLATFORM_BY_ID[t.truePlatformId]
                : undefined);
            const threat = threatOf(t);
            const active = t.id === selectedId;
            const ami = isFriend(t);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    select(t.id);
                    onPick?.(t.id);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors duration-150",
                    active
                      ? "border-border bg-secondary"
                      : "border-transparent hover:bg-secondary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm tabular-nums">
                      {t.callsign}
                    </span>
                    <Badge tone={ami ? "ok" : originTone(t.origin)}>
                      {ami
                        ? friendLabel(t.friendKind!)
                        : t.origin
                          ? originLabel(t.origin)
                          : "—"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {plat
                        ? `${plat.manufacturer} ${plat.name}`
                        : t.classGuess
                          ? classLabel(t.classGuess)
                          : idStateLabel(t.idState)}
                    </span>
                    <span className="font-mono tabular-nums">
                      {Math.round(t.confidence)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge tone={threatTone(threat)}>{threat}</Badge>
                    <Badge>{idStateLabel(t.idState)}</Badge>
                    {ami ? (
                      <Badge tone="ok">
                        AMI {friendLabel(t.friendKind!)}
                      </Badge>
                    ) : null}
                    {t.iff ? <IffBadge m4={t.iff.m4} /> : null}
                    {t.injected ? <Badge tone="warn">INJ</Badge> : null}
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
