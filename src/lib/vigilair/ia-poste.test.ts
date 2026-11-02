import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { iaChat, iaChatVerifie, iaCheck, iaIndisponible } from "./ia-poste.server.ts";

const VARIABLES = ["AFRICONTROL_IA", "AFRICONTROL_IA_MODELE", "AFRICONTROL_IA_CLE"];

type Requete = { methode: string; chemin: string; auth: string | null; corps: string };

/** Faux serveur de modèle compatible OpenAI sur 127.0.0.1 : il note chaque requête reçue. */
async function serveurLocal(
  repondre: (r: Requete, res: ServerResponse) => void,
): Promise<{ base: string; recues: Requete[]; fermer: () => Promise<void> }> {
  const recues: Requete[] = [];
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      const r = {
        methode: req.method ?? "",
        chemin: req.url ?? "",
        auth: req.headers.authorization ?? null,
        corps,
      };
      recues.push(r);
      repondre(r, res);
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/v1`,
    recues,
    fermer: () => new Promise<void>((ok) => srv.close(() => ok())),
  };
}

function json(res: ServerResponse, statut: number, corps: unknown): void {
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(JSON.stringify(corps));
}

/** Répond comme Ollama : un modèle annoncé, une réponse de discussion. */
function commeOllama(r: Requete, res: ServerResponse): void {
  if (r.chemin === "/v1/models") return json(res, 200, { data: [{ id: "modele-local" }] });
  if (r.chemin === "/v1/chat/completions") {
    return json(res, 200, { choices: [{ message: { content: " réponse locale " } }] });
  }
  json(res, 404, {});
}

afterEach(() => {
  for (const v of VARIABLES) delete process.env[v];
});

describe("IA du poste : un serveur sur le réseau du poste, jamais un service public", () => {
  it("NON RÉGLÉE : indisponible, sans erreur affichée, et rien n'est tenté", async () => {
    assert.deepEqual(iaIndisponible(), {
      erreur: "IA du poste non réglée (AFRICONTROL_IA au lancement du serveur)",
      reglee: false,
    });
    assert.deepEqual(await iaCheck(), { configured: false, ok: false, error: null, modele: null });
    await assert.rejects(iaChat([{ role: "user", content: "x" }]), /non réglée/);
  });

  it("HORS DU POSTE : adresse refusée, et RIEN ne part sur le réseau", async () => {
    process.env.AFRICONTROL_IA = "https://api.deepseek.com/v1";
    const vrai = globalThis.fetch;
    let appels = 0;
    globalThis.fetch = (async () => {
      appels += 1;
      return new Response("{}");
    }) as typeof fetch;
    try {
      await assert.rejects(
        iaChat([{ role: "user", content: "Quelle posture autour de Komé ?" }]),
        /refusée/,
      );
      const etat = await iaCheck();
      assert.equal(etat.configured, true);
      assert.equal(etat.ok, false);
      assert.match(etat.error ?? "", /réseau du poste/);
      assert.equal(iaIndisponible()?.reglee, true);
    } finally {
      globalThis.fetch = vrai;
    }
    assert.equal(appels, 0, "aucune requête ne doit partir vers une adresse refusée");
  });

  it("SUR LE POSTE : la question va au serveur local, avec le premier modèle qu'il annonce", async () => {
    const s = await serveurLocal(commeOllama);
    try {
      process.env.AFRICONTROL_IA = `${s.base}/`;
      assert.equal(iaIndisponible(), null);
      const texte = await iaChat([{ role: "user", content: "Quelle posture autour de Komé ?" }], {
        maxTokens: 50,
      });
      assert.equal(texte, "réponse locale");
      assert.deepEqual(
        s.recues.map((r) => `${r.methode} ${r.chemin}`),
        ["GET /v1/models", "POST /v1/chat/completions"],
      );
      const corps = JSON.parse(s.recues[1]!.corps);
      assert.equal(corps.model, "modele-local");
      assert.equal(corps.max_tokens, 50);
      assert.equal(corps.messages[0].content, "Quelle posture autour de Komé ?");
      assert.equal(s.recues[1]!.auth, null);
    } finally {
      await s.fermer();
    }
  });

  it("MODÈLE ET JETON IMPOSÉS : pas de liste des modèles, jeton transmis au serveur local", async () => {
    const s = await serveurLocal(commeOllama);
    try {
      process.env.AFRICONTROL_IA = s.base;
      process.env.AFRICONTROL_IA_MODELE = "qwen2.5:7b";
      process.env.AFRICONTROL_IA_CLE = "jeton-local";
      const etat = await iaCheck();
      assert.deepEqual(etat, { configured: true, ok: true, error: null, modele: "qwen2.5:7b" });
      assert.ok(s.recues.every((r) => r.chemin === "/v1/chat/completions"));
      assert.equal(JSON.parse(s.recues[0]!.corps).model, "qwen2.5:7b");
      assert.equal(s.recues[0]!.auth, "Bearer jeton-local");
    } finally {
      await s.fermer();
    }
  });

  it("NOTICE JOINTE : elle part au modèle, mais ses exemples ne valent pas données", async () => {
    const s = await serveurLocal((r, res) =>
      r.chemin === "/v1/models"
        ? commeOllama(r, res)
        : json(res, 200, {
            choices: [{ message: { content: "TT-ABC suit AFR123, puis ZZZ999." } }],
          }),
    );
    try {
      process.env.AFRICONTROL_IA = s.base;
      const notice = "[Assistant IA du poste — Garde-fou]\nexemples : AFR123, TT-ABC";
      const texte = await iaChatVerifie(
        [
          { role: "system", content: "Assistant du poste." },
          {
            role: "user",
            content: `Image live : AFR123 3c6589 FL350\n\nNotice :\n${notice}\n\nQuestion : qui approche ?`,
          },
        ],
        {},
        notice,
      );
      assert.match(JSON.parse(s.recues[1]!.corps).messages[1].content, /exemples : AFR123, TT-ABC/);
      assert.match(texte, /⚠ Non retrouvé dans les données fournies à l'IA : ZZZ999\./);
      assert.match(texte, /ℹ Tiré de la notice du poste, pas des capteurs : TT-ABC\./);
      assert.doesNotMatch(
        texte,
        /: [^\n]*AFR123/,
        "AFR123 est dans l'image live : rien à signaler",
      );
    } finally {
      await s.fermer();
    }
  });

  it("SERVEUR LOCAL EN PANNE OU SANS MODÈLE : l'erreur le dit", async () => {
    const panne = await serveurLocal((r, res) =>
      r.chemin === "/v1/models" ? commeOllama(r, res) : json(res, 500, {}),
    );
    try {
      process.env.AFRICONTROL_IA = panne.base;
      await assert.rejects(iaChat([{ role: "user", content: "x" }]), /serveur d'IA 500/);
      const etat = await iaCheck();
      assert.equal(etat.ok, false);
      assert.match(etat.error ?? "", /500/);
    } finally {
      await panne.fermer();
    }
    const vide = await serveurLocal((_r, res) => json(res, 200, { data: [] }));
    try {
      process.env.AFRICONTROL_IA = vide.base;
      await assert.rejects(iaChat([{ role: "user", content: "x" }]), /aucun modèle/);
    } finally {
      await vide.fermer();
    }
  });
});
