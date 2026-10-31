import assert from "node:assert/strict";
import { describe, it } from "node:test";
import securityHeadersMiddleware from "../../server/middleware/security-headers.ts";

const evenement = { url: new URL("http://poste.local/"), req: { method: "GET" } };

describe("en-têtes de sécurité du poste", () => {
  it("CADRE : la console ne s'affiche que dans ses propres pages", async () => {
    const r = (await securityHeadersMiddleware(evenement, () => new Response("ok"))) as Response;
    assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'");
    assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  });

  it("RIEN D'AUTRE NE CHANGE : statut, corps et en-têtes de la réponse sont gardés", async () => {
    const r = (await securityHeadersMiddleware(
      evenement,
      () => new Response("corps", { status: 201, headers: { "x-maison": "1" } }),
    )) as Response;
    assert.equal(r.status, 201);
    assert.equal(await r.text(), "corps");
    assert.equal(r.headers.get("x-maison"), "1");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  });

  it("RÈGLE EXISTANTE RESPECTÉE : une réponse qui fixe déjà sa politique la garde", async () => {
    const r = (await securityHeadersMiddleware(
      evenement,
      () => new Response("", { headers: { "content-security-policy": "frame-ancestors 'none'" } }),
    )) as Response;
    assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'none'");
  });

  it("PAS UNE RÉPONSE : le résultat passe tel quel", async () => {
    assert.equal(await securityHeadersMiddleware(evenement, () => undefined), undefined);
  });
});
