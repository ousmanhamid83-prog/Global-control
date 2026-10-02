import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { SENSOR_SITES } from "@/lib/vigilair/sensors";
import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import {
  classLabel,
  idStateLabel,
  originLabel,
  threatLabel,
} from "@/lib/vigilair/catalog";
import { altToFl, formatClock, formatWatHm, kmhToKt } from "@/lib/vigilair/format";
import { countFriends, isFriend } from "@/lib/vigilair/friends";
import { countM4 } from "@/lib/vigilair/iff";
import { countModeS } from "@/lib/vigilair/mode-s";
import { countLive } from "@/lib/vigilair/live-adsb";
import { prfHz } from "@/lib/vigilair/ppi";
import { detectRaids } from "@/lib/vigilair/raid";
import { ROLE_LABEL } from "@/lib/vigilair/staff";
import { useStaff } from "@/lib/vigilair/staff-context";
import { sentinelStats } from "@/lib/vigilair/command";
import { threatOf, useVigilair } from "@/lib/vigilair/store";
import { formatWatchDuration, shortWatchLabel } from "@/lib/vigilair/watch";
import type { IdState, Origin, Threat, Track, UasClass } from "@/lib/vigilair/types";

const ORIGIN_COLOR: Record<Origin, string> = {
  CN: "var(--color-cn)",
  TR: "var(--color-tr)",
  RU: "var(--color-ru)",
  IR: "var(--color-ir)",
  XX: "var(--color-xx)",
};

const FL_BANDS: { name: string; lo: number; hi: number }[] = [
  { name: "SFC–FL050", lo: 0, hi: 50 },
  { name: "FL050–150", lo: 50, hi: 150 },
  { name: "FL150–250", lo: 150, hi: 250 },
  { name: "FL250–350", lo: 250, hi: 350 },
  { name: "FL350+", lo: 350, hi: 9999 },
];

export function DashboardView() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const tracks = useVigilair((s) => s.tracks);
  const history = useVigilair((s) => s.history);
  const now = useVigilair((s) => s.now);
  const ppi = useVigilair((s) => s.ppi);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const pic = useVigilair((s) => s.livePicture);
  const watch = useVigilair((s) => s.watch);
  const watchLoaded = useVigilair((s) => s.watchLoaded);
  const { isSuperadmin, profile, loading: staffLoading } = useStaff();
  const [sent, setSent] = useState({ open: 0, ejected: 0, auto: 0, bindings: 0 });
  useEffect(() => {
    if (!isSuperadmin) return;
    sentinelStats()
      .then(setSent)
      .catch(() => undefined);
  }, [isSuperadmin]);
  const phenomena = useVigilair((s) => s.phenomena);
  const alerts = useVigilair((s) => s.alerts);
  const satMeta = useVigilair((s) => s.satMeta);
  const live = tracks.filter((t) => t.idState !== "perdu");
  const { posture, reason } = computePosture(tracks);
  const raids = detectRaids(tracks);
  const friends = countFriends(tracks);
  const m4 = countM4(tracks);
  const ms = countModeS(live);
  const live1090 = countLive(tracks);

  const byPhen = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of phenomena) map.set(p.kind, (map.get(p.kind) ?? 0) + 1);
    return [...map.entries()].map(([name, n]) => ({ name, n }));
  }, [phenomena]);

  const byAlert = useMemo(
    () => [
      { name: "Ouvertes", n: alerts.filter((a) => !a.acked).length },
      { name: "Acquittées", n: alerts.filter((a) => a.acked).length },
    ],
    [alerts],
  );

  const bySensor = useMemo(() => {
    const src = pic?.sources ?? [];
    return [
      { name: "Live", n: src.filter((s) => s.ok).length },
      { name: "Silence", n: src.filter((s) => !s.ok).length },
    ];
  }, [pic]);

  const byOrigin = useMemo(() => {
    const map: Record<Origin, number> = { CN: 0, TR: 0, RU: 0, IR: 0, XX: 0 };
    for (const t of live) {
      if (t.friendKind) continue;
      map[t.origin ?? "XX"] += 1;
    }
    return (Object.keys(map) as Origin[]).map((o) => ({
      name: originLabel(o),
      origin: o,
      n: map[o],
    }));
  }, [live]);

  const byThreat = useMemo(() => {
    const map: Record<Threat, number> = {
      faible: 0,
      moderee: 0,
      elevee: 0,
      critique: 0,
    };
    for (const t of live) {
      if (t.friendKind) continue;
      map[threatOf(t)] += 1;
    }
    return (Object.keys(map) as Threat[]).map((k) => ({
      name: threatLabel(k),
      n: map[k],
    }));
  }, [live]);

  const byState = useMemo(() => {
    const order: IdState[] = [
      "detecte",
      "classification",
      "candidat",
      "confirme",
      "hors-mandat",
      "perdu",
    ];
    const map = Object.fromEntries(order.map((s) => [s, 0])) as Record<IdState, number>;
    for (const t of tracks) map[t.idState] += 1;
    return order.map((s) => ({ name: idStateLabel(s), n: map[s] }));
  }, [tracks]);

  const byClass = useMemo(() => {
    const map = new Map<UasClass, number>();
    for (const t of live) {
      if (!t.classGuess || t.friendKind) continue;
      map.set(t.classGuess, (map.get(t.classGuess) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, n]) => ({ name: classLabel(k), n }));
  }, [live]);

  const hist = history.map((h) => ({
    t: h.t,
    live: h.live,
    confirmed: h.confirmed,
    critique: h.critique,
    adsb: h.adsb ?? 0,
    uas: h.uas ?? 0,
    ami: h.ami,
  }));

  const byFl = useMemo(() => {
    const counts = FL_BANDS.map((b) => ({ name: b.name, n: 0, lo: b.lo }));
    for (const t of live) {
      const fl = altToFl(t.altM);
      const band = counts.find((b, i) => {
        const next = counts[i + 1];
        return fl >= b.lo && (next ? fl < next.lo : true);
      });
      if (band) band.n += 1;
    }
    return counts;
  }, [live]);

  const scatter = useMemo(() => {
    const of = (kind: "1090" | "UAS" | "AMI") =>
      live
        .filter((t) => feedKind(t) === kind)
        .map((t) => ({
          fl: Math.round(altToFl(t.altM)),
          kt: Math.round(kmhToKt(t.speedKmh)),
          cs: t.callsign,
        }));
    return {
      adsb: of("1090"),
      uas: of("UAS"),
      ami: of("AMI"),
    };
  }, [live]);

  const kpis = [
    { label: "Pistes live", value: String(live.length) },
    {
      label: "Confirmées",
      value: String(live.filter((t) => t.idState === "confirme").length),
    },
    { label: "Posture", value: postureLabel(posture) },
    {
      label: "Quart",
      value: !watchLoaded
        ? "…"
        : watch
          ? `${shortWatchLabel(watch.openedLabel)} · ${formatWatchDuration(now - (Date.parse(watch.openedAt) || now))}`
          : "vacant",
    },
    {
      label: "Capteurs",
      value: pic
        ? `${pic.sources.filter((s) => s.ok).length} flux réels`
        : "en attente",
    },
    {
      label: "Effecteur",
      value: staffLoading
        ? "…"
        : isSuperadmin
          ? ewArmed
            ? "RF armé"
            : "RF off"
          : "Chef seulement",
    },
    { label: "PRF PPI", value: `${prfHz(ppi.rangeKm)} Hz` },
    {
      label: "Raids",
      value: raids.length ? `${raids[0].corridor} · ${raids[0].count}` : "Aucun",
    },
    {
      label: "Amis FATL / ASECNA",
      value: `${friends.fatl} / ${friends.asecna}`,
    },
    {
      label: "Mode 4",
      value:
        m4.invalid > 0
          ? `${m4.valid} valides · ${m4.invalid} invalides`
          : `${m4.valid} valides · ${m4.absent} sans M4`,
    },
    {
      label: "Mode S / MLAT",
      value:
        ms.spoof > 0
          ? `${ms.mlat} TDOA · ${ms.spoof} usurp.`
          : `${ms.ehs + ms.els + ms.adsb} 1090 · ${ms.mlat} MLAT`,
    },
    {
      label: "1090ES live",
      value:
        live1090.emergency > 0
          ? `${live1090.n} · ${live1090.emergency} urg.`
          : pic
            ? `${live1090.n} · ident ${live1090.local}`
            : "en attente",
    },
    {
      label: "FTTJ",
      value: !pic
        ? "—"
        : pic.airport
          ? `RWY ${pic.airport.rwy ?? "—"} · ${pic.solar?.nightOps ? "nuit" : "jour"}`
          : pic.solar?.nightOps
            ? "Nuit"
            : "Jour",
    },
    {
      label: "Alertes SWPC",
      value: pic?.alerts?.length
        ? `${pic.alerts[0]!.kind} · ${pic.alerts.length}`
        : "aucune",
    },
    {
      label: "Sentinelle",
      value: staffLoading
        ? "…"
        : isSuperadmin
          ? sent.open > 0
            ? `${sent.open} ouverts · ${sent.auto} coupures`
            : `${sent.bindings} postes · ${sent.ejected} éjectés`
          : "Clé liée au poste",
    },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Salle technique
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Tableau de bord</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile?.label ?? "Poste"} · {ready ? formatClock(now) : "--:--:--"} WAT · {reason}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok">Silencieux</Badge>
            <Badge>
              {staffLoading
                ? "…"
                : isSuperadmin
                  ? "Chef de division"
                  : profile
                    ? ROLE_LABEL[profile.role]
                    : "Agent"}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-mono text-lg tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard title="Phénomènes" unit="n · feu, séisme, météo">
            {ready && byPhen.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byPhen} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
                  <YAxis stroke="var(--color-muted)" fontSize={11} allowDecimals={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}`, "n"]} />
                  <Bar dataKey="n" fill="var(--color-crit)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-sm text-muted-foreground">Aucun phénomène dans la fenêtre.</p>
            )}
          </ChartCard>
          <ChartCard title="Alertes" unit="ouvertes / acquittées">
            {ready ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byAlert} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
                  <YAxis stroke="var(--color-muted)" fontSize={11} allowDecimals={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}`, "n"]} />
                  <Bar dataKey="n" fill="var(--color-warn)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 bg-secondary/40" />
            )}
          </ChartCard>
          <ChartCard title="Capteurs" unit={satMeta?.visSrc || "flux"}>
            {ready ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bySensor} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
                  <YAxis stroke="var(--color-muted)" fontSize={11} allowDecimals={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value} flux`, "n"]} />
                  <Bar dataKey="n" fill="var(--color-ok)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 bg-secondary/40" />
            )}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Charge pistes" unit="n · WAT">
            {ready ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={formatWatHm}
                    stroke="var(--color-muted)"
                    fontSize={11}
                    minTickGap={28}
                  />
                  <YAxis
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    width={32}
                    label={{ value: "n", position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => `${formatWatHm(Number(v))} WAT`}
                    formatter={(value, name) => [`${value} pistes`, String(name)]}
                  />
                  <Legend iconType="plainline" wrapperStyle={legendStyle} />
                  <Area
                    type="monotone"
                    dataKey="live"
                    name="Live"
                    stroke="var(--color-ok)"
                    fill="var(--color-ok)"
                    fillOpacity={0.18}
                    strokeWidth={1.6}
                  />
                  <Area
                    type="monotone"
                    dataKey="confirmed"
                    name="Confirmées"
                    stroke="var(--color-primary)"
                    fill="var(--color-primary)"
                    fillOpacity={0.1}
                    strokeWidth={1.4}
                  />
                  <Area
                    type="monotone"
                    dataKey="critique"
                    name="Critique"
                    stroke="var(--color-crit)"
                    fill="var(--color-crit)"
                    fillOpacity={0.08}
                    strokeWidth={1.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 bg-secondary/40" />
            )}
          </ChartCard>

          <ChartCard title="Mix flux" unit="1090ES / UAS / AMI · n">
            {ready ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={formatWatHm}
                    stroke="var(--color-muted)"
                    fontSize={11}
                    minTickGap={28}
                  />
                  <YAxis
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => `${formatWatHm(Number(v))} WAT`}
                    formatter={(value, name) => [`${value} pistes`, String(name)]}
                  />
                  <Legend iconType="square" wrapperStyle={legendStyle} />
                  <Area
                    type="monotone"
                    dataKey="adsb"
                    name="1090ES"
                    stackId="mix"
                    stroke="var(--color-ok)"
                    fill="var(--color-ok)"
                    fillOpacity={0.35}
                  />
                  <Area
                    type="monotone"
                    dataKey="uas"
                    name="UAS"
                    stackId="mix"
                    stroke="var(--color-warn)"
                    fill="var(--color-warn)"
                    fillOpacity={0.3}
                  />
                  <Area
                    type="monotone"
                    dataKey="ami"
                    name="AMI"
                    stackId="mix"
                    stroke="var(--color-ru)"
                    fill="var(--color-ru)"
                    fillOpacity={0.28}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 bg-secondary/40" />
            )}
          </ChartCard>

          <ChartCard title="Répartition FL" unit="1 FL = 100 ft = 30,48 m">
            {ready ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byFl} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={10} interval={0} />
                  <YAxis
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    width={32}
                    label={{ value: "n", position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [`${value} pistes`, "Effectif"]}
                  />
                  <Bar dataKey="n" name="Pistes" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 bg-secondary/40" />
            )}
          </ChartCard>

          <ChartCard title="FL × vitesse" unit="FL · kt TAS">
            {ready ? (
              <ResponsiveContainer width="100%" height={240}>
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="var(--color-border)" />
                  <XAxis
                    type="number"
                    dataKey="fl"
                    name="FL"
                    unit=" FL"
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    label={{ value: "FL", position: "insideBottomRight", fill: "var(--color-muted)", fontSize: 10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="kt"
                    name="Vitesse"
                    unit=" kt"
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    width={40}
                    label={{ value: "kt", position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 10 }}
                  />
                  <ZAxis range={[40, 80]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name, item) => {
                      const p = item?.payload as { cs?: string; fl?: number; kt?: number } | undefined;
                      if (name === "FL") return [`FL${String(p?.fl ?? value).padStart(3, "0")}`, p?.cs ?? "FL"];
                      return [`${value} kt`, p?.cs ?? "TAS"];
                    }}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  <Scatter name="1090ES" data={scatter.adsb} fill="var(--color-ok)" />
                  <Scatter name="UAS" data={scatter.uas} fill="var(--color-warn)" />
                  <Scatter name="AMI" data={scatter.ami} fill="var(--color-ru)" />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 bg-secondary/40" />
            )}
          </ChartCard>

          <ChartCard title="Origine (mandat)" unit="pistes hostiles">
            {ready ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byOrigin}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
                  <YAxis
                    stroke="var(--color-muted)"
                    fontSize={11}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [`${value} pistes`, "Effectif"]}
                  />
                  <Bar dataKey="n" name="Pistes" radius={[4, 4, 0, 0]}>
                    {byOrigin.map((d) => (
                      <Cell key={d.origin} fill={ORIGIN_COLOR[d.origin]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 bg-secondary/40" />
            )}
          </ChartCard>

          <ChartCard title="Chaîne d'identification" unit="états · n">
            {ready ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byState} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--color-muted)" fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="var(--color-muted)"
                    fontSize={11}
                    width={110}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [`${value} pistes`, "Effectif"]}
                  />
                  <Bar dataKey="n" name="Pistes" fill="var(--color-ok)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 bg-secondary/40" />
            )}
          </ChartCard>
        </div>

        {byThreat.some((t) => t.n > 0) ? (
          <p className="text-xs text-muted-foreground">
            Menace live : {byThreat.map((c) => `${c.name} ${c.n}`).join(" · ")}
            {byClass.length > 0
              ? ` · Classes : ${byClass.map((c) => `${c.name} ${c.n}`).join(" · ")}`
              : ""}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Paramètres système</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Row k="Couverture ident" v="120 km autour de FTTJ" />
              <Row k="Théâtre AES" v="Mali · Burkina · Niger · Tchad" />
              <Row k="Bande Sahel" v="Dakar → mer Rouge · 4 000 km" />
              <Row k="Carte Monde" v="VIIRS SNPP quotidien · 20 000 km" />
              <Row k="PPI porté" v={`${ppi.rangeKm} km`} />
              <Row k="Balayage" v={`${ppi.rpm} tr/min`} />
              <Row k="Gain / clutter" v={`${ppi.gain.toFixed(2)} / ${Math.round(ppi.clutter * 100)} %`} />
              <Row k="Mandat" v="CN · TR · RU · IR" />
              <Row k="1090ES live" v={pic ? `${pic.sahelN} Sahel · ${pic.localN} ident` : "en attente"} />
              <Row k="SIGMET Afrique" v={String(pic?.sigmets.filter((s) => s.inAo).length ?? 0)} />
              <Row k="GNSS NIC" v={pic?.jam.some((j) => j.level !== "low") ? "dégradé" : "nominal"} />
              <Row k="GOES X-ray" v={pic?.space.xrayClass ?? "—"} />
              <Row
                k="FTTJ piste"
                v={
                  pic?.airport
                    ? `RWY ${pic.airport.rwy ?? "—"} · ${pic.airport.rwyM ?? "—"} m`
                    : "AWC"
                }
              />
              <Row
                k="Soleil WAT"
                v={
                  pic?.solar
                    ? `${pic.solar.nightOps ? "Nuit" : "Jour"} · ${pic.solar.sunrise}–${pic.solar.sunset}`
                    : "—"
                }
              />
              <Row k="Émission RF" v="Interdite (VIGILAIR n'émet pas)" />
              <Row k="Brouillage" v={isSuperadmin ? "Réservé chef de division" : "Masqué — chef seulement"} />
              <Row k="SIGINT" v="1090ES passif · pas de C2 injecté" />
              <Row k="Contrôle objet" v="Jamais — COP seulement" />
            </dl>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">
              {pic?.sources.length ? "Flux réels" : "Inventaire C-UAS"}
            </h2>
            <ul className="mt-3 space-y-2">
              {pic?.sources.length
                ? pic.sources.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 break-words">
                        {s.label}
                        <span className="ml-2 text-xs text-muted-foreground">{s.detail}</span>
                      </span>
                      <Badge tone={s.ok ? "ok" : "default"} className="shrink-0">
                        {s.ok ? "Live" : "Silence"}
                      </Badge>
                    </li>
                  ))
                : SENSOR_SITES.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 break-words">
                        {s.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {s.kind.toUpperCase()} · {s.rangeKm} km
                        </span>
                      </span>
                      <Badge className="shrink-0">Inventaire</Badge>
                    </li>
                  ))}
            </ul>
            {byClass.length > 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Classes live : {byClass.map((c) => `${c.name} ${c.n}`).join(" · ")}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  color: "var(--color-fg)",
  fontSize: 12,
};

const legendStyle = { fontSize: 11, color: "var(--color-muted)" };

function feedKind(t: Track): "1090" | "UAS" | "AMI" {
  if (t.feed === "adsb") return "1090";
  if (isFriend(t)) return "AMI";
  return "UAS";
}

function ChartCard({
  title,
  unit,
  children,
}: {
  title: string;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {unit ? <p className="font-mono text-xs text-muted-foreground">{unit}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
