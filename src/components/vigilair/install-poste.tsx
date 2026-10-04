import { Download, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  canPromptInstall,
  isStandalone,
  promptInstall,
  subscribePoste,
} from "@/lib/vigilair/poste";
import { cn } from "@/lib/utils";

export function InstallPoste({
  variant = "card",
}: {
  variant?: "card" | "header";
}) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => subscribePoste(() => setTick((n) => n + 1)), []);

  const standalone = isStandalone();
  const can = canPromptInstall();

  const onInstall = async () => {
    setBusy(true);
    setNote(null);
    const r = await promptInstall();
    setBusy(false);
    if (r === "accepted") setNote("Poste installé sur cet ordinateur.");
    else if (r === "dismissed") setNote("Installation annulée.");
    else setNote(null);
  };

  if (variant === "header") {
    if (standalone) {
      return (
        <Badge tone="ok" className="inline-flex">
          <Monitor className="mr-1 size-3" />
          Poste
        </Badge>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onInstall()}
        disabled={busy || !can}
        title={
          can
            ? "Installer AfriControl sur cet ordinateur"
            : "Chrome ou Edge : icône + dans la barre d'adresse, puis Installer."
        }
        aria-label="Installer le poste"
      >
        <Download />
        <span className="inline">Installer</span>
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4 hud">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Poste ordinateur
          </p>
          <h2 className="text-sm font-semibold tracking-tight">
            {standalone
              ? "AfriControl tourne comme un logiciel"
              : "Installer sur PC"}
          </h2>
        </div>
        {standalone ? (
          <Badge tone="ok">Installé</Badge>
        ) : (
          <Badge>Windows · macOS · Linux</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {standalone
          ? "Ce poste est hors navigateur, plein écran. Les flux 1090ES, METAR, SIGMET, FTTJ et GNSS sont réels. Pas un simulateur."
          : "AfriControl s'installe sur le PC comme une application (PWA), en fenêtre dédiée. Le kit ZIP contient le mode d'emploi hors-ligne et les icônes."}
      </p>
      {!standalone ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Navigateur : Chrome ou Microsoft Edge, écran d'au moins 1280 px.</li>
          <li>Connexion chef (e-mail + mot de passe) ou agent (e-mail + clé VA-).</li>
          <li>Bouton ci-dessous, ou « Installer l'application » dans la barre d'adresse.</li>
          <li>Le raccourci apparaît dans le menu Démarrer et sur le bureau.</li>
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!standalone ? (
          <Button
            type="button"
            onClick={() => void onInstall()}
            disabled={busy || !can}
          >
            <Download />
            {can ? "Installer sur ce PC" : "En attente du navigateur"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" asChild>
          <a href="/kits/AfriControl-poste-PC.zip" download>
            <Monitor />
            Kit PC
          </a>
        </Button>
      </div>
      {!can && !standalone ? (
        <p className="text-xs text-muted-foreground">
          Si le bouton reste inactif : menu Edge / Chrome · Installer ce site
          en tant qu'application. L'aperçu dans Grok bloque souvent les
          cookies : le poste installé, lui, les accepte.
        </p>
      ) : null}
      {note ? (
        <p className={cn("text-xs", note.includes("annul") ? "text-muted-foreground" : "text-ok")}>
          {note}
        </p>
      ) : null}
    </section>
  );
}
