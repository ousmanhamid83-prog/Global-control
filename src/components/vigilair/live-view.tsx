import { useEffect, useMemo, useState } from "react";
import { Antenna, BookOpen, GitCompare, Headphones, Navigation, Radio, RadioTower, Satellite, Wind } from "lucide-react";
import { AntennaPanel } from "@/components/vigilair/antenna-panel";
import { ChangeCompare } from "@/components/vigilair/change-compare";
import { NavPanel } from "@/components/vigilair/nav-panel";
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
  archiveNow,
  askAssistant,
  atcStatus,
  atcToggle,
  briefLivePicture,
  gpsStatus,
  iaStatus,
  downloadArchive,
  downloadAtcSegment,
  fetchArchives,
  basculerReleveInternet,
  linkStatus,
  lireReleveInternet,
  lookupAircraft,
  posteDiagnostic,
  releverMaintenant,
  sentinelCheck,
  setAutoArchive,
  setContinentSweep,
  type AircraftLookup,
  type DiagRow,
  type EtatReleveEcran,
  type ReponseAssistant,
} from "@/lib/vigilair/live-feeds";
import { dureeLisible } from "@/lib/vigilair/bot-signal";
import {
  IA_CONTACTS_VUS,
  IA_DELAI_S,
  IA_NOTICE_BUDGET,
  IA_QUESTION_MAX,
} from "@/lib/vigilair/ia-limites";
import { ReponseIa } from "@/components/vigilair/reponse-ia";
import { appairerBotSignal, basculerBotSignal, gererNumeroBot, inscrireBotSignal, lireBotSignal } from "@/lib/vigilair/bot-api";
import type { ActionNumero, EtatBot } from "@/lib/vigilair/bot-signal.server";
import {
  basculerCommande,
  forcerRecherche,
  lancerCommande,
  lireCommandes,
} from "@/lib/vigilair/commandes-api";
import {
  COMMANDES,
  LIBELLE_CANAL,
  commandeActive,
  suggestions,
  type Bascules,
  type Canal,
  type Commande,
} from "@/lib/vigilair/commandes-poste";
import type { EtatBascules, ResultatCommande } from "@/lib/vigilair/commandes-poste.server";
import type { ArchiveMeta } from "@/lib/vigilair/archive.server";
import type { AtcSegment, AtcStatus } from "@/lib/vigilair/atc.server";
import { rejeuClock } from "@/lib/vigilair/rejeu";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import { obsAge, tafValidity } from "@/lib/vigilair/taf";
import { formatAge, useWallClock } from "@/lib/vigilair/telemetry";
import { cn } from "@/lib/utils";

type Tab = "1090" | "antenne" | "phonie" | "metar" | "rid" | "gnss" | "change" | "nav" | "outils";

const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: "1090", label: "1090ES", icon: Radio },
  { id: "antenne", label: "Antenne", icon: RadioTower },
  { id: "phonie", label: "Phonie ATC", icon: Headphones },
  { id: "metar", label: "Météo", icon: Wind },
  { id: "rid", label: "Remote ID", icon: Antenna },
  { id: "gnss", label: "GNSS", icon: Satellite },
  { id: "change", label: "Changement", icon: GitCompare },
  { id: "nav", label: "Navigation", icon: Navigation },
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

        {tab === "1090" ? (
          <div className="space-y-3">
            <ContinentSweepControl />
            <AdsbPanel />
          </div>
        ) : null}
        {tab === "antenne" ? <AntennaPanel /> : null}
        {tab === "phonie" ? <AtcPanel /> : null}
        {tab === "metar" ? <WxPanel /> : null}
        {tab === "rid" ? <RidPanel /> : null}
        {tab === "gnss" ? <GnssPanel /> : null}
        {tab === "change" ? <ChangeCompare /> : null}
        {tab === "nav" ? <NavPanel /> : null}
        {tab === "outils" ? <ToolsPanel onGoTab={setTab} /> : null}
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

/**
 * Phonie ATC — réception seule. Le poste enregistre un flux audio produit par le PROPRE récepteur
 * de l'opérateur (clé SDR + rtl_airband/rtl_fm, bande aéronautique VHF publique). AfriControl
 * n'accorde aucune radio et n'émet rien : il lit un flux public en clair et l'archive, sans limite,
 * activable/désactivable. Il ne décode pas la parole.
 */
function AtcPanel() {
  const [status, setStatus] = useState<AtcStatus | null>(null);
  const [segments, setSegments] = useState<AtcSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const wall = useWallClock();

  const refresh = () => {
    atcStatus()
      .then((r) => {
        setStatus(r.status);
        setSegments(r.segments);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, []);

  const toggle = () => {
    setBusy(true);
    atcToggle({ data: { on: !status?.recording } })
      .then((r) => setStatus(r.status))
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const download = (id: string) => {
    downloadAtcSegment({ data: { id } })
      .then((r) => {
        if (!r) return;
        const bin = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bin], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.id;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => undefined);
  };

  const live = status?.recording && status.connected && status.lastChunkAt != null && wall - status.lastChunkAt < 15_000;
  const tone = !status ? "default" : live ? "ok" : status.recording ? "warn" : "default";
  const label = !status
    ? "…"
    : !status.configured
      ? "non configuré"
      : !status.recording
        ? "à l'arrêt"
        : live
          ? "enregistrement"
          : status.connected
            ? "connecté · silence"
            : "flux injoignable";

  return (
    <div className="space-y-4">
      <section className="hud space-y-3 rounded-md border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Phonie ATC · réception seule</h2>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Enregistre le flux audio de <strong>ton propre récepteur</strong> (bande aéronautique VHF
          publique). AfriControl n'accorde rien et n'émet rien : il lit un flux public et l'archive,
          sans limite de durée. Pas de décodage de parole, pas d'écoute d'autre chose que l'aéro.
        </p>
        <dl className="grid grid-cols-4 gap-3 font-mono text-[12px]">
          <Stat k="Flux" v={status?.endpoint ?? "—"} />
          <Stat k="Enregistré" v={status ? `${(status.bytes / 1e6).toFixed(1)} Mo` : "—"} tone={status?.recording ? "ok" : "default"} />
          <Stat k="Segments" v={status ? String(status.segments) : "—"} />
          <Stat
            k="Dernier son"
            v={status?.lastChunkAt ? `il y a ${formatAge(wall - status.lastChunkAt)}` : "—"}
          />
        </dl>
        {status?.lastError ? <p className="font-mono text-xs text-warn">{status.lastError}</p> : null}
        <div className="flex items-center gap-2">
          <Button
            variant={status?.recording ? "default" : "outline"}
            size="sm"
            disabled={busy || !status?.configured}
            onClick={toggle}
          >
            {busy ? "…" : status?.recording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
          </Button>
        </div>
        {!status?.configured ? (
          <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-3 text-xs text-muted-foreground">
            <p className="text-fg">Brancher la phonie</p>
            <p>
              Sur la machine qui porte la clé SDR, exposer la bande aéro publique en flux HTTP (par
              ex. rtl_airband → Icecast), puis démarrer le poste avec l'adresse du flux :
            </p>
            <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
              AFRICONTROL_ATC=http://127.0.0.1:8000/atc.mp3 npm run dev
            </pre>
            <p>Réception seule : le poste lit ce flux public et l'enregistre, il n'émet jamais.</p>
          </div>
        ) : null}
      </section>

      <section className="hud rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Enregistrements archivés</h2>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
            {segments.length} segment(s) · 10 min chacun
          </span>
        </div>
        {segments.length === 0 ? (
          <p className="py-6 text-center font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
            Aucun segment. Démarrer l'enregistrement pour archiver la phonie.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 font-mono text-xs">
            {segments.map((seg) => (
              <li key={seg.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-fg">{new Date(seg.at).toISOString().slice(0, 19).replace("T", " ")} Z</span>
                <span className="text-muted-foreground">{(seg.bytes / 1e6).toFixed(2)} Mo</span>
                <Button size="sm" variant="ghost" onClick={() => download(seg.id)}>
                  Télécharger
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Balayage continental — réservé au chef de division. Par défaut le poste interroge 3 cellules du
 * continent par relevé (courtoisie envers les API publiques) ; le balayage total les interroge
 * toutes à chaque relevé, pour la photo continentale la plus complète. Lecture passive : seul le
 * nombre de cellules change, rien n'est émis.
 */
function ContinentSweepControl() {
  const { isSuperadmin } = useStaff();
  const sweep = useVigilair((s) => s.livePicture?.continentSweep ?? false);
  const liveN = useVigilair((s) => s.tracks.filter((t) => t.feed === "adsb" && t.idState !== "perdu").length);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!isSuperadmin) return null;
  const toggle = () => {
    setBusy(true);
    setErr(null);
    setContinentSweep({ data: { on: !sweep } })
      .then((r) => useVigilair.setState((s) => (s.livePicture ? { livePicture: { ...s.livePicture, continentSweep: r.on } } : {})))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "refusé"))
      .finally(() => setBusy(false));
  };
  return (
    <section className="hud flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">Balayage continental</h3>
          <Badge tone={sweep ? "ok" : "default"}>{sweep ? "total" : "rotation 3"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {sweep
            ? "Toutes les cellules Afrique interrogées à chaque relevé. Chef de division."
            : "3 cellules par relevé (courtoisie API). Le chef peut tout activer."}{" "}
          {liveN} pistes 1090ES réelles en vue.
        </p>
        {err ? <p className="mt-1 font-mono text-xs text-crit">{err}</p> : null}
      </div>
      <Button variant={sweep ? "default" : "outline"} size="sm" disabled={busy} onClick={toggle}>
        {busy ? "…" : sweep ? "Revenir en rotation" : "Activer le balayage total"}
      </Button>
    </section>
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

function GpsCard() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof gpsStatus>> | null>(null);
  useEffect(() => {
    let live = true;
    const poll = () => {
      gpsStatus()
        .then((s) => live && setSt(s))
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const tone = !st ? "default" : !st.configured ? "default" : st.hasFix ? "ok" : st.connected ? "warn" : "crit";
  const label = !st
    ? "…"
    : !st.configured
      ? "non réglé"
      : st.hasFix
        ? "fix"
        : st.connected
          ? "sans fix"
          : "injoignable";

  return (
    <div className="rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">GPS du poste · position &amp; heure réelles</h2>
        <Badge tone={tone}>{label}</Badge>
      </div>
      {st?.configured ? (
        <>
          <div className="mt-3 grid gap-x-6 gap-y-2 text-sm grid-cols-2 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Position</p>
              <p className="font-mono tabular-nums">
                {st.hasFix ? `${st.lat!.toFixed(5)}, ${st.lon!.toFixed(5)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Heure UTC</p>
              <p className="font-mono tabular-nums">{st.utc ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Satellites / HDOP</p>
              <p className="font-mono tabular-nums">
                {st.sats ?? "—"} / {st.hdop ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Altitude</p>
              <p className="font-mono tabular-nums">{st.altM != null ? `${Math.round(st.altM)} m` : "—"}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Récepteur {st.source} ({st.kind === "serial" ? "USB/série" : "TCP"})
            {st.ageS != null ? ` · fix il y a ${st.ageS} s` : ""}. Un fix sert aussi de position
            d'antenne au décodage 1090 (prioritaire sur la valeur fixée en dur). Lecture seule.
          </p>
          {st.error && !st.connected ? <p className="mt-1 font-mono text-xs text-crit">{st.error}</p> : null}
        </>
      ) : (
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p className="text-fg">Brancher un récepteur GPS (clé USB, module, ou terminal qui sort du NMEA)</p>
          <p>L'antenne GPS seule ne suffit pas : il faut un récepteur. Puis au lancement du serveur :</p>
          <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
            AFRICONTROL_GPS=/dev/ttyUSB0 npm run dev        # clé USB (Linux/macOS)
            AFRICONTROL_GPS=127.0.0.1:2947 npm run dev      # flux NMEA en TCP (gpsd / ser2net)
          </pre>
          <p>Donne la position et l'heure UTC réelles du poste. Lecture seule : rien n'est émis.</p>
        </div>
      )}
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
      <GpsCard />
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

/**
 * Enregistrements archivés : bandes de vrai trafic 1090ES entendu par le poste, écrites sur disque,
 * consultables et téléchargeables. Archivage auto (chef) + archivage manuel. C'est une copie de ce
 * qui a été reçu, avec son heure d'origine — jamais une invention.
 */
function ArchivesSection() {
  const { isSuperadmin } = useStaff();
  const [list, setList] = useState<ArchiveMeta[]>([]);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => {
    fetchArchives()
      .then((r) => {
        setList(r.archives);
        setAuto(r.auto);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const saveNow = () => {
    setBusy(true);
    setMsg(null);
    archiveNow()
      .then((r) => {
        if (r.ok) {
          setMsg(`Archivé : ${r.meta!.frames} images · ${r.meta!.aircraft} avions`);
          refresh();
        } else setMsg(r.error ?? "archivage impossible");
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "archivage impossible"))
      .finally(() => setBusy(false));
  };

  const toggleAuto = () => {
    setAutoArchive({ data: { on: !auto } })
      .then((r) => setAuto(r.auto))
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "refusé"));
  };

  const download = (id: string) => {
    downloadArchive({ data: { id } })
      .then((r) => {
        if (!r) {
          setMsg("archive introuvable");
          return;
        }
        const blob = new Blob([r.json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${r.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "téléchargement échoué"));
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Enregistrements archivés · 1090ES réel</h2>
        <div className="flex items-center gap-2">
          <Badge tone={auto ? "ok" : "default"}>auto {auto ? "activé" : "coupé"}</Badge>
          {isSuperadmin ? (
            <Button size="sm" variant="ghost" onClick={toggleAuto}>
              {auto ? "Couper l'auto" : "Activer l'auto"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={saveNow}>
            {busy ? "…" : "Archiver maintenant"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Copie de ce que le poste a réellement entendu (veille des 30 dernières minutes), écrite sur
        disque dans <code className="text-fg">recordings/</code>. Archivage auto toutes les 15 min dès
        3 min de veille. Téléchargeable en JSON (format du rejeu réel).
      </p>
      {msg ? <p className="font-mono text-xs text-warn">{msg}</p> : null}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune archive pour l'instant. Il faut 3 min de veille réelle avant la première bande.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 font-mono text-xs">
          {list.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-fg">
                {rejeuClock(m.from)} → {rejeuClock(m.to).slice(6)}
              </span>
              <span className="text-muted-foreground">
                {m.frames} images · {m.aircraft} avions · {(m.bytes / 1024).toFixed(0)} Ko ·{" "}
                {m.trigger}
              </span>
              <Button size="sm" variant="ghost" onClick={() => download(m.id)}>
                Télécharger
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Imagerie Sentinel-2 fraîche (Copernicus) — le poste ne possède pas de satellite. Il interroge
 * l'API Copernicus avec le compte GRATUIT de l'opérateur. 10 m natif : une piste, un bâtiment, un
 * convoi — pas une voiture. Réel et daté honnêtement ; aucune image inventée.
 */
function SentinelSection() {
  const [st, setSt] = useState<{ configured: boolean; ok: boolean; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = () => {
    setBusy(true);
    sentinelCheck()
      .then(setSt)
      .catch((e: unknown) => setSt({ configured: true, ok: false, error: e instanceof Error ? e.message : "échec" }))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    test();
  }, []);
  const tone = !st ? "default" : !st.configured ? "warn" : st.ok ? "ok" : "crit";
  const label = !st ? "…" : !st.configured ? "clé requise" : st.ok ? "clé valide" : "clé en échec";
  return (
    <section id="diag-sentinel" className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Imagerie Sentinel-2 fraîche · Copernicus (gratuit)</h2>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <Button size="sm" variant="outline" disabled={busy} onClick={test}>
            {busy ? "…" : "Tester la clé"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Le poste ne possède pas de satellite : il interroge Copernicus avec <strong>ton compte
        gratuit</strong>. Résolution 10 m (on lit une piste, un bâtiment, un convoi — pas une voiture
        isolée), images fraîches datées honnêtement. La couche « Sentinel-2 » apparaît sur la carte
        une fois la clé posée.
      </p>
      {st?.error ? <p className="font-mono text-xs text-crit">{st.error}</p> : null}
      {!st?.configured ? (
        <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-3 text-xs text-muted-foreground">
          <p className="text-fg">Brancher la clé Copernicus (gratuite)</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Créer un compte gratuit sur dataspace.copernicus.eu, puis un client OAuth
              (Sentinel Hub &gt; User settings &gt; OAuth clients).
            </li>
            <li>Démarrer le poste avec les deux identifiants :</li>
          </ol>
          <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
            AFRICONTROL_SENTINEL_ID=&lt;client id&gt; AFRICONTROL_SENTINEL_SECRET=&lt;secret&gt; npm run dev
          </pre>
          <p>Lecture seule : le poste lit des images publiques, il ne commande aucun satellite.</p>
        </div>
      ) : null}
    </section>
  );
}

function LinkStatusCard() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof linkStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    linkStatus()
      .then(setSt)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    // Relevé Internet coupé : pas de requête de test sans qu'on la demande.
    lireReleveInternet()
      .then((e) => {
        if (e.actif) run();
      })
      .catch(() => undefined);
  }, []);
  const tone = !st ? "default" : st.reachable === st.total ? "ok" : st.online ? "warn" : "crit";
  const label = !st ? "…" : st.reachable === st.total ? "en ligne" : st.online ? "partiel" : "hors ligne";
  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Liaison Internet · wifi / Starlink / Thuraya</h2>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <Button size="sm" variant="outline" disabled={busy} onClick={run}>
            {busy ? "Test…" : "Tester la liaison"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Le poste utilise le lien Internet actif de l'OS (wifi opérateur, Starlink ou Thuraya). Ce test
        dit s'il atteint ses sources. <strong>Hors ligne</strong> : l'imagerie live ne charge pas — le
        poste retombe sur la mosaïque locale (installer les packs de tuiles). <strong>Partiel</strong> :
        un domaine est bloqué par un pare-feu (voir la liste des domaines dans LIREMOI).
      </p>
      {st ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {st.probes.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-fg">{p.label}</p>
                {p.ok ? (
                  <p className="text-xs text-muted-foreground">joignable{p.ms != null ? ` · ${p.ms} ms` : ""}{p.status ? ` · HTTP ${p.status}` : ""}</p>
                ) : (
                  <p className="text-xs text-warn">injoignable{p.error ? ` · ${p.error}` : ""}</p>
                )}
              </div>
              <Badge tone={p.ok ? "ok" : "crit"}>{p.ok ? "OK" : "KO"}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Relevé Internet du poste, sur décision du chef : activé (comme à la livraison) ou coupé — plus
 * rien ne sort du poste pour le relevé. « Relever maintenant » : un relevé, à l'ordre du chef.
 */
function ReleveInternetSection() {
  const { isSuperadmin } = useStaff();
  const [etat, setEtat] = useState<EtatReleveEcran | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = useWallClock();

  useEffect(() => {
    let vivant = true;
    const lire = () => {
      lireReleveInternet()
        .then((e) => vivant && setEtat(e))
        .catch(() => undefined);
    };
    lire();
    const id = window.setInterval(lire, 5000);
    return () => {
      vivant = false;
      window.clearInterval(id);
    };
  }, []);

  const basculer = () => {
    if (!etat) return;
    const actif = !etat.actif;
    const t0 = performance.now();
    setOccupe(true);
    basculerReleveInternet({ data: { actif } })
      .then((e) => {
        setEtat(e);
        setMsg(
          `Relevé Internet ${actif ? "activé" : "coupé"} en ${Math.round(performance.now() - t0)} ms${e.enregistrement === "memoire" ? " — disque en lecture seule : valable jusqu'au redémarrage" : ""}.`,
        );
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  const relever = () => {
    setOccupe(true);
    setMsg("Relevé en cours…");
    releverMaintenant()
      .then((e) => {
        setEtat(e);
        setMsg(
          `Relevé fait en ${e.ms.toLocaleString("fr-FR")} ms : ${e.dernier ? `${e.dernier.recues}/${e.dernier.sources} sources Internet reçues` : "aucune source reçue"}.`,
        );
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  const d = etat?.dernier;
  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Relevé Internet du poste</h2>
        <div className="flex items-center gap-2">
          <Badge tone={!etat ? "default" : etat.actif ? "ok" : "warn"}>
            {!etat ? "…" : etat.actif ? "activé" : "coupé"}
          </Badge>
          <Button size="sm" variant="outline" disabled={!isSuperadmin || occupe || !etat} onClick={basculer}>
            {etat?.actif === false ? "Activer" : "Couper"}
          </Button>
          <Button size="sm" disabled={!isSuperadmin || occupe} onClick={relever}>
            Relever maintenant
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Coupé à la livraison : le chef de division l'active. Activé, le poste relève ses sources
        Internet — ADS-B des agrégateurs, METAR, TAF, SIGMET, météo spatiale, phénomènes — toutes les
        20 s au plus, console ouverte ou bot. Coupé, plus rien ne sort du poste pour le relevé :
        l'image garde l'antenne du poste et le dernier relevé,
        qui vieillit à vue, et ce qui ne vient que d'Internet est dit{" "}
        {"«\u00a0non reçu\u00a0». «\u00a0Relever maintenant\u00a0»"} : un relevé, un seul, à l'ordre
        du chef. Chaque geste va au journal.
      </p>
      <p className="text-xs">
        {d
          ? `Dernier relevé : ${new Date(d.at).toISOString().slice(11, 19)} Z, il y a ${dureeLisible(now - d.at)} · ${d.recues}/${d.sources} sources Internet reçues`
          : "Aucun relevé Internet depuis le démarrage du poste."}
        {etat?.ordreA ? ` · dernier ordre du chef : ${new Date(etat.ordreA).toISOString().slice(11, 19)} Z` : ""}
      </p>
      {d && d.erreurs.length > 0 ? <p className="text-xs text-warn">{d.erreurs.join(" · ")}</p> : null}
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      {!isSuperadmin ? (
        <p className="text-[11px] text-muted-foreground">Couper, activer, relever : chef de division seul.</p>
      ) : null}
    </section>
  );
}

function DiagnosticSection({ onGoTab }: { onGoTab: (id: Tab) => void }) {
  const [rows, setRows] = useState<DiagRow[] | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    setBusy(true);
    setErr(null);
    posteDiagnostic()
      .then((r) => {
        setRows(r.rows);
        setAt(r.at);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "diagnostic échoué"))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    run();
  }, []);

  // Action corrective par source : aller à l'onglet de réglage, ou défiler vers la section clé.
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const actionFor = (id: string): { label: string; run: () => void } | null => {
    switch (id) {
      case "antenne":
        return { label: "Régler l'antenne", run: () => onGoTab("antenne") };
      case "atc":
        return { label: "Ouvrir Phonie ATC", run: () => onGoTab("phonie") };
      case "ia":
        return { label: "Régler le serveur IA", run: () => scrollTo("diag-ia") };
      case "sentinel":
        return { label: "Configurer la clé", run: () => scrollTo("diag-sentinel") };
      default:
        return null;
    }
  };

  const toneOf = (s: DiagRow["state"]) => (s === "ok" ? "ok" : s === "crit" ? "crit" : s === "warn" ? "warn" : "default");
  const labelOf = (s: DiagRow["state"]) =>
    s === "ok" ? "répond" : s === "crit" ? "en échec" : s === "warn" ? "rien / vieux" : "non réglé";
  const crit = rows?.filter((r) => r.state === "crit").length ?? 0;
  const warn = rows?.filter((r) => r.state === "warn").length ?? 0;

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Diagnostic du poste · sources réelles</h2>
        <div className="flex items-center gap-2">
          {rows ? (
            <Badge tone={crit > 0 ? "crit" : warn > 0 ? "warn" : "ok"}>
              {crit > 0 ? `${crit} en échec` : warn > 0 ? `${warn} à surveiller` : "tout répond"}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={run}>
            {busy ? "…" : "Rafraîchir"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        État honnête de chaque source : ce que le poste a réellement reçu au dernier relevé, l'état de
        l'antenne et de la phonie, la présence des clés. N'interroge pas les API (aucun martèlement).
        « 0 contact » est un vrai constat là où le réseau public n'a pas de récepteur, pas une panne.
      </p>
      {err ? <p className="font-mono text-xs text-crit">{err}</p> : null}
      {rows ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {rows.map((r) => {
            const act = r.state === "ok" ? null : actionFor(r.id);
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {act ? (
                    <Button size="sm" variant="outline" onClick={act.run}>
                      {act.label}
                    </Button>
                  ) : null}
                  <Badge tone={toneOf(r.state)}>{labelOf(r.state)}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {at ? (
        <p className="text-[11px] text-muted-foreground">
          Relevé du diagnostic : {new Date(at).toLocaleTimeString("fr-FR")}.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Les limites de l'assistant, dites à l'opérateur avant qu'il ne pose sa question. Les chiffres
 * viennent de ia-limites, que le serveur applique : l'écran ne promet que ce que fait le serveur.
 */
function LimitesIa() {
  return (
    <div className="grid gap-3 rounded-sm border border-border bg-bg/60 p-3 text-xs text-muted-foreground md:grid-cols-3">
      <div>
        <p className="mb-1 font-medium text-fg">Ce qu'il voit</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Les commandes du poste qu'il consulte lui-même selon la question (/situation,
            /urgences, /trafic, /piste, /meteo, /soleil, /phenomenes, /capteurs…), seulement
            celles activées pour la console, « non reçu » compris.
          </li>
          <li>Jusqu'à {IA_CONTACTS_VUS} contacts 1090 les plus proches de FTTJ, avec leur distance.</li>
          <li>La piste ciblée, quand la question part de son dossier.</li>
          <li>
            Les extraits de la notice du poste qui répondent à la question (≤ {IA_NOTICE_BUDGET}{" "}
            caractères).
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-medium text-fg">Ce qu'il ne voit pas</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Les images des caméras et des drones, la phonie ATC.</li>
          <li>Le journal et l'historique : seul le dernier relevé lui est donné.</li>
          <li>
            Internet : seulement si le chef a activé /recherche et que la question le demande
            (« cherche en ligne… ») ; la requête envoyée est montrée et journalisée, et jamais un
            contact du relevé ni des coordonnées.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-medium text-fg">Ce qu'il ne fait pas</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Commander un capteur ou émettre : réception seule.</li>
          <li>Identifier une personne : ni visage, ni plaque.</li>
          <li>Décider : il propose, l'opérateur valide.</li>
          <li>
            Garantir ses dires : un indicatif, une adresse ICAO ou une immatriculation cités sans
            appui dans les données sont signalés sous la réponse — les identifiants sont vérifiés,
            pas le raisonnement.
          </li>
          <li>
            Question de {IA_QUESTION_MAX} caractères au plus ; abandon après {IA_DELAI_S} s.
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Pendant que le serveur du poste rédige : le temps écoulé, pour voir que rien n'est figé. */
function Redaction({ depuis }: { depuis: number }) {
  const now = useWallClock();
  const s = Math.max(0, Math.round((now - depuis) / 1000));
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      Réponse en préparation… {s} s (abandon à {IA_DELAI_S} s)
    </p>
  );
}

/** Une réponse de l'assistant : texte vérifié, temps mesuré, extraits de la notice. */
function ReponseAssistantVue({ rep, duree }: { rep: ReponseAssistant; duree: number | null }) {
  // Sans IA, la console répond quand même : faits du relevé et passages de la notice.
  const sansIa = !rep.ok && (rep.faits.length > 0 || rep.notice.length > 0);
  return (
    <div className="space-y-2">
      {rep.ok ? (
        <ReponseIa texte={rep.text} className="text-sm" />
      ) : sansIa ? (
        <p className="text-xs text-muted-foreground">
          {rep.error} — réponse sans IA, sans rédaction : les valeurs reçues et la notice du poste.
        </p>
      ) : (
        <p className="text-sm text-warn">{rep.error}</p>
      )}
      {!rep.ok && rep.faits.length > 0 ? (
        <div className="rounded-sm border border-border bg-bg/60 p-2 text-xs">
          <p className="text-muted-foreground">
            Ce que disent les capteurs — dernier relevé, valeurs reçues, sans interprétation
          </p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">
            {rep.faits.join("\n")}
          </pre>
        </div>
      ) : null}
      {rep.competences.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Commandes consultées : <span className="font-mono">{rep.competences.join(", ")}</span>
        </p>
      ) : null}
      {rep.ok && duree != null ? (
        <p className="text-[11px] text-muted-foreground">
          Réponse en {duree.toFixed(1)} s
          {rep.notice.length > 0
            ? ` · ${rep.notice.length} extrait${rep.notice.length > 1 ? "s" : ""} de la notice joint${rep.notice.length > 1 ? "s" : ""} à la question`
            : ""}
          .
        </p>
      ) : null}
      {!rep.ok && !sansIa ? (
        <p className="text-xs text-muted-foreground">
          Ni la notice du poste ni le dernier relevé ne répondent à cette question.
        </p>
      ) : null}
      {rep.notice.length > 0 ? (
        <details open={!rep.ok} className="rounded-sm border border-border bg-bg/60 p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {rep.ok
              ? "Extraits de la notice joints à la question"
              : "Ce que dit la notice du poste — recherche locale, pas une réponse d'IA"}
          </summary>
          <div className="mt-2 space-y-3">
            {rep.notice.map((p, i) => (
              <div key={`${i}-${p.titre}`}>
                <p className="font-medium text-fg">{p.titre}</p>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {p.texte}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Le résultat d'une commande du poste : ses lignes telles quelles, et le temps qu'elle a pris. */
function ResultatCommandeVue({ res, allerRetour }: { res: ResultatCommande; allerRetour: number }) {
  return (
    <div className="space-y-2">
      <pre
        className={cn(
          "whitespace-pre-wrap rounded-sm border border-border bg-bg/60 p-2 font-mono text-[11px] leading-relaxed",
          res.ok ? "text-fg" : "text-warn",
        )}
      >
        {res.lignes.join("\n")}
      </pre>
      <p className="text-[11px] text-muted-foreground">
        {res.commande ? `/${res.commande} · ` : ""}exécutée sur le poste en{" "}
        {res.ms.toLocaleString("fr-FR")} ms · aller-retour {Math.round(allerRetour)} ms.
      </p>
    </div>
  );
}

function AssistantSection({ bascules }: { bascules: Bascules }) {
  const { isSuperadmin } = useStaff();
  const [forcage, setForcage] = useState(false);
  const [st, setSt] = useState<{
    configured: boolean;
    ok: boolean;
    error: string | null;
    modele: string | null;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [q, setQ] = useState("");
  const [rep, setRep] = useState<ReponseAssistant | null>(null);
  const [depuis, setDepuis] = useState<number | null>(null);
  const [duree, setDuree] = useState<number | null>(null);
  const [res, setRes] = useState<{ r: ResultatCommande; allerRetour: number } | null>(null);
  const [choix, setChoix] = useState(0);
  const [fermees, setFermees] = useState(false);
  const propositions = useMemo(
    () => (fermees ? [] : suggestions(q, "console", bascules)),
    [q, bascules, fermees],
  );

  const test = () => {
    setTesting(true);
    iaStatus()
      .then(setSt)
      .catch((e: unknown) =>
        setSt({ configured: true, ok: false, error: e instanceof Error ? e.message : "échec", modele: null }),
      )
      .finally(() => setTesting(false));
  };
  useEffect(() => {
    test();
  }, []);

  // Une ligne qui commence par « / » est une commande du poste : réponse en millisecondes.
  const commander = (texte: string) => {
    const t0 = performance.now();
    lancerCommande({ data: { texte } })
      .then((r) => {
        setRep(null);
        setRes({ r, allerRetour: performance.now() - t0 });
      })
      .catch((e: unknown) =>
        setRes({
          r: {
            ok: false,
            commande: null,
            lignes: [e instanceof Error ? e.message : "commande échouée"],
            ms: 0,
          },
          allerRetour: performance.now() - t0,
        }),
      );
  };

  // Ordre du chef : la requête que le filtre a retenue sort quand même (journal : critique).
  const forcer = (requete: string) => {
    const t0 = performance.now();
    setForcage(true);
    forcerRecherche({ data: { requete } })
      .then((r) => setRes({ r, allerRetour: performance.now() - t0 }))
      .catch((e: unknown) =>
        setRes({
          r: { ok: false, commande: "recherche", lignes: [e instanceof Error ? e.message : "refusé"], ms: 0 },
          allerRetour: performance.now() - t0,
        }),
      )
      .finally(() => setForcage(false));
  };

  // Compléter la saisie avec une commande proposée ; la lancer si elle n'attend rien.
  const completer = (c: Commande) => {
    const attend = c.argument?.startsWith("<") === true;
    setQ(`/${c.nom}${attend ? " " : ""}`);
    setChoix(0);
    if (!attend) commander(`/${c.nom}`);
  };

  const ask = () => {
    const question = q.trim();
    if (!question || depuis != null) return;
    if (question.startsWith("/")) {
      commander(question);
      return;
    }
    setRes(null);
    const t0 = Date.now();
    setDepuis(t0);
    askAssistant({ data: { question } })
      .then(setRep)
      .catch((e: unknown) =>
        setRep({
          ok: false,
          error: e instanceof Error ? e.message : "assistant échoué",
          notice: [],
          faits: [],
          competences: [],
        }),
      )
      .finally(() => {
        setDuree((Date.now() - t0) / 1000);
        setDepuis(null);
      });
  };

  const tone = !st ? "default" : !st.configured ? "warn" : st.ok ? "ok" : "crit";
  const label = !st
    ? "…"
    : !st.configured
      ? "serveur à régler"
      : st.ok
        ? `prêt · ${st.modele ?? "modèle ?"}`
        : "en échec";

  return (
    <section id="diag-ia" className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Assistant IA du poste · serveur sur place</h2>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <Button size="sm" variant="outline" disabled={testing} onClick={test}>
            {testing ? "…" : "Tester le serveur"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Question libre sur l'image live ou sur l'usage de la console. Elle part du serveur du poste
        vers <strong>ton</strong> serveur de modèle, sur le réseau du poste : ni la question, ni
        l'image, ni les bulletins ne vont à un service public. Pour une question d'usage, la notice
        du poste (LIREMOI) est cherchée sur place et jointe. Sans serveur d'IA, la console répond
        quand même, sans rédiger : les passages de la notice, et pour une question sur l'image live
        les valeurs brutes du dernier relevé.
      </p>
      <LimitesIa />
      {st?.error ? <p className="font-mono text-xs text-crit">{st.error}</p> : null}
      <div className="flex gap-2">
        <Input
          value={q}
          maxLength={IA_QUESTION_MAX}
          onChange={(e) => {
            setQ(e.target.value);
            setChoix(0);
            setFermees(false);
          }}
          onKeyDown={(e) => {
            const n = propositions.length;
            if (n > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setChoix((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (n > 0 && e.key === "Tab") {
              e.preventDefault();
              setQ(`/${propositions[choix % n]!.nom} `);
              setChoix(0);
            } else if (n > 0 && e.key === "Escape") {
              setFermees(true);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Mot de commande pas encore complet (« /me ») : la proposition choisie.
              const exact = propositions.some(
                (c) => `/${c.nom}` === q.trim() || c.alias.some((a) => `/${a}` === q.trim()),
              );
              if (n > 0 && !exact) completer(propositions[choix % n]!);
              else ask();
            }
          }}
          placeholder={
            st?.configured
              ? "Question, ou « / » pour une commande — ex. /situation"
              : "ex. Comment inscrire le numéro du bot Signal ? — ou /aide"
          }
          aria-label="Question à l'assistant ou commande du poste"
          aria-autocomplete="list"
          aria-expanded={propositions.length > 0}
          aria-controls="commandes-proposees"
        />
        <Button type="button" onClick={ask} disabled={depuis != null || !q.trim()}>
          {depuis != null ? "…" : "Demander"}
        </Button>
      </div>
      {propositions.length > 0 ? (
        <ul
          id="commandes-proposees"
          role="listbox"
          aria-label="Commandes du poste"
          className="max-h-56 overflow-y-auto rounded-sm border border-border bg-bg/80 py-1 text-xs"
        >
          {propositions.map((c, i) => {
            const active = commandeActive(c, "console", bascules);
            return (
              <li
                key={c.nom}
                role="option"
                aria-selected={i === choix % propositions.length}
                className={cn(
                  "flex cursor-pointer items-baseline gap-2 px-2 py-1",
                  i === choix % propositions.length ? "bg-surface" : "",
                  active ? "" : "opacity-60",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  completer(c);
                }}
              >
                <span className="font-mono text-fg">
                  /{c.nom}
                  {c.argument ? ` ${c.argument}` : ""}
                </span>
                <span className="text-muted-foreground">{c.resume}</span>
                {active ? null : <span className="ml-auto text-warn">désactivée</span>}
              </li>
            );
          })}
        </ul>
      ) : null}
      {depuis != null ? <Redaction depuis={depuis} /> : null}
      {res ? <ResultatCommandeVue res={res.r} allerRetour={res.allerRetour} /> : null}
      {res?.r.forcable && isSuperadmin ? (
        <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-3 text-xs">
          <p className="text-warn">
            Le filtre de souveraineté a retenu cette requête. La faire sortir peut révéler ce que suit
            le poste, ou où il est : elle partira telle quelle vers les moteurs publics, et ira au
            journal en sévérité critique, avec son texte.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={forcage}
            onClick={() => forcer(res.r.forcable!)}
          >
            {forcage ? "Recherche…" : "Faire sortir sur ordre du chef"}
          </Button>
        </div>
      ) : null}
      {rep && depuis == null ? <ReponseAssistantVue rep={rep} duree={duree} /> : null}
      {!st?.configured ? (
        <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-3 text-xs text-muted-foreground">
          <p className="text-fg">Brancher un serveur de modèle sur le réseau du poste</p>
          <p>
            Le plus simple : le script de préparation installe Ollama, choisit le modèle selon la
            mémoire, et écrit AFRICONTROL_IA dans poste.env, que le serveur relit seul au démarrage.
          </p>
          <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
            {"bash scripts/poste/preparer-poste.sh\n" +
              "powershell -ExecutionPolicy Bypass -File scripts\\poste\\preparer-poste.ps1"}
          </pre>
          <p>
            À la main : tout serveur compatible OpenAI (Ollama, llama.cpp, vLLM, LM Studio), son
            adresse au lancement — AFRICONTROL_IA=http://127.0.0.1:11434/v1 — et, au besoin,
            AFRICONTROL_IA_MODELE. Une adresse hors du réseau du poste est refusée avant tout envoi.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Commandes du poste : chacune activée ou non, pour la console et pour le bot Signal. Le chef de
 * division bascule ; l'effet est immédiat et le changement va au journal.
 */
function CommandesSection({
  etat,
  onChange,
}: {
  etat: EtatBascules | null;
  onChange: (e: EtatBascules) => void;
}) {
  const { isSuperadmin } = useStaff();
  const [occupe, setOccupe] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const bascules = etat?.bascules ?? {};

  const basculer = (c: Commande, canal: Canal) => {
    const actif = !commandeActive(c, canal, bascules);
    const t0 = performance.now();
    setOccupe(`${c.nom}:${canal}`);
    basculerCommande({ data: { nom: c.nom, canal, actif } })
      .then((e) => {
        onChange(e);
        setMsg(
          `/${c.nom} ${actif ? "activée" : "désactivée"} pour ${LIBELLE_CANAL[canal]} en ${Math.round(performance.now() - t0)} ms${e.enregistrement === "memoire" ? " — disque en lecture seule : valable jusqu'au redémarrage" : ""}.`,
        );
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(null));
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Commandes du poste · console et bot Signal</h2>
        <Badge tone={etat ? "ok" : "default"}>
          {!etat ? "…" : etat.enregistrement === "fichier" ? "enregistrées sur le poste" : "jusqu'au redémarrage"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Tape « / » dans l'assistant : chaque commande répond en quelques millisecondes depuis l'image
        du poste, sans réseau ni modèle. Certaines partent désactivées pour le bot (positions des
        contacts, marquage militaire) : {isSuperadmin ? "toi seul, chef de division, les actives" : "seul le chef de division les active"}, et chaque bascule est
        écrite au journal.
      </p>
      <p className="text-xs text-muted-foreground">
        /recherche fait sortir la requête du poste, par le moteur SearXNG du poste
        (AFRICONTROL_RECHERCHE) : désactivée partout à la livraison. Une requête qui nomme un
        contact du relevé ou contient des coordonnées est refusée ; chaque recherche va au journal.
      </p>
      {msg ? <p className="font-mono text-xs text-muted-foreground">{msg}</p> : null}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Commande</th>
            <th className="py-1 font-normal">Console</th>
            <th className="py-1 font-normal">Bot Signal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {COMMANDES.map((c) => (
            <tr key={c.nom}>
              <td className="py-1.5 pr-2">
                <span className="font-mono text-fg">/{c.nom}</span>{" "}
                <span className="text-muted-foreground">{c.resume}</span>
              </td>
              {(["console", "bot"] as const).map((canal) => {
                const actif = commandeActive(c, canal, bascules);
                return (
                  <td key={canal} className="py-1.5 pr-2">
                    <Button
                      size="sm"
                      variant={actif ? "outline" : "ghost"}
                      aria-pressed={actif}
                      aria-label={`/${c.nom} pour ${LIBELLE_CANAL[canal]}`}
                      disabled={!isSuperadmin || c.fixe === true || !etat || occupe != null}
                      onClick={() => basculer(c, canal)}
                    >
                      <span className={actif ? "text-ok" : "text-muted-foreground"}>
                        {c.fixe ? "toujours" : actif ? "activée" : "désactivée"}
                      </span>
                    </Button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Bot Signal du poste : son réglage (poste.env), son état, ses derniers échanges et leurs temps.
 * Le chef de division l'active ou le coupe ; l'effet est immédiat et va au journal.
 */
function BotSignalSection() {
  const { isSuperadmin } = useStaff();
  const [etat, setEtat] = useState<EtatBot | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState("");
  const [inscription, setInscription] = useState({ numero: "", captcha: "", voix: false, code: "", pin: "", nom: "AfriControl" });
  const [codeDemande, setCodeDemande] = useState(false);
  /** Le code d'appairage, rendu au seul chef qui l'a demandé : jamais relu du serveur. */
  const [appairage, setAppairage] = useState<{ numero: string; code: string; expireA: number } | null>(null);
  const now = useWallClock();

  const appairer = (id: string, numero: string) => {
    const t0 = performance.now();
    setOccupe(true);
    appairerBotSignal({ data: { id } })
      .then((r) => {
        setEtat(r.etat);
        setAppairage({ numero, code: r.code, expireA: r.expireA });
        setMsg(`Code d'appairage pour ${numero} en ${Math.round(performance.now() - t0)} ms.`);
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  const inscrire = (etape: "code" | "valider") => {
    const t0 = performance.now();
    setOccupe(true);
    inscrireBotSignal({ data: { etape, ...inscription } })
      .then((r) => {
        setEtat(r.etat);
        setMsg(`${r.message} (${Math.round(performance.now() - t0)} ms)`);
        if (r.ok && etape === "code") setCodeDemande(true);
        if (r.ok && etape === "valider") {
          setCodeDemande(false);
          setInscription((x) => ({ ...x, captcha: "", code: "", pin: "" }));
        }
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  const gerer = (action: ActionNumero, valeur: string, libelle: string) => {
    const t0 = performance.now();
    setOccupe(true);
    gererNumeroBot({ data: { action, valeur } })
      .then((e) => {
        setEtat(e);
        if (action === "ajouter") setNouveau("");
        setMsg(`${libelle} en ${Math.round(performance.now() - t0)} ms.`);
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  useEffect(() => {
    let vivant = true;
    const lire = () => {
      lireBotSignal()
        .then((e) => vivant && setEtat(e))
        .catch(() => undefined);
    };
    lire();
    const id = window.setInterval(lire, 3000);
    return () => {
      vivant = false;
      window.clearInterval(id);
    };
  }, []);

  const basculer = () => {
    if (!etat) return;
    const actif = !etat.actif;
    const t0 = performance.now();
    setOccupe(true);
    basculerBotSignal({ data: { actif } })
      .then((e) => {
        setEtat(e);
        setMsg(
          `Bot ${actif ? "activé" : "coupé"} en ${Math.round(performance.now() - t0)} ms${e.enregistrement === "memoire" ? " — disque en lecture seule : valable jusqu'au redémarrage" : ""}.`,
        );
      })
      .catch((err: unknown) => setMsg(err instanceof Error ? err.message : "refusé"))
      .finally(() => setOccupe(false));
  };

  const reglage = etat?.reglage;
  const statut: { tone: "default" | "ok" | "warn" | "crit"; texte: string } = !etat
    ? { tone: "default", texte: "…" }
    : !etat.actif
      ? { tone: "default", texte: "coupé" }
      : reglage && "erreur" in reglage
        ? { tone: "warn", texte: "réglage incomplet" }
        : etat.erreur
          ? { tone: "crit", texte: "en panne" }
          : { tone: "ok", texte: "à l'écoute" };
  const c = etat?.compteurs;

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 col-span-2 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Bot Signal du poste</h2>
        <Badge tone={statut.tone}>{statut.texte}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Un numéro autorisé envoie une commande (« /situation ») au téléphone du poste : le bot
        l'exécute ici et répond à l'expéditeur seul, par le relais Signal du poste. Un numéro
        inconnu ou un groupe n'a aucune réponse ; seules les commandes activées pour le bot, dans
        le tableau ci-dessus, répondent. Coupé à la livraison :{" "}
        {isSuperadmin ? "toi seul, chef de division, l'actives" : "seul le chef de division l'active"},
        et chaque bascule comme chaque commande reçue va au journal.
      </p>
      {reglage ? (
        "erreur" in reglage ? (
          <p className="text-sm text-warn">
            {reglage.erreur} À régler dans poste.env, puis redémarrer le serveur.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Téléphone du poste</dt>
            <dd className="font-mono">{reglage.numero}</dd>
            <dt className="text-muted-foreground">Numéros autorisés</dt>
            <dd className="font-mono">{reglage.autorises}</dd>
            <dt className="text-muted-foreground">Relais</dt>
            <dd className="font-mono">
              {reglage.relais}
              {etat?.mode ? ` · mode ${etat.mode}` : ""}
            </dd>
          </dl>
        )
      ) : null}
      {etat && isSuperadmin ? (
        <details className="rounded border border-border/60 p-3 text-xs" open={etat.sourceNumero == null}>
          <summary className="cursor-pointer font-medium">
            Numéro propre au bot{" "}
            <span className="font-normal text-muted-foreground">
              {etat.sourceNumero
                ? `— ${"erreur" in etat.reglage ? "" : etat.reglage.numero} (${etat.sourceNumero})`
                : "— à inscrire"}
            </span>
          </summary>
          <p className="mt-2 text-muted-foreground">
            Le bot a son propre numéro, inscrit chez Signal par le relais du poste : aucun téléphone
            relié, qui verrait tous les messages de son compte. Il faut une puce qui reçoit un SMS
            ou un appel ; un numéro déjà utilisé par Signal sur un téléphone en serait déconnecté.
          </p>
          <div className="mt-2 grid gap-2">
            <Input
              value={inscription.numero}
              onChange={(ev) => setInscription({ ...inscription, numero: ev.target.value })}
              placeholder="Numéro du bot : +235… ou 00235…"
              aria-label="Numéro propre au bot"
              className="max-w-xs font-mono"
              maxLength={24}
            />
            {!codeDemande ? (
              <>
                <p className="text-muted-foreground">
                  1. Résoudre le captcha de Signal sur{" "}
                  <a
                    className="underline"
                    href="https://signalcaptchas.org/registration/generate"
                    target="_blank"
                    rel="noreferrer"
                  >
                    signalcaptchas.org
                  </a>
                  . Le lien « Ouvrez Signal » paraît 2 s après : clic droit ou appui long, « Copier
                  l'adresse du lien », puis le coller ici (« signalcaptcha://… », valable quelques
                  minutes).
                </p>
                <Input
                  value={inscription.captcha}
                  onChange={(ev) => setInscription({ ...inscription, captcha: ev.target.value })}
                  placeholder="signalcaptcha://…"
                  aria-label="Lien du captcha Signal"
                  className="font-mono"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={inscription.voix}
                    onChange={(ev) => setInscription({ ...inscription, voix: ev.target.checked })}
                  />
                  Code par appel vocal plutôt que par SMS
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={occupe || !inscription.numero.trim() || !inscription.captcha.trim()}
                  onClick={() => inscrire("code")}
                >
                  Recevoir le code
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">2. Le code reçu, puis le nom que Signal montrera.</p>
                <Input
                  value={inscription.code}
                  onChange={(ev) => setInscription({ ...inscription, code: ev.target.value })}
                  placeholder="Code à six chiffres"
                  aria-label="Code d'inscription reçu"
                  className="max-w-xs font-mono"
                  maxLength={12}
                />
                <Input
                  value={inscription.pin}
                  onChange={(ev) => setInscription({ ...inscription, pin: ev.target.value })}
                  placeholder="PIN Signal (seulement si le numéro en a un)"
                  aria-label="PIN Signal"
                  className="max-w-xs font-mono"
                  maxLength={32}
                />
                <Input
                  value={inscription.nom}
                  onChange={(ev) => setInscription({ ...inscription, nom: ev.target.value })}
                  placeholder="Nom du profil : AfriControl"
                  aria-label="Nom du profil du bot"
                  className="max-w-xs"
                  maxLength={26}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={occupe || !inscription.code.trim()}
                    onClick={() => inscrire("valider")}
                  >
                    Valider l'inscription
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={occupe} onClick={() => setCodeDemande(false)}>
                    Redemander un code
                  </Button>
                </div>
              </>
            )}
          </div>
        </details>
      ) : null}
      {etat ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Numéros autorisés — ceux de poste.env sont toujours écoutés ; ceux ajoutés ici le sont
            une fois activés par le chef
          </h3>
          {appairage && now <= appairage.expireA ? (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
              <p>
                Code d'appairage pour {appairage.numero} :{" "}
                <span className="font-mono text-base">
                  {appairage.code.slice(0, 3)} {appairage.code.slice(3)}
                </span>{" "}
                — valable jusqu'à {new Date(appairage.expireA).toISOString().slice(11, 16)} Z.
              </p>
              <p className="text-muted-foreground">
                Depuis ce téléphone, envoyer au bot : « appairer {appairage.code} ». Le bot le
                reconnaîtra ensuite par son compte Signal, même numéro masqué. Une seule fois ; trois
                codes faux l'annulent.
              </p>
            </div>
          ) : null}
          {etat.numeros.length > 0 ? (
            <ul className="divide-y divide-border/60 text-xs">
              {etat.numeros.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="font-mono">{n.numero}</span>
                  <span className="text-muted-foreground">{n.source}</span>
                  <span className={n.actif ? "text-ok" : "text-muted-foreground"}>
                    {n.actif ? "écouté" : "coupé"}
                  </span>
                  {n.surSignal === false ? (
                    <span className="basis-full text-warn">
                      Introuvable sur Signal : le bot ne saura pas que ses messages viennent de lui.
                      Sur ce téléphone, Signal › Confidentialité › Numéro de téléphone › « Qui peut me
                      trouver par mon numéro » : « Tout le monde » (le numéro reste caché à qui ne
                      l'a pas).
                    </span>
                  ) : null}
                  {n.appaire ? <span className="text-ok">appairé</span> : null}
                  {n.source === "console" ? (
                    <span className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!isSuperadmin || occupe}
                        onClick={() => appairer(n.id, n.numero)}
                      >
                        Appairer
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!isSuperadmin || occupe}
                        onClick={() =>
                          gerer(n.actif ? "couper" : "activer", n.id, `${n.numero} ${n.actif ? "coupé" : "activé"}`)
                        }
                      >
                        {n.actif ? "Couper" : "Activer"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!isSuperadmin || occupe}
                        onClick={() => gerer("retirer", n.id, `${n.numero} retiré`)}
                      >
                        Retirer
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Aucun numéro autorisé.</p>
          )}
          {isSuperadmin ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                gerer("ajouter", nouveau, "Numéro ajouté, coupé : à activer quand il le faut,");
              }}
            >
              <Input
                value={nouveau}
                onChange={(ev) => setNouveau(ev.target.value)}
                placeholder="+235… ou 00235…"
                aria-label="Numéro à autoriser"
                className="max-w-xs font-mono"
                maxLength={24}
              />
              <Button type="submit" size="sm" variant="outline" disabled={occupe || !nouveau.trim()}>
                Ajouter (coupé)
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={etat?.actif ? "outline" : "default"}
          disabled={!isSuperadmin || !etat || occupe}
          onClick={basculer}
        >
          {occupe ? "…" : etat?.actif ? "Couper le bot" : "Activer le bot"}
        </Button>
        {msg ? <span className="font-mono text-xs text-muted-foreground">{msg}</span> : null}
      </div>
      {etat?.erreur ? (
        <p className="text-sm text-crit">
          {formatClock(etat.erreur.at)} · {etat.erreur.texte}
        </p>
      ) : null}
      {c ? (
        <p className="font-mono text-xs text-muted-foreground">
          reçus {c.recus} · exécutées {c.executees} · réponses remises {c.reponses} · ignorés{" "}
          {c.ignores} · envois en échec {c.echecsEnvoi}
          {/* En json-rpc, le relais ne se manifeste qu'aux messages : son « dernier contact »
              vieillit sans rien dire de sa santé, la websocket ouverte, si. */}
          {etat?.mode?.startsWith("json-rpc")
            ? etat.ecoute && !etat.erreur
              ? " · websocket du relais ouverte"
              : ""
            : etat?.dernierContact
              ? ` · relais vu il y a ${formatAge(now - etat.dernierContact)}`
              : ""}
        </p>
      ) : null}
      {etat && etat.echanges.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Heure</th>
              <th className="py-1 font-normal">De</th>
              <th className="py-1 font-normal">Commande</th>
              <th className="py-1 font-normal">Sur le poste</th>
              <th className="py-1 font-normal">Remise au relais</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 font-mono">
            {etat.echanges.map((x, i) => (
              // Plusieurs échanges peuvent tomber dans la même milliseconde : le rang départage.
              <tr key={`${x.at}-${i}`}>
                <td className="py-1 pr-2">{formatClock(x.at)}</td>
                <td className="py-1 pr-2">{x.de}</td>
                <td className={cn("py-1 pr-2", x.ok ? "text-fg" : "text-warn")}>{x.commande}</td>
                <td className="py-1 pr-2">
                  {x.commande === "—" ? "—" : `${x.ms.toLocaleString("fr-FR")} ms`}
                </td>
                <td className={cn("py-1 pr-2", x.erreurEnvoi ? "text-crit" : "")}>
                  {x.envoiMs != null ? `${x.envoiMs} ms` : x.erreurEnvoi}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {etat && etat.ignores.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {etat.ignores.map((i, n) => (
            <li key={`${i.at}-${n}`}>
              <span className="font-mono">
                {formatClock(i.at)} · {i.de}
              </span>{" "}
              ignoré : {i.raison}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Le poste exécute en millisecondes ; le trajet par Signal ajoute le reste. Relais en mode
        native (celui du script) : relevé en continu, un message attend 1 à 3 s avant d'être lu, et
        celui envoyé pendant que le bot est coupé attend sur les serveurs de Signal (au-delà de
        5 min, il est dit trop ancien, pas exécuté). Relais en mode json-rpc : poussé aussitôt,
        envois cinq fois plus rapides, mais un message arrivé bot coupé est perdu. Au-delà de
        3 500 caractères, la réponse est coupée : la suite à la console.
      </p>
    </section>
  );
}

function ToolsPanel({ onGoTab }: { onGoTab: (id: Tab) => void }) {
  const { isSuperadmin } = useStaff();
  const [commandes, setCommandes] = useState<EtatBascules | null>(null);
  useEffect(() => {
    lireCommandes()
      .then(setCommandes)
      .catch(() => setCommandes(null));
  }, []);
  const [hex, setHex] = useState("");
  const [lookup, setLookup] = useState<AircraftLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [brief, setBrief] = useState<{ text: string; competences: string[] } | null>(null);
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
          militaire: "inconnu",
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
        if (r.ok) setBrief({ text: r.text, competences: r.competences });
        else setBriefErr(r.error);
      })
      .catch((e: unknown) =>
        setBriefErr(e instanceof Error ? e.message : "briefing échoué"),
      )
      .finally(() => setBriefing(false));
  };

  return (
    <div className="grid gap-4 grid-cols-2">
      <ReleveInternetSection />
      <LinkStatusCard />
      <DiagnosticSection onGoTab={onGoTab} />
      <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">Registre ICAO24 · adsbdb + adsb.lol</h2>
        <p className="text-sm text-muted-foreground">
          Registre en ligne d'un avion : type, immatriculation, propriétaire (adsbdb), marquage
          militaire (adsb.lol, s'il suit l'avion en ce moment). La requête nomme l'avion et sort du
          poste : <strong>chef de division seul</strong>, chaque requête au journal. Même code que
          /registre.
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
            disabled={!isSuperadmin || looking || hex.replace(/[^0-9a-f]/gi, "").length !== 6}
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
                <dt className="text-muted-foreground">Marquage militaire</dt>
                <dd>{lookup.militaire}</dd>
                <dt className="text-muted-foreground">Allocation OACI</dt>
                <dd>{icaoNation(lookup.hex) ?? "—"}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Statut</dt>
                <dd className="text-warn">{lookup.error}</dd>
                <dt className="text-muted-foreground">Marquage militaire</dt>
                <dd>{lookup.militaire}</dd>
              </>
            )}
          </dl>
        ) : null}
        {lookup?.ok ? (
          <p className="text-[11px] text-muted-foreground">
            Reçu (registre en ligne) : Internet, non vérifié, pas des données capteurs.
          </p>
        ) : null}
        {!isSuperadmin ? (
          <p className="text-[11px] text-muted-foreground">Réservé au chef de division.</p>
        ) : null}
      </section>
      <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
        <h2 className="text-sm font-medium">Briefing situation</h2>
        <p className="text-sm text-muted-foreground">
          Synthèse du dernier relevé par l'IA du poste (serveur sur place), à partir des
          commandes du poste activées pour la console. Demande explicite, une fois.
        </p>
        <Button type="button" onClick={runBrief} disabled={briefing}>
          {briefing ? "Rédaction…" : "Briefing chef de division"}
        </Button>
        {briefErr ? <p className="text-sm text-warn">{briefErr}</p> : null}
        {brief ? (
          <>
            <ReponseIa texte={brief.text} className="text-sm" />
            <p className="text-[11px] text-muted-foreground">
              Commandes consultées :{" "}
              <span className="font-mono">{brief.competences.join(", ")}</span>
            </p>
          </>
        ) : null}
      </section>
      <ArchivesSection />
      <SentinelSection />
      <AssistantSection bascules={commandes?.bascules ?? {}} />
      <CommandesSection etat={commandes} onChange={setCommandes} />
      <BotSignalSection />
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
