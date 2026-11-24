/**
 * Le cliché d'une capture de drone, composé par le serveur avec les tuiles que sert la carte du
 * poste (serveTile : Esri World Imagery, Clarity en secours), au zoom le plus fin où le lieu a de
 * l'imagerie. Chaque tuile entre dans l'empreinte, dans l'ordre.
 *
 * Mesuré le 24 novembre 2026 sous MNSTR31, un MQ-9 au-dessus de la mer, 6 km au sud d'Akrotiri
 * (34,532° N, 32,980° E) : 1 tuile sur 9 au zoom 14, 3 au 12, 3 au 11, les autres « sans imagerie »
 * (la mosaïque n'a rien en mer). Aucun zoom n'a la moitié du lieu : le cliché prend le plus fourni,
 * ses cases sans imagerie en gris. Avant, il n'en prenait aucun.
 */
import { createHash } from "node:crypto";
import { COTE_CLICHE, planCliche, SOURCES_CLICHE, ZOOMS_CLICHE } from "./cliche.ts";
import { tailleJpeg, type ClichePdf } from "./evidence-pdf.ts";

export type Cliche = Omit<ClichePdf, "legende"> & {
  z: number;
  /** SHA-256 des tuiles reçues, chacune précédée de sa place (« col,lig: »), dans l'ordre. */
  sha256: string;
  /** D'où viennent les tuiles (en-tête X-AfriControl-Tile, en clair), sans doublon. */
  sources: string[];
};

/** Une tuile de la couche visible de la carte, comme serveTile la rend. */
export type ServirTuile = (z: number, x: number, y: number) => Promise<Response>;

const servirCarte: ServirTuile = async (z, x, y) =>
  (await import("./tile-proxy.server.ts")).serveTile(z, x, y, "vis");

export async function composerCliche(
  lat: number,
  lon: number,
  servir: ServirTuile = servirCarte,
): Promise<Cliche | null> {
  let meilleur: Cliche | null = null;
  for (const z of ZOOMS_CLICHE) {
    const plan = planCliche(lat, lon, z);
    const recues = await Promise.all(
      plan.tuiles.map(async (t) => {
        // Injoignable ou en panne : une case sans imagerie, pas un cliché perdu.
        const r = await servir(z, t.x, t.y).catch(() => null);
        if (!r?.ok) return null;
        const jpeg = new Uint8Array(await r.arrayBuffer());
        if (!tailleJpeg(jpeg)) return null;
        return { col: t.col, lig: t.lig, jpeg, via: r.headers.get("X-AfriControl-Tile") ?? "?" };
      }),
    );
    const tuiles = recues.filter((t) => t != null);
    if (tuiles.length === 0) continue;
    const h = createHash("sha256");
    for (const t of tuiles) h.update(`${t.col},${t.lig}:`).update(t.jpeg);
    const cliche: Cliche = {
      cote: COTE_CLICHE,
      tuiles: tuiles.map(({ col, lig, jpeg }) => ({ col, lig, jpeg })),
      marque: { fx: plan.marque.px / plan.cotePx, fy: plan.marque.py / plan.cotePx },
      z,
      sha256: h.digest("hex"),
      sources: [
        ...new Set(
          tuiles.map((t) => {
            const via = t.via.replace(/^HIT:/, "");
            return SOURCES_CLICHE[via] ?? via;
          }),
        ),
      ],
    };
    // La moitié du lieu au moins : ce zoom suffit. Sinon le suivant, plus large, en dira peut-être
    // davantage ; en mer ou sur une côte, aucun n'y arrive, et le plus fourni est gardé.
    if (tuiles.length * 2 >= plan.tuiles.length) return cliche;
    if (!meilleur || tuiles.length > meilleur.tuiles.length) meilleur = cliche;
  }
  return meilleur;
}
