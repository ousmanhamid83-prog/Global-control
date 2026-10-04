/** Mode S replies + MLAT TDOA. AfriControl n'émet pas. */
import { destPoint, haversineKm } from "./geo";
import { SENSOR_SITES } from "./sensors";
import type {
  IffFix,
  MlatFix,
  ModeSDf,
  ModeSReply,
  ModeSSurveillance,
  Track,
} from "./types";

export const MODE_S_NOTE =
  "Réponses Mode S entendues sur 1090 MHz, déclenchées par les interrogateurs SSR des sites radar. AfriControl n'émet pas. Pas un réseau MLAT ASECNA live.";

export const M4_CRYPTO_STEALTH =
  "Le challenge Mode 4 part de l'interrogateur secondaire du site radar (1030 MHz). AfriControl n'émet pas, ne stocke pas la clé, ne calcule pas le crypto.";

export const REPLY_MAX = 8;
export const WATERFALL_MAX = 28;
const MLAT_MIN_SITES = 3;

export type DfEntry = {
  df: ModeSDf;
  uf: string | null;
  name: string;
  kind: "squitter" | "solicited" | "acas";
  body: string;
};

export const DF_CATALOGUE: DfEntry[] = [
  {
    df: "DF0",
    uf: "UF0",
    name: "Air-air court ACAS",
    kind: "acas",
    body: "Réponse courte air-air (TCAS/ACAS). Altitude et statut. Pas une identification IFF sol.",
  },
  {
    df: "DF4",
    uf: "UF4",
    name: "Surveillance altitude",
    kind: "solicited",
    body: "Réponse à une interrogation sélective UF4. Altitude Mode C / QNH. Brique ELS.",
  },
  {
    df: "DF5",
    uf: "UF5",
    name: "Surveillance identité",
    kind: "solicited",
    body: "Réponse UF5. Squawk Mode 3/A + statut de vol. L'identité 3/A reste usurpable sans Mode 4.",
  },
  {
    df: "DF11",
    uf: "UF11",
    name: "All-call / acquisition",
    kind: "squitter",
    body: "Réponse all-call ou squitter d'acquisition. Adresse ICAO 24 bits + capacité CA. Première prise Mode S.",
  },
  {
    df: "DF16",
    uf: "UF16",
    name: "Air-air long ACAS",
    kind: "acas",
    body: "Réponse longue air-air. Résolution TCAS. Rare au sol, utile pour corréler un chasseur.",
  },
  {
    df: "DF17",
    uf: null,
    name: "Extended squitter ADS-B",
    kind: "squitter",
    body: "Squitter 1090ES non sollicité : position, vitesse, indicatif. GPS-dérivé — usurpable. Le MLAT TDOA est le discriminant.",
  },
  {
    df: "DF20",
    uf: "UF20",
    name: "Comm-B altitude + BDS",
    kind: "solicited",
    body: "Comm-B (EHS) : altitude + registre BDS (4,0 intention ; 5,0 track/turn ; 6,0 heading/IAS).",
  },
  {
    df: "DF21",
    uf: "UF21",
    name: "Comm-B identité + BDS",
    kind: "solicited",
    body: "Comm-B (EHS) : squawk 3/A + même famille de registres BDS. Interrogation sélective ICAO24.",
  },
];

export const BDS_NOTES: { id: string; name: string; body: string }[] = [
  { id: "0,5", name: "Position airborne", body: "BDS 0,5 — position ADS-B encodée (CPR). Même famille que DF17." },
  { id: "0,8", name: "Identification", body: "BDS 0,8 — indicatif 8 caractères (AIS). DF17 type 1–4." },
  { id: "0,9", name: "Vitesse airborne", body: "BDS 0,9 — vitesse sol / cap / rate. DF17 type 19." },
  { id: "2,0", name: "Aircraft ident", body: "BDS 2,0 — identification Comm-B, ELS." },
  { id: "4,0", name: "Intention verticale", body: "BDS 4,0 — altitude sélectionnée MCP/FCU. EHS." },
  { id: "5,0", name: "Track and turn", body: "BDS 5,0 — roll, track, taux de virage. EHS." },
  { id: "6,0", name: "Heading and speed", body: "BDS 6,0 — cap mag, IAS, Mach. EHS." },
];

export const M4_DOCTRINE: { id: string; title: string; body: string }[] = [
  {
    id: "principe",
    title: "Challenge-réponse Mark XII",
    body: "Le Mode 4 (IFF Mark XII) n'est pas un squawk. L'interrogateur secondaire envoie un challenge chiffré sur 1030 MHz. Le transpondeur qui détient la même clé calcule la réponse et la renvoie sur 1090 MHz. Sans la clé, pas d'ami.",
  },
  {
    id: "crypto",
    title: "Chiffrement — clé du jour",
    body: "Un calculateur crypto (famille KIR côté interrogateur, KIT côté transpondeur) dérive le challenge et la réponse à partir d'une clé quotidienne classifiée (code of the day), éventuellement segmentée par créneau. AfriControl ne voit jamais la clé, ne la stocke pas, ne la simule pas en clair. Seul le verdict valide / invalide / timeout remonte.",
  },
  {
    id: "isls",
    title: "ISLS — lobes secondaires",
    body: "L'interrogation Mode 4 embarque une suppression de lobes secondaires (ISLS) : une impulsion de contrôle depuis l'antenne omni. Un transpondeur dans un lobe secondaire ne répond pas. Ça limite le fruit et les réponses hors volume.",
  },
  {
    id: "issues",
    title: "Trois issues opératoires",
    body: "Valide — crypto FATL, affiliation amie, effecteur interdit. Invalide — transpondeur entendu, mauvaise clé : squawk 3/A possible usurpation. Timeout — pas de transpondeur militaire, hors volume, ou Mode 4 coupé. Un UAS commercial n'a en général pas de Mode 4.",
  },
  {
    id: "emit",
    title: "AfriControl n'émet pas",
    body: "Le challenge part de l'interrogateur déjà présent sur le site radar 3D. AfriControl formule une demande d'interrogation, corrèle la réponse, et s'arrête là. L'opérateur adverse ne voit pas AfriControl. Pas d'injection C2, pas de spoof IFF sortant.",
  },
  {
    id: "mode5",
    title: "Mode 5 — hors inventaire simulé",
    body: "Le Mode 5 (Mark XIIA) est le successeur OTAN : crypto à l'heure, interrogation létale, données plateforme. Il n'est pas postulé dans l'inventaire FATL de ce théâtre. Le discriminant ami reste le Mode 4 clé du jour.",
  },
];

export const MODE_S_DOCTRINE: { id: string; title: string; body: string }[] = [
  {
    id: "icao",
    title: "Adresse ICAO 24 bits",
    body: "Chaque transpondeur Mode S a une adresse unique (hex 6 caractères). L'interrogateur peut viser un seul appareil (interrogation sélective) au lieu d'un all-call. Moins de fruit, piste plus propre.",
  },
  {
    id: "ufdf",
    title: "UF / DF — formats montant et descendant",
    body: "UF (uplink, 1030 MHz) = ce que l'interrogateur demande. DF (downlink, 1090 MHz) = ce que le transpondeur répond. DF4 altitude, DF5 identité, DF11 acquisition, DF17 ADS-B, DF20/21 Comm-B (EHS).",
  },
  {
    id: "squitter",
    title: "Squitter vs réponse sollicitée",
    body: "Un squitter part tout seul (DF11 acquisition, DF17 ADS-B ~2 Hz). Une réponse sollicitée (DF4/5/20/21) ne part que si un interrogateur a parlé. AfriControl écoute les deux. Il ne parle pas.",
  },
  {
    id: "els",
    title: "ELS / EHS / ADS-B",
    body: "ELS (surveillance élémentaire) : ICAO24 + Mode A + altitude. EHS (renforcée) : + BDS 4,0 / 5,0 / 6,0 (intention, roll, IAS). ADS-B 1090ES : DF17, position GPS. Un chasseur FATL est EHS + Mode 4, rarement ADS-B. Un A320 ASECNA est ADS-B + ELS, pas de Mode 4.",
  },
  {
    id: "mlat",
    title: "MLAT TDOA",
    body: "La même réponse Mode S arrive à plusieurs sites radar à des instants différents. Le TDOA (multilatération) donne une position RF indépendante du GPS. Si le DF17 revendique une position à des kilomètres du MLAT, c'est une usurpation ADS-B.",
  },
  {
    id: "spoof",
    title: "Ce que le Mode S ne prouve pas",
    body: "Un squawk 3/A et même un DF17 civil se forgent. Le Mode 4 crypto ne se forge pas sans la clé FATL. Le MLAT ne se forge pas sans émettre depuis le vrai lieu. Triple discriminant : crypto M4 · TDOA · cinématique.",
  },
];

export function dfLabel(df: ModeSDf): string {
  return DF_CATALOGUE.find((d) => d.df === df)?.name ?? df;
}

export function surveillanceLabel(s: ModeSSurveillance): string {
  switch (s) {
    case "adsb":
      return "ADS-B 1090ES";
    case "ehs":
      return "Mode S EHS";
    case "els":
      return "Mode S ELS";
    default:
      return "Pas de Mode S";
  }
}

export function inferSurveillance(iff: IffFix): ModeSSurveillance {
  if (iff.surveillance) return iff.surveillance;
  if (iff.mode === "ADS-B") return "adsb";
  if (iff.source === "iff-fatl") return "ehs";
  if (iff.mode === "S") return "els";
  return "none";
}

export function coveringRadarSites(
  lat: number,
  lon: number,
): { id: string; name: string; d: number }[] {
  const out: { id: string; name: string; d: number }[] = [];
  for (const s of SENSOR_SITES) {
    if (s.kind !== "radar" || !s.online) continue;
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d <= s.rangeKm) out.push({ id: s.id, name: s.name, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function computeMlat(track: Track, now: number): MlatFix | null {
  const iff = track.iff;
  if (!iff?.icao24) return null;
  const surv = inferSurveillance(iff);
  if (surv === "none") return null;
  const sites = coveringRadarSites(track.lat, track.lon);
  if (sites.length < MLAT_MIN_SITES) return null;
  const h = idHash(track.id);
  const n = sites.length;
  const gdop = n >= 5 ? 0.05 : n === 4 ? 0.09 : 0.16;
  const residualKm = Math.round((gdop + (h % 70) / 1000) * 1000) / 1000;
  const bearing = (h % 360) + ((now / 8000) % 12);
  const pos = destPoint(track.lat, track.lon, bearing, residualKm);
  const quality = Math.max(22, Math.min(97, 30 + n * 13 - residualKm * 80));
  const claim = iff.adsbClaim;
  const adsbDeltaKm = claim
    ? Math.round(haversineKm(claim.lat, claim.lon, pos.lat, pos.lon) * 10) / 10
    : surv === "adsb"
      ? Math.round(residualKm * 10) / 10
      : null;
  const spoofSuspect = adsbDeltaKm != null && adsbDeltaKm > 2.8;
  const siteNames = sites.slice(0, 6).map((s) => s.name);
  return {
    lat: Math.round(pos.lat * 1e5) / 1e5,
    lon: Math.round(pos.lon * 1e5) / 1e5,
    quality: Math.round(quality),
    nSites: n,
    sites: siteNames,
    residualKm,
    adsbDeltaKm,
    spoofSuspect,
    at: now,
    note: spoofSuspect
      ? `Désaccord ADS-B / MLAT ${adsbDeltaKm} km · ${n} sites TDOA. Possible usurpation DF17. ${MODE_S_NOTE}`
      : `TDOA ${n} sites · résidu ${residualKm.toFixed(2)} km · q=${Math.round(quality)} %. ${MODE_S_NOTE}`,
  };
}

function pickDf(surv: ModeSSurveillance, cycle: number): { df: ModeSDf; bds: string | null } {
  if (surv === "adsb") {
    const r = cycle % 7;
    if (r === 0) return { df: "DF11", bds: null };
    if (r === 1) return { df: "DF4", bds: null };
    if (r === 2) return { df: "DF5", bds: null };
    return { df: "DF17", bds: r === 3 ? "0,8" : r === 4 ? "0,9" : "0,5" };
  }
  if (surv === "ehs") {
    const r = cycle % 6;
    if (r === 0) return { df: "DF11", bds: null };
    if (r === 1) return { df: "DF4", bds: null };
    if (r === 2) return { df: "DF5", bds: null };
    if (r === 3) return { df: "DF20", bds: "4,0" };
    if (r === 4) return { df: "DF20", bds: "5,0" };
    return { df: "DF21", bds: "6,0" };
  }
  const r = cycle % 4;
  if (r === 0) return { df: "DF11", bds: null };
  if (r === 1) return { df: "DF4", bds: null };
  if (r === 2) return { df: "DF5", bds: null };
  return { df: "DF0", bds: null };
}

function payloadFor(
  df: ModeSDf,
  bds: string | null,
  track: Track,
  iff: IffFix,
): string {
  const alt = Math.round(track.altM);
  const spd = Math.round(track.speedKmh);
  const hdg = Math.round(track.heading);
  const sq = iff.squawk;
  const claim = iff.adsbClaim;
  switch (df) {
    case "DF17": {
      const lat = claim?.lat ?? track.lat;
      const lon = claim?.lon ?? track.lon;
      const kind = bds === "0,8" ? "ident" : bds === "0,9" ? "vel" : "pos";
      if (kind === "ident") return `AIS ${iff.flightId} · BDS 0,8`;
      if (kind === "vel") return `GS ${spd} km/h · track ${hdg}° · BDS 0,9`;
      return `pos ${lat.toFixed(4)} ${lon.toFixed(4)} · NIC 7 · BDS 0,5`;
    }
    case "DF11":
      return `CA 5 · ICAO ${iff.icao24} · all-call`;
    case "DF4":
      return `alt ${alt} m Q · UF4`;
    case "DF5":
      return `ident ${sq} · UF5`;
    case "DF20":
      if (bds === "4,0") return `MCP ${alt} m · BDS 4,0`;
      if (bds === "5,0") return `roll ${(hdg % 17) - 8}° · track ${hdg}° · BDS 5,0`;
      return `Comm-B alt ${alt} m · ${bds ?? "BDS"}`;
    case "DF21":
      return `ident ${sq} · IAS ${Math.round(spd * 0.54)} kt · BDS ${bds ?? "6,0"}`;
    case "DF0":
      return `ACAS · alt ${alt} m · no RA`;
    case "DF16":
      return `ACAS long · alt ${alt} m`;
    default:
      return df;
  }
}

function intervalMs(surv: ModeSSurveillance): number {
  if (surv === "adsb") return 900;
  if (surv === "ehs") return 1400;
  if (surv === "els") return 1800;
  return 99999;
}

export function tickModeS(track: Track, now: number): IffFix | null {
  const iff = track.iff;
  if (!iff) return null;
  const surv = inferSurveillance(iff);
  const base: IffFix = {
    ...iff,
    surveillance: surv,
    replies: iff.replies ?? [],
    adsbClaim: iff.adsbClaim ?? null,
    lastReplyAt: iff.lastReplyAt ?? null,
  };
  if (surv === "none" || !base.icao24) {
    return { ...base, mlat: null };
  }
  const mlat = computeMlat({ ...track, iff: base }, now);
  const last = base.lastReplyAt ?? 0;
  if (now - last < intervalMs(surv)) {
    return { ...base, mlat };
  }
  const sites = coveringRadarSites(track.lat, track.lon);
  if (sites.length === 0) return { ...base, mlat };
  const cycle = Math.floor(now / intervalMs(surv));
  const site = sites[cycle % sites.length]!;
  const { df, bds } = pickDf(surv, cycle + idHash(track.id));
  const reply: ModeSReply = {
    id: `ms-${track.id}-${now}`,
    df,
    label: dfLabel(df),
    icao24: base.icao24 ?? "",
    at: now,
    siteId: site.id,
    siteName: site.name,
    bds,
    payload: payloadFor(df, bds, track, base),
    solicited: df !== "DF17" && df !== "DF11",
  };
  const replies = [reply, ...(base.replies ?? [])].slice(0, REPLY_MAX);
  return { ...base, mlat, replies, lastReplyAt: now };
}

export function collectWaterfall(tracks: Track[], limit = WATERFALL_MAX): ModeSReply[] {
  const all: ModeSReply[] = [];
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    if (t.iff?.replies) all.push(...t.iff.replies);
  }
  all.sort((a, b) => b.at - a.at);
  return all.slice(0, limit);
}

export function countModeS(tracks: Track[]): {
  els: number;
  ehs: number;
  adsb: number;
  none: number;
  mlat: number;
  spoof: number;
} {
  let els = 0;
  let ehs = 0;
  let adsb = 0;
  let none = 0;
  let mlat = 0;
  let spoof = 0;
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    const s = t.iff ? inferSurveillance(t.iff) : "none";
    if (s === "els") els += 1;
    else if (s === "ehs") ehs += 1;
    else if (s === "adsb") adsb += 1;
    else none += 1;
    if (t.iff?.mlat) mlat += 1;
    if (t.iff?.mlat?.spoofSuspect) spoof += 1;
  }
  return { els, ehs, adsb, none, mlat, spoof };
}

export function iffEvidenceLine(track: Track): string | null {
  const iff = track.iff;
  if (!iff) return null;
  const surv = inferSurveillance(iff);
  const m4 =
    iff.m4 === "valid"
      ? "Mode 4 valide (clé FATL)"
      : iff.m4 === "invalid"
        ? "Mode 4 invalide (crypto non FATL)"
        : iff.m4 === "timeout"
          ? "Mode 4 timeout"
          : "sans Mode 4";
  const ms =
    surv === "none"
      ? "pas de Mode S"
      : `${surveillanceLabel(surv)} ${iff.icao24 ?? ""}`.trim();
  const mlat = iff.mlat
    ? iff.mlat.spoofSuspect
      ? `MLAT ${iff.mlat.nSites} sites, écart ADS-B ${iff.mlat.adsbDeltaKm} km — usurpation suspecte`
      : `MLAT ${iff.mlat.nSites} sites, résidu ${iff.mlat.residualKm.toFixed(2)} km`
    : "pas de MLAT";
  return `IFF ${m4} · ${ms} · squawk ${iff.squawk} · ${mlat}. AfriControl n'émet pas.`;
}
