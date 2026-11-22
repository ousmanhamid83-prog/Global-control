/**
 * L'image de chaque source (drone, caméra de site) pour la carte : la dernière reçue, son heure, et
 * ses quatre coins au sol — cliqués par le chef, ou calculés de la télémétrie du drone à l'instant
 * de l'image. La carte la pose entre ces quatre coins, redressée en perspective si la vue est de
 * biais (redresser.ts).
 */
import type { OwnDrone } from "./drones-core.ts";
import { coinsDepuisDrone, refusCoins, type Coins, type PointGeo } from "./drones-fond.ts";

/** La dernière image de chaque source et, pour une emprise calculée, où ses coins tombaient alors. */
type ImageFond = { image: HTMLImageElement; a: number; coins: Coins | null };
const images = new Map<string, ImageFond>();

/**
 * Une image de la source vient d'arriver. `position` : où la liaison situe le drone à cet instant,
 * pour une emprise calculée — sans elle, l'image n'est pas posée (elle ne saurait pas où tomber).
 */
export function poserImageFond(
  source: OwnDrone,
  image: HTMLImageElement,
  a: number,
  position: { lat: number; lon: number; hauteurM: number; cap: number | null } | null,
): void {
  const coins =
    source.fond?.mode === "drone" && position
      ? coinsDepuisDrone(position, source.fond.champDeg, image.height / image.width)
      : null;
  images.set(source.id, { image, a, coins });
}

/**
 * Ce que la carte tient du fond d'une source : son image, l'heure où elle est arrivée, et si une
 * emprise calculée a pu la poser (le drone avait alors position, cap et hauteur).
 */
export function etatFond(source: OwnDrone): { src: string; a: number; posee: boolean } | null {
  const i = images.get(source.id);
  if (!i) return null;
  return { src: i.image.src, a: i.a, posee: source.fond?.mode !== "drone" || i.coins !== null };
}

export function chargerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image illisible"));
    img.src = src;
  });
}

/** Les coins d'une image, dans l'ordre où ils se posent. */
export const NOMS_COINS = ["haut-gauche", "haut-droit", "bas-droit", "bas-gauche"] as const;

export type FondAPoser = {
  id: string;
  nom: string;
  image: HTMLImageElement;
  a: number;
  coins: Coins;
};

/**
 * Les images à poser sur la carte, chacune entre ses quatre coins. `essai` : un calage à la main en
 * cours — son ancien calage ne compte plus, l'image se pose dès le quatrième coin valable.
 */
export function fondsAPoser(
  drones: readonly OwnDrone[],
  essai: { id: string; coins: PointGeo[] } | null,
): FondAPoser[] {
  // refusCoins refuse aussi ce qui n'a pas quatre coins : un calage incomplet ne pose rien.
  const calage = essai && !refusCoins(essai.coins) ? (essai.coins as Coins) : null;
  for (const id of images.keys()) {
    if (!drones.some((d) => d.id === id)) images.delete(id);
  }
  const fonds: FondAPoser[] = [];
  for (const source of drones) {
    const i = images.get(source.id);
    if (!i) continue;
    const fond = source.fond;
    const coins =
      essai?.id === source.id
        ? calage
        : !fond
          ? null
          : fond.mode === "coins"
            ? fond.coins
            : i.coins;
    if (coins) fonds.push({ id: source.id, nom: source.name, image: i.image, a: i.a, coins });
  }
  return fonds;
}
