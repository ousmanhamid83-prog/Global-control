import { PLATFORM_BY_ID } from "./catalog";
import {
  AO,
  CORRIDORS,
  destPoint,
  headingBetween,
  type MapScale,
} from "./geo";
import { spawnFriendTrack } from "./friends";
import { spawnInjectedTrack } from "./simulate";
import type { Origin, Track } from "./types";

export type InjectGroup = "aes" | "sahel" | "local";

export type InjectSpec = {
  id: string;
  name: string;
  group: InjectGroup;
  mapScale: MapScale;
  corridorId: string | null;
  corridorName: string;
  platforms: string[];
  count: number;
  spreadKm: number;
  /** Distance from corridor point (or from FTTJ if local). */
  distKm: number;
  blurb: string;
  /** Inject de pistes amies FATL / ASECNA — pas un raid. */
  friend?: boolean;
  /** Squawk 3/A usurpée, sans Mode 4. */
  spoofIff?: boolean;
  /** Squitter DF17 civil usurpé — MLAT désaccorde. */
  spoofAdsb?: boolean;
};

export const INJECTS: InjectSpec[] = [
  {
    id: "periurbain",
    name: "Raid périurbain N'Djamena",
    group: "local",
    mapScale: "ident",
    corridorId: null,
    corridorName: "Périurbain N'Djamena",
    platforms: ["dji-mavic-3t", "dji-matrice-30t", "autel-evo-max-4t", "dji-avata-2"],
    count: 4,
    spreadKm: 3.5,
    distKm: 16,
    blurb: "Quatre UAS commerciaux CN en approche du Palais / FTTJ. Formation — pas un contact réel.",
  },
  {
    id: "bulle-nation",
    name: "Intrusion Place de la Nation",
    group: "local",
    mapScale: "ident",
    corridorId: null,
    corridorName: "Place de la Nation",
    platforms: ["dji-mavic-3t", "autel-evo-max-4t"],
    count: 2,
    spreadKm: 0.5,
    distKm: 0.5,
    blurb: "Deux UAS dans la bulle Place de la Nation. Formation — alerte d'intrusion, pas un contact réel.",
  },
  {
    id: "aes-liptako",
    name: "AES · Liptako-Gourma",
    group: "aes",
    mapScale: "aes",
    corridorId: "menaka",
    corridorName: "Ménaka / Liptako-Gourma",
    platforms: ["tb2", "orlan-10", "shahed-136", "ch-4b"],
    count: 5,
    spreadKm: 28,
    distKm: 40,
    blurb: "Salve mixte TR / RU / IR / CN sur la triple frontière Mali–Niger–Burkina (AES).",
  },
  {
    id: "aes-niger",
    name: "AES · Agadez / Ténéré",
    group: "aes",
    mapScale: "aes",
    corridorId: "tenere",
    corridorName: "Ténéré / Agadez",
    platforms: ["tb2", "akinci", "anka-s"],
    count: 4,
    spreadKm: 32,
    distKm: 45,
    blurb: "MALE turcs depuis Agadez. Théâtre AES — identification silencieuse.",
  },
  {
    id: "aes-mali",
    name: "AES · Gao / Kidal",
    group: "aes",
    mapScale: "aes",
    corridorId: "kidal",
    corridorName: "Kidal / Adrar des Ifoghas",
    platforms: ["orlan-10", "lancet-3", "orion", "geran-2"],
    count: 4,
    spreadKm: 30,
    distKm: 50,
    blurb: "ISR / frappe RU depuis le nord Mali (AES).",
  },
  {
    id: "aes-burkina",
    name: "AES · Dori / Burkina Est",
    group: "aes",
    mapScale: "aes",
    corridorId: "dori",
    corridorName: "Dori / Burkina Est",
    platforms: ["tb2", "kargu-2", "wing-loong-2"],
    count: 4,
    spreadKm: 22,
    distKm: 35,
    blurb: "Mixte TR / CN depuis l'est burkinabè — Liptako.",
  },
  {
    id: "aes-niamey",
    name: "AES · Tillabéri / Niamey",
    group: "aes",
    mapScale: "aes",
    corridorId: "tillaberi",
    corridorName: "Tillabéri / Liptako",
    platforms: ["tb2", "orlan-10", "mohajer-6"],
    count: 4,
    spreadKm: 20,
    distKm: 30,
    blurb: "Approche AES ouest-Niger, axe Tillabéri.",
  },
  {
    id: "tibesti",
    name: "Salve Tibesti / Libye",
    group: "sahel",
    mapScale: "sahel",
    corridorId: "tibesti",
    corridorName: "Tibesti / Libye",
    platforms: ["shahed-136", "geran-2", "shahed-238", "mohajer-6"],
    count: 5,
    spreadKm: 35,
    distKm: 55,
    blurb: "Rodeuses IR / copies RU depuis le couloir Tibesti.",
  },
  {
    id: "darfour",
    name: "Salve Darfour",
    group: "sahel",
    mapScale: "sahel",
    corridorId: "darfour",
    corridorName: "Darfour / Soudan",
    platforms: ["shahed-136", "ababil-3", "orlan-10", "shahed-129"],
    count: 4,
    spreadKm: 30,
    distKm: 48,
    blurb: "Salve IR / RU depuis le Darfour, axe Geneina.",
  },
  {
    id: "chasse",
    name: "Transit chasse Sahel",
    group: "sahel",
    mapScale: "sahel",
    corridorId: null,
    corridorName: "Transit aérien Sahel",
    platforms: ["su-35s", "j-10c", "tf-kaan"],
    count: 3,
    spreadKm: 80,
    distKm: 1100,
    blurb: "Trois chasseurs CN / TR / RU en transit. IFF seulement — pas d'effet C-UAS.",
  },
  {
    id: "fatl-cap",
    name: "CAP FATL FTTJ",
    group: "local",
    mapScale: "ident",
    corridorId: null,
    corridorName: "CAP FTTJ · FATL",
    platforms: ["fatl-mi24", "fatl-su25", "fatl-ch4", "fatl-mi17"],
    count: 4,
    spreadKm: 8,
    distKm: 18,
    blurb:
      "Patrouille FATL autour de FTTJ. IFF Mode 4 crypto — affiliation amie, pas C-UAS. Effecteur interdit. Le CH-4B est d'origine CN.",
    friend: true,
  },
  {
    id: "asecna-ua400",
    name: "ASECNA · UA400",
    group: "sahel",
    mapScale: "sahel",
    corridorId: null,
    corridorName: "ASECNA UA400",
    platforms: ["asecna-a320", "asecna-b737", "asecna-e190"],
    count: 3,
    spreadKm: 80,
    distKm: 400,
    blurb:
      "Trafic IFR FIR FTTT (simulé). ADS-B / Mode S, pas de Mode 4. Pas un flux ASECNA live.",
    friend: true,
  },
  {
    id: "spoof-iff",
    name: "Spoof IFF 3/A",
    group: "local",
    mapScale: "ident",
    corridorId: null,
    corridorName: "Périurbain N'Djamena",
    platforms: ["tb2", "shahed-136", "orlan-10"],
    count: 3,
    spreadKm: 6,
    distKm: 22,
    blurb:
      "UAS mandat avec squawk 3/A usurpée, sans Mode 4 FATL. Discriminant crypto — formation.",
    spoofIff: true,
  },
  {
    id: "spoof-adsb",
    name: "Usurpation ADS-B",
    group: "local",
    mapScale: "ident",
    corridorId: null,
    corridorName: "Périurbain N'Djamena",
    platforms: ["tb2", "orlan-10"],
    count: 2,
    spreadKm: 7,
    distKm: 24,
    blurb:
      "UAS mandat avec squitter DF17 civil usurpé. Le MLAT TDOA désaccorde la position GPS. Discriminant Mode S — formation.",
    spoofAdsb: true,
  },
];

export const INJECT_GROUPS: { id: InjectGroup; label: string }[] = [
  { id: "aes", label: "AES" },
  { id: "sahel", label: "Sahel" },
  { id: "local", label: "N'Djamena" },
];

function wrap360(h: number) {
  let x = h % 360;
  if (x < 0) x += 360;
  return x;
}

export function spawnInject(spec: InjectSpec, now: number): Track[] {
  const corridor = spec.corridorId
    ? CORRIDORS.find((c) => c.id === spec.corridorId)
    : null;
  const originLat = corridor?.lat ?? AO.centerLat;
  const originLon = corridor?.lon ?? AO.centerLon;
  const out: Track[] = [];
  const n = spec.count;
  for (let i = 0; i < n; i++) {
    const platformId =
      spec.platforms[i % spec.platforms.length] ?? spec.platforms[0]!;
    if (!PLATFORM_BY_ID[platformId]) continue;
    if (spec.friend) {
      const plat = PLATFORM_BY_ID[platformId];
      out.push(
        spawnFriendTrack(now - i * 900, {
          platformId,
          kind: plat?.friendKind ?? (platformId.startsWith("asecna") ? "asecna" : "fatl"),
          corridor: spec.corridorName,
          injected: true,
        }),
      );
      continue;
    }
    const ang = (360 / n) * i + (i % 2 === 0 ? 8 : -6);
    const offset = destPoint(originLat, originLon, ang, spec.spreadKm * 0.35);
    const along =
      spec.group === "local"
        ? destPoint(
            AO.centerLat,
            AO.centerLon,
            wrap360(40 + i * 55),
            spec.distKm + (i % 3) * 2.4,
          )
        : destPoint(
            offset.lat,
            offset.lon,
            wrap360(ang + 90),
            spec.distKm * 0.15 + (i % 3) * 6,
          );
    const heading = wrap360(
      headingBetween(along.lat, along.lon, AO.centerLat, AO.centerLon) +
        (i - n / 2) * 4,
    );
    const t = spawnInjectedTrack({
      now: now - i * 900,
      platformId,
      lat: along.lat,
      lon: along.lon,
      heading,
      corridor: spec.corridorName,
      spoofIff: spec.spoofIff,
      spoofAdsb: spec.spoofAdsb,
    });
    out.push(t);
  }
  return out;
}

export function injectOriginMix(spec: InjectSpec): Origin[] {
  const o = new Set<Origin>();
  for (const id of spec.platforms) {
    const p = PLATFORM_BY_ID[id];
    if (p) o.add(p.origin);
  }
  return [...o];
}
