import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { IdentView } from "@/components/vigilair/ident-view";

export const Route = createFileRoute("/ident")({ component: IdentPage });

function IdentPage() {
  return (
    <AppShell>
      <IdentView />
    </AppShell>
  );
}
