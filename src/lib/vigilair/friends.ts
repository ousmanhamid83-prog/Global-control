/** Affiliation des pistes RÉELLES : trafic coopératif (ASECNA, civil) et nos drones. */
import type { FriendKind, Track } from "./types";

/**
 * Trafic coopératif : ce n'est pas une piste C-UAS (posture, raids, bulles l'ignorent). Inclut le
 * trafic civil hors zone ASECNA, qui n'est pas « ami » pour autant. Aucune piste n'est dite FATL :
 * le poste ne lit pas l'IFF militaire (les fiches FATL du catalogue restent des fiches).
 */
export function isFriend(t: { friendKind?: FriendKind | null }): boolean {
  return t.friendKind === "asecna" || t.friendKind === "civil" || t.friendKind === "drone";
}

export function friendLabel(kind: FriendKind): string {
  return kind === "fatl"
    ? "FATL"
    : kind === "civil"
      ? "Civil"
      : kind === "drone"
        ? "Drone"
        : "ASECNA";
}

export function friendBlurb(kind: FriendKind): string {
  if (kind === "civil") {
    return "Trafic civil 1090ES hors zone ASECNA — coopératif, affiliation neutre. Pas une piste C-UAS.";
  }
  if (kind === "drone") {
    return "Un de NOS drones (registre du poste), sa piste 1090ES confirmée par le chef : suivi comme ami, pas une intrusion.";
  }
  return "Trafic IFR ASECNA (FIR FTTT) — ADS-B / Mode S. Plan de vol civil, pas un UAS.";
}

/** Pistes amies réellement entendues : nos drones (appariés par le chef) et le trafic ASECNA. */
export function countFriends(tracks: Track[]): { drone: number; asecna: number; n: number } {
  let drone = 0;
  let asecna = 0;
  for (const t of tracks) {
    if (t.idState === "perdu") continue;
    if (t.friendKind === "drone") drone += 1;
    else if (t.friendKind === "asecna") asecna += 1;
  }
  return { drone, asecna, n: drone + asecna };
}
