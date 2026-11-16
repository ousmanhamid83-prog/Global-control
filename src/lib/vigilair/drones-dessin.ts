/**
 * NOS drones sur la carte, tels que leur liaison les donne : le symbole ami à sa position, son cap,
 * son point de départ, son circuit de patrouille ; pendant qu'un point est désigné, le rayon permis
 * autour du départ et le point choisi. Et, sous les pistes, l'image de chaque source calée en fond.
 */
import { drawApp6Air } from "./app6";
import type { OwnDrone } from "./drones-core";
import {
  affineTriangle,
  coinsDepuisDrone,
  refusCoins,
  versQuadrilatere,
  type Coins,
  type Point2,
  type PointGeo,
} from "./drones-fond";
import { liaisonVivante, nomMode } from "./drones-pilotage";
import type { Suivi } from "./drones-suivi";

type Ctx = CanvasRenderingContext2D;
type Projeter = (lat: number, lon: number) => { x: number; y: number };

/** La dernière image de chaque source et, pour une emprise calculée, où ses coins tombaient alors. */
type ImageFond = { image: HTMLImageElement; a: number; coins: Coins | null };
const images = new Map<string, ImageFond>();
/** L'image tendue, gardée tant que ni elle ni la vue ne changent : la carte se redessine sans cesse. */
const tendues = new Map<string, { cle: string; toile: HTMLCanvasElement; x: number; y: number }>();

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

/** Mailles par côté pour une image vue en perspective : chacune est tendue par deux triangles. */
const MAILLES = 8;

/** Tend l'image sur le quadrilatère q (pixels de la toile), triangle par triangle. */
function tendre(ctx: Ctx, image: HTMLImageElement, q: [Point2, Point2, Point2, Point2]): void {
  const vers = versQuadrilatere(q);
  const [W, H] = [image.width, image.height];
  for (let j = 0; j < MAILLES; j++) {
    for (let i = 0; i < MAILLES; i++) {
      const [u0, u1, v0, v1] = [i / MAILLES, (i + 1) / MAILLES, j / MAILLES, (j + 1) / MAILLES];
      const triangles: [Point2, Point2, Point2][] = [
        [
          [u0, v0],
          [u1, v0],
          [u0, v1],
        ],
        [
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ],
      ];
      for (const [a, b, c] of triangles) {
        const ecran: [Point2, Point2, Point2] = [vers(...a), vers(...b), vers(...c)];
        const source: [Point2, Point2, Point2] = [
          [a[0] * W, a[1] * H],
          [b[0] * W, b[1] * H],
          [c[0] * W, c[1] * H],
        ];
        // Un demi-pixel de débord autour du centre du triangle : pas de fente entre deux mailles.
        const cx = (ecran[0][0] + ecran[1][0] + ecran[2][0]) / 3;
        const cy = (ecran[0][1] + ecran[1][1] + ecran[2][1]) / 3;
        ctx.save();
        ctx.beginPath();
        ecran.forEach(([x, y], k) => {
          const d = Math.hypot(x - cx, y - cy) || 1;
          const [px, py] = [x + ((x - cx) / d) * 0.6, y + ((y - cy) / d) * 0.6];
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        ctx.transform(...affineTriangle(source, ecran));
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }
    }
  }
}

/** Les coins d'une image, dans l'ordre où ils se posent. */
export const NOMS_COINS = ["haut-gauche", "haut-droit", "bas-droit", "bas-gauche"] as const;

/**
 * Les images calées, sous les pistes : chacune tendue entre ses quatre coins, son contour, son nom
 * et l'heure de l'image. `w`, `h` : la carte ; `finesse` : pixels réels par pixel de la carte ;
 * `essai` : un calage à la main en cours — ses coins numérotés, et l'image tendue dès le quatrième.
 */
export function dessinerFonds(
  ctx: Ctx,
  pj: Projeter,
  drones: readonly OwnDrone[],
  o: {
    w: number;
    h: number;
    finesse: number;
    trait: string;
    texte: string;
    essai: { id: string; coins: PointGeo[] } | null;
  },
): void {
  const essai =
    o.essai && o.essai.coins.length === 4 && !refusCoins(o.essai.coins)
      ? (o.essai.coins as Coins)
      : null;
  for (const id of images.keys()) {
    const source = drones.find((d) => d.id === id);
    if (!source) images.delete(id);
    if (!source?.fond && o.essai?.id !== id) tendues.delete(id);
  }
  for (const source of drones) {
    const fond = source.fond;
    const i = images.get(source.id);
    const enEssai = o.essai?.id === source.id;
    // Pendant qu'on recale une source, son ancien calage ne se dessine plus : seul l'essai compte.
    const coins = enEssai
      ? essai
      : !fond
        ? null
        : fond.mode === "coins"
          ? fond.coins
          : (i?.coins ?? null);
    if (!i || !coins) continue;
    const q = coins.map((c) => {
      const p = pj(c.lat, c.lon);
      return [p.x, p.y] as Point2;
    }) as [Point2, Point2, Point2, Point2];
    // Seule la part de l'image qui tombe dans la carte est tendue.
    const x0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1]))));
    const x1 = Math.min(o.w, Math.ceil(Math.max(...q.map((p) => p[0]))));
    const y1 = Math.min(o.h, Math.ceil(Math.max(...q.map((p) => p[1]))));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const cle = `${i.a}|${o.finesse}|${q.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("|")}`;
    let t = tendues.get(source.id);
    if (!t || t.cle !== cle) {
      const toile = t?.toile ?? document.createElement("canvas");
      toile.width = Math.ceil((x1 - x0) * o.finesse);
      toile.height = Math.ceil((y1 - y0) * o.finesse);
      const c = toile.getContext("2d");
      if (!c) continue;
      c.setTransform(o.finesse, 0, 0, o.finesse, -x0 * o.finesse, -y0 * o.finesse);
      tendre(c, i.image, q);
      t = { cle, toile, x: x0, y: y0 };
      tendues.set(source.id, t);
    }
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(t.toile, t.x, t.y, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.trait;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    q.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = o.texte;
    ctx.fillText(
      `${source.name} · image ${new Date(i.a).toISOString().slice(11, 19)} Z`,
      q[0][0] + 4,
      q[0][1] - 5,
    );
    ctx.restore();
  }
  if (!o.essai) return;
  ctx.save();
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  ctx.strokeStyle = o.trait;
  ctx.fillStyle = o.texte;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  o.essai.coins.forEach((c, k) => {
    const p = pj(c.lat, c.lon);
    if (k === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  if (o.essai.coins.length === 4) ctx.closePath();
  ctx.stroke();
  o.essai.coins.forEach((c, k) => {
    const p = pj(c.lat, c.lon);
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.fillText(`${k + 1} · ${NOMS_COINS[k]}`, p.x + 7, p.y + 13);
  });
  ctx.restore();
}

export function dessinerNosDrones(
  ctx: Ctx,
  pj: Projeter,
  suivi: Suivi,
  drones: readonly OwnDrone[],
  o: {
    /** Couleurs : ami, texte, atténué. */
    ami: string;
    texte: string;
    attenue: string;
    /** Pixels par kilomètre, en largeur et en hauteur (la carte n'est pas carrée). */
    pxKmX: number;
    pxKmY: number;
    /** Un point est en train d'être désigné : le rayon permis se montre. */
    designation: boolean;
  },
): void {
  ctx.save();
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  for (const e of suivi.etats) {
    const drone = drones.find((d) => d.id === e.id);
    if (!drone) continue;
    const vivant = liaisonVivante(e, suivi.a);
    const couleur = vivant ? o.ami : o.attenue;
    ctx.strokeStyle = couleur;
    ctx.fillStyle = couleur;
    ctx.lineWidth = 1;
    if (e.depart) {
      const d = pj(e.depart.lat, e.depart.lon);
      ctx.strokeRect(d.x - 4, d.y - 4, 8, 8);
      ctx.fillText("D", d.x - 3, d.y - 7);
      if (o.designation && suivi.reglages) {
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(
          d.x,
          d.y,
          suivi.reglages.rayonKm * o.pxKmX,
          suivi.reglages.rayonKm * o.pxKmY,
          0,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (drone.patrouille) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      drone.patrouille.points.forEach((pt, i) => {
        const p = pj(pt.lat, pt.lon);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      drone.patrouille.points.forEach((pt, i) => {
        const p = pj(pt.lat, pt.lon);
        ctx.fillText(String(i + 1), p.x + 4, p.y - 4);
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });
    }
    if (!e.position) continue;
    const p = pj(e.position.lat, e.position.lon);
    if (e.position.cap !== null) {
      const cap = (e.position.cap * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 22 * Math.sin(cap), p.y - 22 * Math.cos(cap));
      ctx.stroke();
    }
    drawApp6Air(ctx, p.x, p.y, 10, "ami", couleur, `${couleur}22`);
    ctx.fillStyle = o.texte;
    ctx.fillText(`${drone.name} · NOTRE DRONE${vivant ? "" : " · MUET"}`, p.x + 14, p.y - 6);
    ctx.fillStyle = o.attenue;
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillText(`${Math.round(e.position.hauteurM)} m · ${nomMode(e)}`, p.x + 14, p.y + 6);
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
  }
  if (suivi.designe) {
    const p = pj(suivi.designe.lat, suivi.designe.lon);
    ctx.strokeStyle = o.texte;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y);
    ctx.lineTo(p.x + 9, p.y);
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x, p.y + 9);
    ctx.stroke();
    ctx.fillStyle = o.texte;
    ctx.fillText("POINT DÉSIGNÉ", p.x + 12, p.y + 3);
  }
  ctx.restore();
}
