import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { DashboardView } from "@/components/vigilair/dashboard-view";

export const Route = createFileRoute("/tableau")({ component: TableauPage });

function TableauPage() {
  return (
    <AppShell>
      <DashboardView />
    </AppShell>
  );
}
