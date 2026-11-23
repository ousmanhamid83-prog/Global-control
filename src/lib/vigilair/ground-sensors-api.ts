/**
 * Server fns des capteurs sol, pour la console : la liste (états lus par le serveur à son heure),
 * et les gestes du chef de division — inscrire, changer la clé, retirer —, chacun au journal. Les
 * capteurs, eux, parlent par /api/capteur-sol. Module léger isolé (comme routes-api).
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { libelleType, type GroundSensorVue } from "./ground-sensors-core";

export type ListeCapteurs = { maintenant: number; capteurs: GroundSensorVue[] };

/** Le geste n'appartient qu'au chef de division ; il va au journal sous son nom. */
async function parLeChef(userId: string) {
  const { insertOpsLog, requireSuperadmin } = await import("./staff");
  const chef = await requireSuperadmin(userId);
  return (title: string, detail: string) =>
    insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "capteur",
      title,
      detail,
      severity: "info",
    });
}

export const sensorsList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<ListeCapteurs> => {
    const m = await import("./ground-sensors.server");
    return m.listSensorsServer();
  });

export const sensorAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { site?: string; type?: string; name?: string; silenceS?: number }) => ({
    site: String(raw?.site ?? ""),
    type: String(raw?.type ?? "autre"),
    name: String(raw?.name ?? ""),
    silenceS: Number(raw?.silenceS),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; error?: string; cle?: string; id?: string }> => {
      const journal = await parLeChef(context.userId);
      const m = await import("./ground-sensors.server");
      const r = await m.addSensorServer(data);
      if (!r.ok || !r.sensor) return { ok: false, error: r.error };
      await journal(
        `Capteur sol inscrit · ${r.sensor.name}`,
        `${libelleType(r.sensor.type)} · ${r.sensor.site} · silence ${r.sensor.silenceS} s. Clé remise au chef ; le poste n'en garde que l'empreinte.`,
      );
      return { ok: true, cle: r.cle, id: r.sensor.id };
    },
  );

export const sensorNewKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; cle?: string }> => {
    const journal = await parLeChef(context.userId);
    const m = await import("./ground-sensors.server");
    const r = await m.nouvelleCleServer(data.id);
    if (!r.ok || !r.sensor) return { ok: false, error: r.error };
    await journal(
      `Capteur sol · clé changée · ${r.sensor.name}`,
      `${r.sensor.site}. L'ancienne clé ne vaut plus rien.`,
    );
    return { ok: true, cle: r.cle };
  });

export const sensorRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const journal = await parLeChef(context.userId);
    const m = await import("./ground-sensors.server");
    const s = await m.removeSensorServer(data.id);
    if (s) await journal(`Capteur sol retiré · ${s.name}`, `${s.site}. Sa clé ne vaut plus rien.`);
    return { ok: s !== null };
  });
