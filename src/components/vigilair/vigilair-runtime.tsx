import { LiveWatch } from "@/components/vigilair/live-watch";
import { WatchPoll } from "@/components/vigilair/watch-poll";
import { GuardWatch } from "@/components/vigilair/guard-watch";
import { ZoneWatch } from "@/components/vigilair/zone-watch";
import { WatchMode } from "@/components/vigilair/watch-mode";
import { IdleLock } from "@/components/vigilair/idle-lock";
import { ChefSealHost } from "@/components/vigilair/chef-seal";
import { useEffect } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { startTelemetry } from "@/lib/vigilair/telemetry";

/** Survives les changements de route — AppShell se démonte, pas le 1090 ni le quart. */
export function VigilairRuntime() {
  const { user, isPending } = useCurrentUserState();
  if (isPending || !user) return null;
  return (
    <>
      <LiveWatch />
      <TelemetryWatch />
      <WatchPoll />
      <GuardWatch />
      <ZoneWatch />
      <WatchMode />
      <IdleLock />
      <ChefSealHost />
    </>
  );
}

/** Fraîcheur des liaisons, historique court et fil d'événements de la console. */
function TelemetryWatch() {
  useEffect(() => startTelemetry(), []);
  return null;
}
