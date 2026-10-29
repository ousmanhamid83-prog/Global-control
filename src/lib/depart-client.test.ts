import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_PARTI, departSansErreur } from "./depart-client.ts";

/** L'erreur que Node donne à une requête dont le client a coupé la connexion. */
const coupure = () => Object.assign(new Error("aborted"), { code: "ECONNRESET" });

/** Un corps qui arrive en partie, puis casse quand le client part (ou sur `casse`). */
function corpsCoupe(client: AbortSignal, debut: string) {
  let casser: (e: Error) => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(debut));
      casser = (e) => c.error(e);
      client.addEventListener("abort", () => c.error(client.reason));
    },
  });
  return { body, casse: (e: Error) => casser(e) };
}

function requete(client: AbortController, init: RequestInit = {}) {
  return departSansErreur(
    new Request("http://poste/_serverFn/x", { ...init, signal: client.signal }),
  );
}

test("DÉPART : le client part → la raison d'abandon est une réponse 499, plus l'erreur réseau", () => {
  const client = new AbortController();
  const req = requete(client);
  assert.equal(req.signal.aborted, false);
  client.abort(coupure());
  assert.equal(req.signal.aborted, true);
  const raison = req.signal.reason as Response;
  assert.ok(
    raison instanceof Response,
    "une réponse levée est une issue normale pour le framework",
  );
  assert.equal(raison.status, CLIENT_PARTI);
  assert.equal(raison.statusText, "Client Closed Request");
  // Le travail s'arrête toujours aussitôt : c'est ce que lève le framework à chaque étape.
  assert.throws(
    () => req.signal.throwIfAborted(),
    (e: unknown) => e === raison,
  );
});

test("DÉJÀ PARTI : une requête abandonnée avant d'être traitée est arrêtée d'emblée", () => {
  const client = new AbortController();
  client.abort(coupure());
  const req = requete(client);
  assert.equal(req.signal.aborted, true);
  assert.equal((req.signal.reason as Response).status, CLIENT_PARTI);
});

test("CLIENT PRÉSENT : rien ne change — signal calme, corps lu tel quel", async () => {
  const client = new AbortController();
  const req = requete(client, { method: "POST", body: JSON.stringify({ zone: "FTTJ", n: 3 }) });
  assert.deepEqual(await req.json(), { zone: "FTTJ", n: 3 });
  assert.equal(req.signal.aborted, false);
});

test("CORPS COUPÉ : chaque lecture du corps interrompue par le départ rend la même réponse 499", async () => {
  const lectures = ["arrayBuffer", "blob", "bytes", "formData", "json", "text"] as const;
  for (const lecture of lectures) {
    const client = new AbortController();
    const { body } = corpsCoupe(client.signal, "zone=FTT");
    const req = requete(client, {
      method: "POST",
      body,
      duplex: "half",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    } as RequestInit);
    const lu = (req[lecture] as () => Promise<unknown>)();
    client.abort(coupure());
    await assert.rejects(lu, (e: unknown) => e === req.signal.reason, lecture);
  }
});

test("VRAIE ERREUR : une erreur qui n'est pas un départ passe inchangée", async () => {
  const client = new AbortController();
  const illisible = requete(client, { method: "POST", body: "{pas du json" });
  await assert.rejects(illisible.json(), SyntaxError);

  const coupe = new AbortController();
  const { body, casse } = corpsCoupe(coupe.signal, '{"zone":');
  const req = requete(coupe, { method: "POST", body, duplex: "half" } as RequestInit);
  const lu = req.text();
  const panne = new Error("corps trop gros");
  casse(panne);
  await assert.rejects(lu, (e: unknown) => e === panne);
  assert.equal(req.signal.aborted, false);
});

test("MOTEUR PLUS ANCIEN : une lecture absente (bytes) n'empêche pas de servir la requête", async () => {
  const client = new AbortController();
  const brute = new Request("http://poste/_serverFn/x", {
    method: "POST",
    body: '{"n":1}',
    signal: client.signal,
  });
  Object.defineProperty(brute, "bytes", { value: undefined });
  const req = departSansErreur(brute);
  assert.equal(req.bytes, undefined);
  assert.deepEqual(await req.json(), { n: 1 });
});
