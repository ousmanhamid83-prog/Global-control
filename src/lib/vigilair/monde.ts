/** Le monde de la carte : continents, micro-États absents de Natural Earth 110m, rang des noms. */

export const CONTINENTS: { name: string; lat: number; lon: number }[] = [
  { name: "AFRIQUE", lat: 4, lon: 20 },
  { name: "EUROPE", lat: 56, lon: 18 },
  { name: "ASIE", lat: 46, lon: 88 },
  { name: "AMÉRIQUE N.", lat: 48, lon: -100 },
  { name: "AMÉRIQUE S.", lat: -14, lon: -60 },
  { name: "OCÉANIE", lat: -24, lon: 145 },
  { name: "ANTARCTIQUE", lat: -78, lon: 20 },
];

/** Micro-États absents de Natural Earth 110m. */
export const EXTRA_STATES: { n: string; lat: number; lon: number; r: 2 | 3 }[] = [
  { n: "Andorre", lat: 42.51, lon: 1.52, r: 3 },
  { n: "Antigua-et-Barbuda", lat: 17.12, lon: -61.85, r: 3 },
  { n: "Bahreïn", lat: 26.03, lon: 50.55, r: 2 },
  { n: "Barbade", lat: 13.19, lon: -59.54, r: 3 },
  { n: "Cabo Verde", lat: 16.0, lon: -24.0, r: 3 },
  { n: "Comores", lat: -11.65, lon: 43.33, r: 3 },
  { n: "Dominique", lat: 15.42, lon: -61.37, r: 3 },
  { n: "Grenade", lat: 12.12, lon: -61.68, r: 3 },
  { n: "Kiribati", lat: -3.37, lon: -168.73, r: 3 },
  { n: "Liechtenstein", lat: 47.17, lon: 9.56, r: 3 },
  { n: "Maldives", lat: 3.2, lon: 73.22, r: 3 },
  { n: "Malte", lat: 35.94, lon: 14.38, r: 2 },
  { n: "Marshall", lat: 7.13, lon: 171.18, r: 3 },
  { n: "Maurice", lat: -20.2, lon: 57.5, r: 2 },
  { n: "Micronésie", lat: 6.89, lon: 158.22, r: 3 },
  { n: "Monaco", lat: 43.73, lon: 7.42, r: 3 },
  { n: "Nauru", lat: -0.52, lon: 166.93, r: 3 },
  { n: "Palaos", lat: 7.5, lon: 134.58, r: 3 },
  { n: "Saint-Kitts-et-Nevis", lat: 17.36, lon: -62.78, r: 3 },
  { n: "Saint-Marin", lat: 43.94, lon: 12.46, r: 3 },
  { n: "Saint-Vincent", lat: 13.25, lon: -61.2, r: 3 },
  { n: "Sainte-Lucie", lat: 13.91, lon: -60.98, r: 3 },
  { n: "Samoa", lat: -13.76, lon: -172.1, r: 3 },
  { n: "Sao Tomé-et-Principe", lat: 0.23, lon: 6.6, r: 3 },
  { n: "Seychelles", lat: -4.68, lon: 55.49, r: 3 },
  { n: "Singapour", lat: 1.35, lon: 103.82, r: 2 },
  { n: "Tonga", lat: -21.18, lon: -175.2, r: 3 },
  { n: "Tuvalu", lat: -7.11, lon: 177.65, r: 3 },
  { n: "Vatican", lat: 41.9, lon: 12.45, r: 3 },
];

export const SKIP_LABEL = new Set([
  "Antarctique",
  "Somaliland",
  "Chypre du Nord",
  "TAAF",
  "Malouines",
]);

export function rankOf(name: string, area: number): 1 | 2 | 3 {
  if (name === "Tchad") return 1;
  if (area >= 28) return 1;
  if (area >= 5) return 2;
  return 3;
}
