import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import type { LiveAc, LivePicture } from "./live-adsb.ts";
import {
  RECHERCHE_TROUVAILLES,
  chercherEnLigne,
  lignesRecherche,
  rechercheIndisponible,
} from "./recherche-poste.server.ts";

// Faux moteur SearXNG du poste : répond comme /search?format=json, ou comme on le lui dit.
let mode: "json" | "403" | "500" = "json";
const recues: string[] = [];
let srv: Server;
let base = "";

before(async () => {
  srv = createServer((req, res) => {
    recues.push(req.url ?? "");
    if (mode === "403") return res.writeHead(403).end("Forbidden");
    if (mode === "500") return res.writeHead(500).end();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        query: "drone",
        results: [
          // Une entrée sans titre exploitable, en tête : elle ne doit pas compter.
          { title: 42, url: "https://bizarre.example" },
          ...Array.from({ length: 7 }, (_, i) => ({
            title: `Titre   ${i}`,
            url: `https://exemple.org/${i}`,
            content: `Extrait\n numéro ${i}`,
            engine: "duckduckgo",
          })),
        ],
      }),
    );
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(() => srv.close());
beforeEach(() => {
  mode = "json";
  recues.length = 0;
  process.env.AFRICONTROL_RECHERCHE = base;
});

const PIC = {
  aircraft: [{ hex: "06a1f0", flight: "AFR123", reg: null }] as unknown as LiveAc[],
} as LivePicture;

function journal() {
  const ecrit: string[] = [];
  return {
    ecrit,
    f: async (titre: string, detail: string, options?: { severite?: string }) =>
      void ecrit.push(`${options?.severite ? `[${options.severite}] ` : ""}${titre} · ${detail}`),
  };
}

describe("recherche en ligne : par le moteur SearXNG du poste, filtrée, journalisée", () => {
  it("TROUVAILLES : requête JSON au moteur du poste, cinq gardées, texte resserré", async () => {
    const j = journal();
    const r = await chercherEnLigne("portée drone Mavic 3", PIC, j.f);
    assert.ok(r.ok);
    assert.equal(r.trouvailles.length, RECHERCHE_TROUVAILLES);
    assert.deepEqual(r.trouvailles[0], {
      titre: "Titre 0",
      url: "https://exemple.org/0",
      extrait: "Extrait numéro 0",
    });
    const u = new URL(recues[0]!, base);
    assert.equal(u.pathname, "/search");
    assert.equal(u.searchParams.get("q"), "portée drone Mavic 3");
    assert.equal(u.searchParams.get("format"), "json");
    assert.deepEqual(j.ecrit, ["Recherche en ligne · « portée drone Mavic 3 » · 5 trouvaille(s)"]);
  });

  it("FILTRE : une requête qui nomme un contact ne part pas, et le refus va au journal", async () => {
    const j = journal();
    const r = await chercherEnLigne("qui opère AFR123", PIC, j.f);
    assert.deepEqual(r, {
      ok: false,
      erreur: "Requête refusée : elle nomme AFR123, contact du relevé. Rien n'est sorti du poste.",
      forcable: true,
    });
    assert.equal(recues.length, 0, "rien n'est parti");
    assert.match(j.ecrit[0]!, /^Recherche en ligne refusée · Requête refusée : elle nomme AFR123/);
  });

  it("FORCÉE SUR ORDRE DU CHEF : elle sort, et le journal dit en critique ce qui est sorti et pourquoi", async () => {
    const j = journal();
    const r = await chercherEnLigne("qui opère AFR123", PIC, j.f, true);
    assert.equal(r.ok, true);
    assert.equal(recues.length, 1, "la requête est partie au moteur");
    assert.match(decodeURIComponent(recues[0]!), /q=qui\+op[èe]re\+AFR123|q=qui opère AFR123/);
    assert.deepEqual(j.ecrit, [
      "[crit] Recherche en ligne FORCÉE sur ordre du chef · « qui opère AFR123 » est sortie du poste malgré le filtre (elle nomme AFR123, contact du relevé) · 5 trouvaille(s)",
    ]);
    // Une requête ordinaire forcée n'a rien à contourner : journal ordinaire.
    const k = journal();
    await chercherEnLigne("portée d'un drone", PIC, k.f, true);
    assert.deepEqual(k.ecrit, ["Recherche en ligne · « portée d'un drone » · 5 trouvaille(s)"]);
  });

  it("FORCÉE, MAIS VIDE OU TROP LONGUE : refusée quand même, sans bouton à proposer", async () => {
    const j = journal();
    const r = await chercherEnLigne("x".repeat(500), PIC, j.f, true);
    assert.equal(r.ok, false);
    assert.equal("forcable" in r, false);
    assert.equal(recues.length, 0);
  });

  it("MOTEUR NON RÉGLÉ OU HORS DU POSTE : rien ne part, rien au journal", async () => {
    const j = journal();
    delete process.env.AFRICONTROL_RECHERCHE;
    assert.match(rechercheIndisponible()!, /non réglée : AFRICONTROL_RECHERCHE/);
    assert.deepEqual(await chercherEnLigne("drone", PIC, j.f), {
      ok: false,
      erreur: "Recherche en ligne non réglée : AFRICONTROL_RECHERCHE (moteur SearXNG du poste).",
    });
    process.env.AFRICONTROL_RECHERCHE = "https://searx.example.org";
    const r = await chercherEnLigne("drone", PIC, j.f);
    assert.ok(!r.ok && /doit être sur le réseau du poste/.test(r.erreur));
    assert.deepEqual(j.ecrit, []);
    assert.equal(recues.length, 0);
  });

  it("JSON NON ACTIVÉ (403) : le dit, avec le réglage à faire", async () => {
    mode = "403";
    const r = await chercherEnLigne("drone", PIC, journal().f);
    assert.ok(!r.ok && /ajouter « json » à search\.formats/.test(r.erreur));
  });

  it("MOTEUR EN ERREUR : le code HTTP est dit", async () => {
    mode = "500";
    assert.deepEqual(await chercherEnLigne("drone", PIC, journal().f), {
      ok: false,
      erreur: "Moteur du poste : HTTP 500.",
    });
  });

  it("MOTEUR INJOIGNABLE : le dit, sans planter", async () => {
    const ferme = createServer();
    await new Promise<void>((ok) => ferme.listen(0, "127.0.0.1", ok));
    const port = (ferme.address() as AddressInfo).port;
    await new Promise<void>((ok) => ferme.close(() => ok()));
    process.env.AFRICONTROL_RECHERCHE = `http://127.0.0.1:${port}`;
    const r = await chercherEnLigne("drone", PIC, journal().f);
    assert.ok(!r.ok && /^Moteur du poste injoignable \(/.test(r.erreur), JSON.stringify(r));
  });

  it("LIGNES : la requête envoyée, puis chaque trouvaille marquée « Internet, pas des capteurs »", async () => {
    const r = await chercherEnLigne("drone", PIC, journal().f);
    const l = lignesRecherche(r);
    assert.equal(l[0], "Requête envoyée au moteur du poste : « drone »");
    assert.equal(l[1], "5 trouvaille(s) — Internet, non vérifié, pas des données capteurs :");
    assert.deepEqual(l.slice(2, 5), [
      "1. Titre 0",
      "   https://exemple.org/0",
      "   Extrait numéro 0",
    ]);
    assert.deepEqual(lignesRecherche({ ok: true, requete: "x", trouvailles: [] }), [
      "Requête envoyée au moteur du poste : « x »",
      "Aucune trouvaille.",
    ]);
    assert.deepEqual(lignesRecherche({ ok: false, erreur: "Moteur du poste : HTTP 500." }), [
      "Moteur du poste : HTTP 500.",
    ]);
  });
});
