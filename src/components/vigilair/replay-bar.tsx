import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  GraduationCap,
  History,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { dronesPeek } from "@/lib/vigilair/drones";
import { exerciceEnCours } from "@/lib/vigilair/drones-core";
import { reglerExercice } from "@/lib/vigilair/drones-suivi";
import { fetchRejeuTape } from "@/lib/vigilair/live-feeds";
import { rejeuClock, tapeUsable } from "@/lib/vigilair/rejeu";
import { formatTape } from "@/lib/vigilair/replay";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";

/** Le chef met fin à tous les exercices en cours, au poste ; la console oublie ensuite leurs pistes. */
async function finExercices(purger: () => void): Promise<string | null> {
  const maintenant = Date.now();
  for (const d of dronesPeek()) {
    if (!exerciceEnCours(d, maintenant)) continue;
    const erreur = await reglerExercice(d.id, null);
    if (erreur) return erreur;
  }
  purger();
  return null;
}

export function ReplayBar() {
  const clockMode = useVigilair((s) => s.clockMode);
  const replayIndex = useVigilair((s) => s.replayIndex);
  const replayCount = useVigilair((s) => s.replayCount);
  const seekReplay = useVigilair((s) => s.seekReplay);
  const scrubReplay = useVigilair((s) => s.scrubReplay);
  const returnToLive = useVigilair((s) => s.returnToLive);
  const purgeInjects = useVigilair((s) => s.purgeInjects);
  const rejeu = useVigilair((s) => s.rejeu);
  const startRejeu = useVigilair((s) => s.startRejeu);
  const setRejeuSpeed = useVigilair((s) => s.setRejeuSpeed);
  const stopRejeu = useVigilair((s) => s.stopRejeu);
  const { isSuperadmin } = useStaff();
  const [finErreur, setFinErreur] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rejeuBusy, setRejeuBusy] = useState(false);
  const [rejeuError, setRejeuError] = useState<string | null>(null);

  const launchRejeu = () => {
    setRejeuBusy(true);
    setRejeuError(null);
    fetchRejeuTape()
      .then((tape) => {
        if (!tapeUsable(tape)) {
          setRejeuError("Aucune bande réelle de 3 min disponible pour l'instant.");
          return;
        }
        startRejeu(tape);
        setOpen(false);
      })
      .catch((e: unknown) => setRejeuError(e instanceof Error ? e.message : "bande injoignable"))
      .finally(() => setRejeuBusy(false));
  };

  const max = Math.max(0, replayCount - 1);
  const idx = clockMode === "replay" ? replayIndex : max;
  const tapeNow = formatTape(idx * 1000);
  const tapeEnd = formatTape(max * 1000);
  const hasExercise = useVigilair((s) => s.tracks.some((t) => t.injected && t.feed !== "rejeu"));

  return (
    <div className="replay-bar border-b border-border bg-surface/80">
      {rejeu ? (
        <div
          className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-1.5"
          role="status"
          data-testid="rejeu-banner"
        >
          <History className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
            <span className="font-semibold text-primary">REJEU RÉEL</span> · heure d'origine{" "}
            <span className="tabular-nums">{rejeuClock(rejeu.clock)}</span> ·{" "}
            {rejeu.kind === "poste" ? "bande de ce poste" : "archive réelle"} {rejeuClock(rejeu.from)} →{" "}
            {rejeuClock(rejeu.to).slice(6)} · {rejeu.n} pistes REJ · trafic réel enregistré, pas un contact live
          </p>
          {[1, 4].map((v) => (
            <Button
              key={v}
              variant={rejeu.speed === v ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setRejeuSpeed(v)}
              aria-pressed={rejeu.speed === v}
            >
              ×{v}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={stopRejeu}>
            Arrêter le rejeu
          </Button>
        </div>
      ) : null}
      {hasExercise ? (
        <div
          className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-1.5"
          role="status"
          data-testid="exercice-banner"
        >
          <GraduationCap className="size-4 shrink-0 text-warn" />
          <p className="min-w-0 flex-1 truncate text-xs text-fg">
            EXERCICE en cours — pistes EXE : un vrai vol, joué comme intrus. Pas un contact réel,
            jamais relayé par Signal.{finErreur ? ` ${finErreur}` : ""}
          </p>
          {isSuperadmin ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="exercice-fin"
              onClick={() => void finExercices(purgeInjects).then(setFinErreur)}
            >
              <Trash2 />
              Fin d'exercice · retour veille réelle
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-2 px-3 py-2 flex-row items-center">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant={open ? "secondary" : "outline"}
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <GraduationCap />
            Injecter
          </Button>
          {clockMode === "replay" ? (
            <Button variant="outline" size="sm" onClick={() => returnToLive()}>
              <CircleDot />
              Veille
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seekReplay(Math.max(0, replayCount - 1), false)}
              disabled={replayCount < 2}
            >
              AAR
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-fg"
            aria-label="Début de bande"
            onClick={() => seekReplay(0, false)}
            disabled={replayCount < 2}
          >
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-fg"
            aria-label="Reculer"
            onClick={() => scrubReplay(-1)}
            disabled={replayCount < 2}
          >
            <ChevronLeft className="size-4" />
          </button>
          <input
            type="range"
            min={0}
            max={max || 0}
            step={1}
            value={idx}
            disabled={replayCount < 2}
            onChange={(e) => seekReplay(Number(e.target.value), false)}
            aria-label="Bande AAR"
            className="h-9 min-w-0 flex-1"
          />
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-fg"
            aria-label="Avancer"
            onClick={() => scrubReplay(1)}
            disabled={replayCount < 2}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-fg"
            aria-label="Fin de bande / veille"
            onClick={() => returnToLive()}
          >
            <SkipForward className="size-4" />
          </button>
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {tapeNow} / {tapeEnd}
          </span>
        </div>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <History className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Rejeu réel · trafic 1090ES enregistré</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rejoue de vrais avions reçus : la bande de ce poste (30 dernières minutes) ou, au démarrage,
              l'archive réelle livrée. Chaque piste porte « REJ » et son heure d'origine. Pas un contact live.
            </p>
            {rejeuError ? <p className="mt-1 text-xs text-warn">{rejeuError}</p> : null}
          </div>
          <Button size="sm" variant="outline" disabled={rejeuBusy} onClick={launchRejeu}>
            {rejeuBusy ? "Chargement…" : rejeu ? "Relancer" : "Lancer le rejeu"}
          </Button>
        </div>
        </div>
      ) : null}
    </div>
  );
}
