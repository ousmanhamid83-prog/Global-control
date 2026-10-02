import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { PosteBoot } from "@/components/vigilair/poste-boot";
import { PostePcRequis } from "@/components/vigilair/poste-pc";
import { VigilairRuntime } from "@/components/vigilair/vigilair-runtime";
import { StaffProvider } from "@/lib/vigilair/staff-context";
import appCss from "../styles.css?url";

const APP_NAME = "VIGILAIR";

const fetchSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const u = await getSessionUser();
  return u ? { id: u.id } : null;
});

export const Route = createRootRoute({
  beforeLoad: async () => ({ sessionUser: await fetchSessionUser() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "VIGILAIR — COP C-UAS réel, poste installable. 1090ES live, METAR/SIGMET NOAA, FTTJ AWC, GNSS NIC, IFF Mode 4 FATL.",
      },
      { name: "theme-color", content: "#09090b" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { httpEquiv: "Referrer-Policy", content: "no-referrer" },
      {
        httpEquiv: "Permissions-Policy",
        content: "geolocation=(), camera=(), microphone=(), interest-cohort=()",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="fr" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <PosteBoot />
        <PostePcRequis />
        <AuthProvider>
          <StaffProvider>
            <VigilairRuntime />
            <Outlet />
          </StaffProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
