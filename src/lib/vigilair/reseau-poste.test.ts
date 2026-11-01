import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hoteSurPlace, serveurPoste } from "./reseau-poste.ts";

describe("réseau du poste : la seule destination où une donnée peut partir", () => {
  it("SUR PLACE : bouclage, privé, lien local, IPv6 locale, noms réservés au réseau local", () => {
    for (const url of [
      "http://127.0.0.1:8080/hook",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.10/",
      "http://169.254.10.1/",
      "http://[::1]:9000/",
      "http://[fd12:3456::5]/",
      "http://[fe80::1]/",
      "http://[::ffff:10.0.0.5]/",
      "http://0x0a000005/",
      "http://localhost:9000/",
      "http://relais.localhost/",
      "https://relais.local/hook",
      "https://relais.local./hook",
      "https://relais.home.arpa/",
      "https://signal.internal/",
    ]) {
      assert.equal(hoteSurPlace(url), true, url);
    }
  });

  it("HORS DU POSTE : public, faux-semblants, espace partagé 100.64/10, nom sans point, adresse illisible", () => {
    for (const url of [
      "https://hooks.exemple-externe.test/afri",
      "https://api.deepseek.com/v1",
      "http://172.15.0.1/",
      "http://172.32.0.1/",
      "http://192.169.1.1/",
      "http://8.8.8.8/",
      "http://100.64.0.1/",
      "http://[2001:db8::1]/",
      "http://[::ffff:8.8.8.8]/",
      "http://relais:8080/",
      "https://relais.local.example.com/",
      "https://evil.com/relais.local",
      "https://10.0.0.1@evil.com/",
      "http://10.0.0.1.evil.com/",
      "pas une adresse",
      "",
    ]) {
      assert.equal(hoteSurPlace(url), false, url);
    }
  });

  it("SERVEUR DU POSTE : absent, refusé hors du poste, ou prêt sans barre finale", () => {
    assert.deepEqual(serveurPoste(undefined), { refus: "absente" });
    assert.deepEqual(serveurPoste(""), { refus: "absente" });
    assert.deepEqual(serveurPoste("https://router.project-osrm.org"), { refus: "hors-poste" });
    assert.deepEqual(serveurPoste("http://10.0.0.7:5000//"), { base: "http://10.0.0.7:5000" });
    assert.deepEqual(serveurPoste("http://relief.local:5100/v1/srtm30m"), {
      base: "http://relief.local:5100/v1/srtm30m",
    });
  });
});
