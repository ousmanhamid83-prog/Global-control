import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/vigilair/app-shell";
import { CatalogView } from "@/components/vigilair/catalog-view";

export const Route = createFileRoute("/catalogue")({ component: CataloguePage });

function CataloguePage() {
  return (
    <AppShell>
      <CatalogView />
    </AppShell>
  );
}
