/**
 * Répertoire de lieux Tchad + Sahel — pour retrouver des coordonnées là où les cartes publiques
 * décrochent (après Abéché : Ennedi, BET, Ouaddaï, Wadi Fira… Amdjarass n'est sur presque aucune
 * carte en ligne). L'opérateur tape un nom, le poste remplit les coordonnées, sans dépendre d'une
 * carte externe mauvaise ou hors-ligne. Centres de localité (le point est la ville, pas une adresse).
 */

import { haversineKm, SAHEL_CITIES } from "./geo";

export type Place = { name: string; region: string; lat: number; lon: number };

/**
 * Localités plus fines que SAHEL_CITIES — sous-préfectures et lieux de l'est / nord du Tchad surtout,
 * là où le manque de données fait mal. Coordonnées = centre de localité (à affiner si besoin).
 */
const EXTRA: Place[] = [
  // Ennedi-Est / Ennedi-Ouest
  { name: "Bahaï", region: "Ennedi-Est", lat: 15.95, lon: 23.0 },
  { name: "Kalaït", region: "Ennedi-Ouest", lat: 16.67, lon: 19.52 },
  { name: "Ounianga Sérir", region: "Ennedi-Ouest", lat: 18.9, lon: 20.8 },
  // Tibesti
  { name: "Aozou", region: "Tibesti", lat: 21.83, lon: 17.42 },
  { name: "Zouarké", region: "Tibesti", lat: 20.17, lon: 16.5 },
  { name: "Wour", region: "Tibesti", lat: 21.32, lon: 16.0 },
  // Borkou
  { name: "Kirdimi", region: "Borkou", lat: 18.6, lon: 18.5 },
  // Wadi Fira
  { name: "Am Zoer", region: "Ouaddaï", lat: 14.216, lon: 21.317 },
  // Ouaddaï / Sila
  { name: "Abdi", region: "Ouaddaï", lat: 13.84, lon: 20.68 },
  { name: "Am Dam", region: "Ouaddaï", lat: 12.763, lon: 20.683 },
  { name: "Koukou Angarana", region: "Sila", lat: 11.6, lon: 21.6 },
  { name: "Tissi", region: "Sila", lat: 11.0, lon: 22.4 },
  // Salamat
  { name: "Zakouma", region: "Salamat", lat: 10.9, lon: 19.8 },
  { name: "Haraze", region: "Salamat", lat: 9.9, lon: 20.8 },
  // Batha / Guéra
  { name: "Yao", region: "Batha", lat: 12.85, lon: 17.56 },
  { name: "Bitkine", region: "Guéra", lat: 11.98, lon: 18.213 },
  { name: "Melfi", region: "Guéra", lat: 11.06, lon: 17.933 },
  { name: "Mangalmé", region: "Guéra", lat: 12.361, lon: 19.606 },
  // Hadjer-Lamis / Chari-Baguirmi
  { name: "Massaguet", region: "Hadjer-Lamis", lat: 12.47, lon: 15.44 },
  { name: "Bokoro", region: "Hadjer-Lamis", lat: 12.38, lon: 17.06 },
  { name: "Massenya", region: "Chari-Baguirmi", lat: 11.4, lon: 16.17 },
  { name: "Bousso", region: "Chari-Baguirmi", lat: 10.483, lon: 16.717 },
  { name: "Dourbali", region: "Chari-Baguirmi", lat: 11.83, lon: 15.86 },
  // Lac / Kanem
  { name: "Baga Sola", region: "Lac", lat: 13.47, lon: 14.35 },
  { name: "Nokou", region: "Kanem", lat: 14.63, lon: 15.15 },
  // Mayo-Kebbi / Tandjilé
  { name: "Guelendeng", region: "Mayo-Kebbi Est", lat: 10.93, lon: 15.55 },
  { name: "Fianga", region: "Mayo-Kebbi Est", lat: 9.92, lon: 15.13 },
  { name: "Léré", region: "Mayo-Kebbi Ouest", lat: 9.65, lon: 14.22 },
  { name: "Laï", region: "Tandjilé", lat: 9.397, lon: 16.3 },
  { name: "Kélo", region: "Tandjilé", lat: 9.31, lon: 15.8 },
  // Logone / Mandoul / Moyen-Chari
  { name: "Bébédjia", region: "Logone Oriental", lat: 8.67, lon: 16.93 },
  { name: "Kyabé", region: "Moyen-Chari", lat: 9.45, lon: 18.94 },
];

/** Union : SAHEL_CITIES (villes du théâtre) + localités fines. Coordonnées des villes non dupliquées. */
export const PLACES: Place[] = [
  ...SAHEL_CITIES.map((c) => ({ name: c.name, region: "", lat: c.lat, lon: c.lon })),
  ...EXTRA,
];

/** Minuscule + sans accents, pour une recherche tolérante (amdjarass = Amdjarass = Am Djarass). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .trim();
}

/** Recherche par nom (tolérante aux accents et à la casse). Renvoie les meilleures correspondances. */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = norm(query);
  if (!q) return [];
  const starts: Place[] = [];
  const contains: Place[] = [];
  for (const p of PLACES) {
    const n = norm(p.name);
    if (n.startsWith(q)) starts.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Lieu connu le plus proche d'un point (nom + distance km). */
export function nearestPlace(lat: number, lon: number): { place: Place; distKm: number } | null {
  let best: { place: Place; distKm: number } | null = null;
  for (const p of PLACES) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (!best || d < best.distKm) best = { place: p, distKm: d };
  }
  return best;
}
