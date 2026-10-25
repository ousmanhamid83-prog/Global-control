import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProbe, parseProbeMatches, parseXAddrHost, scopeValue } from "./onvif.ts";

test("buildProbe : enveloppe Probe valide avec MessageID", () => {
  const p = buildProbe("1234");
  assert.ok(p.includes("<d:Probe>"));
  assert.ok(p.includes("dn:NetworkVideoTransmitter"));
  assert.ok(p.includes("urn:uuid:1234"));
  assert.ok(p.includes("schemas.xmlsoap.org/ws/2005/04/discovery/Probe"));
});

test("buildProbe : urn:uuid déjà présent n'est pas doublé", () => {
  assert.ok(buildProbe("urn:uuid:abcd").includes("<w:MessageID>urn:uuid:abcd</w:MessageID>"));
});

test("parseXAddrHost : prend la 1re URL http, extrait host + port", () => {
  assert.deepEqual(parseXAddrHost("http://192.168.1.10:8080/onvif/device_service"), {
    xaddr: "http://192.168.1.10:8080/onvif/device_service",
    host: "192.168.1.10",
    port: 8080,
  });
  // liste : on ignore une éventuelle URL non http en tête
  const r = parseXAddrHost("urn:x http://10.0.0.5/onvif/device_service");
  assert.equal(r?.host, "10.0.0.5");
  assert.equal(r?.port, undefined);
});

test("scopeValue : décode name/hardware/location (URL-encodé)", () => {
  const scopes = [
    "onvif://www.onvif.org/type/video_encoder",
    "onvif://www.onvif.org/name/Cam%20Portail",
    "onvif://www.onvif.org/hardware/DS-2CD2042",
    "onvif://www.onvif.org/location/Camp%20Nord",
  ];
  assert.equal(scopeValue(scopes, "name"), "Cam Portail");
  assert.equal(scopeValue(scopes, "hardware"), "DS-2CD2042");
  assert.equal(scopeValue(scopes, "location"), "Camp Nord");
  assert.equal(scopeValue(scopes, "absent"), undefined);
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
 xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:wsdd="http://schemas.xmlsoap.org/ws/2005/04/discovery">
 <SOAP-ENV:Body>
  <wsdd:ProbeMatches>
   <wsdd:ProbeMatch>
    <wsa:EndpointReference><wsa:Address>urn:uuid:aaaa-1111</wsa:Address></wsa:EndpointReference>
    <wsdd:Types>dn:NetworkVideoTransmitter tds:Device</wsdd:Types>
    <wsdd:Scopes>onvif://www.onvif.org/name/Cam%20Portail onvif://www.onvif.org/hardware/DS-2CD2042 onvif://www.onvif.org/location/Camp%20Nord</wsdd:Scopes>
    <wsdd:XAddrs>http://192.168.1.64/onvif/device_service</wsdd:XAddrs>
    <wsdd:MetadataVersion>1</wsdd:MetadataVersion>
   </wsdd:ProbeMatch>
  </wsdd:ProbeMatches>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

const SAMPLE2 = `<d:Envelope xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
 <d:Body><d:ProbeMatches><d:ProbeMatch>
  <a:EndpointReference><a:Address>urn:uuid:bbbb-2222</a:Address></a:EndpointReference>
  <d:Scopes>onvif://www.onvif.org/name/Axis-Depot</d:Scopes>
  <d:XAddrs>http://10.0.0.9:8080/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs>
 </d:ProbeMatch></d:ProbeMatches></d:Body></d:Envelope>`;

test("parseProbeMatches : une caméra, host/nom/modèle/emplacement extraits", () => {
  const d = parseProbeMatches(SAMPLE);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.host, "192.168.1.64");
  assert.equal(d[0]!.port, undefined);
  assert.equal(d[0]!.address, "192.168.1.64");
  assert.equal(d[0]!.name, "Cam Portail");
  assert.equal(d[0]!.hardware, "DS-2CD2042");
  assert.equal(d[0]!.location, "Camp Nord");
  assert.equal(d[0]!.urn, "urn:uuid:aaaa-1111");
});

test("parseProbeMatches : préfixe de namespace différent, port non standard affiché", () => {
  const d = parseProbeMatches(SAMPLE2);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.host, "10.0.0.9");
  assert.equal(d[0]!.port, 8080);
  assert.equal(d[0]!.address, "10.0.0.9:8080");
  assert.equal(d[0]!.name, "Axis-Depot");
});

test("parseProbeMatches : dédoublonnage par XAddrs, ignore les blocs sans XAddrs", () => {
  const two = SAMPLE + "\n" + SAMPLE; // même caméra deux fois
  assert.equal(parseProbeMatches(two).length, 1);
  assert.equal(parseProbeMatches("<x>pas de probematch</x>").length, 0);
});
