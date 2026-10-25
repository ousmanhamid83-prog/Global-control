import { test } from "node:test";
import assert from "node:assert/strict";
import { camKey, diffCameras } from "./sitenet-core.ts";

test("camKey : host:port", () => {
  assert.equal(camKey({ host: "10.20.0.5", port: 8080 }), "10.20.0.5:8080");
});

test("diffCameras : nouvelle apparue", () => {
  const d = diffCameras(["10.0.0.1:80"], ["10.0.0.1:80", "10.0.0.2:8080"]);
  assert.deepEqual(d.added, ["10.0.0.2:8080"]);
  assert.deepEqual(d.removed, []);
});

test("diffCameras : caméra tombée", () => {
  const d = diffCameras(["10.0.0.1:80", "10.0.0.2:8080"], ["10.0.0.1:80"]);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, ["10.0.0.2:8080"]);
});

test("diffCameras : apparition ET disparition", () => {
  const d = diffCameras(["a:1", "b:2"], ["b:2", "c:3"]);
  assert.deepEqual(d.added, ["c:3"]);
  assert.deepEqual(d.removed, ["a:1"]);
});

test("diffCameras : aucun changement", () => {
  const d = diffCameras(["a:1", "b:2"], ["b:2", "a:1"]); // ordre inversé
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
});

test("diffCameras : premier relevé (prev vide/undefined) = tout nouveau", () => {
  assert.deepEqual(diffCameras(undefined, ["a:1"]).added, ["a:1"]);
  assert.deepEqual(diffCameras([], ["a:1", "a:1"]).added, ["a:1"]); // doublon ignoré
});
