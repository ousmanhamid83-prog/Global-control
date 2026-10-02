export type FlameKind = "vehicule" | "naturel";

export type FlameBlob = {
  kind: FlameKind;
  cx: number;
  cy: number;
  m: number;
};

/** Flamme jaune-orange saturée. Pas la latérite, pas un toit rouge, pas un engin jaune. */
export function isFlamePixel(r: number, g: number, b: number): boolean {
  if (r < 230 || g < 110 || b > 80) return false;
  const ratio = g / r;
  if (ratio < 0.45 || ratio > 0.75) return false;
  return r - b >= 160;
}

/** Compte les feux sur une tuile à GSD ≤ 2 m. cx/cy sont en pixels de la tuile. */
export function scanFlames(
  src: Uint8ClampedArray,
  S: number,
  gsd: number,
): { feuVehicule: number; feuNaturel: number; blobs: FlameBlob[] } {
  const none = { feuVehicule: 0, feuNaturel: 0, blobs: [] as FlameBlob[] };
  if (!(gsd > 0) || gsd > 2) return none;
  const hot = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    if (isFlamePixel(src[o]!, src[o + 1]!, src[o + 2]!)) hot[i] = 1;
  }
  const seen = new Uint8Array(S * S);
  const stack: number[] = [];
  let feuVehicule = 0;
  let feuNaturel = 0;
  const blobs: FlameBlob[] = [];
  for (let start = 0; start < S * S; start++) {
    if (!hot[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    let n = 0;
    let minX = S;
    let minY = S;
    let maxX = 0;
    let maxY = 0;
    let sx = 0;
    let sy = 0;
    let edge = false;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % S;
      const y = (p / S) | 0;
      n++;
      if (x < 1 || y < 1 || x > S - 2 || y > S - 2) edge = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sx += x;
      sy += y;
      const tryPush = (q: number) => {
        if (q < 0 || q >= S * S || seen[q] || !hot[q]) return;
        seen[q] = 1;
        stack.push(q);
      };
      tryPush(p - 1);
      tryPush(p + 1);
      tryPush(p - S);
      tryPush(p + S);
    }
    if (edge || n < 2) continue;
    const major = Math.max(maxX - minX + 1, maxY - minY + 1);
    const meters = major * gsd;
    let kind: FlameKind | null = null;
    if (meters >= 12 || n >= 48) kind = "naturel";
    else if (meters >= 1.5 && meters < 12) kind = "vehicule";
    if (!kind) continue;
    if (kind === "vehicule") feuVehicule++;
    else feuNaturel++;
    if (blobs.length < 8) blobs.push({ kind, cx: sx / n, cy: sy / n, m: meters });
  }
  return { feuVehicule, feuNaturel, blobs };
}
