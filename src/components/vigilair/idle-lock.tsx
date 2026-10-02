import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStaff } from "@/lib/vigilair/staff-context";
import { IDLE_MS, revalidatePoste } from "@/lib/vigilair/seal";
import { AUTH_FAIL_MSG } from "@/lib/vigilair/guard";
import { useVigilair } from "@/lib/vigilair/store";

export function IdleLock() {
  const { isSuperadmin, profile } = useStaff();
  const [locked, setLocked] = useState(false);
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const tick = () => {
      if (document.hidden) return;
      if (useVigilair.getState().watchMode) return;
      if (Date.now() - last >= IDLE_MS) setLocked(true);
    };
    const onVis = () => {
      if (document.hidden) return;
      if (useVigilair.getState().watchMode) return;
      if (Date.now() - last >= IDLE_MS) setLocked(true);
      else bump();
    };
    const id = window.setInterval(tick, 15_000);
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("touchstart", bump, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("touchstart", bump);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!locked || !profile) return null;

  const onUnlock = async () => {
    setErr(null);
    setBusy(true);
    try {
      await revalidatePoste({
        data: isSuperadmin ? { password: secret } : { key: secret },
      });
      setSecret("");
      setLocked(false);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : AUTH_FAIL_MSG);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-bg p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void onUnlock();
        }}
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Poste figé
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            Inactivité 8 minutes
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSuperadmin
              ? "Retapez le mot de passe chef. Le COP n'a pas été émis ni copié."
              : "Retapez votre clé VA-. La session n'a pas quitté ce poste."}
          </p>
        </div>
        <label className="block text-sm">
          {isSuperadmin ? "Mot de passe" : "Clé VA-"}
          <Input
            className={isSuperadmin ? "mt-1" : "mt-1 font-mono uppercase"}
            type={isSuperadmin ? "password" : "text"}
            autoComplete="off"
            autoFocus
            required
            value={secret}
            onChange={(e) =>
              setSecret(isSuperadmin ? e.target.value : e.target.value.toUpperCase())
            }
          />
        </label>
        {err ? <p className="text-sm text-crit">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          Reprendre la veille
        </Button>
      </form>
    </div>
  );
}
