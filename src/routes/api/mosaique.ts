import { createFileRoute } from "@tanstack/react-router";
import { lireTuileLocale } from "@/lib/vigilair/mosaique-locale.server";

/** Une tuile de la mosaïque locale du poste, lue sur le disque à la demande (hors ligne). */
export const Route = createFileRoute("/api/mosaique")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const p = new URL(request.url).searchParams;
        if (!p.has("z") || !p.has("x") || !p.has("y")) return new Response(null, { status: 400 });
        const octets = await lireTuileLocale(
          Number(p.get("z")),
          Number(p.get("x")),
          Number(p.get("y")),
        );
        if (!octets) return new Response(null, { status: 404 });
        return new Response(Buffer.from(octets), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "X-AfriControl-Tile": "LOCAL",
          },
        });
      },
    },
  },
});
