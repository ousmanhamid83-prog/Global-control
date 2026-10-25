import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveUrl, extractFirstJpeg, matchOwnDrone, normIdent, sourceArmRule, sourceZones, type OwnDrone } from "./drones-core.ts";

const drone = (ident: string, name = "Aile-01"): OwnDrone => ({
  id: `drone:${name}`,
  name,
  ident,
  site: "Camp Nord",
  at: 0,
});

test("normIdent met en majuscules et retire les séparateurs", () => {
  assert.equal(normIdent("3c6d-d2"), "3C6DD2");
  assert.equal(normIdent(" fatl 07 "), "FATL07");
  assert.equal(normIdent(""), "");
});

test("matchOwnDrone apparie par hex ICAO (tolérant à la casse et aux séparateurs)", () => {
  const list = [drone("3C6DD2")];
  assert.equal(matchOwnDrone(list, "3c6dd2", "AILE07")?.name, "Aile-01");
  assert.equal(matchOwnDrone(list, "3C6D-D2", null)?.name, "Aile-01");
});

test("matchOwnDrone apparie par indicatif quand le hex ne correspond pas", () => {
  const list = [drone("AILE07", "Aile-07")];
  assert.equal(matchOwnDrone(list, "ABCDEF", "aile 07")?.name, "Aile-07");
});

test("matchOwnDrone renvoie null sans correspondance", () => {
  const list = [drone("3C6DD2")];
  assert.equal(matchOwnDrone(list, "ABCDEF", "UNKNOWN"), null);
  assert.equal(matchOwnDrone([], "3C6DD2", "AILE07"), null);
});

test("matchOwnDrone ignore une entrée à identifiant vide", () => {
  const list = [drone("", "Sans-id"), drone("3C6DD2", "Bon")];
  assert.equal(matchOwnDrone(list, "", "")?.name ?? null, null);
  assert.equal(matchOwnDrone(list, "3C6DD2", "")?.name, "Bon");
});

test("extractFirstJpeg récupère la première image d'un flux multipart", () => {
  // en-tête multipart bidon + une « image » FFD8..FFD9 + reste du flux
  const header = new TextEncoder().encode("--boundary\r\nContent-Type: image/jpeg\r\n\r\n");
  const jpeg = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);
  const tail = new TextEncoder().encode("\r\n--boundary\r\n");
  const buf = new Uint8Array(header.length + jpeg.length + tail.length);
  buf.set(header, 0);
  buf.set(jpeg, header.length);
  buf.set(tail, header.length + jpeg.length);
  const out = extractFirstJpeg(buf);
  assert.ok(out);
  assert.deepEqual(Array.from(out!), Array.from(jpeg));
});

test("extractFirstJpeg : null si l'image n'est pas complète", () => {
  assert.equal(extractFirstJpeg(Uint8Array.from([0xff, 0xd8, 0x01, 0x02])), null); // pas de FFD9
  assert.equal(extractFirstJpeg(Uint8Array.from([0x00, 0x01, 0x02])), null); // pas de FFD8
});

test("effectiveUrl : flux direct prioritaire, sinon reconstruit depuis hôte/port/chemin", () => {
  assert.equal(effectiveUrl({ snapshotUrl: "http://cam/stream" }), "http://cam/stream");
  assert.equal(effectiveUrl({ host: "10.0.0.9", port: 8080, path: "snapshot.jpg" }), "http://10.0.0.9:8080/snapshot.jpg");
  assert.equal(effectiveUrl({ host: "cam.local", port: 554 }), "http://cam.local:554");
  assert.equal(effectiveUrl({ host: "https://cam.site", path: "/live" }), "https://cam.site/live");
  assert.equal(effectiveUrl({}), undefined);
  // le flux direct l'emporte sur hôte/port
  assert.equal(effectiveUrl({ snapshotUrl: "http://x/a", host: "y", port: 1 }), "http://x/a");
});

const poly = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i / n, y: i / n }));

test("sourceZones : zones prioritaires, sinon roi, sinon aucune", () => {
  assert.equal(sourceZones({}).length, 0); // toute l'image surveillée
  // roi héritée (une zone) si pas de zones
  assert.deepEqual(sourceZones({ roi: poly(3) }), [poly(3)]);
  // zones (plusieurs) l'emportent sur roi
  const z = [poly(3), poly(4)];
  assert.deepEqual(sourceZones({ zones: z, roi: poly(3) }), z);
  // polygones trop petits filtrés
  assert.deepEqual(sourceZones({ zones: [poly(2)] }), []);
  assert.equal(sourceZones({ roi: poly(2) }).length, 0); // roi < 3 ignorée
});

test("sourceArmRule : règle propre si définie, sinon repli global", () => {
  const global = { nightOnly: true, from: 19, to: 6 };
  // pas de règle propre → hérite du global
  assert.deepEqual(sourceArmRule({}, global), global);
  // règle propre complète
  assert.deepEqual(sourceArmRule({ nightOnly: true, armFrom: 20, armTo: 5 }, global), { nightOnly: true, from: 20, to: 5 });
  // nightOnly propre à false l'emporte (cette source alerte 24/24)
  assert.equal(sourceArmRule({ nightOnly: false }, global).nightOnly, false);
  // champ horaire propre partiel, le reste hérité
  assert.deepEqual(sourceArmRule({ armFrom: 22 }, global), { nightOnly: true, from: 22, to: 6 });
});
