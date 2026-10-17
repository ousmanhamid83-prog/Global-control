import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { AbriView } from "@/components/vigilair/abri-view";

export const Route = createFileRoute("/abri")({ component: AbriPage });

function AbriPage() {
  return (
    <AppShell>
      <AbriView />
    </AppShell>
  );
}
