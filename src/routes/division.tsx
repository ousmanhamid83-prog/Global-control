import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { DivisionView } from "@/components/vigilair/division-view";

export const Route = createFileRoute("/division")({ component: DivisionPage });

function DivisionPage() {
  return (
    <AppShell>
      <DivisionView />
    </AppShell>
  );
}
