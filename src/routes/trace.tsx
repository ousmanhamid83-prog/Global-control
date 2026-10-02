import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { TraceView } from "@/components/vigilair/trace-view";

export const Route = createFileRoute("/trace")({ component: TracePage });

function TracePage() {
  return (
    <AppShell>
      <TraceView />
    </AppShell>
  );
}
