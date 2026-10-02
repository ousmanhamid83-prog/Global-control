import { createFileRoute } from "@tanstack/react-router";
import { measureZone } from "@/lib/vigilair/zone-gps.server";
import type { ZoneRegion } from "@/lib/vigilair/passability";

const REGIONS = new Set<ZoneRegion>(["afrique", "moyen-orient", "europe", "monde", "libre"]);

export const Route = createFileRoute("/api/zone-gps")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        const radiusKm = Number(url.searchParams.get("km") ?? "16");
        const name = (url.searchParams.get("name") ?? "Zone libre").slice(0, 48);
        const id = (url.searchParams.get("id") ?? "libre").slice(0, 32);
        const regionRaw = url.searchParams.get("region") ?? "libre";
        const region: ZoneRegion = REGIONS.has(regionRaw as ZoneRegion)
          ? (regionRaw as ZoneRegion)
          : "libre";
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -85 ||
          lat > 85 ||
          lon < -180 ||
          lon > 180 ||
          !Number.isFinite(radiusKm) ||
          radiusKm < 2 ||
          radiusKm > 80
        ) {
          return Response.json({ error: "gps" }, { status: 400 });
        }
        const zone = await measureZone({
          id,
          name,
          region,
          lat,
          lon,
          radiusKm,
        });
        return Response.json(zone);
      },
    },
  },
});
