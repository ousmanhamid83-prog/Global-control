import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  finishChefPassword,
  sealModalOpen,
  subscribeSealModal,
} from "@/lib/vigilair/seal-client";

export function ChefSealHost() {
  const open = useSyncExternalStore(subscribeSealModal, sealModalOpen, () => false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-bg/80 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-5 hud"
        onSubmit={(e) => {
          e.preventDefault();
          finishChefPassword(password);
        }}
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sceau chef
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            Retapez le mot de passe
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Acte irréversible (clé, éjection, purge, verrou). Valable 5 minutes.
            VIGILAIR n'émet pas.
          </p>
        </div>
        <label className="block text-sm">
          Mot de passe chef
          <Input
            className="mt-1"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            Sceller
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => finishChefPassword(null)}
          >
            Annuler
          </Button>
        </div>
      </form>
    </div>
  );
}
