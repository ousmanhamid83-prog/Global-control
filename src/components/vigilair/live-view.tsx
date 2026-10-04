import { useMemo, useState } from "react";
import { Antenna, BookOpen, Radio, RadioTower, Satellite, Wind } from "lucide-react";
import { AntennaPanel } from "@/components/vigilair/antenna-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { formatClock } from "@/lib/vigilair/format";
import { AO, formatCoord, haversineKm } from "@/lib/vigilair/geo";
import {
  LIVE_CREDIT,
  countLive,
  icaoNation,
  nicLabel,
  type MetarRow,
  type SourceHealth,
} from "@/lib/vigilair/live-adsb";
import {
  RID_NOTE,
  decodeRidDump,
  encodeBasicId,
  encodeLocation,
  encodeSelfId,
  packRidPack,
  type RidDecoded,
} from "@/lib/vigilair/remote-id";
import {
  briefLivePicture,
  lookupAircraft,
  type AircraftLookup,
} from "@/lib/vigilair/live-feeds";
import { useVigilair } from "@/lib/vigilair/store";
import { obsAge, tafValidity } from "@/lib/vigilair/taf";
import { cn } from "@/lib/utils";

type Tab = "1090" | "antenne" | "metar" | "rid" | "gnss" | "outils";

const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: "1090", label: "1090ES", icon: Radio },
  { id: "antenne", label: "Antenne", icon: RadioTower },
  { id: "metar", label: "Météo", icon: Wind },
  { id: "rid", label: "Remote ID", icon: Antenna },
  { id: "gnss", label: "GNSS", icon: Satellite },
  { id: "outils", label: "Outils", icon: BookOpen },
];

export function LiveView() {
  const [tab, setTab] = useState<Tab>("1090");
  const pic = useVigilair((s) => s.livePicture);
  const liveAt = useVigilair((s) => s.liveAt);
  const liveError = useVigilair((s) => s.liveError);
  const tracks = useVigilair((s) => s.tracks);
  const live = countLive(tracks);
  const jamHot = pic?.jam?.filter((j) => j.level !== "low").length ?? 0;
  const sigAo = pic?.sigmets?.filter((s) => s.inAo).length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Partie 9 · COP opérationnel
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Ingest réel · 1090ES · METAR · SIGMET · FTTJ · GNSS
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{LIVE_CREDIT}</p>
        </header>

        <div className="grid gap-2 grid-cols-7">
          <Stat k="Contacts 1090" v={String(live.n)} />
          <Stat k="Volume ident 120 km" v={String(live.local)} tone={live.local ? "ok" : "default"} />
          <Stat
            k="Urgences"
            v={String(live.emergency)}
            tone={live.emergency ? "crit" : "ok"}
          />
          <Stat
            k="Militaire 1090"
            v={String(live.military)}
            tone={live.military ? "warn" : "default"}
          />
          <Stat
            k="SIGMET Afrique"
            v={String(sigAo)}
            tone={sigAo ? "warn" : "ok"}
          />
          <Stat
            k="Kp / GOES"
            v={pic ? `${pic.space.kp} · ${pic.space.xrayClass}` : "—"}
            tone={pic && (pic.space.kp >= 5 || jamHot > 0) ? "warn" : "ok"}
          />
          <Stat
            k="FTTJ"
            v={
              pic?.airport?.rwy
                ? `RWY ${pic.airport.rwy}`
                : pic?.solar
                  ? pic.solar.nightOps
                    ? "Nuit"
                    : "Jour"
                  : "—"
            }
            tone={pic?.solar?.nightOps ? "warn" : "ok"}
          />
        </div>

        {liveError ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-warn">
            {liveError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {pic?.source ?? "En attente du réseau"} ·{" "}
            {liveAt ? formatClock(liveAt) : "--:--:--"} WAT · lecture seule
          </p>
        )}

        {pic?.sources?.length ? <SourceRow sources={pic.sources} /> : null}

        <div className="flex gap-1 overflow-x-auto rounded-md border border-border p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 text-sm",
                  tab === t.id
                    ? "bg-secondary text-fg"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {tab === "1090" ? <AdsbPanel /> : null}
        {tab === "antenne" ? <AntennaPanel /> : null}
        {tab === "metar" ? <WxPanel /> : null}
        {tab === "rid" ? <RidPanel /> : null}
        {tab === "gnss" ? <GnssPanel /> : null}
        {tab === "outils" ? <ToolsPanel /> : null}
      </div>
    </div>
  );
}

function SourceRow({ sources }: { sources: SourceHealth[] }) {
  return (
    <ul className="grid gap-2 grid-cols-3">
      {sources.map((s) => (
        <li
          key={s.id}
          className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2"
        >
          <span
            className={cn(
              "mt-1 size-2 shrink-0 rounded-full",
              s.ok ? "bg-ok" : "bg-muted",
            )}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium break-words">{s.label}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{s.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "ok" | "warn" | "crit" | "default";
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3 hud">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "crit" && "text-crit",
        )}
      >
        {v}
      </p>
    </div>
  );
}

function AdsbPanel() {
  const tracks = useVigilair((s) => s.tracks);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const selectedId = useVigilair((s) => s.selectedId);
  const rows = tracks
    .filter((t) => t.feed === "adsb" && t.idState !== "perdu")
    .sort(
      (a, b) =>
        haversineKm(a.lat, a.lon, AO.centerLat, AO.centerLon) -
        haversineKm(b.lat, b.lon, AO.centerLat, AO.centerLon),
    );

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
        Aucun squitter 1090ES dans les cellules FTTJ / Lagos / Khartoum / Niamey
        pour l'instant. La couverture ADS-B au Tchad est sparse : 0 contact n'est
        pas une panne. Les FIR voisines se remplissent dès qu'un transpondeur
        Mode S est entendu.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-secondary text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Vol</th>
            <th className="px-3 py-2 font-medium">ICAO24</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">État</th>
            <th className="px-3 py-2 font-medium">FL / km/h</th>
            <th className="px-3 py-2 font-medium">Squawk</th>
            <th className="px-3 py-2 font-medium">NIC</th>
            <th className="px-3 py-2 font-medium">FTTJ</th>
            <th className="px-3 py-2 font-medium">Pos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const d = haversineKm(t.lat, t.lon, AO.centerLat, AO.centerLon);
            const plat = PLATFORM_BY_ID[t.truePlatformId];
            const nicBad = t.nic != null && t.nic < 5;
            return (
              <tr
                key={t.id}
                className={cn(
                  "border-t border-border",
                  selectedId === t.id && "bg-secondary/60",
                )}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-mono text-fg"
                    onClick={() => lockTrack(t.id)}
                  >
                    {t.callsign}
                  </button>
                  {t.emergency ? (
                    <Badge tone="crit" className="ml-2">
                      {t.emergency}
                    </Badge>
                  ) : null}
                  {t.military ? (
                    <Badge tone="warn" className="ml-2">
                      MIL
                    </Badge>
                  ) : null}
                  {t.category?.toUpperCase() === "B6" ? (
                    <Badge tone="crit" className="ml-2">
                      UAV
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{t.iff?.icao24}</td>
                <td className="px-3 py-2 text-xs">
                  {t.icaoType ?? "—"} · {plat?.name ?? ""}
                </td>
                <td className="px-3 py-2 text-xs">{t.nation ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums">
                  FL{Math.max(0, Math.round(t.altM / 30.48))} · {Math.round(t.speedKmh)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{t.iff?.squawk ?? "—"}</td>
                <td
                  className={cn(
                    "px-3 py-2 font-mono text-xs",
                    nicBad && "text-warn",
                  )}
                >
                  {nicLabel(t.nic ?? null)}
                </td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums">
                  {d.toFixed(0)} km
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {formatCoord(t.lat, t.lon)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function catTone(cat: string | null): "ok" | "warn" | "crit" | "default" {
  if (cat === "VFR") return "ok";
  if (cat === "MVFR") return "warn";
  if (cat === "IFR" || cat === "LIFR") return "crit";
  return "default";
}

function WxPanel() {
  const pic = useVigilair((s) => s.livePicture);
  const metar = pic?.metar ?? [];
  const taf = pic?.taf ?? [];
  const sigmets = pic?.sigmets ?? [];
  const ao = sigmets.filter((s) => s.inAo);
  const rest = sigmets.filter((s) => !s.inAo).slice(0, 8);
  const apt = pic?.airport;
  const solar = pic?.solar;
  if (metar.length === 0 && taf.length === 0 && sigmets.length === 0 && !apt) {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
        METAR / TAF / SIGMET NOAA Aviation Weather en attente (FTTJ, FIR FTTT, AES).
      </p>
    );
  }
  return (
    <div className="grid gap-4 grid-cols-2">
      {apt || solar ? (
        <div className="rounded-md border border-border bg-surface p-4 col-span-2 hud">
          <h2 className="text-sm font-medium">FTTJ Hassan Djamous · AWC</h2>
          <p className="mt-2 font-mono text-sm tabular-nums">
            {apt
              ? `${apt.name} · RWY ${apt.rwy ?? "—"} · ${apt.rwyM ?? "—"} m · ${apt.elevM} m AMSL · ${apt.freqs ?? "TWR"}`
              : "Aéroport en attente"}
            {solar
              ? ` · lev ${solar.sunrise} / coucher ${solar.sunset} WAT${solar.nightOps ? " · NUIT" : ""}`
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Fiche aéroport NOAA Aviation Weather. Soleil calculé (NOAA Solar Calculator) sur
            les coordonnées FTTJ — pas une API tierce.
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">METAR ASECNA / Sahel</h2>
        <ul className="space-y-2">
          {metar.map((m) => (
            <MetarCard key={m.icao} m={m} />
          ))}
        </ul>
        <h2 className="pt-2 text-sm font-medium">TAF</h2>
        {taf.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            Aucun TAF reçu pour les aérodromes ASECNA / Sahel.
          </p>
        ) : (
          <ul className="space-y-2">
            {taf.map((t) => {
              const v = tafValidity(t.raw);
              return (
              <li key={t.icao} className="rounded-md border border-border bg-surface p-3 hud">
                <p className="flex items-center justify-between gap-2 text-xs font-medium">
                  {t.icao}
                  {v ? <Badge tone={v.expired ? "warn" : "default"}>{v.label}</Badge> : null}
                </p>
                <p className="mt-1 font-mono text-xs leading-relaxed text-muted-foreground">
                  {t.raw}
                </p>
              </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-medium">SIGMET OACI · Afrique</h2>
        {ao.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            Aucun SIGMET dans le rectangle Sahel / Maghreb / Corne. {sigmets.length}{" "}
            SIGMET mondiaux reçus — le flux est vivant.
          </p>
        ) : (
          <ul className="space-y-2">
            {ao.map((s, i) => (
              <li key={`${s.fir}-${i}`} className="rounded-md border border-border bg-surface p-3 hud">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {s.fir} · {s.firName}
                  </p>
                  <Badge tone="warn">{s.hazard}</Badge>
                </div>
                {s.qualifier ? (
                  <p className="mt-1 text-xs text-muted-foreground">{s.qualifier}</p>
                ) : null}
                <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                  {s.raw}
                </p>
              </li>
            ))}
          </ul>
        )}
        {rest.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Hors théâtre : {rest.map((s) => `${s.fir} ${s.hazard}`).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MetarCard({ m }: { m: MetarRow }) {
  const age = obsAge(m.obsAt);
  return (
    <li className="rounded-md border border-border bg-surface p-3 hud">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {m.icao} · {m.name}
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          {age ? <Badge tone={age.stale ? "warn" : "default"}>{age.label}</Badge> : null}
          {m.cat && !age?.stale ? <Badge tone={catTone(m.cat)}>{m.cat}</Badge> : null}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs leading-relaxed text-muted-foreground">{m.raw}</p>
      <p className="mt-2 font-mono text-xs tabular-nums text-fg">
        {m.tempC != null ? `${m.tempC}°C` : "—"} · {m.windDir ?? "VRB"}/{m.windKt ?? "—"} kt
        {m.qnh != null ? ` · Q${m.qnh}` : ""}
        {m.wx ? ` · ${m.wx}` : ""}
      </p>
    </li>
  );
}

function RidPanel() {
  const tracks = useVigilair((s) => s.tracks);
  const [dump, setDump] = useState("");
  const [decoded, setDecoded] = useState<RidDecoded[]>([]);

  const sample = useMemo(() => {
    const uas = tracks.find(
      (t) =>
        t.idState !== "perdu" &&
        t.feed !== "adsb" &&
        !t.friendKind &&
        PLATFORM_BY_ID[t.truePlatformId]?.remoteId,
    );
    if (!uas) return null;
    const plat = PLATFORM_BY_ID[uas.truePlatformId]!;
    const pack = packRidPack([
      encodeBasicId({
        uasId: `VA${uas.callsign.replace(/\W/g, "").slice(0, 16)}`,
        uaType: plat.uasClass === "fixed-wing" ? 1 : 2,
      }),
      encodeLocation({
        lat: uas.lat,
        lon: uas.lon,
        altM: uas.altM,
        speedMs: uas.speedKmh / 3.6,
        heading: uas.heading,
        status: 2,
      }),
      encodeSelfId(`${plat.manufacturer} ${plat.name}`),
    ]);
    return { callsign: uas.callsign, plat: `${plat.manufacturer} ${plat.name}`, pack };
  }, [tracks]);

  const run = (raw: string) => {
    setDump(raw);
    setDecoded(decodeRidDump(raw));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{RID_NOTE}</p>
      <div className="flex flex-wrap gap-2">
        {sample ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => run(sample.pack)}
          >
            Trames RID · {sample.callsign}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => run(dump)}
          disabled={!dump.trim()}
        >
          Décoder le dump
        </Button>
      </div>
      <textarea
        value={dump}
        onChange={(e) => setDump(e.target.value)}
        placeholder="Coller un dump hex OpenDroneID (25 octets / message)…"
        className="min-h-28 w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        spellCheck={false}
      />
      {sample && !dump ? (
        <p className="text-xs text-muted-foreground">
          Exemple COP : {sample.callsign} · {sample.plat} (protocole réel, pas une
          écoute 2,4 GHz).
        </p>
      ) : null}
      <ul className="space-y-2">
        {decoded.map((d, i) => (
          <li key={`${d.type}-${i}`} className="rounded-md border border-border bg-surface p-3 hud">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{d.typeLabel}</p>
              <Badge tone={d.ok ? "ok" : "crit"}>{d.ok ? "OK" : "erreur"}</Badge>
            </div>
            {d.error ? (
              <p className="mt-1 text-xs text-crit">{d.error}</p>
            ) : null}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {d.fields.map((f) => (
                <div key={f.k}>
                  <dt className="text-muted-foreground">{f.k}</dt>
                  <dd className="font-mono">{f.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {d.hex}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GnssPanel() {
  const pic = useVigilair((s) => s.livePicture);
  const space = pic?.space;
  const jam = pic?.jam ?? [];
  const tow = space ? Math.floor(space.gpsTowS) : 0;
  const h = Math.floor(tow / 3600);
  const m = Math.floor((tow % 3600) / 60);
  const s = tow % 60;
  const hot = jam.filter((j) => j.level !== "low");
  return (
    <div className="grid gap-4 grid-cols-2">
      <div className="rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">Temps GPS</h2>
        <p className="mt-3 font-mono text-2xl tabular-nums">
          Semaine {space?.gpsWeek ?? "—"}
        </p>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          TOW {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:
          {String(s).padStart(2, "0")} (epoch 6 jan 1980 + 18 s leap)
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Semaine et TOW calculés sur l'horloge du poste — pas une simulation.
          Almanach TLE non requis pour l'intégrité ionosphérique.
        </p>
        {pic?.solar ? (
          <p className="mt-3 font-mono text-xs tabular-nums text-muted-foreground">
            FTTJ {pic.solar.nightOps ? "NUIT" : "JOUR"} · lev {pic.solar.sunrise} ·
            civil {pic.solar.civilBegin}–{pic.solar.civilEnd} · coucher {pic.solar.sunset} WAT
          </p>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">NOAA SWPC · intégrité GNSS</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <p className="font-mono text-2xl tabular-nums">Kp {space?.kp ?? "—"}</p>
          <Badge tone={space && space.kp >= 5 ? "warn" : "ok"}>
            {space?.gScale ?? "G?"}
          </Badge>
          <Badge tone={space?.xrayClass?.startsWith("M") || space?.xrayClass?.startsWith("X") ? "warn" : "ok"}>
            GOES {space?.xrayClass ?? "—"}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{space?.note}</p>
        {space?.kpTime ? (
          <p className="mt-2 text-xs text-muted-foreground">Kp {space.kpTime} UTC</p>
        ) : null}
        {space?.xrayAt ? (
          <p className="text-xs text-muted-foreground">
            Flux GOES {space.xrayFlux?.toExponential(2)} W/m² · {space.xrayAt}
          </p>
        ) : null}
        <p className="mt-4 text-xs text-muted-foreground">
          Kp ≥ 5 : scintillation possible sur L1 au Sahel, jamming GNSS à
          distinguer d'une tempête. Source NOAA Space Weather Prediction Center.
        </p>
      </div>
      <div className="rounded-md border border-border bg-surface p-4 col-span-2 hud">
        <h2 className="text-sm font-medium">Jamming GNSS · NIC / NACp ADS-B</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Même méthode que gpsjam.org : part des aéronefs 1090ES qui reportent une
          Navigation Integrity Category basse. Temps réel, pas une carte du jour
          précédent.
        </p>
        {hot.length === 0 ? (
          <p className="mt-3 text-sm text-ok">
            Aucune cellule chaude sur le flux actuel
            {jam.length ? ` · ${jam.length} cellule(s) nominale(s)` : ""}.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 grid-cols-2">
            {hot.map((j) => (
              <li
                key={`${j.lat}:${j.lon}`}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm">
                    {j.lat.toFixed(0)}° / {j.lon.toFixed(0)}°
                  </p>
                  <Badge tone={j.level === "high" ? "crit" : "warn"}>
                    {j.pct.toFixed(0)} %
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {j.bad}/{j.n} aéronefs NIC{"<"}5
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(pic?.alerts ?? []).length > 0 ? (
        <div className="rounded-md border border-border bg-surface p-4 col-span-2 hud">
          <h2 className="text-sm font-medium">Alertes NOAA SWPC</h2>
          <ul className="mt-3 space-y-2">
            {(pic?.alerts ?? []).map((a) => (
              <li key={`${a.code}-${a.at}`} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {a.kind} · {a.title}
                  </p>
                  <Badge tone={a.kind === "ALERT" || a.kind === "WARNING" ? "warn" : "default"}>
                    {a.code || a.kind}
                  </Badge>
                </div>
                {a.impact ? (
                  <p className="mt-1 text-xs text-muted-foreground">{a.impact}</p>
                ) : null}
                {a.at ? (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{a.at} UTC</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ToolsPanel() {
  const [hex, setHex] = useState("");
  const [lookup, setLookup] = useState<AircraftLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);

  const runLookup = () => {
    const clean = hex.replace(/[^0-9a-f]/gi, "").slice(0, 6);
    if (clean.length !== 6) return;
    setLooking(true);
    lookupAircraft({ data: { hex: clean } })
      .then(setLookup)
      .catch((e: unknown) =>
        setLookup({
          ok: false,
          hex: clean,
          type: null,
          icaoType: null,
          manufacturer: null,
          registration: null,
          operator: null,
          country: null,
          error: e instanceof Error ? e.message : "échec",
        }),
      )
      .finally(() => setLooking(false));
  };

  const runBrief = () => {
    setBriefing(true);
    setBriefErr(null);
    briefLivePicture()
      .then((r) => {
        if (r.ok) setBrief(r.text);
        else setBriefErr(r.error);
      })
      .catch((e: unknown) =>
        setBriefErr(e instanceof Error ? e.message : "briefing échoué"),
      )
      .finally(() => setBriefing(false));
  };

  return (
    <div className="grid gap-4 grid-cols-2">
      <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">Registre ICAO24 · adsbdb</h2>
        <p className="text-sm text-muted-foreground">
          Interrogation réelle du registre Mode S (type, immat, opérateur). Pas
          une base locale. Lecture seule.
        </p>
        <div className="flex gap-2">
          <Input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            placeholder="ex. 01015C"
            aria-label="ICAO24"
            className="font-mono uppercase"
            maxLength={8}
          />
          <Button
            type="button"
            onClick={runLookup}
            disabled={looking || hex.replace(/[^0-9a-f]/gi, "").length !== 6}
          >
            {looking ? "…" : "Identifier"}
          </Button>
        </div>
        {lookup ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">ICAO24</dt>
            <dd className="font-mono">{lookup.hex.toUpperCase()}</dd>
            {lookup.ok ? (
              <>
                <dt className="text-muted-foreground">Type</dt>
                <dd>{lookup.type ?? "—"}</dd>
                <dt className="text-muted-foreground">ICAO</dt>
                <dd className="font-mono">{lookup.icaoType ?? "—"}</dd>
                <dt className="text-muted-foreground">Immat</dt>
                <dd className="font-mono">{lookup.registration ?? "—"}</dd>
                <dt className="text-muted-foreground">Opérateur</dt>
                <dd>{lookup.operator ?? "—"}</dd>
                <dt className="text-muted-foreground">État</dt>
                <dd>{lookup.country ?? "—"}</dd>
                <dt className="text-muted-foreground">Allocation OACI</dt>
                <dd>{icaoNation(lookup.hex) ?? "—"}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Statut</dt>
                <dd className="text-warn">{lookup.error}</dd>
              </>
            )}
          </dl>
        ) : null}
      </section>
      <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">Briefing situation</h2>
        <p className="text-sm text-muted-foreground">
          Synthèse des capteurs réels du dernier ingest — 1090, METAR, SIGMET,
          Kp, NIC. Demande explicite, une fois.
        </p>
        <Button type="button" onClick={runBrief} disabled={briefing}>
          {briefing ? "Rédaction…" : "Briefing chef de division"}
        </Button>
        {briefErr ? <p className="text-sm text-warn">{briefErr}</p> : null}
        {brief ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{brief}</p>
        ) : null}
      </section>
      <section className="rounded-md border border-border bg-surface p-4 col-span-2 hud">
        <h2 className="text-sm font-medium">Ce qui est réel</h2>
        <ul className="mt-2 grid gap-2 text-sm text-muted-foreground grid-cols-2">
          <li>1090ES — réseau passif mondial (adsb.lol / readsb), cellules FTTJ Lagos Khartoum Niamey.</li>
          <li>METAR / TAF — NOAA Aviation Weather, stations ASECNA et FIR voisines.</li>
          <li>SIGMET — bulletins OACI mondiaux, filtrés Afrique / Sahel.</li>
          <li>FTTJ — fiche aéroport AWC (piste, TWR 118.1), soleil NOAA calculé WAT.</li>
          <li>GNSS — semaine GPS du poste, Kp / GOES / alertes NOAA SWPC, NIC des squitters.</li>
          <li>Registre — adsbdb à la demande + nationalité par allocation OACI 24 bits.</li>
          <li>Remote ID — décodeur ASTM F3411 réel ; le navigateur n'écoute pas le 2,4 GHz.</li>
          <li>Installable — Chrome / Edge, raccourci bureau, même flux sur chaque PC de la division.</li>
          <li>Quart — prise de poste / relève / AAR gelé sur ces capteurs, pas un scénario.</li>
        </ul>
      </section>
    </div>
  );
}
