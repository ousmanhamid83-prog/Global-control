import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  authClient,
  authEnabled,
  getBearerToken,
  persistBearerToken,
  signOut,
} from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { confirmChefLogin } from "@/lib/vigilair/command";
import { machineFingerprint } from "@/lib/vigilair/sentinel";
import { AUTH_FAIL_MSG } from "@/lib/vigilair/guard";
import { authGate } from "@/lib/vigilair/guard-ops";
import { divisionStatus, resolveAccessKey } from "@/lib/vigilair/staff";
import { InstallPoste } from "@/components/vigilair/install-poste";
import { PreviewCookieHint } from "@/components/vigilair/preview-cookie";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({ component: Login });

const COOKIE_MSG =
  "Le navigateur bloque les cookies de l'aperçu. La session passe par un jeton interne. Ouvrez en plein écran ou installez le poste sur le PC.";

function takeToken(raw: unknown, header?: string | null): string | null {
  const fromData =
    raw && typeof raw === "object" && "token" in raw
      ? String((raw as { token?: unknown }).token ?? "")
      : "";
  const t = (header ?? "").trim() || fromData.trim();
  if (!t) return null;
  try {
    return t.includes("%") ? decodeURIComponent(t) : t;
  } catch {
    return t;
  }
}

function captureToken() {
  return {
    onSuccess(ctx: { response?: Response; data?: unknown }) {
      const h = ctx.response?.headers.get("set-auth-token") ?? null;
      const t = takeToken(ctx.data, h);
      if (t) persistBearerToken(t);
    },
  };
}

async function keepPreviewBearer(token: unknown) {
  const t = takeToken(token);
  if (t) persistBearerToken(t);
  try {
    await authClient.getSession();
  } catch {
    /* session reprise au prochain chargement */
  }
}

function storageWritable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = "__va_s";
    window.sessionStorage.setItem(k, "1");
    const ok = window.sessionStorage.getItem(k) === "1";
    window.sessionStorage.removeItem(k);
    if (ok) return true;
  } catch {
    /* sessionStorage bloqué */
  }
  try {
    const k = "__va_s";
    window.localStorage.setItem(k, "1");
    const ok = window.localStorage.getItem(k) === "1";
    window.localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

function Login() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"chef" | "admin">("chef");
  const [hasChef, setHasChef] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Chef de division");
  const [key, setKey] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enterCop = async () => {
    await authClient.getSession().catch(() => undefined);
    if (storageWritable() && getBearerToken()) {
      window.location.replace("/");
      return;
    }
    await navigate({ to: "/" });
  };

  useEffect(() => {
    divisionStatus()
      .then((s) => setHasChef(s.hasSuperadmin))
      .catch(() => setHasChef(false));
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("eject")) {
      setNotice(
        "Accès retiré par le chef de division. Toute reconnexion déclenche une alerte avec votre travail.",
      );
      setTab("admin");
    } else if (q.get("exfil")) {
      setNotice(
        "Copie du logiciel ou d'un dossier détectée. Session coupée. Incident documenté. Le chef de division a été alerté.",
      );
      setTab("admin");
    } else if (q.get("machine")) {
      setNotice(
        "Cette clé est déjà liée à un autre poste. Accès refusé. Alerte envoyée au chef de division.",
      );
      setTab("admin");
    } else if (q.get("denied")) {
      setNotice(
        "Mot de passe réservé au chef. Les agents se connectent uniquement avec une clé VA-.",
      );
      setTab("admin");
    }
  }, []);

  if (isPending) {
    return (
      <main className="console-grid grid min-h-dvh place-items-center px-4 text-fg">
        <div className="flex items-center gap-3" role="status">
          <Logo />
          <div>
            <p className="font-display text-xl font-bold uppercase tracking-[0.22em]">Vigilair</p>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              Chargement du poste…
            </p>
          </div>
        </div>
      </main>
    );
  }
  if (user) return <Navigate to="/" />;

  const onChef = async (mode: "in" | "up") => {
    setErr(null);
    setBusy(true);
    try {
      const fp = await machineFingerprint();
      const gate = await authGate({
        data: {
          kind: "chef_login",
          identity: email,
          result: "check",
          fingerprint: fp.fingerprint,
        },
      });
      if (!gate.ok) throw new Error(gate.error);
      if (mode === "up") {
        const { data, error } = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || "Chef de division",
          fetchOptions: captureToken(),
        });
        if (error) throw new Error(error.message ?? "Inscription impossible");
        await keepPreviewBearer(
          data && "token" in data ? (data as { token?: string }).token : null,
        );
      } else {
        const { data, error } = await authClient.signIn.email({
          email,
          password,
          fetchOptions: captureToken(),
        });
        if (error) throw new Error(error.message ?? "Session refusée");
        await keepPreviewBearer(
          data && "token" in data ? (data as { token?: string }).token : null,
        );
        let last: unknown = null;
        for (let i = 0; i < 4; i += 1) {
          try {
            await confirmChefLogin();
            last = null;
            break;
          } catch (ex) {
            last = ex;
            const msg = ex instanceof Error ? ex.message : "";
            if (/unauthor|session/i.test(msg) && i < 3) {
              await new Promise((r) => setTimeout(r, 280 * (i + 1)));
              continue;
            }
            break;
          }
        }
        if (last) {
          const msg = last instanceof Error ? last.message : "";
          if (/unauthor|session/i.test(msg)) {
            throw new Error(COOKIE_MSG);
          }
          await signOut("/login?denied=1").catch(() => undefined);
          throw last;
        }
      }
      await authGate({
        data: {
          kind: "chef_login",
          identity: email,
          result: "ok",
          fingerprint: fp.fingerprint,
        },
      }).catch(() => undefined);
      await enterCop();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Échec d'authentification";
      if (!msg.includes("verrouillé") && !msg.includes("cookies")) {
        await authGate({
          data: {
            kind: "chef_login",
            identity: email,
            result: "fail",
            fingerprint: "",
          },
        }).catch(() => undefined);
      }
      setErr(
        /identifiant|clé|refus|verrou|invalid email or password|invalid/i.test(msg)
          ? AUTH_FAIL_MSG
          : msg,
      );
      setBusy(false);
    }
  };

  const onKey = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fp = await machineFingerprint();
      const gate = await authGate({
        data: {
          kind: "va_key",
          identity: agentEmail,
          result: "check",
          fingerprint: fp.fingerprint,
        },
      });
      if (!gate.ok) throw new Error(gate.error);
      const resolved = await resolveAccessKey({
        data: { key, email: agentEmail, fingerprint: fp.fingerprint, machineLabel: fp.machineLabel },
      });
      const { data, error } = await authClient.signIn.email({
        email: resolved.email,
        password: key.replace(/\s+/g, "").toUpperCase(),
        fetchOptions: captureToken(),
      });
      if (error) throw new Error(error.message ?? "Clé refusée");
      await keepPreviewBearer(
        data && "token" in data ? (data as { token?: string }).token : null,
      );
      await authGate({
        data: {
          kind: "va_key",
          identity: agentEmail,
          result: "ok",
          fingerprint: fp.fingerprint,
        },
      }).catch(() => undefined);
      await enterCop();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Clé refusée";
      if (!msg.includes("verrouillé") && !msg.includes("cookies")) {
        await authGate({
          data: {
            kind: "va_key",
            identity: agentEmail,
            result: "fail",
            fingerprint: "",
          },
        }).catch(() => undefined);
      }
      setErr(/identifiant|clé|refus|verrou|cookies/i.test(msg) ? msg : AUTH_FAIL_MSG);
      setBusy(false);
    }
  };

  return (
    <main className="console-grid grid min-h-dvh place-items-center px-4 py-10 text-fg">
      <div className="w-full max-w-lg space-y-4">
        <div className="hud space-y-5 rounded-md border border-border bg-surface p-6">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-none">
              <p className="font-display text-xl font-bold uppercase tracking-[0.22em]">Vigilair</p>
              <p className="mt-1.5 font-mono text-[10.5px] uppercase leading-4 tracking-[0.12em] text-muted-foreground">
                Poste de commandement · FTTJ N'Djamena
              </p>
            </div>
          </div>

          <PreviewCookieHint />

          {notice ? (
            <p className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
              {notice}
            </p>
          ) : null}

          <div className="flex gap-1 rounded-sm border border-border bg-bg p-1">
            <button
              type="button"
              onClick={() => setTab("chef")}
              aria-pressed={tab === "chef"}
              className={cn(
                "h-10 flex-1 rounded-xs px-2 font-display text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150",
                tab === "chef" ? "bg-secondary text-fg shadow-border" : "text-muted-foreground hover:text-fg",
              )}
            >
              Chef de division
            </button>
            <button
              type="button"
              onClick={() => setTab("admin")}
              aria-pressed={tab === "admin"}
              className={cn(
                "h-10 flex-1 rounded-xs px-2 font-display text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150",
                tab === "admin" ? "bg-secondary text-fg shadow-border" : "text-muted-foreground hover:text-fg",
              )}
            >
              Agent (clé VA-)
            </button>
          </div>

          {!authEnabled ? (
            <p className="text-sm text-muted-foreground">Authentification désactivée.</p>
          ) : tab === "chef" ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void onChef(hasChef ? "in" : "up");
              }}
            >
              {!hasChef ? (
                <label className="block text-sm">
                  Nom du poste
                  <Input
                    className="mt-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
              ) : null}
              <label className="block text-sm">
                E-mail
                <Input
                  className="mt-1"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="block text-sm">
                Mot de passe
                <Input
                  className="mt-1"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={hasChef ? "current-password" : "new-password"}
                />
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy
                  ? "Vérification…"
                  : hasChef
                    ? "Ouvrir la session chef"
                    : "Créer le poste chef de division"}
              </Button>
              {hasChef ? (
                <p className="text-xs text-muted-foreground">
                  Seul le chef de division a un mot de passe. Les agents : e-mail
                  professionnel + clé VA-. Cinq refus = verrou 15 minutes, COP
                  figé, sessions coupées. Pas de Google, pas de X : l'identité du
                  chef ne quitte pas le poste.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Aucun chef n'est encore déclaré. Ce compte devient le
                  super-administrateur du contrat. Aucun fournisseur tiers
                  (Google / X) : l'adresse IP du chef n'est pas envoyée dehors.
                </p>
              )}
            </form>
          ) : (
            <form className="space-y-3" onSubmit={onKey}>
              <label className="block text-sm">
                E-mail professionnel
                <Input
                  className="mt-1"
                  type="email"
                  required
                  value={agentEmail}
                  onChange={(e) => setAgentEmail(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="block text-sm">
                Clé unique d'identification
                <Input
                  className="mt-1 font-mono uppercase"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase())}
                  placeholder="VA-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  required
                  aria-label="Clé unique d'identification"
                />
              </label>
              <Button type="submit" className="w-full" disabled={busy || key.length < 10 || !agentEmail.includes("@")}>
                {busy ? "Vérification…" : "Accéder au COP"}
              </Button>
              <p className="text-xs text-muted-foreground">
                E-mail émis par le chef + clé VA-. Pas de mot de passe agent.
                La clé se scelle au premier poste. Cinq refus = verrou 15 min.
              </p>
            </form>
          )}
          {err ? (
            <p
              role="alert"
              className="rounded-md border border-crit/40 bg-crit/5 px-3 py-2 text-sm text-crit"
            >
              {err}
            </p>
          ) : null}
        </div>
        <InstallPoste />
      </div>
    </main>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-10 text-primary" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.12" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16 7v4M16 21v4M7 16h4M21 16h4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}
