/**
 * État partagé du bandeau COP : le curseur géo survolé et la règle de mesure A→B, plus le canevas
 * COP vivant (pour la capture d'écran). Ces trois commandes sont appelées depuis d'AUTRES vues
 * (bandeau d'axe, barre d'outils COP), pas seulement depuis la carte — elles vivent donc dans leur
 * propre module plutôt qu'à côté du composant, pour que la carte n'exporte que son composant.
 */
import { SCALE } from "@/lib/vigilair/geo";
import { useVigilair } from "@/lib/vigilair/store";

export type CopHud = {
  cursor: { x: number; y: number; lat: number; lon: number } | null;
  a: { lat: number; lon: number } | null;
  b: { lat: number; lon: number } | null;
};

/** Objet MUTABLE partagé : la carte y écrit à chaque mouvement, les autres vues le lisent. */
export const copHud: CopHud = { cursor: null, a: null, b: null };

/** Canevas COP affiché à l'instant T. Posé par la carte au montage, retiré au démontage. */
const live: { canvas: HTMLCanvasElement | null } = { canvas: null };

export function setLiveCop(canvas: HTMLCanvasElement): void {
  live.canvas = canvas;
}

/** Ne libère que SON canevas : une carte démontée ne doit pas effacer celui d'une autre. */
export function releaseLiveCop(canvas: HTMLCanvasElement): void {
  if (live.canvas === canvas) live.canvas = null;
}

/** Arme la règle de mesure A→B (b = null : on attend le second point). */
export function armMeasure(
  a: { lat: number; lon: number } | null,
  b: { lat: number; lon: number } | null = null,
) {
  copHud.a = a;
  copHud.b = b;
}

export function peekCopCursor() {
  return copHud.cursor;
}

/** Enregistre le COP affiché en PNG horodaté (capture locale, rien n'est envoyé). */
export function snapshotCop(): void {
  const canvas = live.canvas;
  if (!canvas) return;
  const scale = SCALE[useVigilair.getState().mapScale]?.label ?? "COP";
  canvas.toBlob((blob) => {
    if (!blob) return;
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AfriControl-COP-${scale}-${stamp}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}
