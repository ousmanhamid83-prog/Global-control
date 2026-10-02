import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Clock,
  Fingerprint,
  KeyRound,
  Laptop,
  LayoutDashboard,
  MapPinned,
  Menu,
  Mic,
  Pause,
  Play,
  Radar,
  Radio,
  RadioTower,
  Satellite,
  Scan,
  ScrollText,
  Target,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertRelay } from "@/components/vigilair/alert-relay";
import { DutyWatch } from "@/components/vigilair/duty-watch";
import { EvidenceSync } from "@/components/vigilair/evidence-sync";
import { CombatBanner } from "@/components/vigilair/combat-banner";
import { GuardBanner } from "@/components/vigilair/guard-banner";
import { ReplayBar } from "@/components/vigilair/replay-bar";
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

type NavItem = { to: NavTo; label: string; icon: LucideIcon };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Poste",
    items: [
      { to: "/", label: "Situation", icon: Activity },
      { to: "/radar", label: "Radar", icon: Scan },
      { to: "/tableau", label: "Tableau", icon: LayoutDashboard },
    ],
  },
  {
    label: "Détection",
    items: [
      { to: "/ident", label: "Ident", icon: Radar },
      { to: "/iff", label: "IFF", icon: Fingerprint },
      { to: "/capteurs", label: "Capteurs", icon: Satellite },
      { to: "/zones", label: "Bulles", icon: Target },
      { to: "/trace", label: "Trace", icon: MapPinned },
    ],
  },
  {
    label: "Garde",
    items: [
      { to: "/quart", label: "Quart", icon: Clock },
      { to: "/audio", label: "SIGINT", icon: Mic },
      { to: "/catalogue", label: "Signatures", icon: BookOpen },
      { to: "/journal", label: "Journal", icon: ScrollText },
      { to: "/sentinelle", label: "Sentinelle", icon: Laptop },
      { to: "/division", label: "Division", icon: KeyRound },
    ],
  },
];

const NAV = GROUPS.flatMap((g) => g.items);

const PARAMS = [
  ["Intendant", "chaque option, chef seulement"],
  ["Feu", "détection à la seconde, dès l'ouverture"],
  ["Feu naturel", "front, ou point VIIRS sur la carte"],
  ["FIRMS", "VIIRS ≤ 2 h · pixel 375 m"],
  ["Couches", "vis · IR · thermique · nuit · relief"],
  ["Émission", "aucune — le poste n'émet pas"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <div className="flex h-dvh flex-col bg-bg text-fg">
        <header className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Logo />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">VIGILAIR</p>
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
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    bootVigilair();
    setReady(true);
  }, []);

  useEffect(() => {
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.code === "Space") {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    <div className="relative flex h-dvh min-w-0 flex-col overflow-hidden bg-bg text-fg">
      <AlertRelay />
      <DutyWatch />
      <StewardWatch />
      <EvidenceSync />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-md text-fg lg:hidden"
            aria-expanded={menu}
            aria-label={menu ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Logo />
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold tracking-tight">VIGILAIR</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              COP N'Djamena · 1090ES · VIIRS · silencieux
            </p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <div className="hidden items-center gap-1.5 whitespace-nowrap lg:flex">
            <Badge tone={instruction ? "warn" : "ok"}>
              {instruction ? "Exercice" : "Réel"}
            </Badge>
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
          </div>
          {frozen ? <Badge tone="crit">COP figé</Badge> : null}
          <Badge>
            <Radio className="mr-1 size-3" />
            {live}
          </Badge>
          {live1090.n > 0 ? <Badge tone="ok">1090 {live1090.n}</Badge> : null}
          <span className="hidden whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground sm:inline">
            {ready ? formatClock(now) : "--:--:--"} WAT
          </span>
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
              aria-label={
                ewArmed ? "Désarmer le brouillage" : "Armer le brouillage défensif"
              }
            >
              <RadioTower />
              <span className="hidden xl:inline">{ewArmed ? "RF armé" : "RF off"}</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRunning(!running)}
            aria-label={running ? "Pause du flux" : "Reprendre le flux"}
          >
            {running ? <Pause /> : <Play />}
            <span className="hidden xl:inline">{running ? "Pause" : "Flux"}</span>
          </Button>
          {/* Sous lg, installation et fermeture de session passent dans le menu. */}
          <div className="hidden items-center gap-1.5 lg:flex">
            <InstallPoste variant="header" />
            <PosteChip />
          </div>
        </div>
      </header>
      {isSuperadmin && botOpen ? (
        <div className="absolute inset-x-0 top-14 z-40 max-h-[70dvh] overflow-y-auto border-b border-border bg-bg p-3">
          <StewardDesk />
        </div>
      ) : null}

      <nav className="hidden gap-1 overflow-x-auto border-b border-border px-2 py-1 lg:flex">
        {NAV.map((item) => {
          const active =
            item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150",
                active
                  ? "bg-secondary text-fg"
                  : "text-muted-foreground hover:bg-secondary hover:text-fg",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {menu ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Fermer le menu"
            onClick={() => setMenu(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto border-r border-border bg-surface px-3 py-3">
            <p className="px-2 font-display text-sm font-semibold">VIGILAIR</p>
            <p className="px-2 text-xs text-muted-foreground">COP N'Djamena</p>
            {GROUPS.map((group) => (
              <div key={group.label} className="mt-4">
                <p className="px-2 text-[11px] tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <div className="mt-1 flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active =
                      item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          "inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm",
                          active
                            ? "bg-secondary text-fg"
                            : "text-muted-foreground hover:bg-secondary hover:text-fg",
                        )}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="mt-4">
              <p className="px-2 text-[11px] tracking-wide text-muted-foreground uppercase">
                Paramètres
              </p>
              <dl className="mt-1 rounded-lg border border-border px-3 py-2">
                {PARAMS.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-right text-xs text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="mt-3 rounded-lg border border-border px-3 py-3">
              <p className="text-sm text-fg">
                {live} piste{live > 1 ? "s" : ""}
                {unacked > 0 ? ` · ${unacked} alerte${unacked > 1 ? "s" : ""}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Connecté en tant que</p>
              <p className="text-sm font-semibold text-fg">
                {isSuperadmin ? "chef de division" : "poste"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isSuperadmin ? "accès total" : "quart"}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <PosteChip />
                <InstallPoste variant="header" />
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      {pathname === "/tableau" ? null : <CombatBanner />}
      <GuardBanner />
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
