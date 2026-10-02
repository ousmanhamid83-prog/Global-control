import { useEffect, useState, type FormEvent } from "react";
import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/vigilair/format";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";
import {
  listZoneBreaches,
  saveZone,
  setZoneArmed,
  type ZoneBreachRow,
} from "@/lib/vigilair/zones-ops";
import {
  ZONE_KIND_LABEL,
  ZONE_LEVEL_LABEL,
  zoneLevelTone,
  type ZoneKind,
  type ZoneLevel,
} from "@/lib/vigilair/zones";
import { setLiveZones } from "@/lib/vigilair/zones";
import { listZones } from "@/lib/vigilair/zones-ops";
import { cn } from "@/lib/utils";

const SELECT =
  "h-11 rounded-md border border-border bg-input px-3 text-sm text-fg";

const KINDS: ZoneKind[] = ["aerodrome", "palais", "camp", "pont", "ministere"];

export function ZoneView() {
  const { isSuperadmin, loading, profile } = useStaff();
  const picture = useVigilair((s) => s.zonePicture);
  const zones = useVigilair((s) => s.zones);
  const setZones = useVigilair((s) => s.setZones);
  const lockTrack = useVigilair((s) => s.lockTrack);
  const [breaches, setBreaches] = useState<ZoneBreachRow[]>([]);

  const reload = () => {
    listZones()
      .then((rows) => {
        setLiveZones(rows);
        setZones(rows);
      })
      .catch(() => undefined);
    listZoneBreaches()
      .then(setBreaches)
      .catch(() => setBreaches([]));
  };

  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 10_000);
    return () => window.clearInterval(id);
  }, []);

  const statusOf = (id: string): ZoneLevel =>
    picture.find((p) => p.zone.id === id)?.level ?? "veille";

  const board = (zones.length ? zones : picture.map((p) => p.zone)).map((z) => {
    const st = picture.find((p) => p.zone.id === z.id);
    return {
      zone: z,
      level: st?.level ?? statusOf(z.id),
      inside: st?.inside ?? [],
      approaching: st?.approaching ?? [],
    };
  });

  const hot = board.filter((b) => b.level === "intrusion").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Partie 12 · bulles C-UAS
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Protection · {profile?.label ?? "Poste"}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Cinq bulles autour de N'Djamena : FTTJ, Palais, Camp Kassai, Place
            de la Nation, Pont Chagoua. Un UAS dans le rayon = intrusion,
            alerte chef, journal. Un civil 1090ES dans la CTR FTTJ = trafic,
            pas une attaque. Les périmètres miniers du Tchad, du Sahel, du
            Maghreb et de l'Afrique de l'Est sont armés à part : même alerte
            si une piste entre. Ils ne dessinent ni un homme ni une voiture.
            VIGILAIR n'émet pas.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat k="Bulles" v={String(board.length)} />
          <Stat k="Armées" v={String(board.filter((b) => b.zone.armed).length)} tone="ok" />
          <Stat k="Intrusions" v={String(hot)} tone={hot ? "crit" : "ok"} />
          <Stat
            k="Approches"
            v={String(board.filter((b) => b.level === "approche").length)}
            tone={board.some((b) => b.level === "approche") ? "warn" : "default"}
          />
        </div>

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {board.map((b) => (
            <li
              key={b.zone.id}
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.zone.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ZONE_KIND_LABEL[b.zone.kind]} · {b.zone.radiusKm.toFixed(1)} km
                    {b.zone.note ? ` · ${b.zone.note}` : ""}
                  </p>
                </div>
                <Badge tone={b.zone.armed ? zoneLevelTone(b.level) : "default"}>
                  {b.zone.armed ? ZONE_LEVEL_LABEL[b.level] : "Désarmée"}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-2 font-mono text-xs text-muted-foreground">
                <div>
                  <dt>Lat</dt>
                  <dd className="text-fg">{b.zone.lat.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>Lon</dt>
                  <dd className="text-fg">{b.zone.lon.toFixed(4)}</dd>
                </div>
              </dl>
              <ul className="space-y-1">
                {b.inside.length === 0 && b.approaching.length === 0 ? (
                  <li className="text-sm text-muted-foreground">Aucune piste dans la bulle.</li>
                ) : (
                  <>
                    {b.inside.map((c) => (
                      <li key={`in-${c.trackId}`}>
                        <button
                          type="button"
                          className="text-left text-sm hover:text-fg"
                          onClick={() => lockTrack(c.trackId)}
                        >
                          <span className={c.uas ? "text-crit" : "text-ok"}>
                            {c.uas ? "UAS" : "IFR"}
                          </span>{" "}
                          {c.callsign} · {c.distKm.toFixed(2)} km
                        </button>
                      </li>
                    ))}
                    {b.approaching.map((c) => (
                      <li key={`ap-${c.trackId}`}>
                        <button
                          type="button"
                          className="text-left text-sm hover:text-fg"
                          onClick={() => lockTrack(c.trackId)}
                        >
                          <span className="text-warn">APP</span> {c.callsign} ·{" "}
                          {c.distKm.toFixed(2)} km
                        </button>
                      </li>
                    ))}
                  </>
                )}
              </ul>
              {isSuperadmin && !loading ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void setZoneArmed({
                      data: { id: b.zone.id, armed: !b.zone.armed },
                    }).then(() => reload());
                  }}
                >
                  {b.zone.armed ? "Désarmer" : "Armer"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        <section className="space-y-2" data-mine-board="1">
          <h2 className="text-sm font-semibold">Périmètres miniers</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Sites réels, cercles de contrôle. Pas une détection de personnel.
            Le relief montre le massif. L'infrarouge public ne voit pas à
            travers un toit.
          </p>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {picture
              .filter((p) => p.zone.kind === "mine")
              .map((b) => (
                <li
                  key={b.zone.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{b.zone.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.zone.note} · {b.zone.radiusKm.toFixed(0)} km ·{" "}
                      {b.zone.lat.toFixed(3)} {b.zone.lon.toFixed(3)}
                    </p>
                  </div>
                  <Badge tone={zoneLevelTone(b.level)}>{ZONE_LEVEL_LABEL[b.level]}</Badge>
                </li>
              ))}
          </ul>
        </section>

        {isSuperadmin ? <AddZoneForm onDone={reload} /> : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Journal des bulles</h2>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {breaches.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                Aucune intrusion encore. Un inject « périurbain » ou une piste
                UAS dans le rayon verse une ligne ici.
              </li>
            ) : (
              breaches.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <span className="text-sm">
                    <span className={r.kind === "inside" && r.uas ? "text-crit" : "text-warn"}>
                      {r.kind === "inside" ? "DANS" : "APP"}
                    </span>{" "}
                    {r.zoneName} · {r.callsign}
                    <span className="text-muted-foreground">
                      {" "}
                      · {r.distKm.toFixed(2)} km
                    </span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDate(Date.parse(r.at) || Date.now())}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function AddZoneForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ZoneKind>("camp");
  const [lat, setLat] = useState("12.13");
  const [lon, setLon] = useState("15.05");
  const [radiusKm, setRadiusKm] = useState("1.2");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await saveZone({
        data: {
          name,
          kind,
          lat: Number(lat),
          lon: Number(lon),
          radiusKm: Number(radiusKm),
          note,
          armed: true,
        },
      });
      setName("");
      setNote("");
      onDone();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Shield className="size-4" />
        <h2 className="text-sm font-semibold">Nouvelle bulle</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Réservé au chef. Coordonnées dans l'AO tchadienne. Le rayon est la
        zone d'exclusion UAS, pas un volume IFR.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom du site"
          aria-label="Nom du site"
          required
          minLength={2}
          className="sm:col-span-2"
        />
        <select
          className={SELECT}
          aria-label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as ZoneKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {ZONE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <Input
          value={radiusKm}
          onChange={(e) => setRadiusKm(e.target.value)}
          placeholder="Rayon km"
          aria-label="Rayon km"
          inputMode="decimal"
        />
        <Input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="Latitude"
          aria-label="Latitude"
          inputMode="decimal"
        />
        <Input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="Longitude"
          aria-label="Longitude"
          inputMode="decimal"
        />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optionnel)"
          aria-label="Note"
          className="sm:col-span-2"
        />
        <Button type="submit" disabled={busy} className="sm:col-span-2">
          Armer la bulle
        </Button>
      </form>
      {err ? <p className="text-sm text-crit">{err}</p> : null}
    </section>
  );
}

function Stat({
  k,
  v,
  tone = "default",
}: {
  k: string;
  v: string;
  tone?: "ok" | "warn" | "crit" | "default";
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p
        className={cn(
          "font-mono text-lg tabular-nums",
          tone === "crit" && "text-crit",
          tone === "warn" && "text-warn",
          tone === "ok" && "text-ok",
        )}
      >
        {v}
      </p>
    </div>
  );
}
