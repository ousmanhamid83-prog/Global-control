import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_HTTP_PORTS,
  CAMERA_RTSP_PORTS,
  MAX_PROBE_TARGETS,
  SNAPSHOT_PATHS,
  classifyProbe,
  isJpegMagic,
  isPngMagic,
  isPlausibleHost,
  parseHost,
  probeTargets,
} from "./scan2d.ts";

test("parseHost : hôte nu", () => {
  assert.deepEqual(parseHost("10.0.0.9"), { host: "10.0.0.9" });
});

test("parseHost : hôte:port", () => {
  assert.deepEqual(parseHost("10.0.0.9:8080"), { host: "10.0.0.9", port: 8080 });
});

test("parseHost : schéma + chemin ignorés, port gardé", () => {
  assert.deepEqual(parseHost("http://cam.local:8081/snapshot.jpg?x=1"), { host: "cam.local", port: 8081 });
});

test("parseHost : IPv6 littéral entre crochets", () => {
  assert.deepEqual(parseHost("[fe80::1]:554"), { host: "fe80::1", port: 554 });
});

test("parseHost : port invalide ignoré", () => {
  assert.deepEqual(parseHost("host:999999"), { host: "host" });
});

test("parseHost : vide", () => {
  assert.deepEqual(parseHost("   "), { host: "" });
});

test("isPlausibleHost : accepte IP/nom, refuse espaces et vide", () => {
  assert.equal(isPlausibleHost("10.0.0.9"), true);
  assert.equal(isPlausibleHost("cam-portail.local"), true);
  assert.equal(isPlausibleHost("fe80::1"), true);
  assert.equal(isPlausibleHost(""), false);
  assert.equal(isPlausibleHost("a b"), false);
  assert.equal(isPlausibleHost("x".repeat(200)), false);
});

test("probeTargets : port 80 sans segment de port, autres ports suffixés", () => {
  const t = probeTargets("10.0.0.9", { ports: [80, 8080], paths: ["/snapshot.jpg"] });
  assert.equal(t.length, 2);
  assert.equal(t[0]!.url, "http://10.0.0.9/snapshot.jpg");
  assert.equal(t[1]!.url, "http://10.0.0.9:8080/snapshot.jpg");
});

test("probeTargets : un port fourni le teste SEUL, tous chemins", () => {
  const t = probeTargets("cam", { port: 8554, paths: ["/a", "/b", "/c"] });
  assert.equal(t.length, 3);
  assert.ok(t.every((x) => x.port === 8554));
  assert.equal(t[0]!.url, "http://cam:8554/a");
});

test("probeTargets : chemin sans / initial est normalisé", () => {
  const t = probeTargets("h", { ports: [80], paths: ["snap.jpg"] });
  assert.equal(t[0]!.path, "/snap.jpg");
  assert.equal(t[0]!.url, "http://h/snap.jpg");
});

test("probeTargets : borné à MAX_PROBE_TARGETS", () => {
  const t = probeTargets("h"); // ports × chemins par défaut dépasse la borne
  assert.ok(t.length <= MAX_PROBE_TARGETS);
  assert.equal(t.length, MAX_PROBE_TARGETS);
});

test("probeTargets : hôte vide → aucune cible", () => {
  assert.equal(probeTargets("").length, 0);
});

test("isJpegMagic / isPngMagic", () => {
  assert.equal(isJpegMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpegMagic(new Uint8Array([0x00, 0x01])), false);
  assert.equal(isPngMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), true);
  assert.equal(isPngMagic(new Uint8Array([0xff, 0xd8])), false);
});

test("classifyProbe : MJPEG, image par content-type, image par magie, autre", () => {
  assert.equal(classifyProbe("multipart/x-mixed-replace; boundary=x", new Uint8Array()), "mjpeg");
  assert.equal(classifyProbe("image/jpeg", new Uint8Array()), "image");
  assert.equal(classifyProbe("application/octet-stream", new Uint8Array([0xff, 0xd8, 0xff])), "image");
  assert.equal(classifyProbe("text/html", new Uint8Array([0x3c, 0x68])), "other");
});

test("constantes : ports connus non vides, RTSP distincts du HTTP", () => {
  assert.ok(CAMERA_HTTP_PORTS.includes(80));
  assert.ok(CAMERA_RTSP_PORTS.includes(554));
  assert.ok(SNAPSHOT_PATHS.includes("/snapshot.jpg"));
  assert.ok(!CAMERA_HTTP_PORTS.some((p) => CAMERA_RTSP_PORTS.includes(p)));
});
