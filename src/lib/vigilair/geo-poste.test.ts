import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { writeArrayBuffer } from "geotiff";
import { altitudes, routeOsrm } from "./geo-poste.server.ts";

const ROUTE = [
  { lat: 12.1331, lon: 15.0339 },
  { lat: 12.3, lon: 15.2 },
];

/** Faux serveur du poste (OSRM et opentopodata sur 127.0.0.1) : il note chaque adresse demandée. */
async function serveurLocal(
  repondre: (chemin: string, res: ServerResponse) => void,
): Promise<{ base: string; recues: string[]; fermer: () => Promise<void> }> {
  const recues: string[] = [];
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chemin = decodeURIComponent(req.url ?? "");
    recues.push(chemin);
    repondre(chemin, res);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    recues,
    fermer: () => new Promise<void>((ok) => srv.close(() => ok())),
  };
}

function json(res: ServerResponse, statut: number, corps: unknown): void {
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(JSON.stringify(corps));
}

/**
 * Petite tuile Copernicus synthétique (4 × 4 points, pas de 0,25°) pour le degré carré dont le
 * coin sud-ouest est (lat0, lon0) : les valeurs se lisent ligne par ligne depuis le nord-ouest.
 */
async function tuileTest(
  dossier: string,
  nom: string,
  lat0: number,
  lon0: number,
  valeurs: number[],
) {
  const buf = await writeArrayBuffer(new Float32Array(valeurs), {
    width: 4,
    height: 4,
    BitsPerSample: [32],
    SampleFormat: [3],
    ModelPixelScale: [0.25, 0.25, 0],
    ModelTiepoint: [0, 0, 0, lon0, lat0 + 1, 0],
    GeographicTypeGeoKey: 4326,
  });
  writeFileSync(join(dossier, nom), Buffer.from(buf));
}

const dossierVide = () => mkdtempSync(join(tmpdir(), "relief-"));

/** Compte les requêtes qui partiraient : aucune ne doit partir quand l'adresse est refusée. */
async function sansReseau<T>(f: () => Promise<T>): Promise<{ valeur: T; appels: number }> {
  const vrai = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = (async () => {
    appels += 1;
    return new Response("{}");
  }) as typeof fetch;
  try {
    return { valeur: await f(), appels };
  } finally {
    globalThis.fetch = vrai;
  }
}

afterEach(() => {
  delete process.env.AFRICONTROL_ITINERAIRE;
  delete process.env.AFRICONTROL_RELIEF;
  delete process.env.AFRICONTROL_RELIEF_TUILES;
});

describe("itinéraire et relief : serveurs du poste, jamais un service public", () => {
  it("SANS SERVEUR : cap direct, relief non mesuré, et rien ne part", async () => {
    const dossier = join(dossierVide(), "absent");
    process.env.AFRICONTROL_RELIEF_TUILES = dossier;
    const r = await sansReseau(() => routeOsrm(ROUTE));
    assert.deepEqual(r.valeur, {
      ok: false,
      raison: "pas de serveur d'itinéraire sur le poste (AFRICONTROL_ITINERAIRE) — cap direct",
    });
    const a = await sansReseau(() => altitudes(ROUTE));
    assert.deepEqual(a.valeur, {
      ok: false,
      raison: `aucun relief sur le poste (ni tuiles dans ${dossier}, ni AFRICONTROL_RELIEF)`,
    });
    assert.equal(r.appels + a.appels, 0);
  });

  it("SERVICES PUBLICS REFUSÉS : OSRM et opentopodata publics ne reçoivent rien", async () => {
    process.env.AFRICONTROL_ITINERAIRE = "https://router.project-osrm.org";
    process.env.AFRICONTROL_RELIEF = "https://api.opentopodata.org/v1/aster30m";
    const r = await sansReseau(() => routeOsrm(ROUTE));
    const a = await sansReseau(() => altitudes(ROUTE));
    assert.equal(r.valeur.ok, false);
    assert.equal(a.valeur.ok, false);
    assert.match(
      !r.valeur.ok ? r.valeur.raison : "",
      /AFRICONTROL_ITINERAIRE refusée.*rien n'a été envoyé — cap direct$/,
    );
    assert.match(
      !a.valeur.ok ? a.valeur.raison : "",
      /AFRICONTROL_RELIEF refusée.*rien n'a été envoyé$/,
    );
    assert.equal(
      r.appels + a.appels,
      0,
      "aucune coordonnée ne doit partir vers une adresse refusée",
    );
  });

  it("ITINÉRAIRE SUR LE POSTE : les points vont au serveur OSRM local, la route revient", async () => {
    const s = await serveurLocal((_c, res) =>
      json(res, 200, {
        code: "Ok",
        routes: [
          {
            distance: 26000,
            duration: 1500,
            geometry: {
              coordinates: [
                [15.0339, 12.1331],
                [15.2, 12.3],
              ],
            },
          },
        ],
      }),
    );
    try {
      process.env.AFRICONTROL_ITINERAIRE = `${s.base}/`;
      assert.deepEqual(await routeOsrm(ROUTE), {
        ok: true,
        distanceM: 26000,
        durationS: 1500,
        geometry: ROUTE,
      });
      assert.deepEqual(s.recues, [
        "/route/v1/driving/15.03390,12.13310;15.20000,12.30000?overview=simplified&geometries=geojson",
      ]);
    } finally {
      await s.fermer();
    }
  });

  it("RELIEF SUR LE POSTE : une altitude par point, un trou reste un trou, le jeu est nommé", async () => {
    const s = await serveurLocal((_c, res) =>
      json(res, 200, { status: "OK", results: [{ elevation: 298.5 }, { elevation: null }] }),
    );
    try {
      process.env.AFRICONTROL_RELIEF = `${s.base}/v1/srtm30m`;
      assert.deepEqual(await altitudes(ROUTE), { ok: true, elev: [298.5, null], jeu: "srtm30m" });
      assert.deepEqual(s.recues, ["/v1/srtm30m?locations=12.13310,15.03390|12.30000,15.20000"]);
    } finally {
      await s.fermer();
    }
  });

  it("SERVEUR DU POSTE EN PANNE OU INCOMPLET : l'erreur le dit, rien n'est inventé", async () => {
    const panne = await serveurLocal((_c, res) => json(res, 500, {}));
    try {
      process.env.AFRICONTROL_ITINERAIRE = panne.base;
      process.env.AFRICONTROL_RELIEF = `${panne.base}/v1/srtm30m`;
      assert.deepEqual(await routeOsrm(ROUTE), { ok: false, raison: "serveur d'itinéraire 500" });
      assert.deepEqual(await altitudes(ROUTE), { ok: false, raison: "serveur de relief 500" });
    } finally {
      await panne.fermer();
    }
    const court = await serveurLocal((_c, res) =>
      json(res, 200, { results: [{ elevation: 300 }] }),
    );
    try {
      process.env.AFRICONTROL_RELIEF = `${court.base}/v1/srtm30m`;
      assert.deepEqual(await altitudes(ROUTE), {
        ok: false,
        raison: "réponse du serveur de relief incomplète",
      });
    } finally {
      await court.fermer();
    }
  });
  it("TUILES DU POSTE : le relief est lu sur place, sans aucun serveur ni requête", async () => {
    const dossier = dossierVide();
    // Degré carré N12 E015 : la ligne nord (13,0°) puis vers le sud.
    await tuileTest(
      dossier,
      "Copernicus_DSM_COG_30_N12_00_E015_00_DEM.tif",
      12,
      15,
      [310, 311, 312, 313, 320, 321, 322, 323, 330, 331, 332, 333, 340, 341, 342, 343],
    );
    process.env.AFRICONTROL_RELIEF_TUILES = dossier;
    const a = await sansReseau(() =>
      altitudes([
        { lat: 12.9, lon: 15.1 }, // ligne 0, colonne 0
        { lat: 12.6, lon: 15.6 }, // ligne 1, colonne 2
        { lat: 12.1331, lon: 15.0339 }, // ligne 3, colonne 0 (N'Djamena)
      ]),
    );
    assert.deepEqual(a.valeur, {
      ok: true,
      elev: [310, 322, 340],
      jeu: "Copernicus GLO-90, tuiles locales",
    });
    assert.equal(a.appels, 0, "le relief embarqué ne doit rien envoyer");
  });

  it("GLO-30 D'ABORD : la tuile la plus fine présente est préférée", async () => {
    const dossier = dossierVide();
    await tuileTest(
      dossier,
      "Copernicus_DSM_COG_30_N12_00_E015_00_DEM.tif",
      12,
      15,
      Array(16).fill(100),
    );
    await tuileTest(
      dossier,
      "Copernicus_DSM_COG_10_N12_00_E015_00_DEM.tif",
      12,
      15,
      Array(16).fill(200),
    );
    process.env.AFRICONTROL_RELIEF_TUILES = dossier;
    assert.deepEqual(await altitudes([{ lat: 12.5, lon: 15.5 }]), {
      ok: true,
      elev: [200],
      jeu: "Copernicus GLO-30, tuiles locales",
    });
  });

  it("TROUS : point sans donnée ou hors des tuiles → null, jamais une altitude inventée", async () => {
    const dossier = dossierVide();
    await tuileTest(
      dossier,
      "Copernicus_DSM_COG_30_S01_00_W001_00_DEM.tif",
      -1,
      -1,
      [-32767, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    );
    process.env.AFRICONTROL_RELIEF_TUILES = dossier;
    assert.deepEqual(
      await altitudes([
        { lat: -0.1, lon: -0.9 }, // coin nord-ouest de S01 W001 : absence de donnée
        { lat: -0.6, lon: -0.6 }, // donnée présente
        { lat: 3.5, lon: 3.5 }, // aucune tuile pour ce degré carré
      ]),
      { ok: true, elev: [null, 5, null], jeu: "Copernicus GLO-90, tuiles locales" },
    );
    assert.deepEqual(await altitudes([{ lat: 3.5, lon: 3.5 }]), {
      ok: false,
      raison: `aucune tuile de relief ne couvre ces points (${dossier})`,
    });
  });

  it("SERVEUR DE RELIEF PRIORITAIRE : s'il est réglé, il passe avant les tuiles", async () => {
    const dossier = dossierVide();
    await tuileTest(
      dossier,
      "Copernicus_DSM_COG_30_N12_00_E015_00_DEM.tif",
      12,
      15,
      Array(16).fill(1),
    );
    const s = await serveurLocal((_c, res) => json(res, 200, { results: [{ elevation: 299 }] }));
    try {
      process.env.AFRICONTROL_RELIEF_TUILES = dossier;
      process.env.AFRICONTROL_RELIEF = `${s.base}/v1/srtm30m`;
      assert.deepEqual(await altitudes([{ lat: 12.5, lon: 15.5 }]), {
        ok: true,
        elev: [299],
        jeu: "srtm30m",
      });
      assert.equal(s.recues.length, 1);
    } finally {
      await s.fermer();
    }
  });
});
