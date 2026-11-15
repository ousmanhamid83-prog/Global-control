/**
 * NOS drones sur la carte, tels que leur liaison les donne : le symbole ami à sa position, son cap,
 * son point de départ, son circuit de patrouille ; pendant qu'un point est désigné, le rayon permis
 * autour du départ et le point choisi.
 */
import { drawApp6Air } from "./app6";
import type { OwnDrone } from "./drones-core";
import { liaisonVivante, nomMode } from "./drones-pilotage";
import type { Suivi } from "./drones-suivi";

type Ctx = CanvasRenderingContext2D;
type Projeter = (lat: number, lon: number) => { x: number; y: number };

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
