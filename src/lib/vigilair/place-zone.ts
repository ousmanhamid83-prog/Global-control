import type { MapScale } from "./geo";
import { hydroById } from "./hydro";
import { routeById, type LakeRoute } from "./lake-routes";
import { mineById, mineCamera } from "./mines";
import { draftZone, type ZonePreset, type ZoneRegion } from "./passability";
import type { SatLayer } from "./sat";
import { useVigilair } from "./store";

export function placeGpsZone(
  lat: number,
  lon: number,
  opts?: {
    id?: string;
    name?: string;
    region?: ZoneRegion;
    radiusKm?: number;
    scale?: MapScale;
    layer?: SatLayer;
  },
): void {
  const id = opts?.id ?? `libre-${lat.toFixed(3)}-${lon.toFixed(3)}`;
  const name = opts?.name ?? "Zone libre";
  const region = opts?.region ?? "libre";
  const radiusKm = opts?.radiusKm ?? 16;
  const draft = draftZone({ id, name, region, lat, lon, radiusKm });
  useVigilair.setState({
    gpsZone: draft,
    viewOrigin: { lat, lon },
    mapScale: opts?.scale ?? "veille",
    satLayer: opts?.layer ?? "rel",
  });
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    km: String(radiusKm),
    name,
    id,
    region,
  });
  void fetch(`/api/zone-gps?${q.toString()}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      const cur = useVigilair.getState().gpsZone;
      if (!cur || cur.id !== id) return;
      if (!body || typeof body !== "object" || body.mode == null) {
        useVigilair.setState({
          gpsZone: {
            ...cur,
            status: "degrade",
            note: "MNT non joint. Le cercle GPS est exact. La pente n'est pas inventée.",
          },
        });
        return;
      }
      useVigilair.setState({ gpsZone: { ...cur, ...body, id, name, region } });
    })
    .catch(() => {
      const cur = useVigilair.getState().gpsZone;
      if (!cur || cur.id !== id) return;
      useVigilair.setState({
        gpsZone: {
          ...cur,
          status: "degrade",
          note: "MNT non joint. Le cercle GPS est exact. La pente n'est pas inventée.",
        },
      });
    });
}

export function placePreset(p: ZonePreset): void {
  placeGpsZone(p.lat, p.lon, p);
}

export function focusLakeRoute(id: string): void {
  const cur = useVigilair.getState().lakeRouteId;
  if (cur === id) {
    useVigilair.setState({ lakeRouteId: null });
    return;
  }
  const route: LakeRoute | null = routeById(id);
  if (!route) return;
  const mid = route.waypoints[Math.floor(route.waypoints.length / 2)]!;
  useVigilair.setState({
    lakeRouteId: id,
    viewOrigin: { lat: mid.lat, lon: mid.lon },
    mapScale: "approche",
    satLayer: "ir",
  });
}

export function focusMine(id: string): void {
  const cur = useVigilair.getState().mineId;
  if (cur === id) {
    useVigilair.setState({ mineId: null });
    return;
  }
  const mine = mineById(id);
  if (!mine) return;
  const cam = mineCamera(mine);
  const prev = useVigilair.getState();
  useVigilair.setState({
    mineId: id,
    viewOrigin: cam.viewOrigin,
    mapScale: cam.mapScale,
    satLayer: cam.satLayer,
    showPeaks: mine.massif ? true : prev.showPeaks,
  });
}

export function toggleMarine(): void {
  const st = useVigilair.getState();
  const on = !st.marine;
  const narrow = st.mapScale === "k4" || st.mapScale === "ident" || st.mapScale === "veille";
  useVigilair.setState({
    marine: on,
    ...(on ? { mapScale: narrow ? "aes" : st.mapScale } : { waterId: null }),
  });
}

export function focusWater(id: string): void {
  const cur = useVigilair.getState().waterId;
  if (cur === id) {
    useVigilair.setState({ waterId: null });
    return;
  }
  const water = hydroById(id);
  if (!water) return;
  useVigilair.setState({
    marine: true,
    waterId: id,
    viewOrigin: { lat: water.lat, lon: water.lon },
    mapScale: water.scale,
  });
}
