import { createFileRoute } from "@tanstack/react-router";
import { parseSatLayer } from "@/lib/vigilair/sat";
import { serveTile } from "@/lib/vigilair/tile-proxy.server";

export const Route = createFileRoute("/api/tile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const z = Number(url.searchParams.get("z"));
        const x = Number(url.searchParams.get("x"));
        const y = Number(url.searchParams.get("y"));
        const layer = parseSatLayer(url.searchParams.get("l"));
        if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
          return new Response(null, { status: 400 });
        }
        return serveTile(Math.trunc(z), Math.trunc(x), Math.trunc(y), layer);
      },
    },
  },
});
