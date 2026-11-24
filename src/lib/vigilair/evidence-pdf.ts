/** PDF 1.4 minimal (WinAnsi / Helvetica) — serveur seulement. */

const WIN: Record<string, number> = {
  À: 192,
  Á: 193,
  Â: 194,
  Ä: 196,
  Ç: 199,
  È: 200,
  É: 201,
  Ê: 202,
  Ë: 203,
  Î: 206,
  Ï: 207,
  Ô: 212,
  Ù: 217,
  Û: 219,
  Ü: 220,
  à: 224,
  á: 225,
  â: 226,
  ä: 228,
  ç: 231,
  è: 232,
  é: 233,
  ê: 234,
  ë: 235,
  î: 238,
  ï: 239,
  ô: 244,
  ù: 249,
  û: 251,
  ü: 252,
  œ: 156,
  Œ: 140,
  "°": 176,
  "·": 183,
  // Les guillemets du contexte (« capture en appui, la scène « … » étant ouverte ») : avant, « ? ».
  "«": 171,
  "»": 187,
  "–": 150,
  "—": 151,
  "’": 146,
  "‘": 145,
  "“": 147,
  "”": 148,
};

function pdfStr(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (ch === "\\" || ch === "(" || ch === ")") {
      out += `\\${ch}`;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 63;
    if (cp >= 32 && cp <= 126) {
      out += ch;
      continue;
    }
    const mapped = WIN[ch];
    if (mapped != null) {
      out += `\\${mapped.toString(8).padStart(3, "0")}`;
      continue;
    }
    out += "?";
  }
  return out;
}

function wrapLine(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export type PdfBlock = { kind: "h" | "k" | "p" | "mono" | "gap"; text?: string };

export function layoutEvidence(blocks: PdfBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "gap") {
      out.push("");
      continue;
    }
    const width = b.kind === "h" ? 62 : b.kind === "mono" ? 92 : 88;
    const lines = wrapLine(b.text ?? "", width);
    if (b.kind === "h") {
      out.push(lines[0]?.toUpperCase() ?? "");
      out.push("-".repeat(Math.min(62, (lines[0] ?? "").length + 4)));
    } else {
      out.push(...lines);
    }
  }
  return out;
}

/** Le cliché mis en tête du dossier : des tuiles JPEG assemblées, le drone marqué, une légende. */
export type ClichePdf = {
  /** Côté de l'assemblage, en tuiles. */
  cote: number;
  /** Les tuiles reçues, à leur place ; une case sans tuile reste grise. */
  tuiles: { col: number; lig: number; jpeg: Uint8Array }[];
  /** Le drone, en fraction du côté de l'assemblage, depuis son coin nord-ouest. */
  marque: { fx: number; fy: number };
  legende: string[];
};

/**
 * Largeur, hauteur et nombre de composantes d'un JPEG, lus dans son en-tête (le marqueur SOF) ;
 * null si ce n'en est pas un. Le PDF doit annoncer les vraies dimensions de l'image.
 */
export function tailleJpeg(b: Uint8Array): { w: number; h: number; composantes: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]!, composantes: b[i + 9]! };
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return null;
}

export function buildPdf(lines: string[], cliche?: ClichePdf): Uint8Array {
  const pageW = 595;
  const pageH = 842;
  const margin = 48;
  const leading = 11;
  const fontSize = 9;
  const headerSize = 11;
  const usable = pageH - margin * 2;
  const perPage = Math.max(8, Math.floor(usable / leading));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  if (pages.length === 0) pages.push([""]);

  const objects: (string | null)[] = [null];
  const add = (body: string) => {
    objects.push(body);
    return objects.length - 1;
  };

  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBoldId = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  /** Les images de chaque page, par nom ; la page du cliché seule en a. */
  const imagesDe: string[] = [];
  if (cliche) {
    const cote = pageW - 2 * margin;
    const pas = cote / cliche.cote;
    const haut = pageH - margin;
    const cmds: string[] = [];
    const images: string[] = [];
    for (let lig = 0; lig < cliche.cote; lig++) {
      for (let col = 0; col < cliche.cote; col++) {
        const x = (margin + col * pas).toFixed(1);
        const y = (haut - (lig + 1) * pas).toFixed(1);
        const t = cliche.tuiles.find((u) => u.col === col && u.lig === lig);
        const taille = t ? tailleJpeg(t.jpeg) : null;
        if (!t || !taille) {
          cmds.push(`0.85 g ${x} ${y} ${pas.toFixed(1)} ${pas.toFixed(1)} re f`);
          continue;
        }
        const espace = taille.composantes === 1 ? "DeviceGray" : taille.composantes === 4 ? "DeviceCMYK" : "DeviceRGB";
        const id = add(
          `<< /Type /XObject /Subtype /Image /Width ${taille.w} /Height ${taille.h} /ColorSpace /${espace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${t.jpeg.length} >>\nstream\n${Buffer.from(t.jpeg).toString("latin1")}\nendstream`,
        );
        images.push(`/T${images.length} ${id} 0 R`);
        cmds.push(`q ${pas.toFixed(1)} 0 0 ${pas.toFixed(1)} ${x} ${y} cm /T${images.length - 1} Do Q`);
      }
    }
    // Le drone : un cercle rouge et sa croix, à sa position dans l'assemblage.
    const cx = margin + cliche.marque.fx * cote;
    const cy = haut - cliche.marque.fy * cote;
    const r = 9;
    const k = r * 0.5523;
    const f = (v: number) => v.toFixed(1);
    cmds.push(
      `1 0 0 RG 1.6 w ${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ` +
        `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ` +
        `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ` +
        `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c S ` +
        `${f(cx - 2 * r)} ${f(cy)} m ${f(cx - r)} ${f(cy)} l ${f(cx + r)} ${f(cy)} m ${f(cx + 2 * r)} ${f(cy)} l ` +
        `${f(cx)} ${f(cy - 2 * r)} m ${f(cx)} ${f(cy - r)} l ${f(cx)} ${f(cy + r)} m ${f(cx)} ${f(cy + 2 * r)} l S`,
    );
    let y = haut - cote - 18;
    cliche.legende.forEach((line, i) => {
      cmds.push(`0 g BT /F${i === 0 ? "B" : "1"} ${i === 0 ? headerSize : fontSize} Tf ${margin} ${y.toFixed(1)} Td (${pdfStr(line)}) Tj ET`);
      y -= leading;
    });
    const stream = cmds.join("\n");
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
    imagesDe.push(images.join(" "));
  }
  for (const pageLines of pages) {
    const cmds: string[] = [];
    let y = pageH - margin;
    pageLines.forEach((line, i) => {
      const isHead = i === 0 && pages.indexOf(pageLines) === 0;
      const font = isHead ? fontBoldId : fontId;
      const size = isHead ? headerSize : fontSize;
      cmds.push(`BT /F${font === fontBoldId ? "B" : "1"} ${size} Tf ${margin} ${y.toFixed(1)} Td (${pdfStr(line)}) Tj ET`);
      y -= leading;
    });
    const stream = cmds.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    pageIds.push(0);
    imagesDe.push("");
  }

  const pagesId = add("<< /Type /Pages /Count 0 /Kids [] >>");
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const kids = pageIds.map((_, i) => {
    const id = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R /FB ${fontBoldId} 0 R >>${imagesDe[i] ? ` /XObject << ${imagesDe[i]} >>` : ""} >> >>`,
    );
    pageIds[i] = id;
    return id;
  });

  objects[pagesId] =
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] >>`;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  let pos = chunks[0]!.length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pos;
    const body = `${i} 0 obj\n${objects[i]}\nendobj\n`;
    const buf = Buffer.from(body, "latin1");
    chunks.push(buf);
    pos += buf.length;
  }
  const xrefPos = pos;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, "latin1"));
  return Buffer.concat(chunks);
}
