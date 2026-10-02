import { Download, Monitor, Smartphone } from "lucide-react";
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
        <Badge tone="ok" className="hidden sm:inline-flex">
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
            ? "Installer VIGILAIR sur cet ordinateur"
            : "Chrome ou Edge : icône + dans la barre d'adresse, puis Installer."
        }
        aria-label="Installer le poste"
      >
        <Download />
        <span className="hidden sm:inline">Installer</span>
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Poste ordinateur et mobile
          </p>
          <h2 className="text-sm font-semibold tracking-tight">
            {standalone
              ? "VIGILAIR tourne comme un logiciel"
              : "Installer sur PC, Android et iOS"}
          </h2>
        </div>
        {standalone ? (
          <Badge tone="ok">Installé</Badge>
        ) : (
          <Badge>Windows · macOS · Linux · Android · iOS</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {standalone
          ? "Ce poste est hors navigateur, plein écran. Les flux 1090ES, METAR, SIGMET, FTTJ et GNSS sont réels. Pas un simulateur."
          : "VIGILAIR s'installe comme une application (PWA). Même logiciel sur ordinateur, téléphone Android et iPhone. Les kits ZIP contiennent le mode d'emploi hors-ligne et les icônes."}
      </p>
      {!standalone ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>PC : Chrome ou Microsoft Edge. Mobile : Chrome (Android) ou Safari (iOS).</li>
          <li>Connexion chef (e-mail + mot de passe) ou agent (e-mail + clé VA-).</li>
          <li>Bouton ci-dessous, ou « Installer l'application » dans la barre d'adresse / Partager → Sur l'écran d'accueil.</li>
          <li>Le raccourci apparaît dans Démarrer, le bureau, ou l'écran d'accueil.</li>
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
            {can ? "Installer sur cet appareil" : "En attente du navigateur"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" asChild>
          <a href="/kits/VIGILAIR-poste-PC.zip" download>
            <Monitor />
            Kit PC
          </a>
        </Button>
        <Button type="button" variant="outline" asChild>
          <a href="/kits/VIGILAIR-poste-mobile.zip" download>
            <Smartphone />
            Kit Android / iOS
          </a>
        </Button>
      </div>
      {!can && !standalone ? (
        <p className="text-xs text-muted-foreground">
          Si le bouton reste inactif : menu Edge / Chrome · Installer ce site
          en tant qu'application. iPhone : Safari · Partager · Sur l'écran
          Android : Chrome · Ajouter à l'écran d'accueil. L'aperçu dans Grok
          bloque souvent les cookies : le poste installé, lui, les accepte.
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
