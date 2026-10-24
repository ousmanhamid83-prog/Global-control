/**
 * Fond MULTI-TRAMES par médiane temporelle — pur, sans identité, sans modèle entraîné.
 *
 * Au lieu d'une seule moyenne glissante, on garde les N dernières trames (luminance) et on prend la
 * MÉDIANE par pixel. Avantages : un objet qui traverse un pixel ne décale pas la médiane (il faut qu'il
 * y reste plus de la moitié de la fenêtre), un éclair/bruit d'une trame est rejeté, et la détection de
 * mouvement est plus stable. Le push est SÉLECTIF : sous une zone gelée (présence arrêtée), on réinjecte
 * la base au lieu de l'objet, pour que l'historique n'« apprenne » jamais l'objet immobile.
 */

export type FrameRing = {
  /** cap × n luminances (trames concaténées). */
  buf: Float32Array;
  /** pixels par trame. */
  n: number;
  /** nombre max de trames (fenêtre). */
  cap: number;
  /** trames effectivement remplies (≤ cap). */
  len: number;
  /** prochain emplacement d'écriture (0..cap-1). */
  head: number;
};

function lumAt(px: Uint8ClampedArray | Uint8Array, p: number): number {
  return 0.299 * px[p]! + 0.587 * px[p + 1]! + 0.114 * px[p + 2]!;
}

export function createRing(n: number, cap: number): FrameRing {
  return { buf: new Float32Array(n * cap), n, cap, len: 0, head: 0 };
}

/**
 * Ajoute la trame courante à l'anneau. Aux pixels GELÉS (freeze=1), on écrit `baseline` (fond
 * courant, sans l'objet) au lieu de la luminance — ainsi une présence arrêtée n'entre pas dans
 * l'historique et reste de l'avant-plan tant qu'elle est là.
 */
export function pushLuma(
  ring: FrameRing,
  cur: Uint8ClampedArray | Uint8Array,
  baseline?: Float32Array | null,
  freeze?: Uint8Array,
): void {
  const base = ring.head * ring.n;
  for (let i = 0; i < ring.n; i++) {
    ring.buf[base + i] = freeze && freeze[i] && baseline ? baseline[i]! : lumAt(cur, i * 4);
  }
  ring.head = (ring.head + 1) % ring.cap;
  ring.len = Math.min(ring.len + 1, ring.cap);
}

/** Médiane par pixel sur les trames remplies. `out` réutilisé si fourni (taille n). */
export function medianBackground(ring: FrameRing, out?: Float32Array): Float32Array {
  const { n, len } = ring;
  const bg = out && out.length === n ? out : new Float32Array(n);
  if (len === 0) return bg;
  const vals = new Float32Array(len);
  const mid = len >> 1;
  const odd = (len & 1) === 1;
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < len; f++) vals[f] = ring.buf[f * n + i]!;
    // tri d'un très petit tableau (len ≤ cap)
    for (let a = 1; a < len; a++) {
      const v = vals[a]!;
      let b = a - 1;
      while (b >= 0 && vals[b]! > v) {
        vals[b + 1] = vals[b]!;
        b--;
      }
      vals[b + 1] = v;
    }
    bg[i] = odd ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  }
  return bg;
}
