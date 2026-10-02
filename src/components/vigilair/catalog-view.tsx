import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  classLabel,
  familyLabel,
  familyOf,
  originLabel,
  PLATFORMS,
  roleLabel,
  threatLabel,
  type CatalogFamily,
} from "@/lib/vigilair/catalog";
import { FRIEND_PLATFORMS } from "@/lib/vigilair/catalog-friends";
import { originTone, threatTone } from "@/lib/vigilair/format";
import { friendLabel } from "@/lib/vigilair/friends";
import type { Origin, Platform } from "@/lib/vigilair/types";
import { cn } from "@/lib/utils";

const FILTERS: { id: Origin | "ALL"; label: string }[] = [
  { id: "ALL", label: "Mandat entier" },
  { id: "CN", label: "Chine" },
  { id: "TR", label: "Turquie" },
  { id: "RU", label: "Russie" },
  { id: "IR", label: "Iran" },
];

const LIBRARY: Platform[] = [...PLATFORMS, ...FRIEND_PLATFORMS];

const FAMILIES: { id: CatalogFamily | "ALL"; label: string }[] = [
  { id: "ALL", label: "Toutes familles" },
  { id: "commercial", label: "Commercial" },
  { id: "uas-mil", label: "UAS militaire" },
  { id: "chasse", label: "Chasse" },
  { id: "ami", label: "Amis FATL / ASECNA" },
];

export function CatalogView() {
  const [origin, setOrigin] = useState<Origin | "ALL">("ALL");
  const [family, setFamily] = useState<CatalogFamily | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(LIBRARY[0]?.id ?? null);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return LIBRARY.filter((p) => {
      if (origin !== "ALL" && p.origin !== origin) return false;
      if (family !== "ALL" && familyOf(p) !== family) return false;
      if (!query) return true;
      return `${p.name} ${p.manufacturer} ${p.protocol} ${p.payload}`
        .toLowerCase()
        .includes(query);
    });
  }, [origin, family, q]);

  const counts = {
    CN: PLATFORMS.filter((p) => p.origin === "CN").length,
    TR: PLATFORMS.filter((p) => p.origin === "TR").length,
    RU: PLATFORMS.filter((p) => p.origin === "RU").length,
    IR: PLATFORMS.filter((p) => p.origin === "IR").length,
    commercial: PLATFORMS.filter((p) => familyOf(p) === "commercial").length,
    mil: PLATFORMS.filter((p) => familyOf(p) === "uas-mil").length,
    chasse: PLATFORMS.filter((p) => familyOf(p) === "chasse").length,
    ami: FRIEND_PLATFORMS.length,
  };
  const selected = LIBRARY.find((p) => p.id === openId) ?? list[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Bibliothèque de signatures
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Mandat CN / TR / RU / IR : drones commerciaux, UAS militaires et
          chasse. Couche amis FATL / ASECNA à part — l'affiliation IFF n'est
          pas l'origine constructeur.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {counts.CN} CN · {counts.TR} TR · {counts.RU} RU · {counts.IR} IR ·{" "}
          {counts.commercial} civils · {counts.mil} UAS mil. · {counts.chasse}{" "}
          chasse · {counts.ami} amis
        </p>
      </header>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nom, constructeur, protocole"
          aria-label="Rechercher une signature"
          className="sm:max-w-sm"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setOrigin(f.id)}
              className={cn(
                "h-11 rounded-md px-3 text-sm transition-colors duration-150",
                origin === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamily(f.id)}
            className={cn(
              "h-11 rounded-md px-3 text-sm transition-colors duration-150",
              family === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {list.length === 0 ? (
            <li className="p-6 text-sm text-muted-foreground">
              Aucune signature ne correspond.
            </li>
          ) : (
            list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
                    openId === p.id ? "bg-secondary" : "hover:bg-secondary/50",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.manufacturer} {p.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {familyLabel(familyOf(p))} · {classLabel(p.uasClass)} ·{" "}
                      {roleLabel(p.role)}
                    </p>
                  </div>
                  <Badge tone={originTone(p.origin)}>{originLabel(p.origin)}</Badge>
                  {p.friendKind ? (
                    <Badge tone="ok">{friendLabel(p.friendKind)}</Badge>
                  ) : (
                    <Badge tone={threatTone(p.threat)}>{threatLabel(p.threat)}</Badge>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        {selected ? <SignatureCard platform={selected} /> : null}
      </div>
    </div>
  );
}

function SignatureCard({ platform: p }: { platform: Platform }) {
  return (
    <article className="h-fit rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{p.manufacturer}</p>
          <h2 className="text-lg font-semibold tracking-tight">{p.name}</h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={originTone(p.origin)}>{originLabel(p.origin)}</Badge>
          {p.friendKind ? (
            <Badge tone="ok">AMI {friendLabel(p.friendKind)}</Badge>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{p.notes}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Row k="Classe" v={classLabel(p.uasClass)} />
        <Row k="Rôle" v={roleLabel(p.role)} />
        <Row k="Menace" v={threatLabel(p.threat)} />
        <Row k="Masse" v={`${p.massKg} kg`} />
        <Row k="Autonomie" v={`${p.enduranceMin} min`} />
        <Row k="Portée" v={`${p.rangeKm} km`} />
        <Row k="Plafond" v={`${p.ceilingM} m`} />
        <Row k="Croisière" v={`${p.cruiseKmh} km/h`} />
        <Row k="Protocole" v={p.protocol} />
        <Row k="Remote ID" v={p.remoteId ? "Oui" : "Non"} />
      </dl>
      <p className="mt-3 font-mono text-xs text-muted-foreground">
        {p.rfBands.join(" · ")}
      </p>
      <div className="mt-4 space-y-2 rounded-md bg-secondary p-3 text-xs leading-relaxed">
        <p>
          <span className="text-muted-foreground">RF · </span>
          {p.cues.rf}
        </p>
        <p>
          <span className="text-muted-foreground">Visuel · </span>
          {p.cues.visual}
        </p>
        <p>
          <span className="text-muted-foreground">Cinématique · </span>
          {p.cues.kinematic}
        </p>
        <p>
          <span className="text-muted-foreground">Acoustique · </span>
          {p.cues.acoustic}
        </p>
      </div>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
