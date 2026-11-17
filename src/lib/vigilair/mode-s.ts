/**
 * Mode S / ADS-B tels que l'antenne les entend. AfriControl n'émet pas et n'interroge pas : il n'y
 * a ici ni interrogation Mode 4, ni multilatération calculée par le poste, ni réponse fabriquée.
 */
import type { ModeSDf, ModeSReply, ModeSSurveillance, Track } from "./types";

export const MODE_S_NOTE =
  "Ce que les transpondeurs émettent sur 1090 MHz, entendu par l'antenne du poste ou relevé sur le réseau. AfriControl n'émet pas et n'interroge pas.";

const WATERFALL_MAX = 28;

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
    body: "Réponse courte air-air (TCAS/ACAS). Altitude et statut. Pas une identification.",
  },
  {
    df: "DF4",
    uf: "UF4",
    name: "Surveillance altitude",
    kind: "solicited",
    body: "Réponse à une interrogation sélective UF4 d'un radar secondaire. Altitude Mode C.",
  },
  {
    df: "DF5",
    uf: "UF5",
    name: "Surveillance identité",
    kind: "solicited",
    body: "Réponse UF5. Squawk Mode 3/A + statut de vol. Un squawk se règle à la main : il ne prouve rien seul.",
  },
  {
    df: "DF11",
    uf: "UF11",
    name: "All-call / acquisition",
    kind: "squitter",
    body: "Réponse all-call ou squitter d'acquisition. Adresse OACI 24 bits + capacité. Première prise Mode S.",
  },
  {
    df: "DF16",
    uf: "UF16",
    name: "Air-air long ACAS",
    kind: "acas",
    body: "Réponse longue air-air. Résolution TCAS. Rare au sol.",
  },
  {
    df: "DF17",
    uf: null,
    name: "Extended squitter ADS-B",
    kind: "squitter",
    body: "Squitter 1090ES non sollicité : position, vitesse, indicatif. Position GNSS de l'appareil — usurpable.",
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
    body: "Comm-B (EHS) : squawk 3/A + même famille de registres BDS.",
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

export const MODE_S_DOCTRINE: { id: string; title: string; body: string }[] = [
  {
    id: "icao",
    title: "Adresse OACI 24 bits",
    body: "Chaque transpondeur Mode S a une adresse unique (hex 6 caractères). Le décodeur du poste ne retient une réponse sollicitée que si son adresse a déjà été entendue en clair (DF11/17/18) : sinon c'est du bruit.",
  },
  {
    id: "ufdf",
    title: "UF / DF — formats montant et descendant",
    body: "UF (uplink, 1030 MHz) = ce qu'un interrogateur demande. DF (downlink, 1090 MHz) = ce que le transpondeur répond. DF4 altitude, DF5 identité, DF11 acquisition, DF17 ADS-B, DF20/21 Comm-B (EHS).",
  },
  {
    id: "squitter",
    title: "Squitter ou réponse sollicitée",
    body: "Un squitter part tout seul (DF11 acquisition, DF17 ADS-B ~2 Hz). Une réponse sollicitée (DF4/5/20/21) ne part que si un radar secondaire a interrogé. L'antenne du poste écoute les deux. Elle ne parle pas.",
  },
  {
    id: "els",
    title: "ELS / EHS / ADS-B",
    body: "ELS (surveillance élémentaire) : adresse + Mode A + altitude. EHS (renforcée) : + BDS 4,0 / 5,0 / 6,0. ADS-B 1090ES : DF17, position GNSS émise. Un appareil qui coupe l'ADS-B ne donne pas de position à l'antenne seule.",
  },
  {
    id: "mlat",
    title: "Multilatération (MLAT)",
    body: "La même réponse Mode S arrive à plusieurs récepteurs du réseau à des instants différents ; l'agrégateur en déduit une position indépendante du GNSS. Le poste ne la calcule pas : il la reçoit du relevé réseau et la marque « MLAT ». L'antenne seule du poste ne localise pas un appareil sans ADS-B.",
  },
  {
    id: "spoof",
    title: "Ce que le Mode S ne prouve pas",
    body: "Un squawk 3/A et un DF17 se forgent. Ce que le poste mesure vraiment : les positions physiquement impossibles (piste suspecte), l'intégrité annoncée (NIC/NACp), une même adresse tenue par deux émetteurs.",
  },
];

export function surveillanceLabel(s: ModeSSurveillance): string {
  return s === "adsb" ? "ADS-B 1090ES" : "Mode S sans ADS-B";
}

/** Les dernières trames réellement entendues, toutes pistes confondues, les plus récentes d'abord. */
export function collectWaterfall(tracks: Track[], limit = WATERFALL_MAX): ModeSReply[] {
  const all: ModeSReply[] = [];
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    if (t.iff) all.push(...t.iff.replies);
  }
  all.sort((a, b) => b.at - a.at);
  return all.slice(0, limit);
}

export function countModeS(tracks: Track[]): { adsb: number; modes: number } {
  let adsb = 0;
  let modes = 0;
  for (const t of tracks) {
    if (t.idState === "perdu" || !t.iff) continue;
    if (t.iff.surveillance === "adsb") adsb += 1;
    else modes += 1;
  }
  return { adsb, modes };
}

/** Ligne du bulletin de preuve : ce que le transpondeur a dit, et d'où vient la position. */
export function iffEvidenceLine(track: Track): string | null {
  const iff = track.iff;
  if (!iff) return null;
  const position =
    track.posSource === "mlat"
      ? "position MLAT du réseau"
      : iff.surveillance === "adsb"
        ? "position émise par l'appareil (DF17)"
        : "position de source non annoncée";
  return `${surveillanceLabel(iff.surveillance)} ${iff.icao24 ?? ""} · squawk ${iff.squawk} · ${position}. AfriControl n'émet pas.`;
}
