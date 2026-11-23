// Jusqu'à 8 000 km : tout le continent africain depuis N'Djamena (le point le plus éloigné,
// Le Cap, est à ≈ 5 400 km ; Gibraltar ≈ 3 900 km). 12 000 et 20 000 km : couverture
// intercontinentale et mondiale (20 000 km ≈ demi-tour de Terre, atteint l'antipode). Les vrais
// contacts n'apparaissent que là où le poste interroge — balayage continental du chef pour le monde.
export const PPI_RANGES = [50, 120, 250, 500, 1200, 2500, 4000, 6000, 8000, 12000, 20000] as const;
export type PpiRangeKm = (typeof PPI_RANGES)[number];

/** Vecteur vitesse (temps projeté, en minutes) : où sera la piste dans N minutes. 0 = aucun. */
export const TIME_VECTORS = [0, 1, 2, 5] as const;

export type PpiParams = {
  rangeKm: PpiRangeKm;
  labels: boolean;
  trails: boolean;
  iff: boolean;
  /** Cadres APP-6 (affiliation) au lieu des formes plateforme. */
  symbols: boolean;
  /** Minutes de vecteur vitesse projeté sur l'écran. */
  timeVector: (typeof TIME_VECTORS)[number];
  /** Nord géographique (true) ou magnétique (déclinaison du lieu du poste, WMM2025). */
  northTrue: boolean;
};

export const DEFAULT_PPI: PpiParams = {
  rangeKm: 1200,
  labels: true,
  trails: true,
  iff: true,
  symbols: true,
  timeVector: 1,
  northTrue: true,
};

export type HistSample = {
  t: number;
  live: number;
  confirmed: number;
  cn: number;
  tr: number;
  ru: number;
  ir: number;
  xx: number;
  ami: number;
  critique: number;
  elevee: number;
  adsb: number;
  uas: number;
};
