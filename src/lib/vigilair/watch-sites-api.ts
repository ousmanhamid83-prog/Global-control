/**
 * Server fns des sites surveillés — liste / ajout / retrait, partagés par le poste (stockage serveur).
 * Module léger isolé pour que l'état client (watch-sites.ts, importé par le store) ne tire pas tout
 * live-feeds. Réception seule : on surveille, on n'émet rien.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { WatchSite } from "./watch-sites-core";

export const watchSitesList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<WatchSite[]> => {
    const m = await import("./watch-sites.server");
    return m.listSitesServer();
  });

export const watchSiteAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { name?: string; lat?: number; lon?: number; radiusKm?: number }) => ({
    name: String(raw?.name ?? ""),
    lat: Number(raw?.lat),
    lon: Number(raw?.lon),
    radiusKm: Number(raw?.radiusKm),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; sites?: WatchSite[] }> => {
    const m = await import("./watch-sites.server");
    return m.addSiteServer(data);
  });

export const watchSiteRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ sites: WatchSite[] }> => {
    const m = await import("./watch-sites.server");
    return { sites: await m.removeSiteServer(data.id) };
  });
