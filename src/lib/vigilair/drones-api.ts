/**
 * Server fns du registre « nos drones » — liste / ajout / retrait + proxy image (une trame).
 * Module léger isolé (comme routes-api / ground-sensors-api). Réception / lecture seule.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { OwnDrone } from "./drones.server";

export const dronesList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<OwnDrone[]> => {
    const m = await import("./drones.server");
    return m.listDronesServer();
  });

export const droneAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { name?: string; ident?: string; site?: string; snapshotUrl?: string }) => ({
    name: String(raw?.name ?? ""),
    ident: String(raw?.ident ?? ""),
    site: String(raw?.site ?? ""),
    snapshotUrl: String(raw?.snapshotUrl ?? ""),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return m.addDroneServer(data);
  });

export const droneRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ drones: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return { drones: await m.removeDroneServer(data.id) };
  });

/** Proxy image : récupère une trame fixe d'un drone inscrit et la renvoie en data URL (voir serveur). */
export const fetchDroneFrame = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { url?: string }) => ({ url: String(raw?.url ?? "") }))
  .handler(async ({ data }): Promise<{ ok: boolean; dataUrl?: string; at?: number; error?: string }> => {
    const m = await import("./drones.server");
    return m.fetchDroneFrameServer(data.url);
  });
