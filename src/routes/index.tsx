import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { CopView } from "@/components/vigilair/cop-view";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <AppShell>
      <CopView />
    </AppShell>
  );
}
