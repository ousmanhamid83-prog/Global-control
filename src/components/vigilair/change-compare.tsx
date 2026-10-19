import { useEffect, useRef, useState } from "react";
import { GitCompare, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diffHeatmap } from "@/lib/vigilair/change-diff";
import { fetchChangePair } from "@/lib/vigilair/live-feeds";
import { MINE_REGION_LABEL, MINES } from "@/lib/vigilair/mines";

type Pair = Awaited<ReturnType<typeof fetchChangePair>>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image illisible"));
    img.src = src;
  });
}

/**
 * Comparateur avant/après d'un périmètre minier — deux passages Sentinel-2 datés du MÊME cadre.
 * Pas de direct : chaque satellite ne repasse que tous quelques jours, donc on compare deux DATES.
 * Le swipe montre l'avant et l'après ; la surcouche « Changement » allume ce qui a bougé (une piste
 * neuve, un bâtiment, un engin apparu). 10 m : jamais une voiture isolée, jamais une identité —
 * c'est une différence d'image, pas une reconnaissance d'objet. Réception / lecture seule.
 */
export function ChangeCompare() {
  const [mineId, setMineId] = useState<string>(MINES[0]?.id ?? "");
  const [pair, setPair] = useState<Pair | null>(null);
  const [busy, setBusy] = useState(false);
  const [swipe, setSwipe] = useState(50);
  const [showDiff, setShowDiff] = useState(false);
  const [changedPct, setChangedPct] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const analyse = () => {
    setBusy(true);
    setChangedPct(null);
    setShowDiff(false);
    fetchChangePair({ data: { mineId } })
      .then(setPair)
      .catch((e: unknown) =>
        setPair({ ok: false, configured: true, reason: e instanceof Error ? e.message : "échec" }),
      )
      .finally(() => setBusy(false));
  };

  // Calcule le calque de changement dès que la paire est prête (indépendamment de l'affichage).
  useEffect(() => {
    if (!pair || !pair.ok) return;
    let alive = true;
    const run = async () => {
      try {
        const [before, after] = await Promise.all([loadImage(pair.before.dataUrl), loadImage(pair.after.dataUrl)]);
        if (!alive) return;
        const px = pair.px;
        const off = document.createElement("canvas");
        off.width = px;
        off.height = px;
        const octx = off.getContext("2d", { willReadFrequently: true });
        if (!octx) return;
        octx.drawImage(before, 0, 0, px, px);
        const b = octx.getImageData(0, 0, px, px);
        octx.clearRect(0, 0, px, px);
        octx.drawImage(after, 0, 0, px, px);
        const a = octx.getImageData(0, 0, px, px);
        const res = diffHeatmap(b.data, a.data, px, px, { threshold: 34 });
        setChangedPct(Math.round(res.changedFrac * 1000) / 10);
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = px;
          canvas.height = px;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const out = ctx.createImageData(px, px);
            out.data.set(res.overlay);
            ctx.putImageData(out, 0, 0);
          }
        }
      } catch {
        if (alive) setChangedPct(null);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [pair]);

  const site = MINES.find((m) => m.id === mineId);

  return (
    <section className="space-y-4">
      <div className="space-y-2 rounded-md border border-border bg-surface p-4 hud">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompare className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium">Comparateur avant/après · périmètre minier</h2>
          <Badge tone="default">Sentinel-2 · 10 m</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Pas de direct : un satellite ne repasse que tous les quelques jours. On compare donc deux{" "}
          <strong>passages datés</strong> du même cadre. Le poste lit des images publiques Copernicus
          — il ne commande aucun satellite. On lit une <strong>piste neuve, un bâtiment, un engin
          apparu</strong> ; jamais une voiture isolée ni une identité (c'est une différence d'image,
          pas une reconnaissance d'objet).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Site
            <select
              data-change="site"
              value={mineId}
              onChange={(e) => setMineId(e.target.value)}
              className="rounded-sm border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            >
              {MINES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.short} · {MINE_REGION_LABEL[m.region]} ({m.commodity})
                </option>
              ))}
            </select>
          </label>
          <Button data-change="run" size="sm" variant="outline" disabled={busy} onClick={analyse}>
            {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {busy ? "Analyse…" : "Analyser le périmètre"}
          </Button>
          {site ? (
            <span className="text-xs text-muted-foreground">
              {site.lat.toFixed(4)}, {site.lon.toFixed(4)} · rayon ~{site.radiusKm} km
            </span>
          ) : null}
        </div>
      </div>

      {pair && !pair.ok ? (
        <div className="space-y-2 rounded-md border border-border bg-surface p-4 text-sm">
          {!pair.configured ? (
            <>
              <div className="flex items-center gap-2">
                <Badge tone="warn">clé requise</Badge>
                <span className="text-fg">Brancher la clé Copernicus (gratuite) pour comparer</span>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <li>
                  Compte gratuit sur dataspace.copernicus.eu, puis un client OAuth (Sentinel Hub &gt;
                  User settings &gt; OAuth clients).
                </li>
                <li>Démarrer le poste avec les deux identifiants :</li>
              </ol>
              <pre className="overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-[11px] text-fg">
                AFRICONTROL_SENTINEL_ID=&lt;client id&gt; AFRICONTROL_SENTINEL_SECRET=&lt;secret&gt; npm run dev
              </pre>
              <p className="text-xs text-muted-foreground">
                Lecture seule : le poste lit des images publiques, il ne commande aucun satellite.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Badge tone="crit">indisponible</Badge>
              <span className="font-mono text-xs text-crit">{pair.reason}</span>
            </div>
          )}
        </div>
      ) : null}

      {pair && pair.ok ? (
        <div className="space-y-3 rounded-md border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="ok">ancien</Badge>
            <span className="text-muted-foreground">
              {pair.before.from} → {pair.before.to}
            </span>
            <span className="text-muted-foreground">·</span>
            <Badge tone="warn">récent</Badge>
            <span className="text-muted-foreground">
              {pair.after.from} → {pair.after.to}
            </span>
            <span className="ml-auto text-muted-foreground">
              ~{pair.mpp} m/px · composite moins nuageux ≤ 20 j
            </span>
          </div>

          <div className="relative mx-auto aspect-square w-full max-w-[560px] select-none overflow-hidden rounded-md border border-border bg-bg">
            {/* base : ancien (visible à droite du curseur) */}
            <img
              src={pair.before.dataUrl}
              alt="périmètre, passage ancien"
              className="absolute inset-0 size-full object-cover"
              draggable={false}
            />
            {/* dessus : récent, révélé à gauche du curseur */}
            <img
              src={pair.after.dataUrl}
              alt="périmètre, passage récent"
              className="absolute inset-0 size-full object-cover"
              style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}
              draggable={false}
            />
            {/* surcouche changement */}
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 size-full object-cover transition-opacity"
              style={{ opacity: showDiff ? 1 : 0 }}
            />
            {/* trait du curseur */}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-white/80"
              style={{ left: `${swipe}%` }}
            />
            <span className="pointer-events-none absolute left-2 top-2 rounded-xs bg-bg/80 px-1.5 py-0.5 text-[11px] text-fg">
              récent
            </span>
            <span className="pointer-events-none absolute right-2 top-2 rounded-xs bg-bg/80 px-1.5 py-0.5 text-[11px] text-fg">
              ancien
            </span>
          </div>

          <input
            data-change="swipe"
            type="range"
            min={0}
            max={100}
            value={swipe}
            onChange={(e) => setSwipe(Number(e.target.value))}
            className="w-full"
            aria-label="curseur avant/après"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-change="diff"
              size="sm"
              variant={showDiff ? "default" : "outline"}
              onClick={() => setShowDiff((v) => !v)}
            >
              {showDiff ? "Masquer le changement" : "Afficher le changement"}
            </Button>
            {changedPct != null ? (
              <span className="text-xs text-muted-foreground">
                Changement estimé : <strong className="text-fg">{changedPct}%</strong> du cadre
                (différence d'image, à confirmer à l'œil)
              </span>
            ) : null}
          </div>

          <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
            Sentinel-2 L2A · Copernicus · 10 m. Deux fenêtres datées, pas un « live ». Le calque
            allume la différence entre les deux passages — ce n'est ni une détection d'objet, ni une
            identification. Réception / lecture seule.
          </p>
        </div>
      ) : null}
    </section>
  );
}
