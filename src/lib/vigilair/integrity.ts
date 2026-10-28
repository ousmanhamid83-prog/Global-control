/**
 * INTÉGRITÉ DE POSITION — cœur PUR, testable.
 *
 * Un aéronef coopératif ne dit pas seulement OÙ il est : il dit AVEC QUELLE PRÉCISION il le sait.
 * C'est le NIC (Navigation Integrity Category, DO-260B), qui se traduit par un RAYON DE CONFINEMENT
 * Rc — la distance au-delà de laquelle la position annoncée ne peut pas être, à la probabilité
 * prescrite. L'agrégateur relaie même ce rayon tout cuit (champ `rc`, en mètres).
 *
 * AfriControl jetait cette information et peignait toutes les pistes comme des points exacts.
 * Mesuré sur 881 avions réels : 14 % déclarent un rayon supérieur à 185 m, et deux d'entre eux
 * 7,4 km. Un symbole ponctuel à 7 km près, c'est un mensonge par omission sur un scope de sûreté.
 *
 * Deux pièges, tous deux vérifiés sur les mêmes données réelles :
 *
 *  1) `rc = 0` signifie INCONNU, pas « rayon nul ». Les 102 pistes concernées sont les PIRES du lot ;
 *     lire ce zéro au pied de la lettre les ferait passer pour les meilleures.
 *
 *  2) Le NIC est une propriété de la position ÉMISE. Une piste MLAT n'émet aucune position — elle
 *     est localisée par multilatération, depuis le réseau de récepteurs — donc elle n'a pas de NIC
 *     à dégrader. Compter son NIC absent comme « GNSS dégradé » fabriquait de faux brouillages :
 *     sur le même lot réel, 8 des 9 cellules de « brouillage élevé » étaient uniquement du MLAT.
 *
 * Qualité de signal et géométrie, jamais d'identité.
 */

/**
 * Provenance de la position, telle que l'agrégateur la déclare (champ `type`). Ce n'est pas une
 * question de confiance en l'aéronef, mais de nature de la mesure : émise par lui, ou calculée.
 */
export type PosSource =
  /** Position ÉMISE par l'aéronef (ADS-B 1090ES). Elle porte un NIC. */
  | "adsb"
  /** Position CALCULÉE par multilatération depuis plusieurs récepteurs. Aucun NIC. */
  | "mlat"
  /** Piste Mode S sans position émise (interrogation / réponse). Aucun NIC. */
  | "modes"
  /** Provenance non reconnue : on ne suppose rien. */
  | "autre";

/**
 * Rayon de confinement Rc par NIC (DO-260B), en MÈTRES. Vérifié contre le champ `rc` de
 * l'agrégateur sur 881 avions réels : NIC 11→8 m, 10→25, 9→75, 8→186, 7→371, 6→926, 3→7408.
 * La table sert de repli quand l'agrégateur ne relaie pas `rc`.
 */
export const RC_M_BY_NIC: Record<number, number> = {
  11: 7.5,
  10: 25,
  9: 75,
  8: 185,
  7: 370,
  6: 926,
  5: 1852,
  4: 3704,
  3: 7408,
  2: 14_816,
  1: 37_040,
};

/**
 * Rayon retenu pour une position MLAT, en KM. L'agrégateur n'annonce AUCUNE précision pour ces
 * positions : la justesse d'une multilatération dépend de la géométrie des récepteurs qui l'ont
 * entendue, que nous ne connaissons pas. Ce chiffre est donc un PLANCHER prudent choisi pour ne
 * pas afficher une fausse précision — pas une mesure. Mieux vaut un cercle trop large qu'un point
 * qui mentirait.
 */
export const MLAT_RC_KM = 2;

/**
 * NIC en dessous duquel la position émise est considérée comme dégradée (rayon > 1 NM). C'est le
 * seuil qui sert d'indice de brouillage GNSS — appliqué aux positions ÉMISES seulement.
 */
export const NIC_DEGRADED = 5;

/**
 * Effectif minimal d'une cellule pour qu'un pourcentage de positions dégradées veuille dire quelque
 * chose. Sur trafic réel, 7 cellules sur 28 comptent moins de 10 aéronefs : une cellule de 2 avions
 * dont un dégradé afficherait « 50 % de brouillage », ce qui est du bruit présenté comme un fait.
 */
export const JAM_MIN_SAMPLE = 8;

/** La position de cette piste est-elle ÉMISE par l'aéronef ? Seule celle-là porte un NIC. */
export function broadcastsPosition(src: PosSource): boolean {
  return src === "adsb";
}

/** Lit la provenance déclarée par l'agrégateur (`adsb_icao`, `mlat`, `mode_s`, …). */
export function posSourceOf(type: string | null | undefined): PosSource {
  if (!type) return "autre";
  const t = type.toLowerCase();
  if (t.startsWith("adsb") || t.startsWith("adsc") || t.startsWith("tisb")) return "adsb";
  if (t.startsWith("mlat")) return "mlat";
  if (t.startsWith("mode_s") || t.startsWith("modes")) return "modes";
  return "autre";
}

export type RcVerdict = {
  /** Rayon de confinement retenu (km), ou null si vraiment inconnu. */
  km: number | null;
  /** D'où vient ce rayon : à afficher plutôt qu'à taire. */
  note: string;
};

/**
 * Rayon de confinement d'une position, en km. Par ordre de préférence : le rayon relayé par
 * l'agrégateur, puis la table NIC, puis le plancher MLAT. `rcM = 0` est traité comme INCONNU —
 * c'est ce que l'agrégateur veut dire, et le prendre pour un rayon nul inverserait le classement.
 */
export function declaredRcKm(a: {
  rcM?: number | null;
  nic?: number | null;
  posSource?: PosSource;
}): RcVerdict {
  const src = a.posSource ?? "autre";
  if (a.rcM != null && a.rcM > 0) {
    return { km: a.rcM / 1000, note: `rayon annoncé ${Math.round(a.rcM)} m` };
  }
  if (a.nic != null && a.nic > 0) {
    const m = RC_M_BY_NIC[a.nic];
    if (m != null) return { km: m / 1000, note: `NIC ${a.nic} → ${Math.round(m)} m` };
  }
  if (src === "mlat") {
    return { km: MLAT_RC_KM, note: "position calculée (multilatération), précision non annoncée" };
  }
  if (src === "modes") {
    return { km: null, note: "Mode S sans position émise" };
  }
  return { km: null, note: "précision non annoncée" };
}

/**
 * La position ÉMISE par cet aéronef est-elle dégradée ? Question posée uniquement aux pistes qui
 * émettent réellement une position : une piste MLAT n'a pas de NIC, son absence ne prouve rien.
 * C'est tout l'écart entre « le GNSS de cet avion va mal » et « nous l'avons localisé nous-mêmes ».
 */
export function gnssDegraded(a: {
  nic?: number | null;
  nacp?: number | null;
  posSource?: PosSource;
}): boolean {
  if (!broadcastsPosition(a.posSource ?? "autre")) return false;
  if (a.nic == null && a.nacp == null) return false;
  return (a.nic != null && a.nic < NIC_DEGRADED) || (a.nacp != null && a.nacp < NIC_DEGRADED);
}

/**
 * Incertitude TOTALE autour du symbole (km) : ce que l'aéronef admet ignorer de sa propre position,
 * et ce que notre extrapolation ajoute quand il s'est tu. Les deux sont indépendantes, donc on les
 * compose en quadrature plutôt qu'en les additionnant — additionner surestimerait franchement.
 */
export function totalUncertaintyKm(declaredKm: number | null, coastKm: number | null): number {
  const d = declaredKm != null && declaredKm > 0 ? declaredKm : 0;
  const c = coastKm != null && coastKm > 0 ? coastKm : 0;
  if (d === 0 && c === 0) return 0;
  return Math.sqrt(d * d + c * c);
}

/**
 * Altitude recalée de l'âge du relevé, en bornant le taux de montée. Mesuré sur 881 avions réels :
 * seules 2 pistes sont fausses de plus de 150 m, donc l'enjeu est modeste — MAIS certains taux
 * relayés sont aberrants (+33 245 ft/min, soit 169 m/s). Corriger à l'aveugle AJOUTERAIT de
 * l'erreur sur ces cas ; on borne donc au maximum physiquement crédible avant d'appliquer.
 */
export function altAged(altM: number, climbMs: number, ageS: number, maxClimbMs: number): number {
  if (!(ageS > 0) || !Number.isFinite(climbMs) || climbMs === 0) return altM;
  const taux = Math.max(-maxClimbMs, Math.min(maxClimbMs, climbMs));
  return Math.max(0, altM + taux * ageS);
}
