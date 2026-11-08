import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripIps } from "./privacy.ts";

describe("anonymat : aucune adresse en base, mais les heures restent", () => {
  it("IPv4 : effacée", () => {
    assert.equal(stripIps("relais 192.168.1.20 joint"), "relais [ip] joint");
  });

  it("IPv6 : complète ou compressée (::), avec ou sans crochets ni zone — effacée", () => {
    for (const [texte, attendu] of [
      ["depuis 2001:0db8:85a3:0000:0000:8a2e:0370:7334 :", "depuis [ip] :"],
      ["depuis 2001:db8:85a3::8a2e:370:7334", "depuis [ip]"],
      ["lien local fe80::1%eth0", "lien local [ip]%eth0"],
      ["boucle ::1 ouverte", "boucle [ip] ouverte"],
      ["préfixe fe80:: seul", "préfixe [ip] seul"],
      ["http://[2001:db8::7]:8080/", "http://[[ip]]:8080/"],
      ["mappée ::ffff:10.0.0.7", "mappée ::ffff:[ip]"],
    ]) {
      assert.equal(stripIps(texte), attendu, texte);
    }
  });

  it("MAC : effacée", () => {
    assert.equal(stripIps("carte aa:bb:cc:dd:ee:ff vue"), "carte [mac] vue");
    assert.equal(stripIps("carte AA-BB-CC-DD-EE-FF vue"), "carte [mac] vue");
  });

  it("HEURES : gardées — 18:10:22, l'heure exacte d'un relevé, une date du journal", () => {
    for (const texte of [
      "Prise de poste à 18:10:22",
      "du 08/11/2026 18:10:22 au 08/11/2026 18:12:05 (heure de N'Djamena)",
      "dernière action 2026-11-08 17:10:22.966+00",
      "METAR de 10:00 Z",
      "std::vector, Code::42, Note ::",
    ]) {
      assert.equal(stripIps(texte), texte);
    }
  });

  it("EN-TÊTES de proxy : nom effacé", () => {
    assert.equal(stripIps("vu dans X-Forwarded-For"), "vu dans x-hdr");
  });
});
