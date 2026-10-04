/** Statut anonymat — chef seulement. AfriControl n'émet pas. */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { requireSuperadmin } from "./staff";
import { countSessionTraces, scrubSessionIps } from "./privacy";
import { requireChefSeal } from "./seal";

export type PrivacyStatus = {
  withIp: number;
  withUa: number;
  sessions: number;
  fontsThirdParty: boolean;
  tilesThirdParty: boolean;
  oauthOnLogin: boolean;
  machineLabelPlain: boolean;
};

export const privacyStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PrivacyStatus> => {
    await requireSuperadmin(context.userId);
    await scrubSessionIps(context.userId);
    const traces = await countSessionTraces();
    return {
      withIp: traces.withIp,
      withUa: traces.withUa,
      sessions: traces.total,
      fontsThirdParty: false,
      tilesThirdParty: false,
      oauthOnLogin: false,
      machineLabelPlain: false,
    };
  });

export const purgeSessionTraces = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PrivacyStatus> => {
    await requireSuperadmin(context.userId);
    await requireChefSeal(context.userId);
    await scrubSessionIps();
    const traces = await countSessionTraces();
    return {
      withIp: traces.withIp,
      withUa: traces.withUa,
      sessions: traces.total,
      fontsThirdParty: false,
      tilesThirdParty: false,
      oauthOnLogin: false,
      machineLabelPlain: false,
    };
  });
