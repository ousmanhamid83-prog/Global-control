import { useEffect, useState } from "react";
import { FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { originLabel, PLATFORM_BY_ID, sensorLabel } from "@/lib/vigilair/catalog";
import { bulletinToJournal, getEvidencePdf, listBulletins } from "@/lib/vigilair/evidence-store";
import { formatCoord } from "@/lib/vigilair/geo";
import { formatDate, formatHash, originTone } from "@/lib/vigilair/format";
import { emitDuty } from "@/lib/vigilair/duty-bus";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import type { JournalEntry } from "@/lib/vigilair/types";

export function JournalView() {
  const journal = useVigilair((s) => s.journal);
  const hydrateJournal = useVigilair((s) => s.hydrateJournal);
  const { isSuperadmin } = useStaff();
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listBulletins()
      .then((rows) => {
        if (!live) return;
        hydrateJournal(rows.map(bulletinToJournal));
        setLoadErr(null);
      })
      .catch(() => {
        if (!live) return;
        setLoadErr("Journal serveur injoignable — cache du poste affiché.");
      });
    return () => {
      live = false;
    };
  }, [hydrateJournal]);

  const hashed = journal.filter((e) => e.contentSha256).length;
  const head = journal.find((e) => e.chainSha256);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            Journal de preuve
          </h1>
          <p className="text-sm text-muted-foreground">
            Bulletins versés au serveur de division. PDF horodaté, SHA-256,
            chaîne de custody. Append-only : personne ne modifie un bulletin
            scellé. Seul le chef de division peut agir sur le poste.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">
            <ShieldCheck className="mr-1 size-3" />
            {hashed} hashés
          </Badge>
          {loadErr ? (
            <span className="text-xs text-warn">{loadErr}</span>
          ) : isSuperadmin ? (
            <span className="text-xs text-muted-foreground">
              Chef · lecture complète · extraits consignés
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Lecture division · auteur consigné · copie = alerte
            </span>
          )}
        </div>
        {head?.chainSha256 ? (
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-xs text-muted-foreground">
            Tête de chaîne {formatHash(head.chainSha256)}
            {head.prevSha256
              ? ` · préc. ${formatHash(head.prevSha256)}`
              : " · GENESIS"}
          </p>
        ) : null}
      </header>
      {journal.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-5 py-16 text-center">
          <p className="text-sm font-medium">Aucun bulletin</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sur une piste confirmée, versez le dossier de preuve. Le PDF et le
            hash sont scellés au serveur.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {journal.map((e) => {
            const plat = PLATFORM_BY_ID[e.platformId];
            return (
              <li
                key={e.id}
                className="rounded-lg border border-border bg-surface px-4 py-3 hud"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{e.callsign}</span>
                    <Badge tone={originTone(e.origin)}>{originLabel(e.origin)}</Badge>
                    {e.injected ? <Badge tone="warn">INJ</Badge> : null}
                    {e.pending ? (
                      <Badge>
                        <LoaderCircle className="mr-1 size-3 animate-spin" />
                        Versement
                      </Badge>
                    ) : e.contentSha256 ? (
                      <Badge tone="ok">Scellé</Badge>
                    ) : e.fileError ? (
                      <Badge tone="warn">Échec</Badge>
                    ) : (
                      <Badge tone="warn">Cache poste</Badge>
                    )}
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDate(e.at)}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  {plat ? `${plat.manufacturer} ${plat.name}` : e.platformId} ·{" "}
                  {Math.round(e.confidence)} %
                  {e.filedBy ? ` · ${e.filedBy}` : ""}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {formatCoord(e.lat, e.lon)} · {Math.round(e.altM)} m ·{" "}
                  {e.sensors.map(sensorLabel).join(" · ")}
                </p>
                {e.launchLat != null && e.launchLon != null ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    SRC {formatCoord(e.launchLat, e.launchLon)}
                    {e.c2Lat != null && e.c2Lon != null
                      ? ` · TEL ${formatCoord(e.c2Lat, e.c2Lon)}`
                      : ""}
                    {e.stopLat != null && e.stopLon != null
                      ? ` · ARR ${formatCoord(e.stopLat, e.stopLon)}`
                      : ""}
                  </p>
                ) : null}
                {e.contentSha256 ? (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    SHA-256 {formatHash(e.contentSha256)}
                    {e.chainSha256 ? ` · chaîne ${formatHash(e.chainSha256)}` : ""}
                    {e.prevSha256
                      ? ` · préc. ${formatHash(e.prevSha256)}`
                      : e.chainSha256
                        ? " · GENESIS"
                        : ""}
                  </p>
                ) : null}
                {e.fileError ? (
                  <p className="mt-1 text-xs text-warn">{e.fileError}</p>
                ) : null}
                {e.ewNote ? (
                  <p className="mt-1 text-xs text-muted-foreground">{e.ewNote}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">{e.method}</p>
                {e.contentSha256 && !e.pending ? (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === e.id}
                      onClick={() => {
                        setBusyId(e.id);
                        void downloadPdf(e)
                          .catch(() => undefined)
                          .finally(() => setBusyId(null));
                      }}
                    >
                      {busyId === e.id ? <LoaderCircle className="animate-spin" /> : <FileText />}
                      Télécharger le PDF
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

async function downloadPdf(e: JournalEntry) {
  emitDuty({
    kind: "download",
    title: `Extrait PDF ${e.callsign}`,
    detail: `Bulletin ${e.id.slice(0, 8)}`,
    trackId: e.trackId,
    severity: "warn",
  });
  const doc = await getEvidencePdf({ data: e.id });
  const bin = Uint8Array.from(atob(doc.b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  a.click();
  URL.revokeObjectURL(url);
}
