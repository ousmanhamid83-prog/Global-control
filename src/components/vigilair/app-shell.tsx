import { Link, useRouterState } from "@tanstack/react-router";
import { Clock, Pause, Play, Radio, RadioTower } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AlertRelay } from "@/components/vigilair/alert-relay";
import { DutyWatch } from "@/components/vigilair/duty-watch";
import { EvidenceSync } from "@/components/vigilair/evidence-sync";
import { ConsoleStatus } from "@/components/vigilair/console-status";
import { ReplayBar } from "@/components/vigilair/replay-bar";
import { SituationBar } from "@/components/vigilair/situation-bar";
import { InstallPoste } from "@/components/vigilair/install-poste";
import { StewardDesk, StewardWatch } from "@/components/vigilair/steward-watch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { PosteChip } from "@/components/vigilair/poste-chip";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { computePosture, postureLabel } from "@/lib/vigilair/defense";
import { formatClock } from "@/lib/vigilair/format";
import { countFriends } from "@/lib/vigilair/friends";
import { countLive } from "@/lib/vigilair/live-adsb";
import { countM4 } from "@/lib/vigilair/iff";
import { PPI_RANGES, type PpiRangeKm } from "@/lib/vigilair/ppi";
import { detectRaids } from "@/lib/vigilair/raid";
import { useStaff } from "@/lib/vigilair/staff-context";
import { bootVigilair, useVigilair } from "@/lib/vigilair/store";
import { formatWatchDuration, shortWatchLabel } from "@/lib/vigilair/watch";
import { cn } from "@/lib/utils";

type NavTo =
  | "/"
  | "/radar"
  | "/tableau"
  | "/ident"
  | "/iff"
  | "/capteurs"
  | "/zones"
  | "/trace"
  | "/quart"
  | "/audio"
  | "/catalogue"
  | "/journal"
  | "/sentinelle"
  | "/division";

type NavItem = { to: NavTo; label: string };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Poste",
    items: [
      { to: "/", label: "Situation" },
      { to: "/radar", label: "Radar" },
      { to: "/tableau", label: "Tableau" },
    ],
  },
  {
    label: "Détection",
    items: [
      { to: "/ident", label: "Ident" },
      { to: "/iff", label: "IFF" },
      { to: "/capteurs", label: "Capteurs" },
      { to: "/zones", label: "Bulles" },
      { to: "/trace", label: "Trace" },
    ],
  },
  {
    label: "Garde",
    items: [
      { to: "/quart", label: "Quart" },
      { to: "/audio", label: "SIGINT" },
      { to: "/catalogue", label: "Signatures" },
      { to: "/journal", label: "Journal" },
      { to: "/sentinelle", label: "Sentinelle" },
      { to: "/division", label: "Division" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <div className="flex h-dvh flex-col bg-bg text-fg">
        <header className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Logo />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">AfriControl</p>
            <p className="text-xs text-muted-foreground">Chargement du poste…</p>
          </div>
        </header>
        <div className="h-11 border-b border-border" />
        <div className="flex-1 bg-bg" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return <ShellBody>{children}</ShellBody>;
}

function ShellBody({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const now = useVigilair((s) => s.now);
  const running = useVigilair((s) => s.running);
  const tracks = useVigilair((s) => s.tracks);
  const alerts = useVigilair((s) => s.alerts);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const setRunning = useVigilair((s) => s.setRunning);
  const setEwArmed = useVigilair((s) => s.setEwArmed);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const setPpi = useVigilair((s) => s.setPpi);
  const scrubReplay = useVigilair((s) => s.scrubReplay);
  const seekReplay = useVigilair((s) => s.seekReplay);
  const returnToLive = useVigilair((s) => s.returnToLive);
  const setShowFriends = useVigilair((s) => s.setShowFriends);
  const setShowLive = useVigilair((s) => s.setShowLive);
  const cycleThreatFloor = useVigilair((s) => s.cycleThreatFloor);
  const cycleIffFilter = useVigilair((s) => s.cycleIffFilter);
  const requestM4 = useVigilair((s) => s.requestM4);
  const { isSuperadmin } = useStaff();
  const [botOpen, setBotOpen] = useState(false);

  const instruction = useVigilair((s) => s.instruction);
  const watch = useVigilair((s) => s.watch);
  const watchLoaded = useVigilair((s) => s.watchLoaded);
  const copLock = useVigilair((s) => s.copLock);
  const zonePicture = useVigilair((s) => s.zonePicture);
  const frozen = Boolean(copLock?.locked);
  const freezeUi =
    frozen &&
    pathname !== "/sentinelle" &&
    pathname !== "/division" &&
    pathname !== "/zones";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bootVigilair();
    setReady(true);
  }, []);

  useEffect(() => {
    // Dernière façon d'atteindre une commande : souris ou clavier (Tab). Chrome marque tout
    // focus « visible » dès qu'une touche est pressée, donc :focus-visible ne suffit pas ici.
    let viaPointer = true;
    const onPointer = () => {
      viaPointer = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        viaPointer = false;
        return;
      }
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        // Commande atteinte au clavier : Espace l'active, comme partout. Après un clic souris,
        // Espace reste la pause du flux.
        if (!viaPointer && el?.closest("button, a, [role='button'], summary")) {
          return;
        }
        e.preventDefault();
        useVigilair.getState().setRunning(!useVigilair.getState().running);
        return;
      }
      if (e.key === "l" || e.key === "L") {
        const id = useVigilair.getState().selectedId;
        if (id) lockTrack(id);
        return;
      }
      if (e.key === "Escape") {
        lockTrack(null);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrubReplay(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrubReplay(1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        seekReplay(0, false);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        returnToLive();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        const st = useVigilair.getState();
        st.setShowFriends(!st.showFriends);
        return;
      }
      if (e.key === "a" || e.key === "A") {
        const st = useVigilair.getState();
        st.setShowLive(!st.showLive);
        return;
      }
      if (e.key === "t" || e.key === "T") {
        useVigilair.getState().cycleThreatFloor();
        return;
      }
      if (e.key === "i" || e.key === "I") {
        useVigilair.getState().cycleIffFilter();
        return;
      }
      if (e.key === "m" || e.key === "M") {
        if (useVigilair.getState().copLock?.locked) return;
        const id = useVigilair.getState().selectedId;
        if (id) requestM4(id);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= PPI_RANGES.length) {
        setPpi({ rangeKm: PPI_RANGES[n - 1] as PpiRangeKm });
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [lockTrack, setPpi, scrubReplay, seekReplay, returnToLive, setShowFriends, setShowLive, cycleThreatFloor, cycleIffFilter, requestM4]);

  const live = tracks.filter((t) => t.idState !== "perdu").length;
  const unacked = alerts.filter((a) => !a.acked).length;
  const friends = countFriends(tracks);
  const live1090 = countLive(tracks);
  const m4 = countM4(tracks);
  const full =
    pathname === "/" ||
    pathname === "/ident" ||
    pathname === "/radar" ||
    pathname === "/iff";
  const { posture } = computePosture(tracks);
  const raids = detectRaids(tracks);
  const postureTone =
    posture === "menace" || raids.length > 0 ? "crit" : posture === "alerte" ? "warn" : "ok";

  return (
    <div className="console-grid relative flex h-dvh min-w-[1280px] flex-col overflow-hidden text-fg">
      <AlertRelay />
      <DutyWatch />
      <StewardWatch />
      <EvidenceSync />
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
        <div className="flex shrink-0 items-center gap-3">
          <Logo />
          <div className="leading-none">
            <p className="font-display text-[17px] font-bold uppercase tracking-[0.22em] text-fg">
              AfriControl
            </p>
            <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              COP · FTTJ N'Djamena · silencieux
            </p>
          </div>
        </div>
        <div className="h-8 w-px shrink-0 bg-border" aria-hidden />
        {/* Badges sur deux rangs au besoin : jamais au point de pousser les commandes hors de l'écran. */}
        <div className="flex max-h-14 min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden py-1 whitespace-nowrap">
          <Badge tone={instruction ? "warn" : "ok"}>{instruction ? "Exercice" : "Réel"}</Badge>
          {watchLoaded ? (
            <Badge tone={watch ? "ok" : "warn"}>
              <Clock className="mr-1 size-3" />
              {watch
                ? `${shortWatchLabel(watch.openedLabel)} · ${formatWatchDuration(now - (Date.parse(watch.openedAt) || now))}`
                : "Quart vacant"}
            </Badge>
          ) : null}
          <Badge tone={postureTone}>{postureLabel(posture)}</Badge>
          {zonePicture.some((z) => z.level === "intrusion") ? (
            <Badge tone="crit">Bulle</Badge>
          ) : zonePicture.some((z) => z.level === "approche") ? (
            <Badge tone="warn">Bulle</Badge>
          ) : null}
          {friends.n > 0 ? <Badge tone="ok">Amis {friends.n}</Badge> : null}
          {m4.valid > 0 ? <Badge tone="ok">M4+ {m4.valid}</Badge> : null}
          {m4.invalid > 0 ? <Badge tone="crit">M4- {m4.invalid}</Badge> : null}
          {unacked > 0 ? <Badge tone="crit">{unacked} alertes</Badge> : null}
          {raids.length > 0 ? <Badge tone="crit">Raid {raids[0].count}</Badge> : null}
          {frozen ? <Badge tone="crit">COP figé</Badge> : null}
          <Badge>
            <Radio className="mr-1 size-3" />
            {live} pistes
          </Badge>
          {live1090.n > 0 ? <Badge tone="ok">1090 {live1090.n}</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="mr-2 flex flex-col items-end leading-none">
            <span className="font-mono text-[15px] font-semibold tabular-nums text-fg">
              {ready ? formatClock(now) : "--:--:--"}
              <span className="ml-1 text-[10px] font-medium text-muted-foreground">WAT</span>
            </span>
            <span className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
              {ready ? new Date(now).toISOString().slice(11, 19) : "--:--:--"} Z
            </span>
          </div>
          {isSuperadmin ? (
            <Button
              variant={botOpen ? "default" : "outline"}
              size="sm"
              onClick={() => setBotOpen((v) => !v)}
            >
              Bot
            </Button>
          ) : null}
          {isSuperadmin ? (
            <Button
              variant={ewArmed ? "default" : "outline"}
              size="sm"
              onClick={() => setEwArmed(!ewArmed)}
              aria-label={ewArmed ? "Désarmer le brouillage" : "Armer le brouillage défensif"}
            >
              <RadioTower />
              {ewArmed ? "RF armé" : "RF off"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRunning(!running)}
            aria-label={running ? "Pause du flux" : "Reprendre le flux"}
          >
            {running ? <Pause /> : <Play />}
            {running ? "Pause" : "Flux"}
          </Button>
          <InstallPoste variant="header" />
          <PosteChip />
        </div>
      </header>
      {isSuperadmin && botOpen ? (
        <div className="absolute inset-x-0 top-14 z-40 max-h-[70dvh] overflow-y-auto border-b border-border bg-bg p-3">
          <StewardDesk />
        </div>
      ) : null}

      <nav className="flex h-11 shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg/90 px-2">
        {GROUPS.map((group, gi) => (
          <div
            key={group.label}
            className={cn("flex items-stretch", gi > 0 && "ml-2 border-l border-border pl-2")}
          >
            <span className="flex items-center pr-2 pl-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {group.label}
            </span>
            {group.items.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center border-b-2 px-2.5 font-display text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150",
                    active
                      ? "border-primary bg-secondary/70 text-fg"
                      : "border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <SituationBar />
      {pathname === "/tableau" ? null : <ReplayBar />}

      <div
        className={cn(
          "min-h-0 flex-1",
          full ? "flex flex-col overflow-hidden" : "overflow-y-auto",
          freezeUi && "pointer-events-none select-none",
        )}
        aria-disabled={freezeUi || undefined}
      >
        {children}
      </div>
      <ConsoleStatus />
    </div>
  );
}

function Logo() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-9 shrink-0 text-primary"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.12" />
      <circle
        cx="16"
        cy="16"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle
        cx="16"
        cy="16"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M16 7v4M16 21v4M7 16h4M21 16h4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}
