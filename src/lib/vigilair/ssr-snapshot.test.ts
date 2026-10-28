import { test } from "node:test";
import assert from "node:assert/strict";
import { registreVideServeur } from "./ssr-snapshot.ts";

test("SERVEUR : la liste rendue est vide", () => {
  assert.deepEqual(registreVideServeur<string>(), []);
});

test("SERVEUR : la RÉFÉRENCE est stable d'un appel à l'autre", () => {
  // React compare les références : un tableau neuf à chaque appel le ferait boucler, et c'est
  // le piège classique de getServerSnapshot.
  assert.equal(registreVideServeur<number>(), registreVideServeur<number>());
});

test("SERVEUR : la liste est GELÉE — un appelant ne peut pas contaminer les autres registres", () => {
  // Elle est partagée par les cinq registres : une poussée accidentelle les salirait tous.
  const v = registreVideServeur<number>();
  assert.ok(Object.isFrozen(v));
  assert.throws(() => v.push(1));
  assert.deepEqual(registreVideServeur<number>(), []);
});
