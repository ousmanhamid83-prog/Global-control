import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GitCompare, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diffHeatmap } from "@/lib/vigilair/change-diff";
import { fetchChangePair } from "@/lib/vigilair/live-feeds";
import { MINE_REGION_LABEL, MINES } from "@/lib/vigilair/mines";
import {
  addCustomSite,
  removeCustomSite,
  subscribeWatchSites,
  watchSitesSnapshot,
} from "@/lib/vigilair/watch-sites";

type Pair = Awaited<ReturnType<typeof fetchChangePair>>;
type SiteOpt = { id: string; label: string; lat: number; lon: number; radiusKm: number; custom: boolean };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image illisible"));
    img.src = src;
  });
}

/** Formulaire : l'opérateur ajoute ses propres sites au périmètre de sécurité (le lot d'usine est
 *  incomplet). Chaque site ajouté sonne pour les phénomènes proches, est évalué pour l'intrusion
 *  drone, et devient sélectionnable dans le comparateur. Stockage local au poste. */
function SiteManager() {
  const custom = useSyncExternalStore(subscribeWatchSites, watchSitesSnapshot, watchSitesSnapshot);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("5");
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const res = addCustomSite({ name, lat: Number(lat), lon: Number(lon), radiusKm: Number(radius) });
    if (!res.ok) {
      setErr(res.error ?? "saisie invalide");
      return;
    }
    setErr(null);
    setName("");
    setLat("");
    setLon("");
    setRadius("5");
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Sites surveillés — périmètre de sécurité</h2>
        <Badge tone="default">{custom.length} ajouté{custom.length > 1 ? "s" : ""}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Le lot d'usine (sites miniers) n'est jamais complet. Ajoute tes propres sites — camp, poste
        avancé, forage, village, pont. Chacun <strong>sonne</strong> pour une crue / un feu / un
        séisme à moins de 200 km, arme un <strong>périmètre</strong> contre l'intrusion drone, et
        devient sélectionnable dans le comparateur avant/après. Enregistré localement sur ce poste.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <Input data-site="name" placeholder="Nom (ex. Camp Nord)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          data-site="lat"
          inputMode="decimal"
          placeholder="Latitude"
          className="sm:w-28"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
        />
        <Input
          data-site="lon"
          inputMode="decimal"
          placeholder="Longitude"
          className="sm:w-28"
          value={lon}
          onChange={(e) => setLon(e.target.value)}
        />
        <Input
          data-site="radius"
          inputMode="decimal"
          placeholder="Rayon km"
          className="sm:w-24"
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
        <Button data-site="add" size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1 size-3.5" />
          Ajouter
        </Button>
      </div>
      {err ? <p className="font-mono text-xs text-crit">{err}</p> : null}
      {custom.length > 0 ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {custom.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="truncate text-fg">{s.name}</span>
              <span className="font-mono text-muted-foreground">
                {s.lat.toFixed(4)}, {s.lon.toFixed(4)} · {s.radiusKm} km
              </span>
              <Button
                data-site-remove={s.id}
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => removeCustomSite(s.id)}
                aria-label={`retirer ${s.name}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Comparateur avant/après d'un périmètre — deux passages Sentinel-2 datés du MÊME cadre.
 * Pas de direct : un satellite ne repasse que tous quelques jours, donc on compare deux DATES.
 * Le swipe montre l'avant et l'après ; la surcouche « Changement » allume ce qui a bougé (une piste
 * neuve, un bâtiment, un engin apparu). 10 m : jamais une voiture isolée, jamais une identité —
 * c'est une différence d'image, pas une reconnaissance d'objet. Réception / lecture seule.
 */
export function ChangeCompare() {
  const custom = useSyncExternalStore(subscribeWatchSites, watchSitesSnapshot, watchSitesSnapshot);
  const sites: SiteOpt[] = [
    ...MINES.map((m) => ({
      id: m.id,
      label: `${m.short} · ${MINE_REGION_LABEL[m.region]} (${m.commodity})`,
      lat: m.lat,
      lon: m.lon,
      radiusKm: m.radiusKm,
      custom: false,
    })),
    ...custom.map((s) => ({
      id: s.id,
      label: `${s.name} · ajouté`,
      lat: s.lat,
      lon: s.lon,
      radiusKm: s.radiusKm,
      custom: true,
    })),
  ];

  const [siteId, setSiteId] = useState<string>(MINES[0]?.id ?? "");
  const [pair, setPair] = useState<Pair | null>(null);
  const [busy, setBusy] = useState(false);
  const [swipe, setSwipe] = useState(50);
  const [showDiff, setShowDiff] = useState(false);
  const [changedPct, setChangedPct] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selected = sites.find((s) => s.id === siteId) ?? sites[0];

  const analyse = () => {
    if (!selected) return;
    setBusy(true);
    setChangedPct(null);
    setShowDiff(false);
    fetchChangePair({ data: { lat: selected.lat, lon: selected.lon, radiusKm: selected.radiusKm } })
      .then(setPair)
      .catch((e: unknown) =>
        setPair({ ok: false, configured: true, reason: e instanceof Error ? e.message : "échec" }),
      )
      .finally(() => setBusy(false));
  };

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

  return (
    <div className="space-y-4">
      <SiteManager />

      <section className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-surface p-4 hud">
          <div className="flex flex-wrap items-center gap-2">
            <GitCompare className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">Comparateur avant/après · périmètre</h2>
            <Badge tone="default">Sentinel-2 · 10 m</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pas de direct : un satellite ne repasse que tous les quelques jours. On compare donc deux{" "}
            <strong>passages datés</strong> du même cadre. Le poste lit des images publiques
            Copernicus — il ne commande aucun satellite. On lit une <strong>piste neuve, un bâtiment,
            un engin apparu</strong> ; jamais une voiture isolée ni une identité (c'est une différence
            d'image, pas une reconnaissance d'objet).
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Site
              <select
                data-change="site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="rounded-sm border border-border bg-bg px-2 py-1.5 text-sm text-fg"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button data-change="run" size="sm" variant="outline" disabled={busy} onClick={analyse}>
              {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              {busy ? "Analyse…" : "Analyser le périmètre"}
            </Button>
            {selected ? (
              <span className="text-xs text-muted-foreground">
                {selected.lat.toFixed(4)}, {selected.lon.toFixed(4)} · rayon ~{selected.radiusKm} km
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
              <img
                src={pair.before.dataUrl}
                alt="périmètre, passage ancien"
                className="absolute inset-0 size-full object-cover"
                draggable={false}
              />
              <img
                src={pair.after.dataUrl}
                alt="périmètre, passage récent"
                className="absolute inset-0 size-full object-cover"
                style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 size-full object-cover transition-opacity"
                style={{ opacity: showDiff ? 1 : 0 }}
              />
              <div className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: `${swipe}%` }} />
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
    </div>
  );
}
