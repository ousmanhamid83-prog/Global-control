import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { AlertStrip } from "@/components/vigilair/alert-strip";
import { AxisStrip } from "@/components/vigilair/axis-strip";
import { GpsZoneStrip } from "@/components/vigilair/gps-zone";
import { MineStrip } from "@/components/vigilair/mine-strip";
import { HydroStrip } from "@/components/vigilair/hydro-strip";
import { CaptureStrip } from "@/components/vigilair/capture-strip";
import { DefenseStrip } from "@/components/vigilair/defense-strip";
import { MetarStrip } from "@/components/vigilair/metar-strip";
import { WatchStrip } from "@/components/vigilair/watch-strip";
import { ZoneStrip } from "@/components/vigilair/zone-strip";
import { Dossier } from "@/components/vigilair/dossier";
import { PaintFilters } from "@/components/vigilair/paint-filters";
import { RadarMap, peekCopCursor, snapshotCop } from "@/components/vigilair/radar-map";
import { TrackRail } from "@/components/vigilair/track-rail";
import { SCALE, type MapScale } from "@/lib/vigilair/geo";
import { SAT_LAYERS, SAT_LAYER_LABEL, sceneAgeLabel } from "@/lib/vigilair/sat";
import { coverBoard, formatGap, formatNeed, formatPx, lastPixelScan, liveGsd as readLiveGsd, pixelBudgetLine, pixelDetections, pixelSpan, realDetectLine, realDetects, subscribePixelScan, taskDeck } from "@/lib/vigilair/tiles";
import { useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";

function DetectPlate() {
  const satLayer = useVigilair((s) => s.satLayer);
  const mapScale = useVigilair((s) => s.mapScale);
  const viewOrigin = useVigilair((s) => s.viewOrigin);
  const capture = useVigilair((s) => s.capture);
  const scan = useSyncExternalStore(subscribePixelScan, lastPixelScan, lastPixelScan);
  const satMeta = useVigilair((s) => s.satMeta);
  const lat = capture?.lat ?? viewOrigin.lat;
  const gsd = readLiveGsd(satLayer, SCALE[mapScale].tileZ, lat, satMeta?.visSrc);
  const dets = pixelDetections(gsd.m, satLayer);
  const measured = realDetects(scan);
  const inside = coverBoard(gsd.m, satLayer, scan.voiture).find((r) => r.id === "dedans");
  const cell = (on: boolean) => (on ? "oui" : "—");
  return (
    <div
      data-detect="1"
      data-det-ready={scan.ready ? "1" : "0"}
      className="px-2 py-1.5 lg:hidden"
    >
      <p className="font-mono text-[10px] leading-snug text-muted-foreground">
        {gsd.label} · dét 1,5 · rec 6 · id 12
      </p>
      <table className="mt-1 w-full border-collapse font-mono text-[10px] leading-tight">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-0.5 text-left font-normal"> </th>
            <th className="px-1 py-0.5 text-center font-normal">dét</th>
            <th className="px-1 py-0.5 text-center font-normal">rec</th>
            <th className="px-1 py-0.5 text-center font-normal">id</th>
            <th className="py-0.5 text-left font-normal">cran suivant</th>
          </tr>
        </thead>
        <tbody>
          {dets.map((d) => {
            const hit = measured.find((m) => m.id === d.id);
            const next =
              d.gap.next == null
                ? "tenu"
                : `${formatGap(d.gap.missingPx)} · ${formatNeed(d.gap.needGsdM)}`;
            return (
              <tr
                key={d.id}
                data-det={d.id}
                data-det-cls={d.cls}
                data-det-on={d.detected ? "1" : "0"}
                data-det-n={String(hit?.n ?? 0)}
                data-det-miss={d.gap.missingPx.toFixed(2)}
                data-det-need={d.gap.needGsdM == null ? "" : String(Math.round(d.gap.needGsdM * 100))}
                title={d.verdict}
              >
                <td className={d.detected ? "py-0.5 text-fg" : "py-0.5 text-muted-foreground"}>
                  {d.short} {formatPx(d.px)}
                </td>
                <td className={`px-1 py-0.5 text-center ${d.det ? "text-fg" : "text-muted-foreground"}`}>
                  {cell(d.det)}
                </td>
                <td className={`px-1 py-0.5 text-center ${d.rec ? "text-fg" : "text-muted-foreground"}`}>
                  {cell(d.rec)}
                </td>
                <td className={`px-1 py-0.5 text-center ${d.idn ? "text-fg" : "text-muted-foreground"}`}>
                  {cell(d.idn)}
                </td>
                <td className="py-0.5 text-muted-foreground">{next}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {measured.length > 0 ? (
        <p className="mt-1 font-mono text-[10px] leading-snug text-fg">
          Tuile · {measured.map((m) => m.line).join(" · ")}
        </p>
      ) : null}
      <p
        data-cover="dedans"
        data-cover-hold={inside?.hold ?? "rien"}
        className="mt-1 font-mono text-[10px] leading-snug text-muted-foreground"
      >
        {inside?.line}
      </p>
    </div>
  );
}

function PixelRuler({
  rows,
}: {
  rows: { id: string; short: string; px: number }[];
}) {
  const max = 16;
  const at = (px: number) => `${Math.max(0, Math.min(100, (Math.min(px, max) / max) * 100))}%`;
  return (
    <div className="relative mt-6 h-9">
      <div className="absolute inset-x-0 top-3 h-px bg-border" />
      {[
        { px: 1.5, label: "1,5 dét" },
        { px: 6, label: "6 rec" },
        { px: 12, label: "12 id" },
      ].map((tick) => (
        <div key={tick.label} className="absolute top-0" style={{ left: at(tick.px) }}>
          <span className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
            {tick.label}
          </span>
          <span className="absolute top-3 left-0 block h-2 w-px bg-muted-foreground" />
        </div>
      ))}
      {rows.map((row) => (
        <span
          key={row.id}
          className="absolute top-5 -translate-x-1/2 font-mono text-[11px] text-fg"
          style={{ left: at(row.px) }}
        >
          {row.short}
        </span>
      ))}
    </div>
  );
}

function TaskDeck() {
  const satLayer = useVigilair((s) => s.satLayer);
  const mapScale = useVigilair((s) => s.mapScale);
  const viewOrigin = useVigilair((s) => s.viewOrigin);
  const capture = useVigilair((s) => s.capture);
  const scan = useSyncExternalStore(subscribePixelScan, lastPixelScan, lastPixelScan);
  const satMeta = useVigilair((s) => s.satMeta);
  const lat = capture?.lat ?? viewOrigin.lat;
  const gsd = readLiveGsd(satLayer, SCALE[mapScale].tileZ, lat, satMeta?.visSrc);
  const rows = taskDeck(gsd.m, satLayer);
  const measured = realDetects(scan);
  const cover = coverBoard(gsd.m, satLayer, scan.voiture);
  const cell = (on: boolean) => (on ? "oui" : "—");
  return (
    <div
      data-deck="1"
      className="hidden p-3 lg:block"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-xs text-fg">Poste de tâche</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {gsd.label}
          {satLayer === "vis" ? "" : " · couche aveugle sur ces gabarits"}
          {" · détection 1,5 · reconnaissance 6 · identification 12"}
        </p>
      </div>
      <PixelRuler rows={rows} />
      <table className="mt-2 w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-normal">Gabarit</th>
            <th className="py-1 pr-2 font-normal">px</th>
            <th className="py-1 pr-2 font-normal">Détection</th>
            <th className="py-1 pr-2 font-normal">Reconnaissance</th>
            <th className="py-1 pr-2 font-normal">Identification</th>
            <th className="py-1 font-normal">Cran suivant</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-deck-row={row.id}
              data-det-cls={row.cls}
              data-det-on={row.det ? "1" : "0"}
              data-det-miss={row.gap.missingPx.toFixed(2)}
              title={`${row.say} ${row.refuse}`}
            >
              <td className="py-0.5 pr-2 text-fg">
                {row.label}
                <span className="text-muted-foreground"> · {row.m} m</span>
              </td>
              <td className="py-0.5 pr-2 text-fg">{formatPx(row.px)}</td>
              <td className={`py-0.5 pr-2 ${row.det ? "text-fg" : "text-muted-foreground"}`}>
                {cell(row.det)}
              </td>
              <td className={`py-0.5 pr-2 ${row.rec ? "text-fg" : "text-muted-foreground"}`}>
                {cell(row.rec)}
              </td>
              <td className={`py-0.5 pr-2 ${row.idn ? "text-fg" : "text-muted-foreground"}`}>
                {cell(row.idn)}
              </td>
              <td className="py-0.5 text-muted-foreground">
                {row.gap.next == null
                  ? "tenu"
                  : `${formatGap(row.gap.missingPx)} · ${formatNeed(row.gap.needGsdM)}`}
                <span className="text-fg"> · {row.say}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground" data-fire={scan.feuVehicule + scan.feuNaturel > 0 ? "1" : "0"}>
        {gsd.m <= 2
          ? `Feu à ${gsd.label} · véhicule ${scan.feuVehicule} · phénomène ${scan.feuNaturel} · FIRMS VIIRS 375 m à part`
          : "Feu véhicule ou phénomène : passe sur la vue au sol."}
        {measured.length > 0
          ? ` · tuile ${measured.map((m) => m.line).join(" · ")}`
          : " · aucun autre contraste au gabarit"}
      </p>
      <table className="mt-2 w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-normal">À couvert</th>
            <th className="py-1 pr-3 font-normal">Image</th>
            <th className="py-1 font-normal">Ce qu'on en fait</th>
          </tr>
        </thead>
        <tbody>
          {cover.map((row) => (
            <tr key={row.id} data-cover={row.id} data-cover-hold={row.hold} data-det-cls={row.cls}>
              <td className="py-0.5 pr-3 text-fg">{row.label}</td>
              <td className={`py-0.5 pr-3 ${row.id === "dedans" ? "text-muted-foreground" : "text-fg"}`}>
                {row.image}
              </td>
              <td className="py-0.5 text-muted-foreground">{row.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const THEATRE_KEY = "vigilair.cop.theatre";

/** Bandeaux de théâtre repliés par défaut : la carte garde la hauteur. Choix gardé sur ce poste. */
function useTheatreOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(THEATRE_KEY) === "1");
    } catch {
      /* stockage bloqué : repliés */
    }
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(THEATRE_KEY, next ? "1" : "0");
    } catch {
      /* stockage bloqué : choix pour cette session */
    }
  };
  return [open, toggle] as const;
}

const MAP_CHIP = "h-11 min-w-11 shrink-0 rounded-md px-3 text-xs transition-colors duration-150";

export function CopView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const select = useVigilair((s) => s.select);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const mapScale = useVigilair((s) => s.mapScale);
  const setMapScale = useVigilair((s) => s.setMapScale);
  const showFriends = useVigilair((s) => s.showFriends);
  const setShowFriends = useVigilair((s) => s.setShowFriends);
  const showLive = useVigilair((s) => s.showLive);
  const setShowLive = useVigilair((s) => s.setShowLive);
  const satLayer = useVigilair((s) => s.satLayer);
  const setSatLayer = useVigilair((s) => s.setSatLayer);
  const satMeta = useVigilair((s) => s.satMeta);
  const copTool = useVigilair((s) => s.copTool);
  const setCopTool = useVigilair((s) => s.setCopTool);
  const watchMode = useVigilair((s) => s.watchMode);
  const watchDimmed = useVigilair((s) => s.watchDimmed);
  const watchAutoLayer = useVigilair((s) => s.watchAutoLayer);
  const watchWokeReason = useVigilair((s) => s.watchWokeReason);
  const setWatchMode = useVigilair((s) => s.setWatchMode);
  const setWatchAutoLayer = useVigilair((s) => s.setWatchAutoLayer);
  const openCapture = useVigilair((s) => s.openCapture);
  const homeOrigin = useVigilair((s) => s.homeOrigin);
  const capture = useVigilair((s) => s.capture);
  const viewOrigin = useVigilair((s) => s.viewOrigin);
  const [tab, setTab] = useState<"pistes" | "dossier">("pistes");
  const [theatreOpen, toggleTheatre] = useTheatreOpen();
  // Bulle en approche ou en intrusion : le bandeau quitte le théâtre replié et reste sous les yeux.
  const zoneHot = useVigilair((s) =>
    s.zonePicture.some((z) => z.level === "intrusion" || z.level === "approche"),
  );
  const [deckOpen, setDeckOpen] = useState(false);
  const scan = useSyncExternalStore(subscribePixelScan, lastPixelScan, lastPixelScan);
  const reel = realDetectLine(scan);

  const liveGsd = readLiveGsd(
    satLayer,
    SCALE[mapScale].tileZ,
    capture?.lat ?? viewOrigin.lat,
    satMeta?.visSrc,
  );
  const pxHomme = pixelSpan(liveGsd.m, "homme");
  const pxVoiture = pixelSpan(liveGsd.m, "voiture");
  const pxPirogue = pixelSpan(liveGsd.m, "pirogue");

  const k4Vis = mapScale === "k4" && satLayer === "vis";
  const identVis = mapScale === "ident" && satLayer === "vis";
  const veilleVis = mapScale === "veille" && satLayer === "vis";
  const approcheVis = mapScale === "approche" && satLayer === "vis";
  const ageIso =
    satLayer === "ir"
      ? satMeta?.irAt
      : satLayer === "th"
        ? satMeta?.thAt
        : satLayer === "nv"
          ? satMeta?.nvAt
          : satLayer === "rel"
            ? satMeta?.relAt
            : satMeta?.visAt;
  const ageSrc =
    satLayer === "ir"
      ? satMeta?.irSrc
      : satLayer === "th"
        ? satMeta?.thSrc
        : satLayer === "nv"
          ? satMeta?.nvSrc
          : satLayer === "rel"
            ? satMeta?.relSrc
            : satMeta?.visSrc;

  const dim = watchMode && watchDimmed;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden">
      <div className="shrink-0 lg:max-h-[32%] lg:overflow-y-auto lg:overscroll-contain">
        <AlertStrip />
        <DefenseStrip />
        {zoneHot ? <ZoneStrip /> : null}
        <WatchStrip />
        <MetarStrip />
      </div>
      <button
        type="button"
        onClick={toggleTheatre}
        aria-expanded={theatreOpen}
        aria-controls="cop-theatre"
        className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-left text-xs text-muted-foreground transition-colors duration-150 hover:text-fg"
      >
        {theatreOpen ? (
          <ChevronUp className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        )}
        <span className="shrink-0 font-medium text-fg">Théâtre</span>
        <span className="min-w-0 truncate">
          Scènes ICAO · bulles · axes · zone GPS · mines · hydro
        </span>
        <span className="ml-auto shrink-0">{theatreOpen ? "Replier" : "Déplier"}</span>
      </button>
      {/* Masqué en CSS, jamais démonté : les bandeaux gardent leurs relevés en cours. */}
      <div
        id="cop-theatre"
        className={cn(
          "shrink-0 lg:max-h-[34%] lg:overflow-y-auto lg:overscroll-contain",
          !theatreOpen && "hidden",
        )}
      >
        <CaptureStrip />
        {zoneHot ? null : <ZoneStrip />}
        <AxisStrip />
        <GpsZoneStrip />
        <MineStrip />
        <HydroStrip />
      </div>
      <div className="grid shrink-0 grid-cols-1 grid-rows-[minmax(22rem,64dvh)_auto] lg:min-h-0 lg:flex-1 lg:shrink lg:grid-cols-[240px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="hidden min-h-0 border-r border-border lg:block">
          <TrackRail />
        </aside>
        <section className="relative min-h-0 border-b border-border lg:border-b-0 lg:border-r">
          <RadarMap
            tracks={tracks}
            selectedId={selectedId}
            onSelect={(id) => {
              if (id) lockTrack(id);
              else select(null);
              if (id) setTab("dossier");
            }}
          />
          <div
            className={cn(
              "absolute left-3 right-12 top-3 z-10 flex gap-1 overflow-x-auto transition-opacity duration-300 max-lg:scrollbar-none xl:tall:right-auto xl:tall:max-w-[calc(100%-8rem)] xl:tall:flex-wrap xl:tall:overflow-visible",
              dim && "opacity-40 hover:opacity-100",
            )}
          >
            <button
              type="button"
              data-watch="arm"
              onClick={() => setWatchMode(!watchMode)}
              className={cn(
                MAP_CHIP,
                "inline-flex items-center gap-1.5",
                watchMode && !watchDimmed
                  ? "bg-crit/20 text-crit"
                  : watchMode
                    ? "bg-ok/20 text-ok"
                    : "bg-bg/85 text-muted-foreground hover:text-fg",
              )}
              aria-pressed={watchMode}
            >
              <Eye className="size-3.5" aria-hidden />
              {watchMode && !watchDimmed ? "Réveil" : "Veille"}
            </button>
            {(Object.keys(SCALE) as MapScale[]).map((s) => (
              <button
                key={s}
                type="button"
                data-scale={s}
                onClick={() => setMapScale(s)}
                className={cn(
                  MAP_CHIP,
                  mapScale === s
                    ? "bg-secondary text-fg"
                    : "bg-bg/85 text-muted-foreground hover:text-fg",
                )}
              >
                {SCALE[s].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowLive(!showLive)}
              className={cn(
                MAP_CHIP,
                showLive
                  ? "bg-ok/20 text-ok"
                  : "bg-bg/85 text-muted-foreground hover:text-fg",
              )}
              aria-pressed={showLive}
            >
              1090
            </button>
            <button
              type="button"
              onClick={() => setShowFriends(!showFriends)}
              className={cn(
                MAP_CHIP,
                showFriends
                  ? "bg-ok/20 text-ok"
                  : "bg-bg/85 text-muted-foreground hover:text-fg",
              )}
              aria-pressed={showFriends}
            >
              Amis
            </button>
            <PaintFilters />
            <button
              type="button"
              data-tool="10m"
              onClick={() => {
                const cur = peekCopCursor();
                const t = tracks.find((x) => x.id === selectedId);
                const lat = t?.lat ?? cur?.lat ?? useVigilair.getState().viewOrigin.lat;
                const lon = t?.lon ?? cur?.lon ?? useVigilair.getState().viewOrigin.lon;
                openCapture({
                  lat,
                  lon,
                  kind: t ? "menace" : "scene",
                  title: t ? `${t.callsign} · ident` : "Scène ident",
                  body: t
                    ? "Ident visible sur la piste — ICAO du terrain, pas FTTJ sauf si la scène est FTTJ"
                    : "Ident visible au réticule. FTTJ est la distance depuis N'Djamena, pas le centre image.",
                  source: "COP",
                });
              }}
              className={cn(
                MAP_CHIP,
                capture
                  ? "bg-secondary text-fg"
                  : "bg-bg/85 text-muted-foreground hover:text-fg",
              )}
            >
              Ident
            </button>
            <span
              data-gsd="1"
              data-gsd-m={String(Math.round(liveGsd.m * 10) / 10)}
              data-px-homme={String(pxHomme.px)}
              data-px-voiture={String(pxVoiture.px)}
              data-px-pirogue={String(pxPirogue.px)}
              data-px-homme-cls={pxHomme.cls}
              data-px-voiture-cls={pxVoiture.cls}
              data-px-pirogue-cls={pxPirogue.cls}
              data-reel={reel}
              title="Détection : il y a quelque chose, dès 1,5 px. Reconnaissance : c'est cette classe, dès 6 px. Identification : le modèle ou la personne, dès 12 px. Sous 1,5 px : aucune."
              className="inline-flex h-11 max-w-[18rem] shrink-0 flex-col justify-center rounded-md bg-bg/85 px-3 font-mono text-[11px] leading-tight text-fg"
            >
              <span>{liveGsd.label}</span>
              <span className="truncate text-muted-foreground">{pixelBudgetLine(liveGsd.m)}</span>
            </span>
            <button
              type="button"
              onClick={() => homeOrigin()}
              className={cn(MAP_CHIP, "bg-bg/85 text-muted-foreground hover:text-fg")}
            >
              FTTJ
            </button>
            <button
              type="button"
              data-tool="mesure"
              onClick={() => setCopTool(copTool === "mesure" ? "lock" : "mesure")}
              className={cn(
                MAP_CHIP,
                copTool === "mesure"
                  ? "bg-secondary text-fg"
                  : "bg-bg/85 text-muted-foreground hover:text-fg",
              )}
              aria-pressed={copTool === "mesure"}
            >
              Mesure
            </button>
            <button
              type="button"
              data-tool="capture"
              onClick={() => snapshotCop()}
              className={cn(MAP_CHIP, "bg-bg/85 text-muted-foreground hover:text-fg")}
            >
              Capture
            </button>
          </div>
          <div
            className={cn(
              "scrollbar-none absolute inset-x-3 top-16 z-20 flex justify-end gap-1 overflow-x-auto transition-opacity duration-300 lg:tall:left-auto lg:tall:top-14 lg:tall:max-h-[calc(100%-6.5rem)] lg:tall:flex-col lg:tall:items-end lg:tall:overflow-x-visible lg:tall:overflow-y-auto",
              dim && "opacity-40 hover:opacity-100",
            )}
          >
            {/* Sous la boussole du canvas : rangée, ou colonne sur un écran large et haut (défilante si la carte est courte). */}
            {SAT_LAYERS.map((l) => (
              <button
                key={l}
                type="button"
                data-sat={l}
                onClick={() => {
                  setSatLayer(l);
                  if (watchMode) setWatchAutoLayer(false);
                }}
                className={cn(
                  MAP_CHIP,
                  satLayer === l
                    ? "bg-secondary text-fg"
                    : "bg-bg/85 text-muted-foreground hover:text-fg",
                )}
              >
                {SAT_LAYER_LABEL[l]}
              </button>
            ))}
          </div>
          {/* Bas de carte, au-dessus de l'échelle du canvas. Fermé : sous les barres d'outils. Ouvert : le poste de tâche prend la hauteur de la carte, devant les outils. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-3 bottom-11 flex flex-col justify-end gap-2",
              deckOpen
                ? "top-3 z-30 xl:tall:right-28"
                : "top-32 z-10 lg:tall:right-28 lg:tall:top-20 xl:tall:top-40",
            )}
          >
            {watchMode ? (
              <div className="mx-auto w-full max-w-xl rounded-md border border-border bg-bg/90 px-3 py-2 text-center">
                <p className="font-mono text-xs tabular-nums text-fg">
                  {watchDimmed
                    ? "VEILLE ARMÉE · COP live · pas de gel idle"
                    : `RÉVEIL · ${watchWokeReason ?? "contact"}`}
                  {watchAutoLayer ? " · couche auto" : ""}
                </p>
              </div>
            ) : null}
            <div
              id="cop-deck"
              className={cn(
                "pointer-events-auto min-h-0 overflow-y-auto overscroll-contain rounded-md border border-border bg-bg",
                !deckOpen && "hidden",
              )}
            >
              <DetectPlate />
              <TaskDeck />
            </div>
            <div className="flex items-end gap-3">
              <button
                type="button"
                onClick={() => setDeckOpen((v) => !v)}
                aria-expanded={deckOpen}
                aria-controls="cop-deck"
                className={cn(
                  MAP_CHIP,
                  "pointer-events-auto inline-flex items-center gap-1.5 border border-border",
                  deckOpen ? "bg-secondary text-fg" : "bg-bg/85 text-muted-foreground hover:text-fg",
                )}
              >
                {deckOpen ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronUp className="size-3.5" aria-hidden />
                )}
                Poste de tâche
              </button>
              <p className="hidden max-w-md min-w-0 rounded-md bg-bg/85 px-2 py-1 text-xs leading-snug text-muted-foreground sm:block [@media(max-height:640px)]:hidden">
                {k4Vis
                  ? "Visible ~1 m · World Imagery · mosaïque archive · pas < 1 h"
                  : identVis
                  ? capture
                    ? `Ident · ${liveGsd.label} · ${capture.title} · mosaïque World Imagery`
                    : "Visible ident · voiture détection · pirogue reconnaissance · homme aucune · identification non atteinte"
                  : veilleVis
                    ? "Visible ≤ 50 m · Sentinel-2 · mosaïque · FTTJ 96 km"
                    : approcheVis
                    ? "Visible ≤ 50 m · Sentinel-2 · mosaïque · FTTJ 240 km"
                    : satLayer === "nv"
                      ? ageSrc
                        ? `${ageSrc} · ${sceneAgeLabel(ageIso ?? null)} · natif z≤8`
                        : "Nuit VIIRS DNB · ~750 m · quotidien · natif z≤8"
                      : satLayer === "rel"
                        ? "Relief ASTER GDEM ~30 m · ombrage · pas < 1 h"
                        : satLayer === "ir" || satLayer === "th"
                          ? ageSrc
                            ? `${ageSrc} · ${sceneAgeLabel(ageIso ?? null)} · ~1 km (pas 50 m public)`
                            : "IR / thermique ~1 km · nappe et massif"
                          : ageSrc
                            ? `${ageSrc} · ${sceneAgeLabel(ageIso ?? null)}`
                            : "Visible mosaïque Sentinel-2 · pas géostationnaire 1 km"}
              </p>
            </div>
          </div>
        </section>
        <aside className="hidden min-h-0 lg:block">
          <Dossier />
        </aside>
        <div className="flex min-h-[60dvh] flex-col lg:hidden">
          <div className="flex border-b border-border p-1">
            <button
              type="button"
              onClick={() => setTab("pistes")}
              className={cn(
                "h-11 flex-1 rounded-md text-sm transition-colors duration-150",
                tab === "pistes"
                  ? "bg-secondary text-fg"
                  : "text-muted-foreground",
              )}
            >
              Pistes
            </button>
            <button
              type="button"
              onClick={() => setTab("dossier")}
              className={cn(
                "h-11 flex-1 rounded-md text-sm transition-colors duration-150",
                tab === "dossier"
                  ? "bg-secondary text-fg"
                  : "text-muted-foreground",
              )}
            >
              Dossier
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {tab === "pistes" ? (
              <TrackRail onPick={() => setTab("dossier")} />
            ) : (
              <Dossier />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
