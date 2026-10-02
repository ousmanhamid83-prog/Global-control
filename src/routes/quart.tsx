import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { QuartView } from "@/components/vigilair/quart-view";

export const Route = createFileRoute("/quart")({ component: QuartPage });

function QuartPage() {
  return (
    <AppShell>
      <QuartView />
    </AppShell>
  );
}
