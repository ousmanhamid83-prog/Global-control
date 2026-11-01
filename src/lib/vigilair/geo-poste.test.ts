import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
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
});

describe("itinéraire et relief : serveurs du poste, jamais un service public", () => {
  it("SANS SERVEUR : cap direct, relief non mesuré, et rien ne part", async () => {
    const r = await sansReseau(() => routeOsrm(ROUTE));
    assert.deepEqual(r.valeur, {
      ok: false,
      raison: "pas de serveur d'itinéraire sur le poste (AFRICONTROL_ITINERAIRE) — cap direct",
    });
    const a = await sansReseau(() => altitudes(ROUTE));
    assert.deepEqual(a.valeur, {
      ok: false,
      raison: "pas de serveur de relief sur le poste (AFRICONTROL_RELIEF)",
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
});
