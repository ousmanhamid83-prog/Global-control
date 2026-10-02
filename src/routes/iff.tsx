import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { IffView } from "@/components/vigilair/iff-view";

export const Route = createFileRoute("/iff")({ component: IffPage });

function IffPage() {
  return (
    <AppShell>
      <IffView />
    </AppShell>
  );
}
