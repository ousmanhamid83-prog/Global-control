/**
 * Les taches de contraste mesurées dans une tuile d'imagerie (« V détection », « H … », « P … ») : un
 * contraste de la taille d'un homme, d'une voiture ou d'une pirogue sur une image d'archive — une
 * classe de taille, jamais une identité. La mesure est ici, sans navigateur (des pixels en entrée),
 * pour être éprouvée à part ; tiles.ts lui passe les pixels de la tuile.
 *
 * Le balayage lit chaque tuile de haut en bas : garder les premières trouvées, c'était ne montrer que
 * le haut des tuiles, et seulement celles du haut du bloc. La carte en montre les plus CONTRASTÉES,
 * sous les mêmes plafonds ; les comptes et le cran du bandeau portent sur toutes.
 */

/** Les sortes de gabarit mesurées. */
export type Sorte = "homme" | "voiture" | "pirogue";
/** Le cran que la taille d'une tache atteint : rien, détection, reconnaissance, identification. */
export type Cran = "aucune" | "detection" | "reconnaissance" | "identification";

const RANG: Record<Cran, number> = {
  aucune: 0,
  detection: 1,
  reconnaissance: 2,
  identification: 3,
};

/** Une tache mesurée : sa sorte, son centre (en pixels de la tuile), sa taille, son cran, son contraste. */
export type Tache = { id: Sorte; cx: number; cy: number; px: number; cls: Cran; force: number };

export type MesureTuile = {
  homme: number;
  voiture: number;
  pirogue: number;
  /** Le meilleur cran atteint par chaque sorte, sur toutes ses taches (pas seulement les montrées). */
  crans: Partial<Record<Sorte, Cran>>;
  taches: Tache[];
};

/** Rayon de la moyenne locale : une fenêtre de 5 × 5 pixels. */
const R = 2;
/** Écart à la moyenne locale (en niveaux de gris) au-delà duquel un pixel tranche sur son voisinage. */
const SEUIL = 22;

/** Les meilleurs crans de deux relevés, sorte par sorte. */
export function fusionnerCrans(
  a: Partial<Record<Sorte, Cran>>,
  b: Partial<Record<Sorte, Cran>>,
): Partial<Record<Sorte, Cran>> {
  const out = { ...a };
  for (const [id, cran] of Object.entries(b) as [Sorte, Cran][]) {
    const deja = out[id];
    if (deja === undefined || RANG[cran] > RANG[deja]) out[id] = cran;
  }
  return out;
}

/**
 * Les taches d'une tuile de S × S pixels (RVBA). `gsd` : mètres par pixel ; `eau` : la tuile est sur
 * l'eau (les pirogues ne se cherchent que là) ; `crans` : le cran que chaque sorte peut atteindre à
 * cette finesse ; `cranDe` : le cran d'une tache de tant de pixels. Seuls les pixels qui ont leur
 * voisinage entier (5 × 5) sont regardés : une tache qui touche le bord de cette zone est coupée — sa
 * vraie taille ne se lit pas —, elle n'est ni comptée ni montrée.
 */
export function mesurerTaches(
  rgba: Uint8ClampedArray,
  S: number,
  o: { gsd: number; eau: boolean; crans: Record<Sorte, Cran>; cranDe: (px: number) => Cran },
): MesureTuile {
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const k = i * 4;
    lum[i] = rgba[k]! * 0.299 + rgba[k + 1]! * 0.587 + rgba[k + 2]! * 0.114;
  }
  // Sommes cumulées : la moyenne d'une fenêtre se lit en quatre valeurs.
  const pas = S + 1;
  const cumul = new Float64Array(pas * pas);
  for (let y = 0; y < S; y++) {
    let ligne = 0;
    for (let x = 0; x < S; x++) {
      ligne += lum[y * S + x]!;
      cumul[(y + 1) * pas + (x + 1)] = cumul[y * pas + (x + 1)]! + ligne;
    }
  }
  const contraste = new Float32Array(S * S);
  const tranche = new Uint8Array(S * S);
  for (let y = R; y < S - R; y++) {
    for (let x = R; x < S - R; x++) {
      const somme =
        cumul[(y + R + 1) * pas + (x + R + 1)]! -
        cumul[(y - R) * pas + (x + R + 1)]! -
        cumul[(y + R + 1) * pas + (x - R)]! +
        cumul[(y - R) * pas + (x - R)]!;
      const ecart = Math.abs(lum[y * S + x]! - somme / (2 * R + 1) ** 2);
      contraste[y * S + x] = ecart;
      if (ecart > SEUIL) tranche[y * S + x] = 1;
    }
  }
  const vu = new Uint8Array(S * S);
  const pile: number[] = [];
  const visiter = (q: number) => {
    if (vu[q] || !tranche[q]) return;
    vu[q] = 1;
    pile.push(q);
  };
  const mesure: MesureTuile = { homme: 0, voiture: 0, pirogue: 0, crans: {}, taches: [] };
  for (let depart = 0; depart < S * S; depart++) {
    if (!tranche[depart] || vu[depart]) continue;
    vu[depart] = 1;
    pile.length = 0;
    pile.push(depart);
    let n = 0;
    let minX = S;
    let minY = S;
    let maxX = 0;
    let maxY = 0;
    let sx = 0;
    let sy = 0;
    let force = 0;
    let coupee = false;
    while (pile.length) {
      const p = pile.pop()!;
      const x = p % S;
      const y = (p / S) | 0;
      n++;
      // Le bord de la zone regardée : la tache peut continuer au-delà.
      if (x <= R || y <= R || x >= S - 1 - R || y >= S - 1 - R) coupee = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sx += x;
      sy += y;
      force += contraste[p]!;
      // Les quatre voisins, sans passer d'un bout de ligne au début de la suivante.
      if (x > 0) visiter(p - 1);
      if (x < S - 1) visiter(p + 1);
      if (y > 0) visiter(p - S);
      if (y < S - 1) visiter(p + S);
    }
    if (coupee || n < 3 || n > 48) continue;
    const larg = maxX - minX + 1;
    const haut = maxY - minY + 1;
    const grand = Math.max(larg, haut);
    const petit = Math.max(1, Math.min(larg, haut));
    if (grand < 2 || grand > 18) continue;
    if (n / (larg * haut) < 0.35) continue;
    const allonge = grand / petit;
    const metres = grand * o.gsd;
    // Au moins 2 px : toujours un cran (la détection commence à 1,5 px).
    const cls = o.cranDe(grand);
    let id: Sorte | null = null;
    if (o.crans.homme !== "aucune" && metres >= 0.35 && metres <= 0.9 && allonge < 2.2) {
      id = "homme";
    } else if (o.crans.voiture !== "aucune" && metres >= 3 && metres <= 6.8 && allonge < 2.6) {
      id = "voiture";
    } else if (
      o.eau &&
      o.crans.pirogue !== "aucune" &&
      metres >= 6 &&
      metres <= 16 &&
      allonge >= 1.8 &&
      allonge <= 5.5
    ) {
      id = "pirogue";
    }
    if (!id) continue;
    mesure[id]++;
    const deja = mesure.crans[id];
    if (deja === undefined || RANG[cls] > RANG[deja]) mesure.crans[id] = cls;
    mesure.taches.push({ id, cx: sx / n, cy: sy / n, px: grand, cls, force: force / n });
  }
  return mesure;
}

/**
 * Les taches à montrer : les plus contrastées d'abord (à contraste égal, l'ordre reçu), au plus
 * `parSorte` d'une même sorte et `total` en tout.
 */
export function garderTraces<T extends { id: string; force: number }>(
  candidates: readonly T[],
  plafonds: { total: number; parSorte?: number },
): T[] {
  const parSorte = plafonds.parSorte ?? plafonds.total;
  // Le tri de JavaScript est stable : à contraste égal, l'ordre reçu est gardé.
  const triees = [...candidates].sort((a, b) => b.force - a.force);
  const gardees: T[] = [];
  const deSorte = new Map<string, number>();
  for (const t of triees) {
    if (gardees.length >= plafonds.total) break;
    const n = deSorte.get(t.id) ?? 0;
    if (n >= parSorte) continue;
    deSorte.set(t.id, n + 1);
    gardees.push(t);
  }
  return gardees;
}
