import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCapturePdf, buildTextPdf } from "./capture-pdf.ts";

function ascii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

test("buildCapturePdf : PDF valide avec image DCTDecode et texte", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]); // faux JPEG (octets embarqués tels quels)
  const pdf = buildCapturePdf(jpeg, 320, 240, ["AfriControl - dossier de preuve", "Cam Portail - 12:34"]);
  const s = ascii(pdf);
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.includes("/DCTDecode"));
  assert.ok(s.includes("/Width 320"));
  assert.ok(s.includes("/Image"));
  assert.ok(s.includes("(AfriControl - dossier de preuve) Tj"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  // startxref présent et pointe dans le fichier
  const m = s.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(m);
  const xrefPos = Number(m![1]);
  assert.ok(xrefPos > 0 && xrefPos < pdf.length);
  assert.equal(ascii(pdf.subarray(xrefPos, xrefPos + 4)), "xref");
});

test("buildCapturePdf : les accents sont translittérés, pas cassés", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const s = ascii(buildCapturePdf(jpeg, 10, 10, ["présence immobile · périmètre armé"]));
  assert.ok(s.includes("(presence immobile - perimetre arme) Tj"));
});

test("buildTextPdf : PDF texte valide, titre + lignes, sans image", () => {
  const pdf = buildTextPdf("AfriControl - etat du perimetre reseau", ["Poste Est : 2 vivantes, 1 tombee", "10.20.0.5:80 OK"]);
  const s = ascii(pdf);
  assert.equal(s.slice(0, 8), "%PDF-1.4");
  assert.ok(s.includes("(AfriControl - etat du perimetre reseau) Tj"));
  assert.ok(s.includes("(10.20.0.5:80 OK) Tj"));
  assert.ok(!s.includes("/XObject")); // pas d'image
  assert.ok(s.trimEnd().endsWith("%%EOF"));
});

test("buildTextPdf : trop de lignes → tronqué proprement", () => {
  const many = Array.from({ length: 200 }, (_, i) => `ligne ${i}`);
  const s = ascii(buildTextPdf("T", many));
  assert.ok(s.includes("(... (tronque)) Tj"));
});
