import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { corpsWebhook, envoiWebhook, estRelaisSignal, texteTelegram } from "./relais-alerte.ts";

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

describe("relais Signal du poste (signal-cli-rest-api)", () => {
  it("RECONNU : l'adresse finit par /v2/send, et rien d'autre", () => {
    assert.ok(estRelaisSignal("http://127.0.0.1:8085/v2/send?number=+235"));
    assert.ok(estRelaisSignal("http://127.0.0.1:8085/v2/send/"));
    assert.ok(!estRelaisSignal("http://127.0.0.1:8085/v2/sendx"));
    assert.ok(!estRelaisSignal("http://10.9.9.9:8080/hook"));
    assert.ok(!estRelaisSignal("pas une adresse"));
  });

  it("SUR PLACE : le détail, les numéros intacts, l'adresse sans ses paramètres", () => {
    const envoi = envoiWebhook(
      ALERTE,
      "http://127.0.0.1:8085/v2/send?number=+23566000001&recipients=+23566000002, %2B23566000003,",
      AT,
    );
    assert.deepEqual(envoi, {
      url: "http://127.0.0.1:8085/v2/send",
      corps: {
        message: `AfriControl · CRITIQUE\n${ALERTE.title}\n${ALERTE.body}`,
        number: "+23566000001",
        recipients: ["+23566000002", "+23566000003"],
      },
    });
  });

  it("HORS DU POSTE : niveau et heure seulement, comme Telegram", () => {
    const envoi = envoiWebhook(
      ALERTE,
      "https://signal.exemple-externe.test/v2/send?number=+23566000001&recipients=+23566000002",
      AT,
    );
    assert.equal(envoi.url, "https://signal.exemple-externe.test/v2/send");
    assert.equal(envoi.corps.message, texteTelegram(ALERTE, AT));
    const json = JSON.stringify(envoi.corps);
    for (const mot of MOTS_SENSIBLES) assert.ok(!json.includes(mot), mot);
  });

  it("WEBHOOK GÉNÉRIQUE : adresse et corps inchangés", () => {
    for (const adresse of ["http://10.9.9.9:8080/hook?jeton=a+b", "https://hooks.exemple.test/x"]) {
      assert.deepEqual(envoiWebhook(ALERTE, adresse, AT), {
        url: adresse,
        corps: corpsWebhook(ALERTE, adresse, AT),
      });
    }
  });
});
