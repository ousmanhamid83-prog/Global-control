import { useEffect, useState } from "react";
import { Clock, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatClock, formatDate } from "@/lib/vigilair/format";
import { ROLE_LABEL, TEAM_LABEL, type StaffRole, type StaffTeam } from "@/lib/vigilair/staff";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import {
  closeWatch,
  handoverWatch,
  listWatches,
  openWatch,
  updateWatchNote,
} from "@/lib/vigilair/watch-ops";
import {
  formatWatchDuration,
  snapFromPicture,
  snapLine,
  type WatchShiftRow,
  type WatchSnap,
} from "@/lib/vigilair/watch";
import { cn } from "@/lib/utils";

function copExtras() {
  const s = useVigilair.getState();
  return {
    instruction: s.instruction,
    tracks: s.tracks.filter((t) => t.idState !== "perdu").length,
    unacked: s.alerts.filter((a) => !a.acked).length,
    locked: s.tracks.filter((t) => t.locked).length,
  };
}

function roleOf(v: string): string {
  return ROLE_LABEL[v as StaffRole] ?? v;
}

function teamOf(v: string): string {
  return TEAM_LABEL[v as StaffTeam] ?? v;
}

export function QuartView() {
  const { profile } = useStaff();
  const watch = useVigilair((s) => s.watch);
  const watchLoaded = useVigilair((s) => s.watchLoaded);
  const pic = useVigilair((s) => s.livePicture);
  const now = useVigilair((s) => s.now);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"open" | "handover" | "close" | "note" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<WatchShiftRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const reloadHistory = () => {
    listWatches()
      .then(setHistory)
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    reloadHistory();
  }, [watch?.id, watch?.status]);

  useEffect(() => {
    setNote(watch?.noteIn ?? "");
  }, [watch?.id]);

  const liveSnap = snapFromPicture(pic, copExtras());
  const mine = Boolean(profile && watch && watch.openedBy === profile.userId);
  const vacant = watchLoaded && !watch;

  const run = async (kind: "open" | "handover" | "close" | "note") => {
    setBusy(kind);
    setErr(null);
    const payload = { ...copExtras(), note, snap: liveSnap };
    try {
      const row =
        kind === "open"
          ? await openWatch({ data: payload })
          : kind === "handover"
            ? await handoverWatch({ data: payload })
            : kind === "close"
              ? await closeWatch({ data: payload })
              : await updateWatchNote({ data: { note } });
      useVigilair.setState({
        watch: row.status === "open" ? row : null,
        watchLoaded: true,
      });
      if (kind === "close") setNote("");
      reloadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec quart");
    } finally {
      setBusy(null);
    }
  };

  const held =
    watch && Number.isFinite(Date.parse(watch.openedAt))
      ? now - Date.parse(watch.openedAt)
      : 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Partie 10 · Quart de veille
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Prise de poste · Relève · AAR réel
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Un quart ouvert à la fois. À la prise, VIGILAIR gele le tableau
            capteurs réel (1090ES, METAR FTTJ, SIGMET, Kp, RWY, soleil WAT).
            La relève clôture l'AAR du sortant et ouvre le gel du rentrant.
            Le mode veille du COP (bouton Veille) est distinct : il garde le
            poste live sans gel idle, imagerie ≤ 50 m, réveil auto. Pas de
            piste inventée : un silence 1090 sur N'Djamena est le réel.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            k="Quart"
            v={
              !watchLoaded
                ? "…"
                : watch
                  ? `${formatWatchDuration(held)}`
                  : "vacant"
            }
            tone={watch ? "ok" : "warn"}
          />
          <Stat k="Titulaire" v={watch ? watch.openedLabel : "—"} />
          <Stat
            k="1090 au gel"
            v={watch ? String(watch.snapIn.ac) : "—"}
            tone={watch && watch.snapIn.emergency ? "crit" : "default"}
          />
          <Stat
            k="FTTJ au gel"
            v={watch?.snapIn.cat ?? (watch ? "sans METAR" : "—")}
            tone={
              watch?.snapIn.cat === "VFR"
                ? "ok"
                : watch?.snapIn.cat === "MVFR"
                  ? "warn"
                  : watch?.snapIn.cat
                    ? "crit"
                    : "default"
            }
          />
        </div>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          {!watchLoaded ? (
            <div className="h-24 animate-pulse rounded-md bg-secondary/40" />
          ) : vacant ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge tone="warn">
                  <Clock className="mr-1 size-3" />
                  Salle vide
                </Badge>
                <p className="text-sm text-muted-foreground">
                  Personne n'a pris le quart. Le COP tourne, le journal de
                  relève est vide.
                </p>
              </div>
              <LiveNow snap={liveSnap} />
            </div>
          ) : watch ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ok">
                  <Shield className="mr-1 size-3" />
                  En quart
                </Badge>
                <p className="text-sm font-medium">{watch.openedLabel}</p>
                <span className="text-xs text-muted-foreground">
                  {roleOf(watch.openedRole)} · {teamOf(watch.openedTeam)} · depuis{" "}
                  {formatDate(Date.parse(watch.openedAt) || now)} WAT ·{" "}
                  {formatWatchDuration(held)}
                </span>
                {mine ? <Badge>Vous</Badge> : null}
              </div>
              {watch.noteIn ? (
                <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
                  Consigne : {watch.noteIn}
                </p>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <SnapCard title="Gel d'ouverture" snap={watch.snapIn} />
                <SnapCard title="Capteurs maintenant" snap={liveSnap} live />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="watch-note" className="text-xs text-muted-foreground">
              Consigne de relève (faits capteurs, pas de fiction)
            </label>
            <textarea
              id="watch-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 800))}
              rows={4}
              placeholder="Ex. METAR FTTJ TS, 0 squitter ident, SIGMET Afrique orage, Kp calme. Consignes au rentrant."
              className="min-h-24 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-fg placeholder:text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">{note.length}/800</p>
          </div>

          {err ? (
            <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-warn">
              {err}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {vacant ? (
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("open")}
              >
                {busy === "open" ? "Enregistrement…" : "Prendre le poste"}
              </Button>
            ) : null}
            {watch && !mine ? (
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("handover")}
              >
                {busy === "handover" ? "Relève…" : "Relève — je prends"}
              </Button>
            ) : null}
            {watch && mine ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("note")}
              >
                {busy === "note" ? "…" : "Mettre à jour la consigne"}
              </Button>
            ) : null}
            {watch && (mine || profile?.role === "superadmin") ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("close")}
              >
                {busy === "close" ? "Clôture…" : "Clôturer sans relève"}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">AAR — quarts précédents</h2>
          <p className="text-sm text-muted-foreground">
            Chaque clôture ou relève verse un compte-rendu factuel : delta 1090,
            METAR, SIGMET, Kp, consignes. Append-only.
          </p>
          {history.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-sm text-muted-foreground">
              Aucun quart versé. Première prise de poste = premier gel.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((w) => {
                const opened = Date.parse(w.openedAt);
                const closed = w.closedAt ? Date.parse(w.closedAt) : now;
                const dur =
                  Number.isFinite(opened) && Number.isFinite(closed)
                    ? closed - opened
                    : 0;
                const open = openId === w.id;
                return (
                  <li
                    key={w.id}
                    className="rounded-lg border border-border bg-surface px-4 py-3"
                  >
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                      onClick={() => setOpenId(open ? null : w.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={w.status === "open" ? "ok" : "default"}>
                          {w.status === "open" ? "ouvert" : "clos"}
                        </Badge>
                        <span className="text-sm font-medium">{w.openedLabel}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatWatchDuration(dur)}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {Number.isFinite(opened) ? formatDate(opened) : "—"}
                      </span>
                    </button>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {snapLine(w.snapIn)}
                    </p>
                    {open && w.aar ? (
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-xs leading-relaxed text-fg">
                        {w.aar}
                      </pre>
                    ) : open ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        AAR à la clôture.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function LiveNow({ snap }: { snap: WatchSnap }) {
  return <SnapCard title="Capteurs maintenant (pas encore gelés)" snap={snap} live />;
}

function SnapCard({
  title,
  snap,
  live = false,
}: {
  title: string;
  snap: WatchSnap;
  live?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {snap.at ? formatClock(snap.at) : "—"} WAT
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <KV k="1090ES" v={`${snap.ac} · ident ${snap.local}`} />
        <KV k="Urgences / MIL / B6" v={`${snap.emergency} / ${snap.military} / ${snap.uav}`} />
        <KV k="FTTJ CAT" v={snap.cat ?? "—"} />
        <KV k="RWY" v={snap.rwy ? `${snap.rwy}${snap.rwyM ? ` · ${snap.rwyM} m` : ""}` : "—"} />
        <KV k="SIGMET AO" v={String(snap.sigmetAo)} />
        <KV k="Kp / GOES" v={`${snap.kp ?? "—"} · ${snap.xray ?? "—"}`} />
        <KV k="Soleil" v={snap.night ? "Nuit" : "Jour"} />
        <KV k="Flux" v={`${snap.fluxOk}/${snap.fluxN}`} />
      </dl>
      {snap.metarFttj ? (
        <p className="truncate font-mono text-xs text-muted-foreground">
          {snap.metarFttj.replace(/^METAR\s+/, "")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {live ? "METAR FTTJ en attente d'ingest." : "METAR FTTJ absent au gel — réel."}
        </p>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="font-mono text-sm tabular-nums">{v}</dd>
    </div>
  );
}

function Stat({
  k,
  v,
  tone = "default",
}: {
  k: string;
  v: string;
  tone?: "default" | "ok" | "warn" | "crit";
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-lg tabular-nums",
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
