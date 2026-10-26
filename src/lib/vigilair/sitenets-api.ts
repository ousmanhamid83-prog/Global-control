/**
 * Server fns du registre « sites distants » (plages réseau) — list / add / remove / recordScan.
 * Module léger isolé (comme drones-api). Réception / découverte seule, sans identité.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { SiteNet } from "./sitenets.server";

export const siteNetsList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<SiteNet[]> => {
    const m = await import("./sitenets.server");
    return m.listSiteNetsServer();
  });

export const siteNetAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { name?: string; range?: string; group?: string }) => ({ name: String(raw?.name ?? ""), range: String(raw?.range ?? ""), group: String(raw?.group ?? "") }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; sitenets?: SiteNet[] }> => {
    const m = await import("./sitenets.server");
    return m.addSiteNetServer(data);
  });

export const siteNetRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ sitenets: SiteNet[] }> => {
    const m = await import("./sitenets.server");
    return { sitenets: await m.removeSiteNetServer(data.id) };
  });

export const siteNetRecordScan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; cams?: string[] }) => ({ id: String(raw?.id ?? ""), cams: Array.isArray(raw?.cams) ? raw.cams.map(String) : [] }))
  .handler(async ({ data }): Promise<{ added: string[]; removed: string[]; sitenets: SiteNet[] }> => {
    const m = await import("./sitenets.server");
    return m.recordSiteScanServer(data.id, data.cams);
  });
