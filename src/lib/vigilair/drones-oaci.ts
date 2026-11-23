/**
 * Les drones qui se déclarent sur 1090ES : par la catégorie d'émetteur B6 (« unmanned aerial
 * vehicle » de la norme DO-260B), que l'appareil émet lui-même, ou par un type OACI de drone, que
 * le registre de l'agrégateur, ou celui de notre décodeur, donne pour son adresse.
 *
 * Types : le Doc 8643 de l'OACI (doc8643.icao.int, relevé le 23 novembre 2026, 2 614 indicatifs)
 * n'a pas de rubrique « sans pilote ». Sont retenus les 17 indicatifs dont CHAQUE modèle inscrit
 * est un aéronef sans pilote, avec le nom que le Doc leur donne. Écartés malgré un nom proche :
 * HERN (le DH-114 Heron, piloté), Q5 (l'avion d'attaque Q-5), S15S (le motoplaneur S-15, dont le
 * drone Patroller est S15U) et FRBD (le Firebird, à pilote optionnel). Vu en réel le 23 novembre
 * 2026 : HRON, sur un drone qui émet aussi la catégorie B6 (indicatif BOOSTER).
 */

const TYPES_DRONE_OACI: ReadonlyMap<string, string> = new Map([
  ["AKNC", "Bayraktar Akıncı"],
  ["ANKA", "Anka"],
  ["BTB2", "Bayraktar TB-2"],
  ["BTB3", "Bayraktar TB-3"],
  ["FLCO", "Falco"],
  ["GJ11", "GJ-11 Sharp Sword"],
  ["HRM9", "Hermes 900"],
  ["HRON", "Heron / Harfang"],
  ["KZLA", "Bayraktar Kızılelma"],
  ["Q1", "MQ-1 Predator / Gray Eagle"],
  ["Q25", "MQ-25 Stingray"],
  ["Q28", "MQ-28 Ghost Bat"],
  ["Q4", "RQ-4 Global Hawk / MQ-4 Triton"],
  ["Q58", "XQ-58 Valkyrie"],
  ["Q9", "MQ-9 Reaper / Predator B"],
  ["S15U", "S-15 Patroller"],
  ["X47B", "X-47B"],
]);

/** Ce qui fait un drone : la catégorie B6, sinon le type ; et le modèle, s'il est connu. */
export type DroneDeclare = {
  par: "B6" | "type";
  type: string | null;
  modele: string | null;
};

export function droneDeclare(t: {
  category?: string | null;
  icaoType?: string | null;
}): DroneDeclare | null {
  const type = t.icaoType?.trim().toUpperCase() || null;
  const modele = (type && TYPES_DRONE_OACI.get(type)) ?? null;
  if (t.category?.trim().toUpperCase() === "B6") return { par: "B6", type, modele };
  return modele ? { par: "type", type, modele } : null;
}

/** « catégorie B6 », « catégorie B6 · HRON (Heron / Harfang) », « type BTB2 (Bayraktar TB-2) ». */
export function libelleDrone(d: DroneDeclare): string {
  const type = d.modele ? `${d.type} (${d.modele})` : d.type;
  if (d.par === "type") return `type ${type}`;
  return type ? `catégorie B6 · ${type}` : "catégorie B6";
}
