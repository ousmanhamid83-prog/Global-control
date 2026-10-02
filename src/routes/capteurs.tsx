import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { LiveView } from "@/components/vigilair/live-view";

export const Route = createFileRoute("/capteurs")({ component: CapteursPage });

function CapteursPage() {
  return (
    <AppShell>
      <LiveView />
    </AppShell>
  );
}
