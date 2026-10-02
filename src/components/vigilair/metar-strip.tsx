import { Badge } from "@/components/ui/badge";
import { formatClock } from "@/lib/vigilair/format";
import { LIVE_CREDIT } from "@/lib/vigilair/live-adsb";
import { useVigilair } from "@/lib/vigilair/store";

function catTone(cat: string | null): "ok" | "warn" | "crit" | "default" {
  if (cat === "VFR") return "ok";
  if (cat === "MVFR") return "warn";
  if (cat === "IFR" || cat === "LIFR") return "crit";
  return "default";
}

export function MetarStrip() {
  const pic = useVigilair((s) => s.livePicture);
  const liveAt = useVigilair((s) => s.liveAt);
  const liveError = useVigilair((s) => s.liveError);
  const showLive = useVigilair((s) => s.showLive);
  const n = pic?.sahelN ?? 0;
  const local = pic?.localN ?? 0;
  const fttj = pic?.metar.find((m) => m.icao === "FTTJ");
  const kp = pic?.space.kp;
  const xray = pic?.space.xrayClass;
  const sigAo = pic?.sigmets.filter((s) => s.inAo).length ?? 0;
  const jamHot = pic?.jam.some((j) => j.level !== "low") ?? false;

  return (
    <div className="flex border-b border-border bg-surface px-3 py-2 flex-row items-center gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge tone={showLive ? "ok" : "default"}>1090ES {showLive ? "live" : "off"}</Badge>
        <span className="font-mono text-xs tabular-nums text-fg">
          {n} contacts · {local} vol. ident
        </span>
        {fttj ? (
          <>
            <Badge tone={catTone(fttj.cat)}>{fttj.cat ?? "METAR"}</Badge>
            <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              FTTJ {fttj.raw.replace(/^METAR\s+/, "")}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">METAR FTTJ en attente</p>
        )}
        {sigAo > 0 ? (
          <Badge tone="warn">SIGMET {sigAo}</Badge>
        ) : null}
        {jamHot ? <Badge tone="crit">GNSS dégradé</Badge> : null}
        {pic?.solar?.nightOps ? <Badge tone="warn">Nuit FTTJ</Badge> : null}
        {pic?.airport?.rwy ? (
          <Badge>RWY {pic.airport.rwy}</Badge>
        ) : null}
      </div>
      <p className="truncate text-xs text-muted-foreground ml-auto max-w-md text-right">
        {liveError
          ? liveError
          : `${LIVE_CREDIT.split("·")[0]}· Kp ${kp ?? "—"} · GOES ${xray ?? "—"} · ${
              liveAt ? formatClock(liveAt) : "--:--:--"
            }`}
      </p>
    </div>
  );
}
