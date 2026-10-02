import { createFileRoute } from "@tanstack/react-router";
import { satStatus } from "@/lib/vigilair/tile-proxy.server";

export const Route = createFileRoute("/api/sat")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(satStatus(), {
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
