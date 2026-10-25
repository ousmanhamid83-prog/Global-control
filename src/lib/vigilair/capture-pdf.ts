/**
 * Générateur PDF MINIMAL (1 page A4) pour le DOSSIER DE PREUVE d'une capture : l'image (JPEG embarqué
 * via DCTDecode) + quelques lignes de contexte. Pur, sans dépendance — tourne côté client pour un
 * téléchargement immédiat, transmissible à une autorité. Pas d'identité : juste la preuve que l'œil lira.
 */

const ACCENTS: Record<string, string> = {
  à: "a", â: "a", ä: "a", á: "a", ç: "c", è: "e", é: "e", ê: "e", ë: "e",
  î: "i", ï: "i", ô: "o", ö: "o", ó: "o", ù: "u", û: "u", ü: "u", œ: "oe",
  À: "A", Â: "A", Ä: "A", Ç: "C", È: "E", É: "E", Ê: "E", Ë: "E", Î: "I",
  Ï: "I", Ô: "O", Ù: "U", Û: "U", Ü: "U", "·": "-", "—": "-", "–": "-",
  "’": "'", "°": "deg",
};

/** Translittère en ASCII imprimable et échappe ( ) \ pour un littéral de chaîne PDF. */
function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const a = ACCENTS[ch] ?? ch;
    for (const c of a) {
      if (c === "\\" || c === "(" || c === ")") out += `\\${c}`;
      else {
        const cp = c.codePointAt(0) ?? 63;
        out += cp >= 32 && cp <= 126 ? c : "?";
      }
    }
  }
  return out;
}

function bytes(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

/**
 * Construit le PDF. `jpeg` = octets JPEG de la capture ; `imgW/imgH` ses dimensions ; `lines` le texte.
 */
export function buildCapturePdf(
  jpeg: Uint8Array,
  imgW: number,
  imgH: number,
  lines: string[],
): Uint8Array {
  const PW = 595;
  const PH = 842;
  const M = 40;
  const maxW = PW - 2 * M;
  const maxH = 520;
  const scale = Math.min(maxW / Math.max(1, imgW), maxH / Math.max(1, imgH));
  const dw = Math.round(imgW * scale);
  const dh = Math.round(imgH * scale);
  const ix = M;
  const iy = PH - M - dh;
  let ty = iy - 24;

  let content = `q\n${dw} 0 0 ${dh} ${ix} ${iy} cm\n/Im0 Do\nQ\n`;
  content += `BT\n/F1 11 Tf\n${M} ${ty} Td\n14 TL\n`;
  for (const ln of lines) {
    content += `(${pdfText(ln)}) Tj\n0 -14 Td\n`;
    ty -= 14;
  }
  content += `ET\n`;
  const contentBytes = bytes(content);

  // Objets : 1 Catalog, 2 Pages, 3 Page, 4 Contents, 5 Font, 6 Image.
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { chunks.push(u); pos += u.length; };
  const obj = (s: string) => { offsets.push(pos); push(bytes(s)); };

  push(bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));

  obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  obj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
      `/Resources << /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  // Objet 4 : flux de contenu (texte + placement image).
  offsets.push(pos);
  push(bytes(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`));
  push(contentBytes);
  push(bytes("endstream\nendobj\n"));

  obj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

  // Objet 6 : image JPEG (DCTDecode).
  offsets.push(pos);
  push(bytes(
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  ));
  push(jpeg);
  push(bytes("\nendstream\nendobj\n"));

  // Table xref + trailer.
  const xrefPos = pos;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  push(bytes(xref));

  const total = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { total.set(c, o); o += c.length; }
  return total;
}

/**
 * PDF texte seul (1 page A4) : un TITRE + des lignes. Sert au dossier « état du périmètre réseau »
 * (quelles caméras vivantes / tombées à l'instant T), transmissible à la hiérarchie. Pur, sans image.
 * Débordement de page → tronqué avec une mention. Pas d'identité : des adresses d'équipement, pas des gens.
 */
export function buildTextPdf(title: string, lines: string[]): Uint8Array {
  const PW = 595;
  const PH = 842;
  const M = 40;
  let ty = PH - M;
  let content = `BT\n/F1 14 Tf\n${M} ${ty} Td\n(${pdfText(title)}) Tj\n/F1 10 Tf\n0 -22 Td\n14 TL\n`;
  ty -= 22;
  for (const ln of lines) {
    if (ty < M + 14) {
      content += `(... (tronque)) Tj\n`;
      break;
    }
    content += `(${pdfText(ln)}) Tj\n0 -14 Td\n`;
    ty -= 14;
  }
  content += `ET\n`;
  const contentBytes = bytes(content);

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { chunks.push(u); pos += u.length; };
  const obj = (s: string) => { offsets.push(pos); push(bytes(s)); };

  push(bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  obj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
      `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );
  offsets.push(pos);
  push(bytes(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`));
  push(contentBytes);
  push(bytes("endstream\nendobj\n"));
  obj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

  const xrefPos = pos;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  push(bytes(xref));

  const total = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { total.set(c, o); o += c.length; }
  return total;
}
