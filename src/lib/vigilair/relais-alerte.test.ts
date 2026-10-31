import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { corpsWebhook, hoteSurPlace, texteTelegram } from "./relais-alerte.ts";

const ALERTE = {
  id: "trk-ami-1793446-AFR123",
  title: "Agent éjecté · Moussa K.",
  body: "Récap : 12 ident · dernier verrou AFR123 près de Komé · zone Sud-Est",
  level: "critique",
};
const AT = new Date("2026-10-31T11:59:01.774Z");
/** Aucun mot du titre, du détail ni de l'identifiant ne doit apparaître. */
const MOTS_SENSIBLES = ["Moussa", "AFR123", "Komé", "Sud-Est", "éjecté", "Récap", "trk-ami"];

describe("relais d'alerte : ce qui sort du poste", () => {
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

  it("TELEGRAM : niveau et heure seulement, jamais le contenu", () => {
    const texte = texteTelegram(ALERTE, AT);
    assert.equal(
      texte,
      "AfriControl · CRITIQUE\nAlerte au poste à 11:59 Z — détail dans la console.",
    );
    for (const mot of MOTS_SENSIBLES) assert.ok(!texte.includes(mot), mot);
  });

  it("WEBHOOK HORS DU POSTE : la même alerte sans contenu, sans identifiant", () => {
    const corps = corpsWebhook(ALERTE, "https://hooks.exemple-externe.test/afri", AT);
    assert.deepEqual(corps, {
      source: "AfriControl",
      level: "critique",
      at: "2026-10-31T11:59:01.774Z",
      message: "Alerte au poste — détail dans la console.",
    });
    const json = JSON.stringify(corps);
    for (const mot of MOTS_SENSIBLES) assert.ok(!json.includes(mot), mot);
  });

  it("WEBHOOK SUR PLACE : le détail complet, comme avant", () => {
    assert.deepEqual(corpsWebhook(ALERTE, "http://10.9.9.9:8080/hook", AT), {
      source: "AfriControl",
      level: "critique",
      at: "2026-10-31T11:59:01.774Z",
      id: ALERTE.id,
      title: ALERTE.title,
      body: ALERTE.body,
    });
  });
});
