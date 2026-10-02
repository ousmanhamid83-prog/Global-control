export const PPI_RANGES = [50, 120, 250, 500, 1200, 2500, 4000] as const;
export type PpiRangeKm = (typeof PPI_RANGES)[number];

export type PpiParams = {
  rangeKm: PpiRangeKm;
  rpm: number;
  gain: number;
  clutter: number;
  afterglow: boolean;
  labels: boolean;
  trails: boolean;
  iff: boolean;
};

export const DEFAULT_PPI: PpiParams = {
  rangeKm: 1200,
  rpm: 8,
  gain: 1,
  clutter: 0.16,
  afterglow: true,
  labels: true,
  trails: true,
  iff: true,
};

/** PRF théorique pour une portée non ambiguë (c / 2R). */
export function prfHz(rangeKm: number): number {
  const r = Math.max(1, rangeKm) * 1000;
  return Math.round(299_792_458 / (2 * r));
}

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
