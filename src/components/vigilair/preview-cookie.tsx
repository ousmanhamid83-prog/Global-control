import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function inIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

function cookiesBlocked(): boolean {
  if (typeof window === "undefined") return false;
  if (navigator.cookieEnabled === false) return true;
  try {
    const k = "va_ck";
    document.cookie = `${k}=1; path=/; SameSite=Lax`;
    const ok = document.cookie.includes(k);
    document.cookie = `${k}=; path=/; max-age=0`;
    return !ok;
  } catch {
    return true;
  }
}

/** Aperçu en cadre (iframe) : le navigateur bloque les cookies tiers. */
export function PreviewCookieHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(inIframe() || cookiesBlocked());
  }, []);

  if (!show) return null;

  const openFull = () => {
    try {
      const w = window.open(window.location.href, "_blank", "noopener");
      if (!w) {
        window.location.href = window.location.href;
      }
    } catch {
      /* WebView sans popup */
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-3 text-sm">
      <p className="font-medium text-fg">Aperçu — cookies bloqués</p>
      <p className="text-muted-foreground">
        Chrome et Edge refusent les cookies dans un cadre. AfriControl n'en a pas
        besoin : la session voyage en jeton interne, sans IP, sans Google. Si
        l'écran reste bloqué, ouvrez le poste en plein écran ou installez-le
        sur le PC (PWA) — là, plus de cadre.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={openFull}>
        Ouvrir en plein écran
      </Button>
    </div>
  );
}
