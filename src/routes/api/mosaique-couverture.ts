import { createFileRoute } from "@tanstack/react-router";
import { couvertureLocale } from "@/lib/vigilair/mosaique-locale.server";

/** Quelles tuiles la mosaïque locale contient vraiment : le navigateur ne demande que celles-là. */
export const Route = createFileRoute("/api/mosaique-couverture")({
  server: {
    handlers: {
      GET: () => Response.json(couvertureLocale(), { headers: { "Cache-Control": "no-store" } }),
    },
  },
});
