import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { ZoneView } from "@/components/vigilair/zone-view";

export const Route = createFileRoute("/zones")({ component: ZonesPage });

function ZonesPage() {
  return (
    <AppShell>
      <ZoneView />
    </AppShell>
  );
}
