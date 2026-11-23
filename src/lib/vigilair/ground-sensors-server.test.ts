import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  addSensorServer,
  listSensorsServer,
  nouvelleCleServer,
  recevoirMessage,
  removeSensorServer,
} from "./ground-sensors.server.ts";

const g = globalThis as Record<string, unknown>;
let dossier = "";
const cwd = process.cwd();
const ICI = "192.168.1.20";

before(() => {
  dossier = mkdtempSync(path.join(tmpdir(), "capteurs-sol-"));
  process.chdir(dossier);
});
after(() => {
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => {
  // Un serveur qui redémarre : le registre est relu du disque.
  for (const k of Object.keys(g)) if (k.startsWith("__afriSensors")) delete g[k];
  rmSync(path.join(dossier, "data"), { recursive: true, force: true });
});

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("capteurs sol, serveur : la clé, le réseau du poste, le débit, le disque", () => {
  it("inscrit : une clé de 32 caractères, seule son empreinte gardée sur le disque", async () => {
    const r = await addSensorServer({
      site: "Camp Nord",
      type: "barriere",
      name: "Barrière est",
      silenceS: 30,
    });
    assert.equal(r.ok, true);
    assert.match(r.cle!, /^[A-Za-z0-9_-]{32}$/);
    const texte = readFileSync(path.join(dossier, "data", "sensors.json"), "utf8");
    assert.equal(texte.includes(r.cle!), false, "la clé n'est pas sur le disque");
    assert.equal(JSON.parse(texte)[0].empreinteCle, sha(r.cle!));
    const { capteurs } = await listSensorsServer(Date.now());
    assert.equal(capteurs[0]!.etat.code, "jamais");
    assert.equal(capteurs[0]!.silenceS, 30);
    assert.equal(
      JSON.stringify(capteurs).includes(sha(r.cle!)),
      false,
      "ni l'empreinte à la console",
    );
    assert.deepEqual(await addSensorServer({ site: " ", name: "x" }), {
      ok: false,
      error: "site requis",
    });
    assert.deepEqual(await addSensorServer({ site: "x", name: "" }), {
      ok: false,
      error: "nom requis",
    });
  });

  it("refusé hors du réseau du poste, sans clé, avec une autre clé, pour un id inconnu, trop vite", async () => {
    const { cle, sensor } = await addSensorServer({ site: "Camp", type: "camera", name: "Cam 1" });
    const id = sensor!.id;
    const t = Date.now();
    assert.deepEqual(await recevoirMessage({ id, etat: "alarme" }, cle!, "8.8.8.8", t), {
      statut: 403,
      corps: { erreur: "hors du réseau du poste" },
    });
    assert.deepEqual(await recevoirMessage({ id, etat: "alarme" }, cle!, "", t), {
      statut: 403,
      corps: { erreur: "hors du réseau du poste" },
    });
    assert.equal((await recevoirMessage({ id, etat: "on" }, cle!, ICI, t)).statut, 400);
    const refus = { statut: 401, corps: { erreur: "clé refusée" } };
    assert.deepEqual(await recevoirMessage({ id, etat: "alarme" }, "", ICI, t), refus);
    assert.deepEqual(await recevoirMessage({ id, etat: "alarme" }, `${cle}x`, ICI, t), refus);
    assert.deepEqual(
      await recevoirMessage({ id: "sensor-inconnu", etat: "alarme" }, cle!, ICI, t),
      refus,
    );
    assert.deepEqual(await recevoirMessage({ id, etat: "alarme" }, "x".repeat(201), ICI, t), refus);
    assert.equal((await listSensorsServer(t)).capteurs[0]!.etat.code, "jamais", "rien n'a compté");
    assert.deepEqual(await recevoirMessage({ id, etat: "ok" }, cle!, ICI, t), {
      statut: 200,
      corps: { ok: true },
    });
    assert.deepEqual(await recevoirMessage({ id, etat: "ok" }, cle!, "127.0.0.1", t + 99), {
      statut: 429,
      corps: { erreur: "trop de messages" },
    });
    assert.equal((await recevoirMessage({ id, etat: "ok" }, cle!, "::1", t + 100)).statut, 200);
  });

  it("l'état dit par le capteur, à l'heure du serveur ; muet après son délai ; écrit sur le disque", async () => {
    const { cle, sensor } = await addSensorServer({
      site: "Camp",
      type: "radar",
      name: "Radar sud",
      silenceS: 10,
    });
    const id = sensor!.id;
    const t = Date.now();
    await recevoirMessage({ id, etat: "alarme", detail: "piste 3" }, cle!, ICI, t);
    let v = (await listSensorsServer(t + 500)).capteurs[0]!;
    assert.deepEqual(v.etat, { code: "alarme", depuis: t });
    assert.equal(v.detail, "piste 3");
    assert.equal(v.derniereAlarme, t);
    assert.equal(v.avis?.id, `sol-${id}-alarme-${t}`);
    v = (await listSensorsServer(t + 10_001)).capteurs[0]!;
    assert.deepEqual(v.etat, { code: "muet", depuis: t });
    // Un changement d'état part sur le disque dans la seconde.
    await attendre(1300);
    const disque = JSON.parse(readFileSync(path.join(dossier, "data", "sensors.json"), "utf8"));
    assert.equal(disque[0].recu.etat, "alarme");
    assert.equal(disque[0].derniereAlarme, t);
    // Redémarrage : relu du disque, l'alarme est toujours là.
    for (const k of Object.keys(g)) if (k.startsWith("__afriSensors")) delete g[k];
    assert.equal((await listSensorsServer(t + 600)).capteurs[0]!.etat.code, "alarme");
  });

  it("clé changée : l'ancienne ne vaut plus ; capteur retiré : plus rien n'entre", async () => {
    const { cle, sensor } = await addSensorServer({ site: "Camp", name: "Porte" });
    const id = sensor!.id;
    const t = Date.now();
    const neuve = await nouvelleCleServer(id);
    assert.equal(neuve.ok, true);
    assert.notEqual(neuve.cle, cle);
    assert.equal((await recevoirMessage({ id, etat: "ok" }, cle!, ICI, t)).statut, 401);
    assert.equal((await recevoirMessage({ id, etat: "ok" }, neuve.cle!, ICI, t)).statut, 200);
    assert.deepEqual(await nouvelleCleServer("sensor-inconnu"), {
      ok: false,
      error: "capteur inconnu",
    });
    assert.equal((await removeSensorServer(id))?.id, id);
    assert.equal(await removeSensorServer(id), null);
    assert.equal(
      (await recevoirMessage({ id, etat: "ok" }, neuve.cle!, ICI, t + 1000)).statut,
      401,
    );
    assert.deepEqual((await listSensorsServer()).capteurs, []);
  });
});
