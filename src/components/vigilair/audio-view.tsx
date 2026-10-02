import { Link } from "@tanstack/react-router";
import { Mic, MicOff, Radio, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { channelLabel, spectrogramColumn } from "@/lib/vigilair/acoustics";
import { PLATFORM_BY_ID } from "@/lib/vigilair/catalog";
import { sopForTrack } from "@/lib/vigilair/defense";
import { formatClock, threatTone } from "@/lib/vigilair/format";
import { SENSOR_SITES } from "@/lib/vigilair/sensors";
import { sigintStreams } from "@/lib/vigilair/sigint";
import { sortTracks, useVigilair } from "@/lib/vigilair/store";
import type { AudioClip, Track } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

function token(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function AudioView() {
  const tracks = useVigilair((s) => s.tracks);
  const selectedId = useVigilair((s) => s.selectedId);
  const select = useVigilair((s) => s.select);
  const listening = useVigilair((s) => s.listening);
  const setListening = useVigilair((s) => s.setListening);
  const listenWide = useVigilair((s) => s.listenWide);
  const setListenWide = useVigilair((s) => s.setListenWide);
  const recordClip = useVigilair((s) => s.recordClip);
  const clips = useVigilair((s) => s.clips);

  const live = sortTracks(tracks.filter((t) => t.idState !== "perdu"));
  const track = live.find((t) => t.id === selectedId) ?? live[0] ?? null;

  useEffect(() => {
    if (track && track.id !== selectedId) select(track.id);
  }, [track, selectedId, select]);

  useEffect(() => () => {
    setListening(false);
    setListenWide(false);
  }, [setListening, setListenWide]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Écoute SIGINT
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Écoute offensive de tout ce qui concerne l'objet : BPF, analogique
          FPV, télémétrie, métadonnées RF, Remote ID, gonio de la source de
          commandement. Jamais de prise de contrôle. Jamais d'émission.
        </p>
      </header>
      <SigintDesk />
      <div className="grid gap-4 grid-cols-[240px_minmax(0,1fr)_300px]">
        <div className="overflow-y-auto">
          <TrackPicker tracks={live} selectedId={track?.id ?? null} onSelect={select} />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <SpectroPanel track={track} listening={listening} wide={listenWide} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant={listening ? "default" : "outline"}
              onClick={() => setListening(!listening)}
              disabled={!track?.acoustic?.locked && !listenWide}
            >
              {listening ? <MicOff /> : <Mic />}
              {listening ? "Couper l'écoute" : "Écouter le BPF"}
            </Button>
            <Button
              variant={listenWide ? "default" : "outline"}
              onClick={() => setListenWide(!listenWide)}
              disabled={!track}
            >
              <Radio />
              {listenWide ? "Écoute large ON" : "Écoute offensive"}
            </Button>
            <Button
              variant="outline"
              onClick={() => track && recordClip(track.id)}
              disabled={!track || (!track.acoustic?.locked && !listenWide)}
            >
              <Square />
              Enregistrer 8 s
            </Button>
            <Link
              to="/"
              className="inline-flex h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-fg"
            >
              Retour situation
            </Link>
          </div>
        </div>
        <div>
          <InterceptDossier track={track} clips={clips} />
        </div>
      </div>
    </div>
  );
}

function SigintDesk() {
  const alerts = useVigilair((s) => s.alerts);
  const ackAlert = useVigilair((s) => s.ackAlert);
  const ackSigint = useVigilair((s) => s.ackSigint);
  const select = useVigilair((s) => s.select);
  const [filter, setFilter] = useState<"open" | "acked" | "all">("open");
  const rows = alerts.filter((a) => a.domain === "sigint");
  const openN = rows.filter((a) => !a.acked).length;
  const shown = rows.filter((a) =>
    filter === "open" ? !a.acked : filter === "acked" ? a.acked : true,
  );
  return (
    <section className="rounded-lg border border-border bg-surface hud" data-sigint-alerts="1">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Gestion des alertes</h2>
        <span className="font-mono text-xs text-muted-foreground">{openN} ouvertes</span>
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          {(
            [
              ["open", "Ouvertes"],
              ["acked", "Acquittées"],
              ["all", "Toutes"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "h-8 rounded-md px-2 text-xs",
                filter === id ? "bg-secondary text-fg" : "text-muted-foreground hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={ackSigint} disabled={openN === 0}>
            Acquitter
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {filter === "open"
            ? "Aucune alerte SIGINT ouverte. Un verrou d'écoute — BPF, FPV, Remote ID, GNSS, SATCOM — s'inscrit ici. Pas d'émission."
            : "Rien dans ce filtre."}
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
              <Badge tone={threatTone(a.level)}>{a.level}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.body}</p>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{formatClock(a.at)}</span>
              <Button variant="outline" size="sm" onClick={() => select(a.trackId)}>
                Piste
              </Button>
              {a.acked ? (
                <span className="text-xs text-muted-foreground">acquittée</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => ackAlert(a.id)}>
                  Acquitter
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackPicker({
  tracks,
  selectedId,
  onSelect,
}: {
  tracks: Track[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface hud">
      {tracks.length === 0 ? (
        <li className="p-4 text-sm text-muted-foreground">Aucune piste.</li>
      ) : (
        tracks.map((t) => {
          const plat = PLATFORM_BY_ID[t.hypotheses[0]?.platformId ?? t.truePlatformId];
          const lock = t.acoustic?.locked;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-3 text-left text-sm",
                  selectedId === t.id ? "bg-secondary" : "hover:bg-secondary/50",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    lock ? "bg-ok" : "bg-muted",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs">{t.callsign}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {lock
                      ? `${t.acoustic?.bpfHz} Hz · ${channelLabel(t.acoustic!.channel)}`
                      : plat
                        ? `${plat.name} · hors ACO`
                        : "hors ACO"}
                  </span>
                </span>
              </button>
            </li>
          );
        })
      )}
    </ul>
  );
}

function SpectroPanel({
  track,
  listening,
  wide,
}: {
  track: Track | null;
  listening: boolean;
  wide: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hist = useRef<number[][]>([]);

  useEffect(() => {
    hist.current = [];
    if (track) {
      for (let i = 0; i < 90; i++) hist.current.push(spectrogramColumn(track, 56));
    }
  }, [track?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const loop = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = token("--color-bg", "#09090b");
      const ok = token("--color-ok", "#7d9b86");
      const muted = token("--color-muted", "#71717a");
      const border = token("--color-border", "#27272a");
      if (track) {
        hist.current.push(spectrogramColumn(track, 56));
        if (hist.current.length > 160) hist.current.shift();
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const cols = hist.current;
      const bins = 56;
      const cw = w / 160;
      const ch = h / bins;
      for (let x = 0; x < cols.length; x++) {
        const col = cols[x]!;
        for (let y = 0; y < bins; y++) {
          const v = col[y] ?? 0;
          ctx.globalAlpha = 0.15 + v * 0.85;
          ctx.fillStyle = ok;
          ctx.fillRect(x * cw, h - (y + 1) * ch, cw + 0.5, ch + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = border;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.fillStyle = muted;
      ctx.font = "400 10px 'IBM Plex Mono', monospace";
      ctx.fillText("400 Hz", 8, 14);
      ctx.fillText("0 Hz", 8, h - 8);
      if (track?.acoustic?.locked) {
        ctx.fillText(`${track.acoustic.bpfHz} Hz`, w - 64, 14);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [track]);

  useListen(track, listening, wide);

  const vu = track?.acoustic?.locked
    ? Math.min(100, 20 + track.acoustic.snrDb * 2)
    : 4;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface hud">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="font-mono text-xs text-muted-foreground">
          {track ? `${track.callsign} · waterfall ACO` : "pas de piste"}
        </p>
        <Badge tone={track?.acoustic?.locked ? "ok" : "default"}>
          {track?.acoustic?.locked ? `SNR ${track.acoustic.snrDb} dB` : "NO LOCK"}
        </Badge>
      </div>
      <canvas
        ref={canvasRef}
        className="block w-full h-64"
        aria-label="Spectrogramme acoustique"
      />
      <div className="flex items-center gap-3 px-3 py-2">
        <Radio className="size-3.5 text-muted-foreground" />
        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-secondary">
          <div
            className="h-full bg-ok transition-[width] duration-150"
            style={{ width: `${vu}%` }}
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {track?.acoustic ? `${track.acoustic.splDb} dB SPL` : "—"}
        </span>
      </div>
    </div>
  );
}

function useListen(track: Track | null, listening: boolean, wide: boolean) {
  const ac = track?.acoustic;
  useEffect(() => {
    const want = (listening && ac?.locked) || (wide && track);
    if (!want) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = ac?.locked ? ac.bpfHz : 88;
    const og = ctx.createGain();
    og.gain.value = ac?.locked ? 0.12 : 0.04;
    osc.connect(og).connect(master);
    osc.start();

    const h2 = ctx.createOscillator();
    h2.type = "triangle";
    h2.frequency.value = ac?.locked ? ac.harmonics[1] : 240;
    const hg = ctx.createGain();
    hg.gain.value = ac?.locked ? 0.05 : 0.02;
    h2.connect(hg).connect(master);
    h2.start();

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const ng = ctx.createGain();
    ng.gain.value =
      ac?.channel === "analog-fpv" ? 0.08 : wide && !ac?.locked ? 0.06 : 0.03;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = ac?.channel === "analog-fpv" ? 1800 : ac?.bpfHz ?? 1400;
    bp.Q.value = 1.2;
    noise.connect(bp).connect(ng).connect(master);
    noise.start();

    return () => {
      osc.stop();
      h2.stop();
      noise.stop();
      void ctx.close();
    };
  }, [listening, wide, ac?.locked, ac?.bpfHz, ac?.channel, track?.id]);
}

function InterceptDossier({
  track,
  clips,
}: {
  track: Track | null;
  clips: AudioClip[];
}) {
  const recs = useMemo(() => (track ? sopForTrack(track) : []), [track]);
  const streams = useMemo(() => (track ? sigintStreams(track) : []), [track]);
  const plat = track
    ? PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId]
    : undefined;
  const ac = track?.acoustic;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 hud">
      {!track ? (
        <p className="text-sm text-muted-foreground">Sélectionnez une piste.</p>
      ) : (
        <>
          <div>
            <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
            <h2 className="text-base font-semibold">
              {plat ? `${plat.manufacturer} ${plat.name}` : "Non identifié"}
            </h2>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row k="Canal" v={ac ? channelLabel(ac.channel) : "—"} />
            <Row k="BPF" v={ac ? `${ac.bpfHz} Hz` : "—"} mono />
            <Row
              k="Azimuts ACO"
              v={
                ac?.bearings.length
                  ? ac.bearings
                      .map((b) => {
                        const s = SENSOR_SITES.find((x) => x.id === b.siteId);
                        return `${s?.name ?? b.siteId} ${Math.round(b.deg)}°`;
                      })
                      .join(" · ")
                  : "—"
              }
            />
            <Row
              k="CPA"
              v={
                track.cpa
                  ? `${track.cpa.name} ${track.cpa.distKm.toFixed(1)} km`
                  : "—"
              }
              mono
            />
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ac?.channelNote}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Écoute offensive : tout canal concernant l'objet. Pas de
            transcription, pas d'injection C2, pas de prise de contrôle.
          </p>
          {track.pilotFix ? (
            <p className="text-xs text-muted-foreground">
              Gonio opérateur · qualité {Math.round(track.pilotFix.quality)} % ·{" "}
              {track.pilotFix.method}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pas de gonio poste de pilotage (hors RF ou chasse habitée).
            </p>
          )}
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Canaux SIGINT
            </h3>
            <ul className="space-y-2">
              {streams.map((s) => (
                <li key={s.id} className="rounded-sm bg-secondary px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{s.label}</span>
                    <Badge
                      tone={
                        s.state === "lock"
                          ? "ok"
                          : s.state === "denied"
                            ? "crit"
                            : "default"
                      }
                    >
                      {s.state === "lock"
                        ? "Lock"
                        : s.state === "denied"
                          ? "Refus"
                          : "Scan"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Conduite défensive
            </h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {recs.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Clips
        </h3>
        {clips.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun enregistrement.</p>
        ) : (
          <ul className="space-y-1">
            {clips.slice(0, 8).map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-sm bg-secondary px-2 py-2 text-xs"
              >
                <span className="font-mono">
                  {c.callsign} · {c.bpfHz} Hz
                </span>
                <span className="text-muted-foreground">{formatClock(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono text-xs tabular-nums" : "text-xs"}>{v}</dd>
    </div>
  );
}
