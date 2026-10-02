import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { RadarView } from "@/components/vigilair/radar-view";

export const Route = createFileRoute("/radar")({ component: RadarPage });

function RadarPage() {
  return (
    <AppShell>
      <RadarView />
    </AppShell>
  );
}
