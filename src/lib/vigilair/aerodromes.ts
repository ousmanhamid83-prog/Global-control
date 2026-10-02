/** Aérodromes ASECNA / Sahel / AES — ICAO réel, pas un décor. */

export type Aerodrome = {
  icao: string;
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  elevM: number;
  fir: string;
};

export const AERODROMES: Aerodrome[] = [
  { icao: "FTTJ", iata: "NDJ", name: "Hassan Djamous", city: "N'Djamena", lat: 12.1337, lon: 15.034, elevM: 295, fir: "FTTT" },
  { icao: "FTTA", iata: "SRH", name: "Sarh", city: "Sarh", lat: 9.1444, lon: 18.3744, elevM: 365, fir: "FTTT" },
  { icao: "FTTD", iata: "MQQ", name: "Moundou", city: "Moundou", lat: 8.6244, lon: 16.0714, elevM: 428, fir: "FTTT" },
  { icao: "FTTC", iata: "AEH", name: "Abéché", city: "Abéché", lat: 13.847, lon: 20.8443, elevM: 545, fir: "FTTT" },
  { icao: "FTTF", iata: "FYT", name: "Faya-Largeau", city: "Faya", lat: 17.917, lon: 19.111, elevM: 234, fir: "FTTT" },
  { icao: "FTTS", iata: "", name: "Mongo", city: "Mongo", lat: 12.184, lon: 18.693, elevM: 427, fir: "FTTT" },
  { icao: "DRRN", iata: "NIM", name: "Diori Hamani", city: "Niamey", lat: 13.4815, lon: 2.1836, elevM: 223, fir: "DRRR" },
  { icao: "DRZA", iata: "AJY", name: "Mano Dayak", city: "Agadez", lat: 16.965, lon: 8.0001, elevM: 505, fir: "DRRR" },
  { icao: "GABS", iata: "BKO", name: "Modibo Keïta", city: "Bamako", lat: 12.5335, lon: -7.9499, elevM: 380, fir: "GMMM" },
  { icao: "DFFD", iata: "OUA", name: "Ouagadougou", city: "Ouagadougou", lat: 12.3532, lon: -1.5124, elevM: 316, fir: "DFFF" },
  { icao: "GOOY", iata: "DKR", name: "Léopold Sédar Senghor", city: "Dakar", lat: 14.7397, lon: -17.4902, elevM: 26, fir: "GOOO" },
  { icao: "GUCY", iata: "CKY", name: "Conakry", city: "Conakry", lat: 9.5769, lon: -13.612, elevM: 26, fir: "GTTT" },
  { icao: "GMMN", iata: "CMN", name: "Mohammed V", city: "Casablanca", lat: 33.3675, lon: -7.5898, elevM: 200, fir: "GMMM" },
  { icao: "DNMM", iata: "LOS", name: "Murtala Muhammed", city: "Lagos", lat: 6.5774, lon: 3.3212, elevM: 41, fir: "DNKK" },
  { icao: "DNKN", iata: "KAN", name: "Mallam Aminu Kano", city: "Kano", lat: 12.0476, lon: 8.5246, elevM: 476, fir: "DNKK" },
  { icao: "FKKD", iata: "DLA", name: "Douala", city: "Douala", lat: 4.0061, lon: 9.7195, elevM: 10, fir: "FCCC" },
  { icao: "FEFF", iata: "BGF", name: "Bangui M'Poko", city: "Bangui", lat: 4.3985, lon: 18.5188, elevM: 368, fir: "FCCC" },
  { icao: "HSSK", iata: "KRT", name: "Khartoum", city: "Khartoum", lat: 15.5895, lon: 32.5532, elevM: 386, fir: "HSSS" },
  { icao: "HSGN", iata: "EGN", name: "Geneina", city: "Geneina", lat: 13.4817, lon: 22.4653, elevM: 805, fir: "HSSS" },
  { icao: "HSFS", iata: "ELF", name: "El Fasher", city: "El Fasher", lat: 13.6149, lon: 25.3246, elevM: 739, fir: "HSSS" },
  { icao: "HSNL", iata: "UYL", name: "Nyala", city: "Nyala", lat: 12.0535, lon: 24.9562, elevM: 658, fir: "HSSS" },
  { icao: "HSNN", iata: "EBD", name: "El Obeid", city: "El Obeid", lat: 13.1532, lon: 30.2327, elevM: 574, fir: "HSSS" },
  { icao: "HSSN", iata: "MAK", name: "Malakal", city: "Malakal", lat: 9.558, lon: 31.6522, elevM: 394, fir: "HSSS" },
];

export const METAR_IDS = AERODROMES.map((a) => a.icao).join(",");

export const TAF_IDS = "FTTJ,FTTA,FTTD,FTTC,DRRN,DRZA,GABS,DFFD,GOOY,DNMM,HSSK";

export const AERO_BY_ICAO: Record<string, Aerodrome> = Object.fromEntries(
  AERODROMES.map((a) => [a.icao, a]),
);
