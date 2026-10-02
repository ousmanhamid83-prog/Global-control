import {
  classLabel,
  idStateLabel,
  originLabel,
  PLATFORM_BY_ID,
  roleLabel,
  sensorLabel,
  threatLabel,
} from "@/lib/vigilair/catalog";
import { methodBlurb } from "@/lib/vigilair/engine";
import { canRequestEw, STEALTH_NOTE } from "@/lib/vigilair/ew";
import { getEvidencePdf } from "@/lib/vigilair/evidence-store";
import { formatCoord } from "@/lib/vigilair/geo";
import { formatHash, originTone, threatTone } from "@/lib/vigilair/format";
import { friendBlurb, friendLabel, isFriend } from "@/lib/vigilair/friends";
import {
  canRequestM4,
  iffModeRows,
  m4Label,
  m4Tone,
  M4_STEALTH,
} from "@/lib/vigilair/iff";
import { inferSurveillance, surveillanceLabel } from "@/lib/vigilair/mode-s";
import type { Track } from "@/lib/vigilair/types";
import { treatContact } from "@/lib/vigilair/treat";
import { useStaff } from "@/lib/vigilair/staff-context";
import { threatOf, useVigilair } from "@/lib/vigilair/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Crosshair, EyeOff, FilePlus2, FileText, Fingerprint, Mic, RadioTower } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function Dossier() {
  const selectedId = useVigilair((s) => s.selectedId);
  const track = useVigilair((s) => s.tracks.find((t) => t.id === selectedId));
  const fileBulletin = useVigilair((s) => s.fileBulletin);
  const requestEw = useVigilair((s) => s.requestEw);
  const requestM4 = useVigilair((s) => s.requestM4);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const lockLive = useVigilair((s) => s.lockLive);
  const liveN = useVigilair((s) => s.tracks.filter((t) => t.feed === "adsb").length);
  const ewArmed = useVigilair((s) => s.ewArmed);
  const journal = useVigilair((s) => s.journal);
  const { isSuperadmin } = useStaff();

  if (!track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Crosshair className="size-8 text-muted" />
        <p className="text-sm font-medium">Veille réelle</p>
        <p className="text-xs text-muted-foreground">
          Pas de piste verrouillée. Les contacts 1090ES live, METAR, SIGMET et
          GNSS s'affichent dès qu'un transpondeur est entendu. Un inject n'est
          qu'un exercice.
        </p>
      </div>
    );
  }

  const topId = track.hypotheses[0]?.platformId ?? (track.idState === "hors-mandat" ? track.truePlatformId : undefined);
  const plat = topId ? PLATFORM_BY_ID[topId] : undefined;
  const threat = threatOf(track);
  const already = journal.find((j) => j.trackId === track.id);
  const sealed = Boolean(already?.contentSha256);
  const pendingFile = Boolean(already?.pending);
  const alreadyFiled = sealed || pendingFile;
  const canFile =
    (track.idState === "confirme" || track.idState === "hors-mandat" || track.idState === "candidat") &&
    Boolean(plat);
  const ew = canRequestEw(track, ewArmed);
  const ewBusy = track.ew?.state === "demande" || track.ew?.state === "effet";
  const ami = isFriend(track);
  const m4 = canRequestM4(track);
  const m4Busy = track.iff?.m4 === "demande";
  const modes = track.iff ? iffModeRows(track.iff) : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
          <h2 className="text-lg font-semibold tracking-tight">
            {plat ? `${plat.manufacturer} ${plat.name}` : idStateLabel(track.idState)}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {track.feed === "adsb" ? (
              <Badge tone="ok">1090ES live</Badge>
            ) : null}
            {ami && track.friendKind ? (
              <Badge tone="ok">AMI {friendLabel(track.friendKind)}</Badge>
            ) : null}
            <Badge tone={ami ? "ok" : originTone(track.origin)}>
              {track.origin ? originLabel(track.origin) : "Origine indéterminée"}
              {ami ? " · constructeur" : ""}
            </Badge>
            <Badge tone={threatTone(threat)}>{threatLabel(threat)}</Badge>
            <Badge>{idStateLabel(track.idState)}</Badge>
            {track.locked ? <Badge tone="ok">Traj. verrouillée</Badge> : null}
            {track.ew?.state === "effet" ? <Badge tone="crit">Effet RF</Badge> : null}
            {track.iff ? (
              <Badge tone={m4Tone(track.iff.m4)}>{m4Label(track.iff.m4)}</Badge>
            ) : (
              <Badge>sans IFF</Badge>
            )}
            <Badge tone="ok">
              <EyeOff className="mr-1 size-3" />
              Silencieux
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-medium tabular-nums leading-none">
            {Math.round(track.confidence)}
            <span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">confiance</p>
        </div>
      </div>
      <Separator />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 p-4 text-sm">
        <Item label="Position" value={formatCoord(track.lat, track.lon)} mono />
        <Item label="Altitude" value={`${Math.round(track.altM)} m`} mono />
        <Item label="Vitesse" value={`${Math.round(track.speedKmh)} km/h`} mono />
        <Item label="Cap" value={`${Math.round(track.heading)}°`} mono />
        <Item
          label="Classe"
          value={track.classGuess ? classLabel(track.classGuess) : "—"}
        />
        <Item
          label="Capteurs"
          value={
            track.feed === "adsb"
              ? "1090ES réseau (passif)"
              : track.sensors.map(sensorLabel).join(" · ") || "—"
          }
        />
        <Item label="Couloir" value={track.corridor ?? "—"} />
        {track.feed === "adsb" ? (
          <>
            <Item label="Type ICAO" value={track.icaoType ?? "—"} mono />
            <Item label="Immat." value={track.reg ?? "—"} mono />
            <Item label="Nationalité" value={track.nation ?? "allocation OACI —"} mono />
            <Item label="Urgence" value={track.emergency ?? "aucune"} mono />
            <Item
              label="RSSI"
              value={track.rssi != null ? `${track.rssi.toFixed(1)} dBFS` : "réseau"}
              mono
            />
          </>
        ) : null}
        <Item
          label="CPA site"
          value={
            track.cpa
              ? `${track.cpa.name} · ${track.cpa.distKm.toFixed(1)} km${
                  track.cpa.etaS ? ` · ${track.cpa.etaS} s` : ""
                }${track.cpa.closing ? " · rapprochement" : ""}`
              : "—"
          }
        />
        <Item
          label="Acoustique"
          value={
            track.acoustic?.locked
              ? `Lock ${track.acoustic.bpfHz} Hz · SNR ${track.acoustic.snrDb} dB`
              : "Hors ACO"
          }
        />
        <Item
          label="Gonio TEL"
          value={
            track.pilotFix
              ? `${Math.round(track.pilotFix.quality)} % · ${track.pilotFix.method}`
              : "—"
          }
        />
        <Item
          label="Envoi SRC"
          value={
            track.launchFix
              ? `${track.launchFix.lat.toFixed(5)}, ${track.launchFix.lon.toFixed(5)}`
              : "—"
          }
          mono
        />
        <Item
          label="Arrêt"
          value={
            track.stopFix
              ? `${track.stopFix.predicted ? "prévu" : "constaté"} · ${track.stopFix.lat.toFixed(5)}, ${track.stopFix.lon.toFixed(5)}`
              : "—"
          }
          mono
        />
      </dl>
      <Separator />
      <div className="space-y-3 p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Modes IFF
        </h3>
        {modes.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {modes.map((row) => (
              <div key={row.id}>
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5">
                  <Badge tone={row.tone}>{row.value}</Badge>
                </dd>
              </div>
            ))}
            <Item
              label="Site interrogateur"
              value={track.iff?.m4Site ?? "—"}
            />
            <Item
              label="Affiliation"
              value={
                track.feed === "adsb"
                  ? `1090ES live${track.nation ? ` · ${track.nation}` : ""}`
                  : track.friendKind
                    ? `${friendLabel(track.friendKind)} · ${
                        track.iff?.source === "iff-fatl"
                          ? "IFF FATL"
                          : "ADS-B ASECNA (exercice)"
                      }`
                    : track.iff?.flightId ?? "Non corrélé"
              }
            />
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            Pas de transpondeur corrélé. Un challenge Mode 4 peut être demandé
            via l'interrogateur du site radar.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {track.iff?.m4Note ?? M4_STEALTH}
        </p>
        {track.iff?.mlat ? (
          <p
            className={
              track.iff.mlat.spoofSuspect
                ? "text-xs text-crit"
                : "text-xs text-muted-foreground"
            }
          >
            MLAT {track.iff.mlat.nSites} sites · résidu{" "}
            {track.iff.mlat.residualKm.toFixed(2)} km
            {track.iff.mlat.adsbDeltaKm != null
              ? ` · écart ADS-B ${track.iff.mlat.adsbDeltaKm.toFixed(1)} km`
              : ""}
            {track.iff.surveillance
              ? ` · ${surveillanceLabel(inferSurveillance(track.iff))}`
              : ""}
          </p>
        ) : track.iff ? (
          <p className="text-xs text-muted-foreground">
            {track.iff.surveillance
              ? surveillanceLabel(inferSurveillance(track.iff))
              : "Pas de Mode S"}{" "}
            · pas de MLAT (volume ou ICAO24 insuffisant).
          </p>
        ) : null}
        {track.iff?.replies && track.iff.replies.length > 0 ? (
          <ol className="space-y-1 font-mono text-xs text-muted-foreground">
            {track.iff.replies.slice(0, 4).map((r) => (
              <li key={r.id}>
                {r.df}
                {r.bds ? ` ${r.bds}` : ""} · {r.payload}
              </li>
            ))}
          </ol>
        ) : null}
        <Button
          variant={m4Busy ? "secondary" : "outline"}
          className="w-full"
          disabled={m4Busy || !m4.ok}
          onClick={() => requestM4(track.id)}
        >
          <Fingerprint />
          {track.iff?.m4 === "demande"
            ? "Interrogation en cours"
            : track.iff?.m4 && track.iff.m4 !== "absent"
              ? "Réinterroger Mode 4"
              : "Demander Mode 4"}
        </Button>
        {!m4.ok ? (
          <p className="text-xs text-muted-foreground">{m4.reason}</p>
        ) : null}
        <Button asChild variant="outline" className="w-full">
          <Link to="/iff">Pupitre IFF · Mode 4 / Mode S / MLAT</Link>
        </Button>
      </div>
      {plat ? (
        <>
          <Separator />
          <div className="space-y-3 p-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fiche signature
            </h3>
            <p className="text-sm text-muted-foreground">{plat.notes}</p>
            {ami && track.friendKind ? (
              <p className="text-xs text-ok">{friendBlurb(track.friendKind)}</p>
            ) : null}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <Item label="Rôle" value={roleLabel(plat.role)} />
              <Item label="Masse" value={`${plat.massKg} kg`} mono />
              <Item label="Autonomie" value={`${plat.enduranceMin} min`} mono />
              <Item label="Portée" value={`${plat.rangeKm} km`} mono />
              <Item label="Plafond" value={`${plat.ceilingM} m`} mono />
              <Item label="Protocole" value={plat.protocol} />
              <Item label="Bandes RF" value={plat.rfBands.join(" · ")} />
              <Item label="Remote ID" value={plat.remoteId ? "Présent (écoute seule)" : "Absent"} />
              <Item label="Emport" value={plat.payload} />
            </dl>
            <p className="text-xs text-muted-foreground">{methodBlurb(track)}</p>
            <p className="text-xs text-muted-foreground">{STEALTH_NOTE}</p>
          </div>
        </>
      ) : null}

      {track.hypotheses.length > 0 ? (
        <>
          <Separator />
          <div className="p-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hypothèses
            </h3>
            <ol className="space-y-1">
              {track.hypotheses.map((h, i) => {
                const hp = PLATFORM_BY_ID[h.platformId];
                if (!hp) return null;
                return (
                  <li
                    key={h.platformId}
                    className="flex items-center justify-between gap-2 rounded-sm bg-secondary/60 px-2 py-2 text-sm"
                  >
                    <span>
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      {hp.manufacturer} {hp.name}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {Math.round(h.score)}%
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      ) : null}

      <div className="mt-auto space-y-2 p-4">
        <Button className="w-full" variant="outline" disabled={liveN === 0} onClick={() => lockLive()}>
          <Fingerprint />
          Inject réel 1090ES
        </Button>
        {track.feed === "adsb" || track.locked ? <TransponderBlock track={track} /> : null}
        <Button
          variant={track.locked ? "default" : "outline"}
          className="w-full"
          onClick={() => lockTrack(track.locked ? null : track.id)}
        >
          <Crosshair />
          {track.locked ? "Trajectoire verrouillée" : "Verrouiller la trajectoire"}
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/ident">Vue identification 120 km</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/radar">Écran radar PPI</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/trace">Traçabilité Sentinel</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/audio">
            <Mic />
            Écoute SIGINT
          </Link>
        </Button>
        {isSuperadmin ? (
          <>
            <Button
              className="w-full"
              variant={ewBusy ? "secondary" : "outline"}
              disabled={ewBusy}
              onClick={() => requestEw(track.id)}
            >
              <RadioTower />
              {track.ew?.state === "effet"
                ? "Effet RF en cours (externe)"
                : track.ew?.state === "demande"
                  ? "Demande transmise"
                  : ewArmed
                    ? "Demander un effet RF"
                    : "RF désarmé — activer en en-tête"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {ewBusy ? track.ew?.note : ew.ok ? ew.reason : ew.reason}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Brouillage et contrôle réservés au chef de division. Détection,
            identification et SIGINT restent disponibles.
          </p>
        )}
        <Button
          className="w-full"
          disabled={!canFile || alreadyFiled}
          onClick={() => fileBulletin(track.id)}
        >
          <FilePlus2 />
          {already?.pending
            ? "Versement au serveur…"
            : already?.contentSha256
              ? "Dossier scellé au journal"
              : already?.fileError
                ? "Réessayer le versement PDF"
                : "Verser le dossier de preuve (PDF)"}
        </Button>
        {already?.fileError && !already.contentSha256 ? (
          <p className="text-xs text-warn">{already.fileError}</p>
        ) : null}
        {already?.contentSha256 ? (
          <div className="space-y-2">
            <p className="font-mono text-xs text-muted-foreground">
              SHA-256 {formatHash(already.contentSha256)}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                void getEvidencePdf({ data: already.id }).then((doc) => {
                  const bin = Uint8Array.from(atob(doc.b64), (c) => c.charCodeAt(0));
                  const blob = new Blob([bin], { type: "application/pdf" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = doc.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                });
              }}
            >
              <FileText />
              Télécharger le PDF
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Item({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs tabular-nums" : "text-sm"}>{value}</dd>
    </div>
  );
}

function TransponderBlock({ track }: { track: Track }) {
  const pic = useVigilair((s) => s.livePicture);
  const treated = treatContact(
    {
      id: track.id,
      callsign: track.callsign,
      lat: track.lat,
      lon: track.lon,
      altM: track.altM,
      nic: track.nic ?? null,
      nacp: track.nacp ?? null,
      squawk: track.iff?.squawk ?? null,
      icao24: track.iff?.icao24 ?? null,
      mode: track.iff?.mode ?? null,
    },
    pic,
  );
  return (
    <section className="space-y-1 rounded-md border border-border bg-surface p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Traité · {treated.verdict}
      </p>
      <p className="font-mono text-xs">{treated.xpdr}</p>
      <p className="text-xs text-muted-foreground">{treated.metar}</p>
      <p className="text-xs text-muted-foreground">{treated.sigmet}</p>
      <p className="text-xs text-muted-foreground">{treated.gnss}</p>
    </section>
  );
}
