import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { SentinelView } from "@/components/vigilair/sentinel-view";

export const Route = createFileRoute("/sentinelle")({ component: SentinelPage });

function SentinelPage() {
  return (
    <AppShell>
      <SentinelView />
    </AppShell>
  );
}
