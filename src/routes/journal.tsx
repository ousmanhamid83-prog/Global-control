import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { JournalView } from "@/components/vigilair/journal-view";

export const Route = createFileRoute("/journal")({ component: JournalPage });

function JournalPage() {
  return (
    <AppShell>
      <JournalView />
    </AppShell>
  );
}
