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
import { getEvidencePdf } from "@/lib/vigilair/evidence-store";
import { formatCoord } from "@/lib/vigilair/geo";
import { formatHash, originTone, threatTone } from "@/lib/vigilair/format";
import { friendBlurb, friendLabel, isFriend } from "@/lib/vigilair/friends";
import { iffModeRows } from "@/lib/vigilair/iff";
import { surveillanceLabel } from "@/lib/vigilair/mode-s";
import type { Track } from "@/lib/vigilair/types";
import { rejeuClock } from "@/lib/vigilair/rejeu";
import { treatContact } from "@/lib/vigilair/treat";
import { threatOf, useVigilair } from "@/lib/vigilair/store";
import { askAssistant } from "@/lib/vigilair/live-feeds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ReponseIa } from "@/components/vigilair/reponse-ia";
import { Crosshair, EyeOff, FilePlus2, FileText, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

export function Dossier() {
  const selectedId = useVigilair((s) => s.selectedId);
  const track = useVigilair((s) => s.tracks.find((t) => t.id === selectedId));
  const fileBulletin = useVigilair((s) => s.fileBulletin);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const lockLive = useVigilair((s) => s.lockLive);
  const liveN = useVigilair((s) => s.tracks.filter((t) => t.feed === "adsb").length);
  const journal = useVigilair((s) => s.journal);
  const autoPick = useVigilair((s) => s.autoPick);
  const autoLockOn = useVigilair((s) => s.autoLockOn);
  const setAutoLockOn = useVigilair((s) => s.setAutoLockOn);
  const select = useVigilair((s) => s.select);

  if (!track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Crosshair className="size-8 text-muted" />
        <p className="text-sm font-medium">Veille réelle</p>
        <p className="text-xs text-muted-foreground">
          {autoLockOn
            ? "Aucun transpondeur entendu pour l'instant. Seules les pistes 1090ES ont besoin d'un transpondeur ; le METAR, le SIGMET et le GNSS tournent en continu (Capteurs > Météo / GNSS), même sans piste. Dès qu'une piste réelle est reçue, le verrou auto l'ouvre ici et la croise avec ces trois sources. Un rejeu ou un exercice est toujours marqué comme tel."
            : "Verrou auto coupé, aucune piste choisie. Cliquer une piste sur la carte ou le radar pour l'ouvrir ici. Un rejeu ou un exercice est toujours marqué comme tel."}
        </p>
        {!autoLockOn ? (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setAutoLockOn(true)}>
            <Crosshair />
            Réactiver le verrou auto
          </Button>
        ) : null}
      </div>
    );
  }

  const isAuto = autoPick?.id === track.id;
  const rej = track.feed === "rejeu" ? track.rejeu : undefined;
  // Données transpondeur réelles : live, ou rejouées depuis une bande enregistrée.
  const heard = track.feed === "adsb" || track.feed === "rejeu";

  const topId = track.hypotheses[0]?.platformId;
  const plat = topId ? PLATFORM_BY_ID[topId] : undefined;
  const threat = threatOf(track);
  const already = journal.find((j) => j.trackId === track.id);
  const sealed = Boolean(already?.contentSha256);
  const pendingFile = Boolean(already?.pending);
  const alreadyFiled = sealed || pendingFile;
  const canFile = (track.idState === "confirme" || track.idState === "candidat") && Boolean(plat);
  const ami = isFriend(track);
  const modes = track.iff ? iffModeRows(track.iff) : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {track.exercice ? (
        <div className="space-y-1 border-b border-border bg-warn/10 px-4 py-3" data-testid="exercice-dossier">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-warn">
            Exercice · pas un contact réel
          </p>
          <p className="text-xs text-fg">
            Vol réel de notre drone <span className="font-medium">{track.exercice.drone}</span>, joué
            comme intrus{plat ? ` (${plat.manufacturer} ${plat.name})` : ""}.
          </p>
          <p className="text-xs text-muted-foreground">
            Position, altitude, vitesse et cap : la télémétrie MAVLink de son autopilote. Alertes jamais
            relayées par Signal.
          </p>
        </div>
      ) : null}
      {rej ? (
        <div className="space-y-1 border-b border-border bg-primary/10 px-4 py-3" data-testid="rejeu-dossier">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
            Rejeu réel · pas un contact live
          </p>
          <p className="text-xs text-fg">
            Position reçue le <span className="font-mono tabular-nums">{rejeuClock(rej.posAt)}</span> ·{" "}
            {rej.kind === "poste" ? "bande de ce poste" : "archive réelle"}
          </p>
          <p className="text-xs text-muted-foreground">{rej.source}</p>
        </div>
      ) : null}
      {isAuto ? (
        <div className="space-y-2 border-b border-border bg-primary/10 px-4 py-3" data-testid="auto-lock">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
            Verrou auto · piste réelle
          </p>
          <p className="text-xs text-fg">{autoPick.reason}</p>
          <p className="text-[11px] text-muted-foreground">
            Choisie par la console. Un clic sur une autre piste reprend la main.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => select(track.id)}>
              Garder cette piste
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAutoLockOn(false)}>
              Couper le verrou auto
            </Button>
          </div>
        </div>
      ) : !autoLockOn ? null : (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
            Choix opérateur
          </span>
          <Button size="sm" variant="ghost" onClick={() => setAutoLockOn(true)}>
            Rendre au verrou auto
          </Button>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{track.callsign}</p>
          <h2 className="text-lg font-semibold tracking-tight">
            {plat ? `${plat.manufacturer} ${plat.name}` : idStateLabel(track.idState)}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {track.feed === "adsb" ? (
              <Badge tone="ok">{track.sensors.includes("antenne") ? "1090ES antenne" : "1090ES réseau"}</Badge>
            ) : null}
            {rej ? <Badge tone="warn">REJEU RÉEL</Badge> : null}
            {ami && track.friendKind ? (
              <Badge tone={track.friendKind === "civil" ? "default" : "ok"}>{track.friendKind === "civil" ? "CIVIL" : `AMI ${friendLabel(track.friendKind)}`}</Badge>
            ) : null}
            <Badge tone={ami ? "ok" : originTone(track.origin)}>
              {track.origin ? originLabel(track.origin) : "Origine indéterminée"}
              {ami ? " · constructeur" : ""}
            </Badge>
            <Badge tone={threatTone(threat)}>{threatLabel(threat)}</Badge>
            <Badge>{idStateLabel(track.idState)}</Badge>
            {track.locked ? <Badge tone="ok">Traj. verrouillée</Badge> : null}
            {track.iff ? <Badge>{surveillanceLabel(track.iff.surveillance)}</Badge> : null}
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
          {/* Le POURQUOI du chiffre. Pour le trafic réel il était tapé en dur à 99 % ; il découle
              maintenant des preuves d'identité, et il se justifie à l'écran. */}
          {track.confidenceNote ? (
            <p className="mt-0.5 max-w-[14rem] text-[11px] leading-tight text-muted-foreground">
              {track.confidenceNote}
            </p>
          ) : null}
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
          value={rej ? "1090ES enregistré (rejeu)" : track.sensors.map(sensorLabel).join(" · ")}
        />
        <Item label="Couloir" value={track.corridor ?? "—"} />
        {heard ? (
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
          label="Premier relevé"
          value={
            track.launchFix
              ? `${track.launchFix.lat.toFixed(5)}, ${track.launchFix.lon.toFixed(5)} · ${new Date(track.launchFix.at).toLocaleTimeString("fr-FR", { timeZone: "Africa/Ndjamena" })}`
              : "—"
          }
          mono
        />
      </dl>
      <Separator />
      <div className="space-y-3 p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Transpondeur
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
              label="Reçu"
              value={`${rej ? "1090ES rejeu" : "1090ES en direct"}${track.nation ? ` · ${track.nation}` : ""}`}
            />
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Pas de transpondeur entendu.</p>
        )}
        {track.iff ? (
          <p className="text-xs text-muted-foreground">
            {surveillanceLabel(track.iff.surveillance)}
            {track.posSource === "mlat"
              ? " · position MLAT du réseau : l'appareil n'émet pas la sienne."
              : ""}
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
        <Button asChild variant="outline" className="w-full">
          <Link to="/iff">Transpondeurs 1090</Link>
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
          <Crosshair />
          Prendre la piste réelle la plus proche
        </Button>
        {/* Le traitement croise la météo et le GNSS d'AUJOURD'HUI : seulement pour une piste 1090ES en
            direct — ni un rejeu, ni un exercice (sans transpondeur). */}
        {track.feed === "adsb" ? <TransponderBlock track={track} /> : null}
        <AssistantAsk track={track} />
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

/** Résumé factuel d'une piste pour l'assistant — uniquement des champs typés, aucune fiction. */
function trackBrief(track: Track): string {
  const feed =
    track.feed === "rejeu"
      ? "REJEU (position 1090ES enregistrée, pas live)"
      : track.exercice
        ? `EXERCICE (vol réel de notre drone ${track.exercice.drone}, joué comme intrus : pas un contact réel)`
        : track.sensors.includes("antenne")
          ? "1090ES en direct (antenne du poste)"
          : "1090ES en direct (relevé réseau)";
  const lines = [
    `Indicatif: ${track.callsign}`,
    `Source: ${feed}`,
    `Position: ${track.lat.toFixed(4)}, ${track.lon.toFixed(4)} · alt ${Math.round(track.altM)} m`,
    `Cinématique: cap ${Math.round(track.heading)}° · ${Math.round(track.speedKmh)} km/h · montée ${track.climbMs.toFixed(1)} m/s`,
    `Identification: ${idStateLabel(track.idState)} · confiance ${Math.round(track.confidence)}%${track.confidenceNote ? ` (${track.confidenceNote})` : ""}`,
  ];
  if (track.origin) lines.push(`Origine: ${originLabel(track.origin)}`);
  if (track.classGuess) lines.push(`Classe estimée: ${classLabel(track.classGuess)}`);
  if (track.icaoType) lines.push(`Type ICAO: ${track.icaoType}`);
  if (track.reg) lines.push(`Immat.: ${track.reg}`);
  if (track.nation) lines.push(`Nationalité (allocation OACI): ${track.nation}`);
  if (track.military) lines.push("Marqué militaire par le réseau");
  if (track.emergency) lines.push(`Urgence: ${track.emergency}`);
  if (track.nic != null) lines.push(`NIC: ${track.nic}${track.nic < 5 ? " (GNSS dégradé / jamming possible)" : ""}`);
  if (track.nacp != null) lines.push(`NACp: ${track.nacp}`);
  if (track.corridor) lines.push(`Couloir: ${track.corridor}`);
  if (track.cpa) {
    lines.push(
      `CPA site: ${track.cpa.name} · ${track.cpa.distKm.toFixed(1)} km` +
        (track.cpa.etaS ? ` · ETA ${track.cpa.etaS} s` : "") +
        (track.cpa.closing ? " · en rapprochement" : ""),
    );
  }
  return lines.join("\n");
}

function AssistantAsk({ track }: { track: Track }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Sans IA : les valeurs reçues (la piste, puis le dernier relevé), sans interprétation.
  const [faits, setFaits] = useState<string[]>([]);
  const [consultees, setConsultees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = () => {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setErr(null);
    askAssistant({ data: { question, track: trackBrief(track) } })
      .then((r) => {
        setFaits(r.ok ? [] : r.faits);
        setConsultees(r.competences);
        if (r.ok) setAnswer(r.text);
        else setErr(r.error);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "assistant échoué"))
      .finally(() => setBusy(false));
  };

  return (
    <section className="space-y-2 rounded-md border border-border bg-surface p-3 hud">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Sparkles className="size-3.5" />
        Assistant · cette piste
      </p>
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="ex. Faut-il s'inquiéter de ce contact ?"
          aria-label="Question à l'assistant sur cette piste"
        />
        <Button type="button" variant="outline" onClick={ask} disabled={busy || !q.trim()}>
          {busy ? "…" : "Demander"}
        </Button>
      </div>
      {err ? (
        <p className={faits.length > 0 ? "text-[11px] text-muted-foreground" : "text-xs text-warn"}>
          {err}
          {faits.length > 0 ? " — réponse sans IA : les valeurs reçues, sans interprétation." : ""}
        </p>
      ) : null}
      {faits.length > 0 ? (
        <pre className="whitespace-pre-wrap rounded-sm border border-border bg-bg/60 p-2 font-mono text-[11px] leading-relaxed text-fg">
          {faits.join("\n")}
        </pre>
      ) : null}
      {consultees.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Commandes consultées : <span className="font-mono">{consultees.join(", ")}</span>
        </p>
      ) : null}
      {answer ? (
        <ReponseIa texte={answer} className="text-xs" />
      ) : faits.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Raisonne sur les données réelles de la piste. La clé reste au serveur ; réception seule.
        </p>
      ) : null}
    </section>
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
    <section className="space-y-1 rounded-md border border-border bg-surface p-3 text-sm hud">
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
