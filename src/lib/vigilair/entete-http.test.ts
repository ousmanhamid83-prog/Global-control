import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enTeteSur } from "./entete-http.ts";

const CREDIT_S2 = "Sentinel-2 L2A · Copernicus · 10 m · composite moins nuageux ≤ 20 j";

describe("en-têtes HTTP : jamais un caractère qui fait lever la réponse", () => {
  it("LE DÉFAUT : le crédit Sentinel-2 brut fait lever la construction de la réponse", () => {
    assert.throws(
      () => new Response("", { headers: { "X-AfriControl-Sat": CREDIT_S2 } }),
      TypeError,
    );
  });

  it("CORRIGÉ : le même crédit passe, « ≤ » devenu « <= », le reste intact", () => {
    const sur = enTeteSur(CREDIT_S2);
    assert.equal(sur, "Sentinel-2 L2A · Copernicus · 10 m · composite moins nuageux <= 20 j");
    const r = new Response("", { headers: { "X-AfriControl-Sat": sur } });
    assert.equal(r.headers.get("X-AfriControl-Sat"), sur);
  });

  it("LATIN-1 GARDÉ : les accents français et le point médian ne bougent pas", () => {
    const t = "mosaïque embarquée (hors ligne) · déjà vue à côté";
    assert.equal(enTeteSur(t), t);
  });

  it("ÉQUIVALENTS ASCII pour la typographie courante, « ? » pour le reste", () => {
    assert.equal(enTeteSur("A — B → C … « D » ’E’"), "A - B -> C ... « D » 'E'");
    assert.equal(enTeteSur("cible ✈ 🛰"), "cible ? ?");
    assert.equal(enTeteSur("ligne\r\nsuivante\tfin"), "ligne??suivante\tfin");
  });

  it("QUELLE QUE SOIT LA CHAÎNE : la réponse se construit toujours", () => {
    let graine = 7;
    const hasard = () => (graine = (graine * 48271) % 2147483647);
    for (let i = 0; i < 300; i++) {
      const t = Array.from({ length: 24 }, () => String.fromCodePoint(hasard() % 0x3000)).join("");
      assert.doesNotThrow(() => new Response("", { headers: { x: enTeteSur(t) } }), t);
    }
  });
});
