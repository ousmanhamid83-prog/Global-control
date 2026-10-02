import { Link } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useVigilair } from "@/lib/vigilair/store";
import { ZONE_LEVEL_LABEL, zoneLevelTone } from "@/lib/vigilair/zones";

export function ZoneStrip() {
  const picture = useVigilair((s) => s.zonePicture);
  if (picture.length === 0) return null;

  const hot = picture.filter((z) => z.level === "intrusion" || z.level === "approche");
  const city = picture.filter((z) => z.zone.kind !== "mine");
  const mines = picture.filter((z) => z.zone.kind === "mine");
  const armed = city.filter((z) => z.zone.armed).length;
  const lead = hot[0] ?? picture.find((z) => z.level === "trafic") ?? picture[0];
  if (!lead) return null;

  const tone = zoneLevelTone(lead.level);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2"
      data-mine-zones={String(mines.length)}
    >
      <Badge tone={tone}>
        <Target className="mr-1 size-3" />
        {ZONE_LEVEL_LABEL[lead.level]}
      </Badge>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {hot.length > 0
          ? hot
              .map(
                (z) =>
                  `${z.zone.name} · ${z.inside.filter((c) => c.uas).length || z.approaching.filter((c) => c.uas).length} piste${
                    (z.inside.filter((c) => c.uas).length || z.approaching.filter((c) => c.uas).length) > 1
                      ? "s"
                      : ""
                  }`,
              )
              .join(" · ")
          : `${armed} bulles ville · ${mines.length} périmètres miniers armés`}
      </p>
      <Link
        to="/zones"
        className="inline-flex h-11 items-center rounded-md px-3 text-xs text-fg hover:bg-secondary"
      >
        Bulles
      </Link>
    </div>
  );
}
