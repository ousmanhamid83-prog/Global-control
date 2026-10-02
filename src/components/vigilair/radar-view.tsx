import { PpiRadar } from "@/components/vigilair/ppi-radar";
import { RhiRadar } from "@/components/vigilair/rhi-radar";
import { PaintFilters } from "@/components/vigilair/paint-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_BY_ID, classLabel, originLabel } from "@/lib/vigilair/catalog";
import { AO, formatCoord, haversineKm, headingBetween } from "@/lib/vigilair/geo";
import { iffModesLine, m4Label, m4Tone } from "@/lib/vigilair/iff";
import { PPI_RANGES, prfHz, type PpiRangeKm } from "@/lib/vigilair/ppi";
import { useStaff } from "@/lib/vigilair/staff-context";
import { trackVisible, useVigilair } from "@/lib/vigilair/store";
import { cn } from "@/lib/utils";
import { Crosshair, EyeOff, Fingerprint } from "lucide-react";

export function RadarView() {
  const ppi = useVigilair((s) => s.ppi);
  const setPpi = useVigilair((s) => s.setPpi);
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const selected = tracks.find((t) => t.id === selectedId);
  const live = tracks.filter((t) => trackVisible(t, selectedId));
  const { isSuperadmin } = useStaff();
  const requestM4 = useVigilair((s) => s.requestM4);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(24rem,72dvh)_auto] overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <section className="relative grid min-h-0 grid-rows-[minmax(0,1fr)_7rem] border-b border-border lg:grid-rows-[minmax(0,1fr)_9rem] lg:border-b-0 lg:border-r">
        <PpiRadar className="min-h-0" />
        <div className="min-h-0 border-t border-border">
          <RhiRadar className="h-full" />
        </div>
      </section>
      <aside className="min-h-0 overflow-y-auto">
        <div className="space-y-4 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Paramètres PPI
            </p>
            <h2 className="text-base font-semibold">Écran radar FTTJ</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              PPI + coupe altitude RHI — affichage des pistes 1090ES live, pas un
              radar primaire FATL. Carrés verts = amis. Filtre menace / Mode 4.
              Pupitre IFF : crypto Mode 4 (exercice), réponses Mode S. Espace =
              pause · L = verrouiller · F = amis · T = menace · I = IFF · M =
              Mode 4 · 1–7 = portée · ← → AAR.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">Portée</p>
            <div className="flex flex-wrap gap-1">
              {PPI_RANGES.map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => setPpi({ rangeKm: km as PpiRangeKm })}
                  className={cn(
                    "h-9 rounded-md px-3 text-xs transition-colors duration-150",
                    ppi.rangeKm === km
                      ? "bg-secondary text-fg"
                      : "text-muted-foreground hover:bg-secondary hover:text-fg",
                  )}
                >
                  {km} km
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">Peinture</p>
            <PaintFilters variant="rail" />
          </div>

          <Param
            label={`Balayage · ${ppi.rpm} tr/min`}
            value={ppi.rpm}
            min={4}
            max={20}
            step={1}
            onChange={(v) => setPpi({ rpm: v })}
          />
          <Param
            label={`Gain · ${ppi.gain.toFixed(2)}`}
            value={ppi.gain}
            min={0.4}
            max={1.6}
            step={0.05}
            onChange={(v) => setPpi({ gain: v })}
          />
          <Param
            label={`Clutter · ${Math.round(ppi.clutter * 100)} %`}
            value={ppi.clutter}
            min={0}
            max={0.6}
            step={0.02}
            onChange={(v) => setPpi({ clutter: v })}
          />

          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["afterglow", "Afterglow"],
                ["labels", "Étiquettes"],
                ["trails", "Trajectoires"],
                ["iff", "IFF / ADS-B"],
              ] as const
            ).map(([key, lab]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPpi({ [key]: !ppi[key] })}
                className={cn(
                  "h-11 rounded-md px-3 text-xs transition-colors duration-150",
                  ppi[key]
                    ? "bg-secondary text-fg"
                    : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {lab}
              </button>
            ))}
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Item label="PRF" value={`${prfHz(ppi.rangeKm)} Hz`} />
            <Item label="Période" value={`${(60 / ppi.rpm).toFixed(1)} s`} />
            <Item label="Site" value="FTTJ" />
            <Item label="Pistes dans le PPI" value={`${live.filter((t) => haversineKm(AO.airport.lat, AO.airport.lon, t.lat, t.lon) <= ppi.rangeKm).length}`} />
          </dl>

          <div className="flex items-center gap-2">
            <Badge tone="ok">
              <EyeOff className="mr-1 size-3" />
              Silencieux
            </Badge>
            {isSuperadmin ? (
              <Badge>Chef · effecteur</Badge>
            ) : (
              <Badge>Admin · détection</Badge>
            )}
          </div>

          {selected ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="font-mono text-xs text-muted-foreground">{selected.callsign}</p>
              <p className="text-sm font-medium">
                {(() => {
                  const plat =
                    PLATFORM_BY_ID[
                      selected.hypotheses[0]?.platformId ?? selected.truePlatformId
                    ];
                  return plat
                    ? `${plat.manufacturer} ${plat.name}`
                    : "Piste en cours d'ident";
                })()}
              </p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatCoord(selected.lat, selected.lon)}
              </p>
              <p className="text-xs text-muted-foreground">
                BRG{" "}
                {headingBetween(
                  AO.airport.lat,
                  AO.airport.lon,
                  selected.lat,
                  selected.lon,
                ).toFixed(0)}
                ° · RNG{" "}
                {haversineKm(
                  AO.airport.lat,
                  AO.airport.lon,
                  selected.lat,
                  selected.lon,
                ).toFixed(1)}{" "}
                km
                {selected.classGuess ? ` · ${classLabel(selected.classGuess)}` : ""}
                {selected.origin ? ` · ${originLabel(selected.origin)}` : ""}
              </p>
              {selected.iff ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={m4Tone(selected.iff.m4)}>
                    {m4Label(selected.iff.m4)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {iffModesLine(selected.iff)}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sans transpondeur IFF.</p>
              )}
              <Button
                variant={selected.locked ? "default" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => lockTrack(selected.locked ? null : selected.id)}
              >
                <Crosshair />
                {selected.locked ? "Trajectoire verrouillée" : "Verrouiller"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={selected.iff?.m4 === "demande"}
                onClick={() => requestM4(selected.id)}
              >
                <Fingerprint />
                {selected.iff?.m4 === "demande"
                  ? "Mode 4 en cours"
                  : selected.iff?.m4 === "valid"
                    ? "Réinterroger Mode 4"
                    : "Demander Mode 4"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cliquez un contact sur l'écran pour verrouiller sa trajectoire.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Param({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full"
      />
    </label>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
