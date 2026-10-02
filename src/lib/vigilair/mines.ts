import type { MapScale } from "./geo";
import type { ZoneRow } from "./zones";

export type MineRegion = "tchad" | "sahel" | "maghreb" | "est";

export type MineSite = {
  id: string;
  name: string;
  short: string;
  region: MineRegion;
  commodity: string;
  operator: string;
  lat: number;
  lon: number;
  radiusKm: number;
  scale: Extract<MapScale, "veille" | "approche">;
  massif: boolean;
  note: string;
};

export const MINE_REGION_LABEL: Record<MineRegion, string> = {
  tchad: "Tchad",
  sahel: "Sahel",
  maghreb: "Maghreb",
  est: "Est",
};

/**
 * Périmètres de contrôle. Coordonnées publiées (champ, mine, localité).
 * Un cercle armé n'est pas un homme, ni une voiture, ni un toit transparent.
 */
export function mineCamera(mine: Pick<MineSite, "lat" | "lon" | "massif">): {
  viewOrigin: { lat: number; lon: number };
  mapScale: "ident";
  satLayer: "vis";
} {
  return {
    viewOrigin: { lat: mine.lat, lon: mine.lon },
    mapScale: "ident",
    satLayer: "vis",
  };
}

export const MINES: MineSite[] = [
  {
    id: "kome",
    name: "Komé · Doba",
    short: "Komé",
    region: "tchad",
    commodity: "pétrole",
    operator: "SHT · bassin de Doba",
    lat: 8.5428,
    lon: 16.7806,
    radiusKm: 14,
    scale: "veille",
    massif: false,
    note: "Champ de Komé. Le cercle couvre le secteur, pas chaque puits.",
  },
  {
    id: "djermaya",
    name: "Raffinerie de Djermaya",
    short: "Djermaya",
    region: "tchad",
    commodity: "raffinerie",
    operator: "CNPC / SHT",
    lat: 12.3969316,
    lon: 15.053569,
    radiusKm: 3,
    scale: "veille",
    massif: false,
    note: "Site industriel au nord de N'Djamena. Réservoirs et voirie dans la photo.",
  },
  {
    id: "kouri",
    name: "Kouri Bougoudi",
    short: "Kouri",
    region: "tchad",
    commodity: "or artisanal",
    operator: "orpaillage · frontière Libye",
    lat: 23.429333,
    lon: 15.99825,
    radiusKm: 10,
    scale: "approche",
    massif: true,
    note: "Orpaillage du Tibesti. Lieu publié 23°25′45,6″N 15°59′53,7″E. Chantier dans la photo.",
  },
  {
    id: "miski",
    name: "Miski",
    short: "Miski",
    region: "tchad",
    commodity: "or artisanal",
    operator: "orpaillage dispersé",
    lat: 20.166667,
    lon: 17.95,
    radiusKm: 12,
    scale: "approche",
    massif: true,
    note: "Lieu-dit du Tibesti. L'orpaillage est dispersé : ce n'est pas une fosse levée au mètre.",
  },
  {
    id: "gouey",
    name: "Goueygoudoum",
    short: "Mayo-Kebbi",
    region: "tchad",
    commodity: "or",
    operator: "indice · formations de Pala",
    lat: 9.6132642,
    lon: 15.0364959,
    radiusKm: 8,
    scale: "veille",
    massif: false,
    note: "Indice d'or du Mayo-Kebbi. Localité, pas une fosse industrielle.",
  },
  {
    id: "arlit",
    name: "Arlit",
    short: "Arlit",
    region: "sahel",
    commodity: "uranium",
    operator: "SOMAÏR · Niger",
    lat: 18.739079,
    lon: 7.393331,
    radiusKm: 8,
    scale: "veille",
    massif: false,
    note: "Ville minière d'Arlit. Le point est la localité, pas un puits.",
  },
  {
    id: "essakane",
    name: "Essakane",
    short: "Essakane",
    region: "sahel",
    commodity: "or",
    operator: "mine d'Essakane · Burkina",
    lat: 14.392492,
    lon: 0.0253381,
    radiusKm: 6,
    scale: "veille",
    massif: false,
    note: "Mine d'or de l'Oudalan. Fosse, gradins et pistes dans la photo.",
  },
  {
    id: "tasiast",
    name: "Tasiast",
    short: "Tasiast",
    region: "maghreb",
    commodity: "or",
    operator: "Kinross · Mauritanie",
    lat: 20.5859819,
    lon: -15.4763454,
    radiusKm: 8,
    scale: "veille",
    massif: false,
    note: "Mine de Tasiast. Le point est l'aérodrome du site.",
  },
  {
    id: "gara",
    name: "Gara Djebilet",
    short: "Gara Djebilet",
    region: "maghreb",
    commodity: "fer",
    operator: "Tindouf · Algérie",
    lat: 26.7422268,
    lon: -7.4839383,
    radiusKm: 10,
    scale: "approche",
    massif: true,
    note: "Gisement de fer. La colline et le chantier sont dans la photo.",
  },
  {
    id: "bouazzer",
    name: "Bou Azzer",
    short: "Bou Azzer",
    region: "maghreb",
    commodity: "cobalt",
    operator: "Anti-Atlas · Maroc",
    lat: 30.5183831,
    lon: -6.913384,
    radiusKm: 4,
    scale: "approche",
    massif: true,
    note: "Mine de Bou Azzer. Carreau et pistes dans la photo.",
  },
  {
    id: "hassi",
    name: "Hassi Messaoud",
    short: "Hassi Messaoud",
    region: "maghreb",
    commodity: "pétrole",
    operator: "champ · Algérie",
    lat: 31.6957444,
    lon: 6.0604297,
    radiusKm: 15,
    scale: "veille",
    massif: false,
    note: "Champ pétrolier. Puits, pistes et engins présents dans la mosaïque.",
  },
  {
    id: "geita",
    name: "Geita",
    short: "Geita",
    region: "est",
    commodity: "or",
    operator: "Geita Gold Mine · Tanzanie",
    lat: -2.8216172,
    lon: 32.2674227,
    radiusKm: 6,
    scale: "veille",
    massif: false,
    note: "Mine d'or. Fosse et roulage dans la photo.",
  },
  {
    id: "kibali",
    name: "Kibali · Durba",
    short: "Kibali",
    region: "est",
    commodity: "or",
    operator: "Kibali · Haut-Uélé",
    lat: 3.1272962,
    lon: 29.5618522,
    radiusKm: 8,
    scale: "veille",
    massif: false,
    note: "Camp de Durba, à côté de Kibali. Le point est la localité, pas la fosse au mètre.",
  },
  {
    id: "hassai",
    name: "Hassai",
    short: "Hassai",
    region: "est",
    commodity: "or",
    operator: "collines de la mer Rouge · Soudan",
    lat: 18.6938826,
    lon: 35.3875922,
    radiusKm: 8,
    scale: "approche",
    massif: true,
    note: "Or des collines. Carreau visible dans la photo.",
  },
];

export const MINE_WATCH =
  "Photo au sol. La fosse, les pistes et les engins qui sont dans la mosaïque sont dans l'image. Un feu de véhicule ou un front naturel se lit sur ces pixels.";

export function mineById(id: string | null): MineSite | null {
  if (!id) return null;
  return MINES.find((m) => m.id === id) ?? null;
}

export function mineZoneRows(): ZoneRow[] {
  return MINES.map((m) => ({
    id: m.id,
    name: m.short,
    kind: "mine",
    lat: m.lat,
    lon: m.lon,
    radiusKm: m.radiusKm,
    armed: true,
    note: m.commodity,
  }));
}
