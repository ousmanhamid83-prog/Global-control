import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPdf, tailleJpeg, type ClichePdf } from "./evidence-pdf.ts";

/** Un JPEG réduit à ses en-têtes : SOI, les segments donnés, EOI. */
function jpeg(...segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);
}
/** APP0 « JFIF », 16 octets annoncés, comme en tête des tuiles d'Esri. */
const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
/** Un segment SOF : précision 8, hauteur, largeur, composantes. */
function sof(m: number, h: number, w: number, n: number): number[] {
  const composantes = Array.from({ length: n }, (_, i) => [i + 1, 0x11, 0]).flat();
  return [0xff, m, 0, 8 + 3 * n, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, n, ...composantes];
}
/** Un segment qui n'est pas un SOF, de 10 octets : lu comme un SOF, il donnerait 4626 × 4626. */
const pasSof = (m: number) => [0xff, m, 0, 8, 0x12, 0x12, 0x12, 0x12, 0x12, 0x12];
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("tailleJpeg : la taille que le PDF doit annoncer", () => {
  it("lue au SOF, après les segments qui le précèdent, quel que soit le SOF", () => {
    assert.deepEqual(tailleJpeg(jpeg(APP0, sof(0xc0, 256, 256, 3))), {
      w: 256,
      h: 256,
      composantes: 3,
    });
    // Progressif (C2), après une table de Huffman (C4), une extension (C8) et une table
    // arithmétique (CC) : ces trois-là ne sont pas des SOF, quoique dans la même plage.
    const progressif = jpeg(APP0, pasSof(0xc4), pasSof(0xc8), pasSof(0xcc), sof(0xc2, 384, 512, 1));
    assert.deepEqual(tailleJpeg(progressif), { w: 512, h: 384, composantes: 1 });
    // Les bornes de la plage : C0 (ci-dessus) et CF.
    assert.deepEqual(tailleJpeg(jpeg(sof(0xcf, 1, 300, 4))), { w: 300, h: 1, composantes: 4 });
    // Un segment de plus de 255 octets (un APP1 EXIF) : sa longueur tient sur deux octets.
    const app1 = [0xff, 0xe1, 0x01, 0x2e, ...new Array<number>(300).fill(0xc0)];
    assert.deepEqual(tailleJpeg(jpeg(app1, sof(0xc0, 256, 256, 3))), {
      w: 256,
      h: 256,
      composantes: 3,
    });
  });

  it("null pour ce qui n'est pas un JPEG, ou un JPEG tronqué avant sa taille", () => {
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...sof(0xc0, 9, 9, 3),
    ]);
    assert.equal(tailleJpeg(png), null);
    // Un seul des deux octets de tête faux suffit.
    assert.equal(tailleJpeg(Uint8Array.from([0xff, 0xd9, ...sof(0xc0, 9, 9, 3)])), null);
    assert.equal(tailleJpeg(Uint8Array.from([0x00, 0xd8, ...sof(0xc0, 9, 9, 3)])), null);
    // Tronqué : le SOF commence, ses composantes manquent.
    assert.equal(
      tailleJpeg(Uint8Array.from([0xff, 0xd8, ...sof(0xc0, 9, 9, 3).slice(0, 9)])),
      null,
    );
    // Le dixième octet du SOF est le dernier du fichier : la taille est lue.
    assert.deepEqual(
      tailleJpeg(Uint8Array.from([0xff, 0xd8, ...sof(0xc0, 9, 7, 3).slice(0, 10)])),
      {
        w: 7,
        h: 9,
        composantes: 3,
      },
    );
    // Un segment qui ne commence pas par FF : la chaîne est cassée.
    assert.equal(tailleJpeg(jpeg([0x00, 0xe0, 0, 4, 0, 0], sof(0xc0, 9, 9, 3))), null);
    // Sans SOF.
    assert.equal(tailleJpeg(jpeg(APP0, pasSof(0xc4))), null);
  });
});

/**
 * Les objets du PDF, par numéro, lus comme un lecteur les lit : startxref donne la table xref, et
 * chaque décalage de la table doit tomber sur « N 0 obj ».
 */
function objets(pdf: Uint8Array): Map<number, string> {
  const s = latin1(pdf);
  const xref = Number(s.slice(s.lastIndexOf("startxref\n") + 10).split("\n")[0]);
  assert.ok(s.startsWith("xref\n", xref), `table xref au décalage ${xref}`);
  const [entete, ...lignes] = s.slice(xref + 5).split("\n");
  const n = Number(entete!.split(" ")[1]);
  const out = new Map<number, string>();
  for (let i = 1; i < n; i++) {
    const decalage = Number(lignes[i]!.slice(0, 10));
    assert.ok(s.startsWith(`${i} 0 obj\n`, decalage), `objet ${i} au décalage ${decalage}`);
    out.set(i, s.slice(decalage, s.indexOf("\nendobj\n", decalage)));
  }
  return out;
}

describe("buildPdf : le cliché en première page", () => {
  const rgb = jpeg(APP0, sof(0xc0, 256, 256, 3), [1, 2, 3, 0xff, 0x00, 0x28, 0x29, 0x5c]);
  const gris = jpeg(sof(0xc0, 256, 256, 1));
  const cmjn = jpeg(sof(0xc0, 256, 256, 4));
  const cliche: ClichePdf = {
    cote: 3,
    tuiles: [
      { col: 0, lig: 0, jpeg: rgb },
      { col: 1, lig: 0, jpeg: cmjn },
      { col: 2, lig: 2, jpeg: gris },
      // Pas un JPEG : la case reste grise.
      { col: 1, lig: 1, jpeg: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
    ],
    marque: { fx: 0.3, fy: 0.2 },
    legende: ["Cliché du lieu — essai", "deuxième ligne"],
  };

  it("les tuiles à leur place, telles quelles, le drone marqué, la légende sous l'image", () => {
    const pdf = buildPdf(["DOSSIER", "ligne 2"], cliche);
    const obj = objets(pdf);
    const tout = [...obj.values()].join("\n");
    assert.match(tout, /\/Type \/Pages \/Count 2 /);
    const images = [...obj.values()].filter((o) => o.includes("/Subtype /Image"));
    assert.equal(images.length, 3);
    assert.match(images[0]!, /\/Width 256 \/Height 256 \/ColorSpace \/DeviceRGB /);
    assert.ok(images[0]!.includes(`/Filter /DCTDecode /Length ${rgb.length} >>\nstream\n`));
    assert.match(images[1]!, /\/ColorSpace \/DeviceCMYK /);
    assert.match(images[2]!, /\/ColorSpace \/DeviceGray /);
    // Les octets de la tuile, parenthèses et barre oblique comprises, entrent sans retouche.
    assert.ok(Buffer.from(pdf).indexOf(Buffer.from(rgb)) > 0);
    const page1 = [...obj.values()].find(
      (o) => o.includes("/Type /Page ") && o.includes("/XObject"),
    )!;
    assert.match(page1, /\/XObject << \/T0 \d+ 0 R \/T1 \d+ 0 R \/T2 \d+ 0 R >>/);
    const pages = [...obj.values()].filter((o) => o.includes("/Type /Page "));
    assert.equal(pages.filter((o) => o.includes("/XObject")).length, 1, "seule la page du cliché");
    // Une case de 499 / 3 = 166,3 pt ; la première en haut à gauche, la dernière en bas à droite.
    assert.match(tout, /q 166\.3 0 0 166\.3 48\.0 627\.7 cm \/T0 Do Q/);
    assert.match(tout, /q 166\.3 0 0 166\.3 214\.3 627\.7 cm \/T1 Do Q/);
    assert.match(tout, /q 166\.3 0 0 166\.3 380\.7 295\.0 cm \/T2 Do Q/);
    assert.equal(tout.match(/0\.85 g [\d.]+ [\d.]+ 166\.3 166\.3 re f/g)?.length, 6);
    // Le drone : x = 48 + 0,3 × 499, y = 794 − 0,2 × 499 ; le cercle part de x + 9.
    assert.match(tout, /1 0 0 RG 1\.6 w 206\.7 694\.2 m /);
    assert.match(tout, /BT \/FB 11 Tf 48 277\.0 Td \(Clich\\351 du lieu \\227 essai\) Tj ET/);
    assert.match(tout, /BT \/F1 9 Tf 48 266\.0 Td \(deuxi\\350me ligne\) Tj ET/);
  });

  it("sans cliché, le dossier d'avant : pas d'image, pas de page de plus", () => {
    const pdf = buildPdf(["DOSSIER", "ligne 2"]);
    const tout = [...objets(pdf).values()].join("\n");
    assert.match(tout, /\/Type \/Pages \/Count 1 /);
    assert.doesNotMatch(tout, /XObject|DCTDecode/);
    assert.match(tout, /BT \/FB 11 Tf 48 794\.0 Td \(DOSSIER\) Tj ET/);
  });

  it("les guillemets du contexte en WinAnsi : « » et non plus « ? »", () => {
    // Lu dans le vrai dossier de MNSTR31 avant correction : « la scène ? FTTJ N'Djamena ? ».
    const pdf = buildPdf(["DOSSIER", "la scène « FTTJ N'Djamena » étant ouverte"]);
    const tout = [...objets(pdf).values()].join("\n");
    assert.match(tout, /\(la sc\\350ne \\253 FTTJ N'Djamena \\273 \\351tant ouverte\) Tj/);
  });
});
