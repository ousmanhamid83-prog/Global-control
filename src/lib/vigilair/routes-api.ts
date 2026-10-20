/**
 * Server fns des routes mémorisées — liste / enregistrement / suppression, partagées par le poste.
 * Module léger isolé (comme watch-sites-api). Réception seule.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { NamedPoint } from "./nav";
import type { SavedRoute } from "./routes.server";

export const routesList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<SavedRoute[]> => {
    const m = await import("./routes.server");
    return m.listRoutesServer();
  });

export const routeAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { name?: string; points?: NamedPoint[] }) => ({
    name: String(raw?.name ?? ""),
    points: Array.isArray(raw?.points) ? raw.points : [],
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; routes?: SavedRoute[] }> => {
    const m = await import("./routes.server");
    return m.addRouteServer(data);
  });

export const routeRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ routes: SavedRoute[] }> => {
    const m = await import("./routes.server");
    return { routes: await m.removeRouteServer(data.id) };
  });
