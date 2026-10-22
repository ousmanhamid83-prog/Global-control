/**
 * Server fns des capteurs sol — liste / ajout / état / retrait, partagés par le poste. Module léger
 * isolé (comme routes-api). Réception seule côté air.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { GroundSensor } from "./ground-sensors.server";

export const sensorsList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<GroundSensor[]> => {
    const m = await import("./ground-sensors.server");
    return m.listSensorsServer();
  });

export const sensorAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { site?: string; type?: string; name?: string }) => ({
    site: String(raw?.site ?? ""),
    type: String(raw?.type ?? "autre"),
    name: String(raw?.name ?? ""),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; sensors?: GroundSensor[] }> => {
    const m = await import("./ground-sensors.server");
    return m.addSensorServer(data);
  });

export const sensorSetState = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; state?: string }) => ({ id: String(raw?.id ?? ""), state: String(raw?.state ?? "ok") }))
  .handler(async ({ data }): Promise<{ sensors: GroundSensor[] }> => {
    const m = await import("./ground-sensors.server");
    return { sensors: await m.setSensorStateServer(data.id, data.state) };
  });

export const sensorRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ sensors: GroundSensor[] }> => {
    const m = await import("./ground-sensors.server");
    return { sensors: await m.removeSensorServer(data.id) };
  });
