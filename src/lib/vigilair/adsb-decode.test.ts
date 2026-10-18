import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cprGlobal,
  cprLocal,
  cprNL,
  crc24,
  crcSyndrome,
  decodeAc13,
  decodeFrame,
  decodeId13,
  hexToBytes,
  parseAvrLine,
  RxTable,
  splitAvr,
  type ModeSMsg,
} from "./adsb-decode.ts";

const frame = (hex: string) => {
  const f = parseAvrLine(`*${hex};`);
  assert.ok(f, `trame illisible ${hex}`);
  return f!;
};

const decode = (hex: string, known: (icao: string) => boolean = () => false): ModeSMsg => {
  const r = decodeFrame(frame(hex), known);
  assert.ok(r.ok, `trame rejetée ${hex}`);
  return (r as { ok: true; msg: ModeSMsg }).msg;
};

// ---------- Encodeur de test : de vraies trames DF17 valides, autour de N'Djamena ----------

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!).toString(16);
  }
  return hex.toUpperCase();
}

function push(out: number[], value: number, len: number) {
  for (let i = len - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** i) % 2);
}

function df17(icao: number, me: number[]): string {
  const head: number[] = [];
  push(head, 17, 5);
  push(head, 5, 3);
  push(head, icao, 24);
  const body = hexToBytes(bitsToHex([...head, ...me]));
  const crc = crc24(body, 11);
  const all: number[] = [...head, ...me];
  push(all, crc, 24);
  return bitsToHex(all);
}

const mod = (a: number, b: number) => a - b * Math.floor(a / b);

function encodePosition(lat: number, lon: number, altFt: number, odd: boolean): number[] {
  const i = odd ? 1 : 0;
  const dLat = 360 / (60 - i);
  const yz = Math.floor((131072 * mod(lat, dLat)) / dLat + 0.5);
  const rlat = dLat * (yz / 131072 + Math.floor(lat / dLat));
  const ni = Math.max(cprNL(rlat) - i, 1);
  const dLon = 360 / ni;
  const xz = Math.floor((131072 * mod(lon, dLon)) / dLon + 0.5);
  const n = Math.round((altFt + 1000) / 25);
  const alt12 = ((n & 0x7f0) << 1) | 0x10 | (n & 0xf);
  const me: number[] = [];
  push(me, 11, 5); // TC 11
  push(me, 0, 2);
  push(me, 0, 1);
  push(me, alt12, 12);
  push(me, 0, 1);
  push(me, odd ? 1 : 0, 1);
  push(me, yz % 131072, 17);
  push(me, xz % 131072, 17);
  return me;
}

describe("CRC Mode S", () => {
  it("un squitter DF17 intact a un syndrome nul", () => {
    assert.equal(crcSyndrome(hexToBytes("8D4840D6202CC371C32CE0576098")), 0);
  });
  it("un bit faux est détecté et la trame rejetée", () => {
    const bad = "8D4840D6202CC371C32CE0576099";
    assert.notEqual(crcSyndrome(hexToBytes(bad)), 0);
    const r = decodeFrame(frame(bad), () => true);
    assert.equal(r.ok, false);
  });
});

describe("lignes AVR de dump1090", () => {
  it("lit « *HEX; » et « @horodatage HEX; »", () => {
    assert.equal(parseAvrLine("*8D4840D6202CC371C32CE0576098;")?.df, 17);
    assert.equal(parseAvrLine("@0000123456AB8D4840D6202CC371C32CE0576098;")?.df, 17);
  });
  it("ignore le reste (longueur fausse, texte, ligne vide)", () => {
    assert.equal(parseAvrLine("*8D4840D6202CC371C32CE05760;"), null);
    assert.equal(parseAvrLine("bonjour"), null);
    assert.equal(parseAvrLine(""), null);
  });
});

describe("squitters publiés (The 1090 MHz Riddle)", () => {
  it("identification KLM1023", () => {
    const m = decode("8D4840D6202CC371C32CE0576098");
    assert.equal(m.kind, "ident");
    if (m.kind !== "ident") return;
    assert.equal(m.icao, "4840d6");
    assert.equal(m.callsign, "KLM1023");
  });

  it("position globale paire/impaire → 52,2572 N 3,9194 E, 38 000 ft", () => {
    const e = decode("8D40621D58C382D690C8AC2863A7");
    const o = decode("8D40621D58C386435CC412692AD6");
    assert.ok(e.kind === "pos" && o.kind === "pos");
    if (e.kind !== "pos" || o.kind !== "pos") return;
    assert.equal(e.odd, false);
    assert.equal(o.odd, true);
    assert.equal(e.altFt, 38000);
    const p = cprGlobal({ lat: e.latCpr, lon: e.lonCpr }, { lat: o.latCpr, lon: o.lonCpr }, false);
    assert.ok(p);
    assert.ok(Math.abs(p!.lat - 52.2572) < 1e-4, `lat ${p!.lat}`);
    assert.ok(Math.abs(p!.lon - 3.91937) < 1e-4, `lon ${p!.lon}`);
  });

  it("position locale autour d'une référence → même point", () => {
    const e = decode("8D40621D58C382D690C8AC2863A7");
    if (e.kind !== "pos") return assert.fail();
    const p = cprLocal(e.latCpr, e.lonCpr, false, 52.258, 3.918, false);
    assert.ok(Math.abs(p.lat - 52.2572) < 1e-4);
    assert.ok(Math.abs(p.lon - 3.91937) < 1e-4);
  });

  it("vitesse sol : 159 kt, route 182,9°, −832 ft/min", () => {
    const m = decode("8D485020994409940838175B284F");
    if (m.kind !== "vel") return assert.fail(m.kind);
    assert.ok(Math.abs(m.gsKt! - 159.2) < 0.1);
    assert.ok(Math.abs(m.trackDeg! - 182.88) < 0.01);
    assert.equal(m.vrateFpm, -832);
  });

  it("vitesse air : 375 kt, cap 244,0°, −2 304 ft/min", () => {
    const m = decode("8DA05F219B06B6AF189400CBC33F");
    if (m.kind !== "vel") return assert.fail(m.kind);
    assert.equal(m.airspeed, true);
    assert.equal(m.gsKt, 375);
    assert.ok(Math.abs(m.trackDeg! - 243.98) < 0.01);
    assert.equal(m.vrateFpm, -2304);
  });
});

describe("réponses DF4 / DF5 (adresse dans la parité)", () => {
  it("squawk 0356 et altitude 32 300 ft (champs publiés)", () => {
    const sq = hexToBytes("2A00516D492B80");
    const id = ((sq[2]! & 0x1f) << 8) | sq[3]!;
    assert.equal(decodeId13(id), "0356");
    const al = hexToBytes("A02014B400000000000000F9D514");
    const ac = ((al[2]! & 0x1f) << 8) | al[3]!;
    assert.equal(decodeAc13(ac), 32300);
  });
  it("une adresse jamais entendue en clair est écartée", () => {
    const r = decodeFrame(frame("2A00516D492B80"), () => false);
    assert.deepEqual(r, { ok: false, reason: "adresse inconnue" });
  });
});

describe("redécoupage du flux AVR (trames à cheval sur deux paquets)", () => {
  it("plusieurs trames dans un même paquet", () => {
    const { lines, rest } = splitAvr("*8D4840D6;*8D485020;");
    assert.deepEqual(lines, ["*8D4840D6;", "*8D485020;"]);
    assert.equal(rest, "");
  });

  it("une trame coupée reste dans le reste jusqu'au « ; » suivant", () => {
    const a = splitAvr("*8D48");
    assert.deepEqual(a.lines, []);
    assert.equal(a.rest, "*8D48");
    const b = splitAvr(a.rest + "40D6;");
    assert.deepEqual(b.lines, ["*8D4840D6;"]);
    assert.equal(b.rest, "");
  });

  it("les sauts de ligne (CRLF) entre trames sont nettoyés", () => {
    const { lines } = splitAvr("*AAAA;\r\n*BBBB;\n");
    assert.deepEqual(lines, ["*AAAA;", "*BBBB;"]);
  });

  it("le reste après la dernière trame est conservé pour le paquet suivant", () => {
    const { lines, rest } = splitAvr("*AAAA;*BB");
    assert.deepEqual(lines, ["*AAAA;"]);
    assert.equal(rest, "*BB");
  });

  it("bout à bout : reconstitue une vraie trame DF17 scindée en deux paquets", () => {
    const hex = "8D4840D6202CC371C32CE0576098";
    const p1 = `*${hex.slice(0, 10)}`;
    const p2 = `${hex.slice(10)};`;
    const a = splitAvr(p1);
    const b = splitAvr(a.rest + p2);
    assert.equal(b.lines.length, 1);
    const f = parseAvrLine(b.lines[0]!);
    assert.ok(f);
    assert.equal(f!.df, 17);
    assert.equal(crcSyndrome(f!.bytes), 0);
  });
});

describe("chemins moins fréquents (non-régression)", () => {
  const ICAO = 0x3c4b26;

  it("position sol (TC6) : vitesse 16 kt, cap 180°, NIC 10, drapeau sol", () => {
    const me: number[] = [];
    push(me, 6, 5); // TC 6 (surface)
    push(me, 40, 7); // MOV 40 → 16 kt
    push(me, 1, 1); // statut cap valide
    push(me, 64, 7); // cap 64 → 180°
    push(me, 0, 1); // T
    push(me, 0, 1); // F (paire)
    push(me, 12345, 17); // LAT CPR (non résolue ici)
    push(me, 54321, 17); // LON CPR
    const m = decode(df17(ICAO, me));
    assert.equal(m.kind, "pos");
    if (m.kind !== "pos") return;
    assert.equal(m.surface, true);
    assert.ok(Math.abs(m.gsKt! - 16) < 1e-9, `gsKt ${m.gsKt}`);
    assert.ok(Math.abs(m.trackDeg! - 180) < 1e-9, `track ${m.trackDeg}`);
    assert.equal(m.nic, 10);
    assert.equal(m.altFt, 0);
  });

  it("altitude GNSS (TC20) : mètres → pieds, drapeau GNSS, NIC 11", () => {
    const me: number[] = [];
    push(me, 20, 5); // TC 20 (position GNSS)
    push(me, 0, 2); // SS
    push(me, 0, 1); // NICsb
    push(me, 1000, 12); // ALT = 1000 m
    push(me, 0, 1); // T
    push(me, 1, 1); // F (impaire)
    push(me, 100, 17); // LAT CPR
    push(me, 200, 17); // LON CPR
    const m = decode(df17(ICAO, me));
    assert.equal(m.kind, "pos");
    if (m.kind !== "pos") return;
    assert.equal(m.gnssAlt, true);
    assert.ok(Math.abs(m.altFt! - 1000 * 3.28084) < 0.01, `altFt ${m.altFt}`);
    assert.equal(m.nic, 11);
  });

  it("état d'urgence (TC28) : intervention illicite + squawk 0356", () => {
    const me: number[] = [];
    push(me, 28, 5); // TC 28
    push(me, 1, 3); // sous-type 1 (état d'urgence)
    push(me, 5, 3); // code urgence 5 → unlawful
    push(me, 4461, 13); // ID 13 bits → squawk 0356
    push(me, 0, 32); // reste
    const m = decode(df17(ICAO, me));
    assert.equal(m.kind, "status");
    if (m.kind !== "status") return;
    assert.equal(m.emergency, "unlawful");
    assert.equal(m.squawk, "0356");
  });

  it("all-call DF11 : adresse lue, parité II=0 acceptée", () => {
    const data = hexToBytes("5D3C4B26000000");
    const crc = crc24(data, 4);
    const hex = "5D3C4B26" + crc.toString(16).padStart(6, "0").toUpperCase();
    const r = decodeFrame(frame(hex), () => false);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.msg.kind, "allcall");
    assert.equal(r.msg.icao, "3c4b26");
  });

  it("hémisphère sud : le repli CPR ramène bien une latitude négative", () => {
    const lat = -33.8688;
    const lon = 151.2093;
    const e = decode(df17(ICAO, encodePosition(lat, lon, 35000, false)));
    const o = decode(df17(ICAO, encodePosition(lat, lon, 35000, true)));
    if (e.kind !== "pos" || o.kind !== "pos") return assert.fail();
    const p = cprGlobal({ lat: e.latCpr, lon: e.lonCpr }, { lat: o.latCpr, lon: o.lonCpr }, true);
    assert.ok(p, "paire/impaire dans la même bande");
    assert.ok(Math.abs(p!.lat - lat) < 1e-3, `lat ${p!.lat}`);
    assert.ok(Math.abs(p!.lon - lon) < 1e-3, `lon ${p!.lon}`);
  });

  it("cprNL : bornes publiées et décroissance vers les pôles", () => {
    assert.equal(cprNL(0), 59);
    assert.equal(cprNL(87), 2);
    assert.equal(cprNL(87.5), 1);
    assert.equal(cprNL(90), 1);
    assert.equal(cprNL(-87), 2);
    // NL ne remonte jamais quand on monte en latitude.
    let prev = cprNL(0);
    for (let a = 1; a <= 90; a++) {
      const nl = cprNL(a);
      assert.ok(nl <= prev, `NL remonte à ${a}° (${nl} > ${prev})`);
      prev = nl;
    }
  });
});

describe("table de l'antenne, autour de N'Djamena", () => {
  const ICAO = 0x0a1b2c;
  const t0 = 1_800_000_000_000;

  it("pose la piste au bon endroit après une paire, sans filtre d'altitude", () => {
    const rx = new RxTable({ lat: 12.1331, lon: 15.0339 });
    const lat = 12.4567;
    const lon = 15.3456;
    rx.ingest(`*${df17(ICAO, encodePosition(lat, lon, 1200, false))};`, t0);
    assert.equal(rx.positioned(t0).length, 0, "une trame seule ne suffit pas");
    rx.ingest(`*${df17(ICAO, encodePosition(lat, lon, 1200, true))};`, t0 + 500);
    const [a] = rx.positioned(t0 + 500);
    assert.ok(a);
    assert.ok(Math.abs(a!.lat! - lat) < 0.001, `lat ${a!.lat}`);
    assert.ok(Math.abs(a!.lon! - lon) < 0.001, `lon ${a!.lon}`);
    assert.equal(a!.altFt, 1200);
    assert.equal(a!.nic, 8);
  });

  it("suit l'avion en décodage local et rejette un saut impossible", () => {
    const rx = new RxTable({ lat: 12.1331, lon: 15.0339 });
    rx.ingest(`*${df17(ICAO, encodePosition(12.2, 15.1, 35000, false))};`, t0);
    rx.ingest(`*${df17(ICAO, encodePosition(12.2, 15.1, 35000, true))};`, t0 + 400);
    rx.ingest(`*${df17(ICAO, encodePosition(12.21, 15.11, 35000, false))};`, t0 + 5000);
    let [a] = rx.positioned(t0 + 5000);
    assert.ok(Math.abs(a!.lat! - 12.21) < 0.001);
    // 1° plus loin une seconde après : impossible pour un avion.
    rx.ingest(`*${df17(ICAO, encodePosition(13.21, 15.11, 35000, true))};`, t0 + 6000);
    assert.equal(rx.stats.rejectedPos, 1);
    [a] = rx.positioned(t0 + 6000);
    assert.ok(Math.abs(a!.lat! - 12.21) < 0.001, "la position rejetée n'est pas appliquée");
    // Il se recale ensuite sur une vraie paire.
    rx.ingest(`*${df17(ICAO, encodePosition(12.22, 15.12, 35000, false))};`, t0 + 7000);
    rx.ingest(`*${df17(ICAO, encodePosition(12.22, 15.12, 35000, true))};`, t0 + 7500);
    [a] = rx.positioned(t0 + 7500);
    assert.ok(Math.abs(a!.lat! - 12.22) < 0.001, `recalage ${a!.lat}`);
  });

  it("compte les trames à CRC faux sans créer de piste", () => {
    const rx = new RxTable(null);
    const good = df17(ICAO, encodePosition(12.2, 15.1, 35000, false));
    const bad = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    rx.ingest(`*${bad};`, t0);
    assert.equal(rx.stats.crc, 1);
    assert.equal(rx.ac.size, 0);
  });
});
