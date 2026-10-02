import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { AudioView } from "@/components/vigilair/audio-view";

export const Route = createFileRoute("/audio")({ component: AudioPage });

function AudioPage() {
  return (
    <AppShell>
      <AudioView />
    </AppShell>
  );
}
