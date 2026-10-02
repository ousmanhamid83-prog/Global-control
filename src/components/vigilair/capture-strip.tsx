import { Crosshair } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KIND_LABEL, THEATER_POSTS, type Phenomenon } from "@/lib/vigilair/capture";
import { SCALE, THEATER_LABEL, formatGsdM, theaterRank } from "@/lib/vigilair/geo";
import { layerGsd, pixelBudgetLine } from "@/lib/vigilair/tiles";
import { useVigilair } from "@/lib/vigilair/store";
import { threatTone } from "@/lib/vigilair/format";
import { cn } from "@/lib/utils";

export function CaptureStrip() {
  const phenomena = useVigilair((s) => s.phenomena);
  const capture = useVigilair((s) => s.capture);
  const openCapture = useVigilair((s) => s.openCapture);
  const closeCapture = useVigilair((s) => s.closeCapture);
  const homeOrigin = useVigilair((s) => s.homeOrigin);
  const mapScale = useVigilair((s) => s.mapScale);
  const satLayer = useVigilair((s) => s.satLayer);
  const viewOrigin = useVigilair((s) => s.viewOrigin);

  const liveGsd = layerGsd(
    satLayer,
    SCALE[mapScale].tileZ,
    capture?.lat ?? viewOrigin.lat,
  );

  const theaterN = phenomena.filter((p) => theaterRank(p.theater) >= 3).length;
  const globeN = phenomena.filter((p) => theaterRank(p.theater) < 3).length;
  const chips = phenomena.slice(0, 12);
  const shown = capture?.objects ?? [];
  const visible = shown.filter((o) => o.resolvable).slice(0, 8);
  const limits = shown.filter((o) => !o.resolvable && o.kind === "limite").slice(0, 3);

  return (
    <div
      className="flex flex-col gap-1 border-b border-border bg-surface px-3 py-2"
      data-capture-strip="1"
      data-capture-open={capture ? "1" : "0"}
      data-capture-gsd={String(Math.round(liveGsd.m * 10) / 10)}
      data-capture-theater={capture?.theater ?? ""}
    >
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        <Badge tone="ice">
          <Crosshair className="mr-1 size-3" />
          {liveGsd.label}
        </Badge>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground" data-px-line="1">
          {pixelBudgetLine(liveGsd.m)}
        </span>
        {THEATER_POSTS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-post={p.id}
            onClick={() =>
              openCapture({
                lat: p.lat,
                lon: p.lon,
                kind: "scene",
                title: p.title,
                body: p.body,
                source: "poste 10 m",
                id: `cap-${p.id}`,
              })
            }
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs transition-colors duration-150",
              capture?.id === `cap-${p.id}`
                ? "bg-secondary text-fg"
                : "bg-bg/80 text-muted-foreground hover:text-fg",
            )}
          >
            <Badge tone="ice">{THEATER_LABEL[p.theater]}</Badge>
            <span className="truncate">{p.title}</span>
          </button>
        ))}
        {chips.map((p) => (
          <PhenomChip key={p.id} p={p} active={capture?.id === `cap-${p.id}`} onOpen={openCapture} />
        ))}
        {capture ? (
          <button
            type="button"
            onClick={() => closeCapture()}
            className="ml-auto inline-flex h-11 shrink-0 items-center rounded-md px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-fg"
          >
            Fermer scène
          </button>
        ) : (
          <button
            type="button"
            onClick={() => homeOrigin()}
            className="ml-auto inline-flex h-11 shrink-0 items-center rounded-md px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-fg"
          >
            FTTJ
          </button>
        )}
      </div>
      {capture ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs text-fg" data-capture-hud="1">
            SCÈNE {capture.title} · GSD {formatGsdM(capture.gsdM)} · {pixelBudgetLine(capture.gsdM)} · {THEATER_LABEL[capture.theater]} ·{" "}
            {KIND_LABEL[capture.kind]}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {visible.map((o) => (
              <span key={o.id} className="text-xs text-fg">
                {o.label}
              </span>
            ))}
            {limits.map((o) => (
              <span key={o.id} className="text-xs text-muted-foreground">
                {o.label} · hors GSD
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {theaterN} théâtre Tchad / AES / Darfour · {globeN} globe · clic = scène ICAO (HSFS ≠ FTTJ) · GSD réel de la tuile
        </p>
      )}
    </div>
  );
}

function PhenomChip({
  p,
  active,
  onOpen,
}: {
  p: Phenomenon;
  active: boolean;
  onOpen: (opts: {
    lat: number;
    lon: number;
    kind: Phenomenon["kind"];
    title: string;
    body: string;
    source: string;
    id?: string;
  }) => void;
}) {
  return (
    <button
      type="button"
      data-phenom={p.id}
      data-theater={p.theater}
      onClick={() =>
        onOpen({
          lat: p.lat,
          lon: p.lon,
          kind: p.kind,
          title: p.title,
          body: p.body,
          source: p.source,
          id: `cap-${p.id}`,
        })
      }
      className={cn(
        "inline-flex h-11 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-md px-3 text-left text-xs transition-colors duration-150",
        active ? "bg-secondary text-fg" : "bg-bg/80 text-muted-foreground hover:text-fg",
      )}
    >
      <Badge tone={threatTone(p.level)}>{THEATER_LABEL[p.theater]}</Badge>
      <span className="truncate">{p.title}</span>
    </button>
  );
}
