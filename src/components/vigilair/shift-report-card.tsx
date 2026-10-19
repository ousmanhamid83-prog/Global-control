import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { originLabel, PLATFORM_BY_ID, sensorLabel } from "@/lib/vigilair/catalog";
import { formatCoord } from "@/lib/vigilair/geo";
import { formatDate } from "@/lib/vigilair/format";
import { shiftReport } from "@/lib/vigilair/live-feeds";
import { useVigilair } from "@/lib/vigilair/store";
import type { JournalEntry } from "@/lib/vigilair/types";

/** Une ligne factuelle par bulletin — uniquement des champs typés, exercice marqué. */
function bulletinLine(e: JournalEntry): string {
  const plat = PLATFORM_BY_ID[e.platformId];
  return (
    `${formatDate(e.at)} · ${e.callsign} · ${plat ? `${plat.manufacturer} ${plat.name}` : e.platformId}` +
    ` · ${originLabel(e.origin)} · conf ${Math.round(e.confidence)}%` +
    ` · ${formatCoord(e.lat, e.lon)} ${Math.round(e.altM)} m` +
    ` · ${e.sensors.map(sensorLabel).join("/") || "capteurs ?"}` +
    (e.injected ? " · EXERCICE (inject)" : "")
  );
}

/**
 * Compte rendu de quart rédigé par DeepSeek à partir des SEULS bulletins du journal.
 * Partagé entre le Journal de preuve et la vue Quart (relève). La clé reste au serveur.
 * Aide à relire et valider avant la relève — ce n'est pas une pièce scellée.
 */
export function ShiftReportCard() {
  const journal = useVigilair((s) => s.journal);
  const [report, setReport] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (journal.length === 0) return null;

  const run = () => {
    setBusy(true);
    setErr(null);
    const events = journal.map(bulletinLine);
    const real = journal.filter((e) => !e.injected).length;
    const meta = `Poste FTTJ (N'Djamena). ${journal.length} bulletins (${real} réels, ${journal.length - real} exercices).`;
    shiftReport({ data: { events, meta } })
      .then((r) => {
        if (r.ok) setReport(r.text);
        else setErr(r.error);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "compte rendu échoué"))
      .finally(() => setBusy(false));
  };

  const download = () => {
    if (!report) return;
    const stamp = new Date();
    const header =
      `AfriControl — compte rendu de quart\n` +
      `Poste FTTJ (N'Djamena) · ${stamp.toLocaleString("fr-FR")}\n` +
      `Rédigé par assistant DeepSeek à partir de ${journal.length} bulletins du journal.\n` +
      `Aide à valider, pas une pièce scellée — la preuve reste les bulletins hashés.\n` +
      `${"=".repeat(60)}\n\n`;
    const blob = new Blob([header + report + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compte-rendu-quart-${stamp.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3 hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          Compte rendu de quart · DeepSeek
        </p>
        <div className="flex items-center gap-2">
          {report ? (
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="size-3.5" />
              Télécharger (.txt)
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={run}>
            {busy ? "Rédaction…" : report ? "Régénérer" : "Rédiger le compte rendu"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Synthèse rédigée à partir des SEULS bulletins versés (faits réels, exercices marqués).
        La clé reste au serveur. À relire et valider avant la relève — ce n'est pas une pièce scellée.
      </p>
      {err ? <p className="text-xs text-warn">{err}</p> : null}
      {report ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{report}</p>
      ) : null}
    </div>
  );
}
