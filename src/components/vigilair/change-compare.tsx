import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GitCompare, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diffHeatmap } from "@/lib/vigilair/change-diff";
import { addSensor, removeSensor, sensorsSnapshot, setSensorState, subscribeSensors, type SensorType } from "@/lib/vigilair/ground-sensors";
import { addDrone, discoverOnvifClient, dronesSnapshot, registerCamerasClient, removeDrone, scanRangeClient, scanSourceClient, setDroneRule, setDroneZones, sourceZones, subscribeDrones } from "@/lib/vigilair/drones";
import { addSiteNet, hydrateSiteNets, recordSiteScan, removeSiteNet, siteNetsSnapshot, subscribeSiteNets } from "@/lib/vigilair/sitenets";
import { buildCapturePdf } from "@/lib/vigilair/capture-pdf";
import { fetchChangePair } from "@/lib/vigilair/live-feeds";
import { MINE_REGION_LABEL, MINES } from "@/lib/vigilair/mines";
import { searchPlaces, type Place } from "@/lib/vigilair/places";
import { useVigilair } from "@/lib/vigilair/store";
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
  const [armed, setArmed] = useState(true);
  const [alertKm, setAlertKm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const results: Place[] = query.trim() ? searchPlaces(query, 8) : [];
  const changeWatch = useVigilair((s) => s.changeWatch);
  const setChangeWatch = useVigilair((s) => s.setChangeWatch);
  const changeThreshold = useVigilair((s) => s.changeThreshold);
  const setChangeThreshold = useVigilair((s) => s.setChangeThreshold);
  const sensors = useSyncExternalStore(subscribeSensors, sensorsSnapshot, sensorsSnapshot);
  const [snSite, setSnSite] = useState("");
  const [snType, setSnType] = useState<SensorType>("camera");
  const [snName, setSnName] = useState("");
  const addSn = async () => {
    const r = await addSensor(snSite, snType, snName);
    if (r.ok) setSnName("");
  };

  // Nos drones : registre partagé + veille mouvement sur leur imagerie.
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesSnapshot);
  // Sites distants : plages réseau mémorisées (au bout des liaisons antenne).
  const siteNets = useSyncExternalStore(subscribeSiteNets, siteNetsSnapshot, siteNetsSnapshot);
  useEffect(() => { void hydrateSiteNets(); }, []);
  const droneWatch = useVigilair((s) => s.droneWatch);
  const setDroneWatch = useVigilair((s) => s.setDroneWatch);
  const droneThreshold = useVigilair((s) => s.droneThreshold);
  const setDroneThreshold = useVigilair((s) => s.setDroneThreshold);
  const droneCadence = useVigilair((s) => s.droneCadence);
  const setDroneCadence = useVigilair((s) => s.setDroneCadence);
  const droneNightOnly = useVigilair((s) => s.droneNightOnly);
  const setDroneNightOnly = useVigilair((s) => s.setDroneNightOnly);
  const droneArmFrom = useVigilair((s) => s.droneArmFrom);
  const droneArmTo = useVigilair((s) => s.droneArmTo);
  const setDroneArmWindow = useVigilair((s) => s.setDroneArmWindow);
  const droneMotion = useVigilair((s) => s.droneMotion);
  const droneLog = useVigilair((s) => s.droneLog);
  const siteNetWatch = useVigilair((s) => s.siteNetWatch);
  const setSiteNetWatch = useVigilair((s) => s.setSiteNetWatch);
  const siteNetCadenceMin = useVigilair((s) => s.siteNetCadenceMin);
  const setSiteNetCadence = useVigilair((s) => s.setSiteNetCadence);
  const [zoomCap, setZoomCap] = useState<string | null>(null);
  const [roiEdit, setRoiEdit] = useState<string | null>(null);
  const [roiPts, setRoiPts] = useState<{ x: number; y: number }[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanRes, setScanRes] = useState<Awaited<ReturnType<typeof scanSourceClient>> | null>(null);
  const [onvifBusy, setOnvifBusy] = useState(false);
  const [onvifRes, setOnvifRes] = useState<Awaited<ReturnType<typeof discoverOnvifClient>> | null>(null);
  const [drRange, setDrRange] = useState("");
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeRes, setRangeRes] = useState<Awaited<ReturnType<typeof scanRangeClient>> | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [snNetName, setSnNetName] = useState("");
  const [snNetRange, setSnNetRange] = useState("");
  const [snNetErr, setSnNetErr] = useState<string | null>(null);
  type NetScanState = { busy?: boolean; cams?: Awaited<ReturnType<typeof scanRangeClient>>["cameras"]; added?: string[]; removed?: string[]; at?: number; err?: string };
  const [netScan, setNetScan] = useState<Record<string, NetScanState>>({});
  const exportPdf = async (d: { id: string; name: string; site: string }, m: { frame?: string; pct?: number | null; targets?: number; hint?: string; note?: string }) => {
    if (!m.frame) return;
    try {
      const img = await loadImage(m.frame);
      const b64 = m.frame.split(",")[1] ?? "";
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const lines = [
        "AfriControl — dossier de preuve (veille imagerie)",
        `Source : ${d.name}  ·  Site : ${d.site || "—"}`,
        `Date : ${new Date().toLocaleString("fr-FR")}`,
        `Mouvement : ${m.pct ?? 0}%  ·  Pistes : ${m.targets ?? 0}  ·  ${m.hint ?? ""}`,
        m.note ? `Note : ${m.note}` : "",
        "Détection de mouvement/présence, sans identité. L'identité reste à l'œil de l'opérateur.",
        "AfriControl : réception + analyse. Ne pilote pas, n'arme rien.",
      ].filter(Boolean);
      const pdf = buildCapturePdf(bytes, img.naturalWidth, img.naturalHeight, lines);
      const blob = new Blob([pdf as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AfriControl-${d.name.replace(/\s+/g, "-")}-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* export impossible */
    }
  };
  const [drKind, setDrKind] = useState("drone");
  const [drName, setDrName] = useState("");
  const [drIdent, setDrIdent] = useState("");
  const [drSite, setDrSite] = useState("");
  const [drUrl, setDrUrl] = useState("");
  const [drHost, setDrHost] = useState("");
  const [drPort, setDrPort] = useState("");
  const [drPath, setDrPath] = useState("");
  const [drErr, setDrErr] = useState<string | null>(null);
  const [openCapture, setOpenCapture] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const addDr = async () => {
    setDrErr(null);
    const r = await addDrone({ kind: drKind, name: drName, ident: drIdent, site: drSite, snapshotUrl: drUrl, host: drHost, port: drPort, path: drPath });
    if (r.ok) {
      setDrName("");
      setDrIdent("");
      setDrUrl("");
      setDrHost("");
      setDrPort("");
      setDrPath("");
    } else {
      setDrErr(r.error ?? "échec");
    }
  };

  // SCAN AUTO : à partir de l'hôte de NOTRE caméra/drone, trouve le port + le chemin du flux et
  // pré-remplit la fiche (découverte de liaison, pas d'identité).
  const doScan = async (host: string) => {
    setDrErr(null);
    setScanBusy(true);
    setScanRes(null);
    try {
      setScanRes(await scanSourceClient(host));
    } catch {
      setDrErr("scan impossible (poste injoignable)");
    } finally {
      setScanBusy(false);
    }
  };
  const runScan = async () => {
    const host = drHost.trim() || drUrl.trim();
    if (!host) {
      setDrErr("renseigne l'hôte (ex. 10.0.0.9) pour lancer le scan");
      return;
    }
    await doScan(host);
  };

  // SCAN DE PLAGE : balaie un sous-réseau distant (au bout de l'antenne) pour trouver ses caméras.
  const runRange = async () => {
    const spec = drRange.trim();
    if (!spec) {
      setDrErr("renseigne une plage (ex. 10.20.0.0/24 ou 10.20.0.10-40)");
      return;
    }
    setDrErr(null);
    setBulkMsg(null);
    setRangeBusy(true);
    setRangeRes(null);
    try {
      setRangeRes(await scanRangeClient(spec));
    } catch {
      setDrErr("scan de plage impossible (poste injoignable)");
    } finally {
      setRangeBusy(false);
    }
  };
  const applyRangeCam = (c: { host: string; port: number; path: string; name?: string }) => {
    setDrKind("camera");
    setDrUrl("");
    setDrHost(c.host);
    setDrPort(String(c.port));
    setDrPath(c.path);
    if (c.name && !drName.trim()) setDrName(c.name);
    setRangeRes(null);
  };
  const registerAll = async (list: { host: string; port?: number; path?: string; name?: string }[], scan: boolean) => {
    if (list.length === 0) return;
    setBulkMsg("Inscription en cours…");
    try {
      const r = await registerCamerasClient(list.map((c) => ({ host: c.host, port: c.port, path: c.path, name: c.name })), scan);
      setBulkMsg(`${r.added} caméra(s) inscrite(s)${r.withStream ? ` · ${r.withStream} avec flux` : ""}${r.skipped ? ` · ${r.skipped} ignorée(s)/déjà inscrite(s)` : ""}.`);
      setOnvifRes(null);
      setRangeRes(null);
    } catch {
      setBulkMsg("inscription en lot impossible (poste injoignable)");
    }
  };
  const applyScan = (s: { host: string; port: number; path: string }) => {
    setDrUrl("");
    setDrHost(s.host);
    setDrPort(String(s.port));
    setDrPath(s.path);
    setScanRes(null);
  };

  // DÉCOUVERTE ONVIF : trouve les caméras du réseau sans taper d'IP (multicast WS-Discovery).
  const runOnvif = async () => {
    setDrErr(null);
    setOnvifBusy(true);
    setOnvifRes(null);
    try {
      setOnvifRes(await discoverOnvifClient(3000));
    } catch {
      setDrErr("découverte ONVIF impossible (poste injoignable)");
    } finally {
      setOnvifBusy(false);
    }
  };
  const applyOnvif = async (dev: { host: string; port?: number; name?: string }) => {
    setDrKind("camera");
    setDrUrl("");
    setDrPath("");
    setDrHost(dev.host);
    setDrPort(dev.port ? String(dev.port) : "");
    if (dev.name && !drName.trim()) setDrName(dev.name);
    setOnvifRes(null);
    // Enchaînement : on cherche tout de suite le chemin du flux (un seul geste).
    await doScan(dev.host);
  };

  // SITES DISTANTS : mémoriser une plage nommée, re-scanner d'un clic, détecter tombée / nouvelle.
  const addNet = async () => {
    setSnNetErr(null);
    const r = await addSiteNet(snNetName.trim(), snNetRange.trim());
    if (r.ok) {
      setSnNetName("");
      setSnNetRange("");
    } else {
      setSnNetErr(r.error ?? "échec");
    }
  };
  const rescanNet = async (site: { id: string; range: string }) => {
    setNetScan((s) => ({ ...s, [site.id]: { ...s[site.id], busy: true, err: undefined } }));
    try {
      const res = await scanRangeClient(site.range);
      if (res.error) {
        setNetScan((s) => ({ ...s, [site.id]: { busy: false, err: res.error } }));
        return;
      }
      const cams = res.cameras;
      const addrs = cams.map((c) => `${c.host}:${c.port}`);
      const diff = await recordSiteScan(site.id, addrs);
      setNetScan((s) => ({ ...s, [site.id]: { busy: false, cams, added: diff.added, removed: diff.removed, at: Date.now() } }));
    } catch {
      setNetScan((s) => ({ ...s, [site.id]: { busy: false, err: "re-scan impossible" } }));
    }
  };

  const pick = (pl: Place) => {
    setName(pl.name);
    setLat(String(pl.lat));
    setLon(String(pl.lon));
    setQuery("");
    setErr(null);
  };

  const add = async () => {
    setBusy(true);
    const ak = Number(alertKm);
    const res = await addCustomSite({
      name,
      lat: Number(lat),
      lon: Number(lon),
      radiusKm: Number(radius),
      armed,
      alertKm: alertKm.trim() !== "" && Number.isFinite(ak) ? ak : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "saisie invalide");
      return;
    }
    setErr(null);
    setName("");
    setLat("");
    setLon("");
    setRadius("5");
    setAlertKm("");
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
        avancé, forage, village, pont. Chacun <strong>sonne</strong> pour une crue / un séisme à moins
        de 200 km (un feu à moins de 40 km), arme un <strong>périmètre</strong> contre l'intrusion
        drone, et devient sélectionnable dans le comparateur. Partagé par tous les postes.
      </p>
      {/* Recherche de lieu : les cartes publiques décrochent après Abéché (Ennedi, BET, Amdjarass…).
          On tape un nom, le poste remplit les coordonnées, sans dépendre d'une carte externe. */}
      <div className="relative">
        <Input
          data-site="search"
          placeholder="Rechercher un lieu (Amdjarass, Fada, Faya, Abéché…) → remplit les coordonnées"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-border bg-bg shadow-xl">
            {results.map((pl) => (
              <li key={`${pl.name}-${pl.lat}-${pl.lon}`}>
                <button
                  type="button"
                  data-place={pl.name}
                  onClick={() => pick(pl)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary"
                >
                  <span className="text-fg">{pl.name}</span>
                  {pl.region ? <span className="text-muted-foreground">{pl.region}</span> : null}
                  <span className="ml-auto font-mono text-muted-foreground">
                    {pl.lat.toFixed(3)}, {pl.lon.toFixed(3)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
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
        <Button data-site="add" size="sm" variant="outline" disabled={busy} onClick={() => void add()}>
          <Plus className="mr-1 size-3.5" />
          {busy ? "…" : "Ajouter"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <input data-site="armed" type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
          Intrusion aérienne armée
        </label>
        <label className="flex items-center gap-2">
          Rayon alerte phénomènes (km)
          <Input data-site="alertkm" className="w-20" inputMode="decimal" placeholder="défaut" value={alertKm} onChange={(e) => setAlertKm(e.target.value)} />
        </label>
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
              {s.armed === false ? <Badge tone="default">désarmé</Badge> : null}
              {s.alertKm ? <Badge tone="default">alerte {s.alertKm} km</Badge> : null}
              <Button
                data-site-remove={s.id}
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void removeCustomSite(s.id)}
                aria-label={`retirer ${s.name}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Détection auto de CHANGEMENT (Sentinel-2) — pas d'objet ni d'identité. */}
      <div className="space-y-1 rounded-sm border border-border bg-bg/40 p-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input data-site="changewatch" type="checkbox" checked={changeWatch} onChange={(e) => setChangeWatch(e.target.checked)} />
          <span className="font-medium text-fg">Surveillance changement auto (Sentinel-2)</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Le poste compare seul les passages des sites et sonne si la zone a bougé au-delà de</span>
          <Input
            data-site="threshold"
            className="w-16"
            inputMode="decimal"
            value={String(changeThreshold)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setChangeThreshold(n);
            }}
          />
          <span>% du cadre.</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Détection de CHANGEMENT (piste/bâtiment/engin neuf), pas d'objet ni d'identité. Un site toutes
          les 3 min. Nécessite la clé Copernicus (sinon le scan ne renvoie rien).
        </p>
      </div>

      {/* Capteurs SOL — l'entrée pour la détection temps réel véhicule/personne au sol. */}
      <div className="space-y-2 rounded-sm border border-border bg-bg/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-fg">Capteurs sol (périmètre)</h3>
          <Badge tone="default">{sensors.length}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          L'<strong>entrée</strong> pour la détection temps réel véhicule/personne AU SOL
          (caméra/barrière/radar) — ce que l'imagerie satellite ne fait pas. États manuels aujourd'hui ;
          un vrai capteur poussera son état ici quand le matériel sera câblé. Une alarme sonne au bandeau.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Input data-sensor="site" placeholder="Site (ex. Camp Nord)" value={snSite} onChange={(e) => setSnSite(e.target.value)} />
          <select
            data-sensor="type"
            value={snType}
            onChange={(e) => setSnType(e.target.value as SensorType)}
            className="rounded-sm border border-border bg-bg px-2 py-1.5 text-sm text-fg"
          >
            <option value="camera">Caméra</option>
            <option value="barriere">Barrière</option>
            <option value="radar">Radar</option>
            <option value="autre">Autre</option>
          </select>
          <Input data-sensor="name" placeholder="Nom du capteur" value={snName} onChange={(e) => setSnName(e.target.value)} />
          <Button data-sensor="add" size="sm" variant="outline" onClick={() => void addSn()}>
            <Plus className="mr-1 size-3.5" />
            Ajouter
          </Button>
        </div>
        {sensors.length > 0 ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {sensors.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                <Badge tone={s.state === "alarme" ? "crit" : s.state === "hs" ? "warn" : "ok"}>{s.state}</Badge>
                <span className="text-fg">{s.name}</span>
                <span className="text-muted-foreground">
                  {s.type} · {s.site}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button data-sensor-alarm={s.id} size="sm" variant="ghost" onClick={() => void setSensorState(s.id, s.state === "alarme" ? "ok" : "alarme")}>
                    {s.state === "alarme" ? "Lever" : "Alarme"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void setSensorState(s.id, "hs")}>
                    HS
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeSensor(s.id)} aria-label={`retirer ${s.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* NOS drones — suivi ami + imagerie comme SOURCE D'ANALYSE (mouvement), pas un fond. */}
      <div className="space-y-2 rounded-sm border border-border bg-bg/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-fg">Nos drones et caméras (suivi + analyse imagerie)</h3>
          <Badge tone="default">{drones.length}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Une source inscrite (drone ou <strong>caméra fixe</strong>) est intégrée à AfriControl avec ses
          paramètres de liaison : <strong>hôte, port, chemin</strong> (ou une URL directe) — et son
          <strong> journal de connexion</strong>. Un drone est reconnu <strong>ami</strong> (sa piste 1090ES
          n'est plus une intrusion). L'image (flux) devient une source d'analyse : la veille signale un
          <strong> mouvement/présence</strong> et <strong>suit plusieurs pistes</strong> (cap + vitesse,
          id par piste) — jamais une identification de personne. AfriControl <strong>suit et analyse</strong>,
          il ne pilote pas, n'arme rien. Flux accepté : image fixe (snapshot JPEG) ou <strong>MJPEG</strong> ;
          le RTSP demande une passerelle.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            data-drone="kind"
            value={drKind}
            onChange={(e) => setDrKind(e.target.value)}
            className="rounded-sm border border-border bg-bg px-2 py-1.5 text-sm text-fg"
          >
            <option value="drone">Drone</option>
            <option value="camera">Caméra</option>
          </select>
          <Input data-drone="name" placeholder="Nom (ex. Aile-01 / Cam Portail)" value={drName} onChange={(e) => setDrName(e.target.value)} />
          <Input data-drone="ident" placeholder={drKind === "camera" ? "Repère (option.)" : "Identifiant (hex ICAO / indicatif)"} value={drIdent} onChange={(e) => setDrIdent(e.target.value)} />
          <Input data-drone="site" placeholder="Site rattaché" value={drSite} onChange={(e) => setDrSite(e.target.value)} />
          <Input data-drone="host" placeholder="Hôte (ex. 10.0.0.9)" value={drHost} onChange={(e) => setDrHost(e.target.value)} />
          <Input data-drone="port" placeholder="Port (ex. 8080)" value={drPort} onChange={(e) => setDrPort(e.target.value)} />
          <Input data-drone="path" placeholder="Chemin (ex. /snapshot.jpg)" value={drPath} onChange={(e) => setDrPath(e.target.value)} />
          <Input data-drone="url" placeholder="— ou URL directe (http/https)" value={drUrl} onChange={(e) => setDrUrl(e.target.value)} className="sm:col-span-2" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-drone="add" size="sm" variant="outline" onClick={() => void addDr()}>
            <Plus className="mr-1 size-3.5" />
            Inscrire {drKind === "camera" ? "la caméra" : "le drone"}
          </Button>
          <Button data-drone="scan" size="sm" variant="ghost" disabled={scanBusy} onClick={() => void runScan()}>
            {scanBusy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {scanBusy ? "Scan en cours…" : "Scan auto (port/chemin)"}
          </Button>
          <Button data-drone="onvif" size="sm" variant="ghost" disabled={onvifBusy} onClick={() => void runOnvif()}>
            {onvifBusy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {onvifBusy ? "Recherche réseau…" : "Découverte ONVIF (réseau)"}
          </Button>
          {drErr ? <span className="text-xs text-crit">{drErr}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input data-drone="range" placeholder="Plage d'un site distant (ex. 10.20.0.0/24)" value={drRange} onChange={(e) => setDrRange(e.target.value)} className="sm:w-72" />
          <Button data-drone="rangescan" size="sm" variant="ghost" disabled={rangeBusy} onClick={() => void runRange()}>
            {rangeBusy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {rangeBusy ? "Balayage du site distant…" : "Scan de plage (longue distance)"}
          </Button>
          {bulkMsg ? <span data-drone-bulkmsg className="text-xs text-ok">{bulkMsg}</span> : null}
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          <strong>Scan auto</strong> : renseigne l'<strong>hôte</strong> (ex. 10.0.0.9) puis lance — le poste
          teste les ports et chemins de flux les plus courants de NOS caméras et pré-remplit la fiche.
          <strong> Découverte ONVIF</strong> : trouve les caméras du réseau <strong>sans même taper d'IP</strong>
          (sonde multicast) ; « Utiliser » enchaîne direct le scan du chemin. <strong>Scan de plage</strong> :
          pour un site <strong>distant au bout de l'antenne</strong>, balaie son sous-réseau (ex. 10.20.0.0/24) —
          le multicast ne traverse pas les routeurs, un balayage de plage si. <strong>« Tout inscrire »</strong>
          enregistre toutes les caméras trouvées d'un coup. Dans tous les cas : découverte de liaison
          (quel équipement, quel port répond une image), jamais d'identité.
        </p>
        {scanRes ? (
          <div data-drone-scanres className="space-y-1 rounded-sm border border-border bg-bg/60 p-2 text-[11px]">
            {scanRes.error ? (
              <p className="text-crit">Scan : {scanRes.error}</p>
            ) : scanRes.suggested ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ok">flux trouvé</Badge>
                <span className="font-mono text-fg">
                  {scanRes.suggested.host}:{scanRes.suggested.port}{scanRes.suggested.path}
                </span>
                <span className="text-muted-foreground">({scanRes.suggested.kind === "mjpeg" ? "MJPEG" : "image"})</span>
                <Button
                  data-drone-scanuse
                  size="sm"
                  variant="outline"
                  onClick={() => applyScan(scanRes.suggested!)}
                >
                  Utiliser
                </Button>
              </div>
            ) : (
              <p className="text-warn">
                Aucun flux image trouvé automatiquement
                {scanRes.openHttpPorts.length ? ` (ports ouverts : ${scanRes.openHttpPorts.join(", ")} — identifiants peut-être requis)` : ""}.
              </p>
            )}
            {scanRes.found.length > 1 ? (
              <ul className="font-mono text-[10px] text-muted-foreground">
                {scanRes.found.slice(1).map((f) => (
                  <li key={f.url}>
                    autre : {scanRes.host}:{f.port}{f.path} ({f.kind === "mjpeg" ? "MJPEG" : "image"})
                  </li>
                ))}
              </ul>
            ) : null}
            {scanRes.rtsp.some((r) => r.open) ? (
              <p className="text-muted-foreground">
                RTSP détecté sur {scanRes.rtsp.filter((r) => r.open).map((r) => r.port).join(", ")} — non lisible
                par le navigateur : une <strong>passerelle</strong> (RTSP → MJPEG) est requise.
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground">{scanRes.scanned} test(s) effectué(s).</p>
          </div>
        ) : null}
        {onvifRes ? (
          <div data-drone-onvifres className="space-y-1 rounded-sm border border-border bg-bg/60 p-2 text-[11px]">
            {onvifRes.error ? (
              <p className="text-crit">Découverte ONVIF : {onvifRes.error}</p>
            ) : onvifRes.devices.length === 0 ? (
              <p className="text-warn">
                Aucune caméra ONVIF n'a répondu sur le réseau. (Caméra non-ONVIF, ou multicast non routé —
                utilise alors « Scan auto » avec l'IP, ou l'URL directe.)
              </p>
            ) : (
              <>
                <p className="text-fg">{onvifRes.devices.length} caméra(s) ONVIF trouvée(s) sur le réseau :</p>
                <ul className="divide-y divide-border">
                  {onvifRes.devices.map((dev) => (
                    <li key={dev.xaddr} data-onvif-dev={dev.address} className="flex flex-wrap items-center gap-2 py-1">
                      <Badge tone="ok">ONVIF</Badge>
                      <span className="font-mono text-fg">{dev.address}</span>
                      {dev.name ? <span className="text-muted-foreground">{dev.name}</span> : null}
                      {dev.hardware ? <span className="text-muted-foreground">· {dev.hardware}</span> : null}
                      {dev.location ? <span className="text-muted-foreground">· {dev.location}</span> : null}
                      <Button data-onvif-use={dev.address} size="sm" variant="outline" className="ml-auto" onClick={() => void applyOnvif(dev)}>
                        Utiliser
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  data-onvif-all
                  size="sm"
                  variant="outline"
                  onClick={() => void registerAll(onvifRes.devices.map((d) => ({ host: d.host, port: d.port, name: d.name })), true)}
                >
                  Tout inscrire ({onvifRes.devices.length})
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  « Utiliser » remplit l'hôte (type caméra) et enchaîne le « Scan auto » du chemin.
                  « Tout inscrire » enregistre toutes les caméras d'un coup (chemin du flux cherché pour
                  chacune). Métadonnées d'équipement (nom, modèle), jamais d'identité.
                </p>
              </>
            )}
          </div>
        ) : null}
        {rangeRes ? (
          <div data-drone-rangeres className="space-y-1 rounded-sm border border-border bg-bg/60 p-2 text-[11px]">
            {rangeRes.error ? (
              <p className="text-crit">Scan de plage : {rangeRes.error}</p>
            ) : rangeRes.cameras.length === 0 ? (
              <p className="text-warn">
                Aucune caméra trouvée sur la plage ({rangeRes.hosts} hôte(s) balayé(s)
                {rangeRes.openHosts.length ? `, ${rangeRes.openHosts.length} équipement(s) répondent` : ""}).
                Vérifie que le sous-réseau du site distant est bien routé jusqu'au poste.
              </p>
            ) : (
              <>
                <p className="text-fg">
                  {rangeRes.cameras.length} caméra(s) trouvée(s) sur {rangeRes.hosts} hôte(s) balayé(s) :
                </p>
                <ul className="divide-y divide-border">
                  {rangeRes.cameras.map((c) => (
                    <li key={c.url} data-range-cam={`${c.host}:${c.port}`} className="flex flex-wrap items-center gap-2 py-1">
                      <Badge tone="ok">{c.kind === "mjpeg" ? "MJPEG" : "image"}</Badge>
                      <span className="font-mono text-fg">{c.host}:{c.port}{c.path}</span>
                      {c.name ? <span className="text-muted-foreground">{c.name}</span> : null}
                      <Button data-range-use={`${c.host}:${c.port}`} size="sm" variant="outline" className="ml-auto" onClick={() => applyRangeCam(c)}>
                        Utiliser
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  data-range-all
                  size="sm"
                  variant="outline"
                  onClick={() => void registerAll(rangeRes.cameras.map((c) => ({ host: c.host, port: c.port, path: c.path, name: c.name })), false)}
                >
                  Tout inscrire ({rangeRes.cameras.length})
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Site <strong>distant</strong> (au bout de l'antenne) : le sous-réseau est balayé, chaque flux
                  trouvé a déjà son chemin. {rangeRes.scanned} test(s). Nom par ONVIF unicast si dispo. Jamais d'identité.
                </p>
              </>
            )}
          </div>
        ) : null}

        {/* SITES DISTANTS mémorisés : plage de chaque site, re-scan d'un clic, détection tombée/nouvelle. */}
        <div className="space-y-2 rounded-sm border border-dashed border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg">Sites distants (plages mémorisées)</span>
            <Badge tone="default">{siteNets.length}</Badge>
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            Mémorise la plage réseau de chaque site (au bout de l'antenne) pour la <strong>re-scanner d'un
            clic</strong>. Chaque re-scan signale une caméra <strong>tombée</strong> (disparue) ou une
            <strong> nouvelle</strong> apparue sur le périmètre. Présence d'équipement, jamais d'identité.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input data-net="name" placeholder="Nom du site (ex. Poste Est)" value={snNetName} onChange={(e) => setSnNetName(e.target.value)} />
            <Input data-net="range" placeholder="Plage (ex. 10.20.0.0/24)" value={snNetRange} onChange={(e) => setSnNetRange(e.target.value)} />
            <Button data-net="add" size="sm" variant="outline" onClick={() => void addNet()}>
              <Plus className="mr-1 size-3.5" />
              Mémoriser
            </Button>
          </div>
          {snNetErr ? <span className="text-xs text-crit">{snNetErr}</span> : null}
          {siteNets.length > 0 ? (
            <label className="flex flex-wrap items-center gap-2 text-[11px] text-fg">
              <input data-net="autowatch" type="checkbox" checked={siteNetWatch} onChange={(e) => setSiteNetWatch(e.target.checked)} />
              Re-scan automatique du périmètre
              <span className="text-muted-foreground">toutes les</span>
              <select
                data-net="cadence"
                value={siteNetCadenceMin}
                onChange={(e) => setSiteNetCadence(Number(e.target.value) || 15)}
                className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] text-fg"
              >
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
              <span className="text-muted-foreground">→ alerte si une caméra tombe ou apparaît</span>
            </label>
          ) : null}
          {siteNets.length > 0 ? (
            <ul className="divide-y divide-border rounded-sm border border-border">
              {siteNets.map((s) => {
                const ns = netScan[s.id] ?? {};
                return (
                  <li key={s.id} data-net-row={s.id} className="flex flex-col gap-1 px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-fg">{s.name}</span>
                      <span className="font-mono text-muted-foreground">{s.range}</span>
                      {s.cams && s.cams.length ? <Badge tone="ok">{s.cams.length} caméra(s)</Badge> : null}
                      {s.lastScanAt ? <span className="text-muted-foreground">dernier : {new Date(s.lastScanAt).toLocaleTimeString("fr-FR")}</span> : null}
                      <div className="ml-auto flex items-center gap-1">
                        <Button data-net-rescan={s.id} size="sm" variant="ghost" disabled={ns.busy} onClick={() => void rescanNet(s)}>
                          {ns.busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                          {ns.busy ? "Balayage…" : "Re-scanner"}
                        </Button>
                        <Button data-net-remove={s.id} size="sm" variant="ghost" onClick={() => void removeSiteNet(s.id)} aria-label={`retirer ${s.name}`}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {ns.err ? <span className="text-crit">{ns.err}</span> : null}
                    {ns.at ? (
                      <div data-net-diff={s.id} className="flex flex-wrap items-center gap-2">
                        {ns.added && ns.added.length ? <span className="text-ok">+{ns.added.length} nouvelle(s) : {ns.added.join(", ")}</span> : null}
                        {ns.removed && ns.removed.length ? <span className="text-crit">−{ns.removed.length} tombée(s) : {ns.removed.join(", ")}</span> : null}
                        {(!ns.added || !ns.added.length) && (!ns.removed || !ns.removed.length) ? <span className="text-muted-foreground">aucun changement · {ns.cams?.length ?? 0} caméra(s)</span> : null}
                        {ns.cams && ns.cams.length ? (
                          <Button data-net-all={s.id} size="sm" variant="outline" onClick={() => void registerAll((ns.cams ?? []).map((c) => ({ host: c.host, port: c.port, path: c.path, name: c.name })), false)}>
                            Tout inscrire ({ns.cams.length})
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <label className="flex flex-wrap items-center gap-2 text-xs text-fg">
          <input data-drone="watch" type="checkbox" checked={droneWatch} onChange={(e) => setDroneWatch(e.target.checked)} />
          Veille mouvement (imagerie drone)
          <span className="text-muted-foreground">seuil</span>
          <input
            data-drone="threshold"
            type="number"
            min={1}
            max={90}
            value={droneThreshold}
            onChange={(e) => setDroneThreshold(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
            className="w-16 rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg"
          />
          <span className="text-muted-foreground">% du cadre</span>
          <span className="text-muted-foreground">· cadence</span>
          <select
            data-drone="cadence"
            value={droneCadence}
            onChange={(e) => setDroneCadence(Number(e.target.value) || 15)}
            className="rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg"
          >
            <option value={15}>Normale (15 s)</option>
            <option value={5}>Rapprochée (5 s)</option>
            <option value={3}>Continue (3 s)</option>
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-xs text-fg">
          <input data-drone="nightonly" type="checkbox" checked={droneNightOnly} onChange={(e) => setDroneNightOnly(e.target.checked)} />
          N'alerter que sur une fenêtre horaire (ex. nuit)
          <span className="text-muted-foreground">de</span>
          <input
            data-drone="armfrom"
            type="number"
            min={0}
            max={23}
            value={droneArmFrom}
            onChange={(e) => setDroneArmWindow(Math.max(0, Math.min(23, Number(e.target.value) || 0)), droneArmTo)}
            className="w-14 rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg"
          />
          <span className="text-muted-foreground">h à</span>
          <input
            data-drone="armto"
            type="number"
            min={0}
            max={23}
            value={droneArmTo}
            onChange={(e) => setDroneArmWindow(droneArmFrom, Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
            className="w-14 rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg"
          />
          <span className="text-muted-foreground">h · hors fenêtre : suivi + journal, sans alerte</span>
        </label>
        {drones.length > 0 ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {drones.map((d) => {
              const m = droneMotion[d.id];
              const alarmed = m?.pct != null && m.pct >= droneThreshold;
              const open = openCapture === d.id;
              const logOpen = openLog === d.id;
              const log = droneLog[d.id] ?? [];
              const last = log[0];
              const isCam = d.kind === "camera";
              const hostPort = d.host ? `${d.host}${d.port ? `:${d.port}` : ""}` : null;
              return (
                <li key={d.id} className="flex flex-col gap-1.5 px-3 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={isCam ? "default" : "ok"}>{isCam ? "caméra" : "ami"}</Badge>
                    <span className="text-fg">{d.name}</span>
                    <span className="text-muted-foreground">
                      {d.ident}
                      {d.site ? ` · ${d.site}` : ""}
                      {hostPort ? ` · ${hostPort}` : d.snapshotUrl ? " · flux ✓" : " · pas de flux"}
                    </span>
                    {last ? (
                      <Badge tone={last.ok ? "ok" : "warn"}>{last.ok ? "en ligne" : "injoignable"}</Badge>
                    ) : null}
                    {m ? (
                      <Badge tone={m.error ? "warn" : alarmed ? "crit" : "default"}>
                        {m.error ? m.error : m.pct == null ? "trame de réf." : `mvt ${m.pct}%`}
                      </Badge>
                    ) : null}
                    {m && m.pct != null && !m.error ? (
                      <span className="text-muted-foreground">
                        {m.targets ? `${m.targets} piste${m.targets > 1 ? "s" : ""} · ` : ""}
                        {m.hint}
                        {m.where && m.where !== "—" ? ` · ${m.where}` : ""}
                        {m.heading && m.heading !== "immobile" ? ` · → ${m.heading}${m.speed ? ` ${m.speed}%/s` : ""}` : ""}
                      </span>
                    ) : null}
                    {m?.note ? <span className="text-warn">⚠ {m.note}</span> : null}
                    <div className="ml-auto flex items-center gap-1">
                      {log.length > 0 ? (
                        <Button data-drone-log={d.id} size="sm" variant="ghost" onClick={() => setOpenLog(logOpen ? null : d.id)}>
                          {logOpen ? "Masquer log" : "Journal"}
                        </Button>
                      ) : null}
                      {m?.frame ? (
                        <Button
                          data-drone-capture={d.id}
                          size="sm"
                          variant={alarmed ? "outline" : "ghost"}
                          onClick={() => setOpenCapture(open ? null : d.id)}
                        >
                          {open ? "Fermer" : "Capture"}
                        </Button>
                      ) : null}
                      <Button data-drone-remove={d.id} size="sm" variant="ghost" onClick={() => void removeDrone(d.id)} aria-label={`retirer ${d.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {logOpen && log.length > 0 ? (
                    <ul data-drone-logbox={d.id} className="rounded-sm border border-border bg-bg/60 p-2 font-mono text-[10.5px]">
                      {log.map((e, i) => (
                        <li key={i} className={e.ok ? "text-muted-foreground" : "text-warn"}>
                          {new Date(e.at).toLocaleTimeString("fr-FR")} · {e.ok ? "OK" : "ERR"} · {e.msg}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {open && m?.frame ? (
                    <div className="space-y-2 rounded-sm border border-border bg-bg/60 p-2 text-[11px] text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setZoomCap(zoomCap === d.id ? null : d.id)}>
                          {zoomCap === d.id ? "Réduire" : "Zoom"}
                        </Button>
                        <Button data-drone-pdf={d.id} size="sm" variant="ghost" onClick={() => void exportPdf(d, m)}>
                          Export PDF
                        </Button>
                        {(() => {
                          const zones = sourceZones(d);
                          return (
                            <>
                              <Button
                                data-drone-roi={d.id}
                                size="sm"
                                variant={roiEdit === d.id ? "outline" : "ghost"}
                                onClick={() => {
                                  if (roiEdit === d.id) { setRoiEdit(null); setRoiPts([]); }
                                  else { setRoiEdit(d.id); setRoiPts([]); }
                                }}
                              >
                                {roiEdit === d.id ? "Annuler" : zones.length ? "Ajouter une zone" : "Définir zone"}
                              </Button>
                              {roiEdit === d.id ? (
                                <>
                                  <Button data-drone-roiclose={d.id} size="sm" variant="outline" disabled={roiPts.length < 3} onClick={() => { void setDroneZones(d.id, [...zones, roiPts]); setRoiEdit(null); setRoiPts([]); }}>
                                    Fermer la zone ({roiPts.length})
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setRoiPts([])}>Vider</Button>
                                </>
                              ) : null}
                              {zones.length > 0 ? (
                                <>
                                  {zones.map((_, i) => (
                                    <Button key={i} data-drone-zonedel={`${d.id}:${i}`} size="sm" variant="ghost" onClick={() => void setDroneZones(d.id, zones.filter((__, idx) => idx !== i))}>
                                      Zone {i + 1} ✕
                                    </Button>
                                  ))}
                                  <Button size="sm" variant="ghost" onClick={() => void setDroneZones(d.id, [])}>Effacer zones</Button>
                                </>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className={`relative ${zoomCap === d.id ? "w-full" : "w-72 shrink-0"}`}>
                          <img
                            data-drone-frame={d.id}
                            src={m.frame}
                            alt={`capture ${d.name}`}
                            onClick={(e) => {
                              if (roiEdit === d.id) {
                                const r = e.currentTarget.getBoundingClientRect();
                                const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                                const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                                setRoiPts((pts) => [...pts, { x, y }]);
                              } else setZoomCap(zoomCap === d.id ? null : d.id);
                            }}
                            className={`block h-auto w-full rounded-sm border border-border ${roiEdit === d.id ? "cursor-crosshair" : "cursor-zoom-in"}`}
                          />
                          {(() => {
                            const zones = sourceZones(d);
                            const drawn = roiEdit === d.id ? [...zones, roiPts] : zones;
                            const polys = drawn.filter((poly) => poly.length >= 2);
                            return polys.length > 0 ? (
                              <svg data-drone-roisvg={d.id} className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                                {polys.map((poly, i) => (
                                  <polygon key={i} points={poly.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(120,200,255,0.15)" stroke="rgba(120,200,255,0.95)" strokeWidth={0.005} />
                                ))}
                              </svg>
                            ) : null;
                          })()}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-fg">
                            Mouvement <strong>{m.pct}%</strong> · {m.targets ?? 0} piste{(m.targets ?? 0) > 1 ? "s" : ""} · {m.hint} · {m.where}
                          </p>
                          {m.tracks && m.tracks.length > 0 ? (
                            <ul className="font-mono text-[10.5px]">
                              {m.tracks.map((t) => (
                                <li key={t.id}>
                                  T{t.id} · {t.where} · {t.stationary || t.heading === "immobile" ? `immobile${t.dwell ? ` ${t.dwell}s` : ""}` : <>→ {t.heading} {t.speed}%/s</>}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {m.note ? <p className="text-warn">⚠ {m.note}</p> : null}
                          {/* RÈGLE PAR EMPLACEMENT : fenêtre nuit propre à CETTE source (sinon hérite du global). */}
                          {(() => {
                            const hasRule = typeof d.nightOnly === "boolean";
                            const from = d.armFrom ?? droneArmFrom;
                            const to = d.armTo ?? droneArmTo;
                            return (
                              <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-bg/40 px-2 py-1">
                                <label className="flex items-center gap-1.5">
                                  <input
                                    data-drone-rule={d.id}
                                    type="checkbox"
                                    checked={hasRule}
                                    onChange={(e) => void setDroneRule(d.id, e.target.checked ? { nightOnly: true, armFrom: from, armTo: to } : null)}
                                  />
                                  Fenêtre nuit propre à cette source
                                </label>
                                {hasRule ? (
                                  <>
                                    <span>de</span>
                                    <input
                                      data-drone-rulefrom={d.id}
                                      type="number"
                                      min={0}
                                      max={23}
                                      value={from}
                                      onChange={(e) => void setDroneRule(d.id, { nightOnly: true, armFrom: Math.max(0, Math.min(23, Number(e.target.value) || 0)), armTo: to })}
                                      className="w-14 rounded-sm border border-border bg-bg px-2 py-0.5 text-xs text-fg"
                                    />
                                    <span>h à</span>
                                    <input
                                      data-drone-ruleto={d.id}
                                      type="number"
                                      min={0}
                                      max={23}
                                      value={to}
                                      onChange={(e) => void setDroneRule(d.id, { nightOnly: true, armFrom: from, armTo: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                                      className="w-14 rounded-sm border border-border bg-bg px-2 py-0.5 text-xs text-fg"
                                    />
                                    <span>h</span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">hérite du global ({droneNightOnly ? `nuit ${droneArmFrom}→${droneArmTo} h` : "24/24"})</span>
                                )}
                              </div>
                            );
                          })()}
                          <p>
                            Image <strong>pleine résolution</strong> : clique pour <strong>zoomer</strong> et lire la
                            scène. <strong>Plusieurs zones</strong> possibles (« Ajouter une zone ») : on n'arme que
                            DANS l'une d'elles (ignore la route). Chaque source peut avoir sa <strong>fenêtre nuit</strong>
                            propre. « Export PDF » = dossier de preuve transmissible. C'est une
                            <strong> aide à la décision</strong> : l'opérateur regarde et <strong>identifie à l'œil</strong>.
                            AfriControl ne reconnaît ni visage ni plaque, ne cible pas.
                          </p>
                          {m.level === "critique" ? <p className="text-crit">Périmètre armé : envoyer une patrouille.</p> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
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
