import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KIND_LABEL } from "@/lib/vigilair/capture";
import { threatRank } from "@/lib/vigilair/catalog";
import { threatTone } from "@/lib/vigilair/format";
import { AO, haversineKm, nearestCity } from "@/lib/vigilair/geo";
import { nearestWatchSite } from "@/lib/vigilair/watch-sites";
import { useVigilair } from "@/lib/vigilair/store";
import { formatAge, useWallClock } from "@/lib/vigilair/telemetry";
import { X } from "lucide-react";

/**
 * Phénomènes mondiaux — crues, cyclones, séismes, volcans, feux captés en temps réel (GDACS, EONET,
 * USGS, FIRMS). Les proches du théâtre ou d'un site minier sonnent en bandeau ; ici on retrouve TOUS
 * les événements, même lointains, avec « Capture » (imagerie réelle de la zone) en un clic.
 */
export function WorldPhenomPanel() {
  const open = useVigilair((s) => s.worldPhenomOpen);
  const phenomena = useVigilair((s) => s.phenomena);
  const setOpen = useVigilair((s) => s.setWorldPhenomOpen);
  const openCapture = useVigilair((s) => s.openCapture);
  const wall = useWallClock(); // rafraîchit les âges

  if (!open) return null;

  const rows = [...phenomena].sort((a, b) => {
    const sev = threatRank(b.level) - threatRank(a.level);
    if (sev) return sev;
    const da = haversineKm(AO.airport.lat, AO.airport.lon, a.lat, a.lon);
    const db = haversineKm(AO.airport.lat, AO.airport.lon, b.lat, b.lon);
    return da - db;
  });

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Phénomènes mondiaux</h2>
            <p className="text-xs text-muted-foreground">
              {rows.length} événements réels · GDACS · EONET · USGS · FIRMS
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Fermer">
            <X className="size-4" />
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Aucun phénomène au dernier relevé (ou ingest en attente).
          </p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {rows.map((p) => {
              const fttjKm = Math.round(haversineKm(AO.airport.lat, AO.airport.lon, p.lat, p.lon));
              const city = nearestCity(p.lat, p.lon);
              const nm = nearestWatchSite(p.lat, p.lon);
              const nearSite = nm != null && nm.distKm <= 200;
              return (
                <li key={p.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={threatTone(p.level)}>{p.level}</Badge>
                    <Badge>{KIND_LABEL[p.kind]}</Badge>
                    {nearSite && nm ? <Badge tone="warn">{nm.site.custom ? "site surveillé" : "site minier"}</Badge> : null}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {p.at ? `il y a ${formatAge(wall - p.at)}` : "—"}
                    </span>
                  </div>
                  <p className="text-sm text-fg">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {city.name} · {fttjKm.toLocaleString("fr-FR")} km de FTTJ
                    {nearSite && nm ? ` · ${nm.site.short} à ${Math.round(nm.distKm)} km` : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    data-phenom-kind={p.kind}
                    data-phenom-lat={p.lat}
                    data-phenom-lon={p.lon}
                    onClick={() => {
                      openCapture({ lat: p.lat, lon: p.lon, kind: "scene", title: p.title, body: p.body, source: p.source });
                      setOpen(false);
                    }}
                  >
                    Capture imagerie
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Capture = imagerie réelle de la zone (Sentinel-2 10 m si clé, sinon IR/Esri). Réception seule.
        </p>
      </aside>
    </div>
  );
}
