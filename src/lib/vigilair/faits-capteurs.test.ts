import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactsProches, faitsCapteurs, sujetsDe } from "./faits-capteurs.ts";
import type { LiveAc, LivePicture } from "./live-adsb.ts";

function avion(p: Partial<LiveAc>): LiveAc {
  return {
    hex: "000000",
    flight: "XXX000",
    flightTx: true,
    messages: null,
    lat: 0,
    lon: 0,
    altM: 10668,
    gsKmh: 800,
    track: 0,
    climbMs: 0,
    squawk: null,
    icaoType: "A320",
    reg: null,
    rssi: null,
    emergency: null,
    seenS: 1,
    onGround: false,
    category: null,
    nic: 8,
    nacp: 9,
    sil: 3,
    military: false,
    posSource: "adsb",
    rcM: null,
    ...p,
  } as LiveAc;
}

const AT = Date.UTC(2026, 10, 2, 12, 0, 0);
// Trois contacts : un au Caire, un militaire au Darfour, un en urgence près de FTTJ.
const CAIRE = avion({ hex: "4bcced", flight: "THY6139", lat: 30.1, lon: 31.4, reg: "TC-SGM" });
const DARFOUR = avion({ hex: "0a0001", flight: "TCH01", lat: 13.6, lon: 25.3, military: true });
const URGENCE = avion({ hex: "06a1f0", flight: "AFR123", lat: 12.3, lon: 15.2, emergency: "7700" });
const PIC = {
  at: AT,
  aircraft: [CAIRE, DARFOUR, URGENCE],
  localN: 1,
  sahelN: 2,
  emergencies: [URGENCE],
  metar: [
    { icao: "DRRN", raw: "DRRN 021200Z 09008KT CAVOK 37/05 Q1007" },
    { icao: "FTTJ", raw: "FTTJ 021200Z 05010KT 9999 FEW040 35/10 Q1008" },
  ],
  taf: [{ icao: "FTTJ", raw: "TAF FTTJ 021100Z 0212/0312 05012KT CAVOK" }],
  space: { kp: 3, gScale: "G0", xrayClass: "B5.1" },
  sigmets: [
    { fir: "FTTT", hazard: "TS", qualifier: "EMBD", inAo: true },
    { fir: "LFFF", hazard: "TURB", qualifier: null, inAo: false },
  ],
  jam: [
    { lat: 13.0, lon: 14.0, n: 40, bad: 30, pct: 75, level: "high" },
    { lat: 9.0, lon: 18.0, n: 20, bad: 1, pct: 5, level: "low" },
  ],
  alerts: [],
  // Toutes les sources du relevé ont répondu.
  sources: ["1090", "metar", "taf", "sigmet", "swpc"].map((id) => ({
    id,
    label: id,
    ok: true,
    detail: "",
  })),
} as unknown as LivePicture;

const MAINTENANT = AT + 42_000;

describe("réponse sans IA : les faits bruts des capteurs, selon le sujet de la question", () => {
  it("SUJETS : la question dit de quoi on parle", () => {
    assert.deepEqual(sujetsDe("Y a-t-il des urgences en cours ?"), ["urgences"]);
    assert.deepEqual(sujetsDe("Quel temps fait-il à FTTJ ?"), ["meteo"]);
    assert.deepEqual(sujetsDe("Le Kp est-il élevé ?"), ["espace"]);
    assert.deepEqual(sujetsDe("Combien d'avions près de N'Djamena ?"), ["trafic"]);
    assert.deepEqual(sujetsDe("Des SIGMET sur l'AO ?"), ["sigmet"]);
    assert.deepEqual(sujetsDe("Du brouillage GPS ?"), ["gnss"]);
    assert.deepEqual(sujetsDe("Ce contact est-il militaire ?"), ["militaires", "trafic"]);
  });

  it("ORDRE : le plus urgent d'abord, quel que soit l'ordre des mots dans la question", () => {
    assert.deepEqual(sujetsDe("La météo et le brouillage GPS ?"), ["gnss", "meteo"]);
  });

  it("INQUIÉTUDE : tout ce qui peut alerter (urgences, militaires, trafic, GNSS)", () => {
    assert.deepEqual(sujetsDe("Faut-il s'inquiéter ?"), [
      "urgences",
      "militaires",
      "trafic",
      "gnss",
    ]);
  });

  it("VUE D'ENSEMBLE : « résume la situation » donne tous les sujets", () => {
    assert.equal(sujetsDe("Résume la situation")?.length, 7);
  });

  it("USAGE : « comment régler le GPS ? » n'est pas une question pour les capteurs", () => {
    assert.equal(sujetsDe("Comment régler le GPS du poste ?"), null);
    assert.deepEqual(faitsCapteurs("Comment régler le GPS du poste ?", PIC, MAINTENANT, 0), []);
  });

  it("SANS SUJET : la notice répond si elle a trouvé ; sinon, la vue d'ensemble plutôt que rien", () => {
    assert.deepEqual(faitsCapteurs("Comment marche le garde-fou ?", PIC, MAINTENANT, 2), []);
    const tout = faitsCapteurs("Et maintenant ?", PIC, MAINTENANT, 0);
    assert.ok(
      tout.some((l) => l.startsWith("METAR FTTJ")) && tout.some((l) => l.startsWith("Urgences")),
    );
  });

  it("EN-TÊTE : l'heure UTC du relevé (même sur un poste réglé à l'heure de N'Djamena) et son âge", () => {
    const tz = process.env.TZ;
    process.env.TZ = "Africa/Ndjamena";
    try {
      const [tete] = faitsCapteurs("Y a-t-il des urgences ?", PIC, MAINTENANT, 0);
      assert.equal(tete, "Dernier relevé des capteurs : 12:00:00 UTC, il y a 42 s.");
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
    const [vieux] = faitsCapteurs("Y a-t-il des urgences ?", PIC, AT + 5 * 60_000, 0);
    assert.match(vieux!, /il y a 5 min\.$/);
  });

  it("URGENCES : chaque contact en urgence, avec son code et sa distance au poste", () => {
    const f = faitsCapteurs("Y a-t-il des urgences ?", PIC, MAINTENANT, 0);
    assert.equal(f[1], "Urgences : 1");
    assert.match(f[2]!, /^ {2}AFR123 06a1f0 A320 FL350 nic=8 à \d+ km 7700$/);
  });

  it("MÉTÉO : le METAR et le TAF FTTJ tels que reçus, mot pour mot", () => {
    assert.deepEqual(faitsCapteurs("Quel temps fait-il ?", PIC, MAINTENANT, 0).slice(1), [
      "METAR FTTJ : FTTJ 021200Z 05010KT 9999 FEW040 35/10 Q1008",
      "TAF FTTJ 021100Z 0212/0312 05012KT CAVOK",
    ]);
  });

  it("MÉTÉO : un message qui porte déjà son type n'est pas préfixé deux fois", () => {
    const recu = {
      ...PIC,
      metar: [{ icao: "FTTJ", raw: "METAR FTTJ 021500Z 03007KT 8000 NSC 39/M01 Q1008 NOSIG" }],
      taf: [{ icao: "FTTJ", raw: "0212/0312 05012KT CAVOK" }],
    } as LivePicture;
    assert.deepEqual(faitsCapteurs("Quel temps fait-il ?", recu, MAINTENANT, 0).slice(1), [
      "METAR FTTJ 021500Z 03007KT 8000 NSC 39/M01 Q1008 NOSIG",
      "TAF FTTJ : 0212/0312 05012KT CAVOK",
    ]);
    const speci = { ...recu, metar: [{ icao: "FTTJ", raw: "SPECI FTTJ 021520Z 27025G40KT" }] };
    assert.equal(
      faitsCapteurs("Quel temps fait-il ?", speci as LivePicture, MAINTENANT, 0)[1],
      "SPECI FTTJ 021520Z 27025G40KT",
    );
  });

  it("MÉTÉO ABSENTE : dit qu'elle manque, n'invente rien", () => {
    const sans = { ...PIC, metar: [], taf: [] } as LivePicture;
    assert.deepEqual(faitsCapteurs("Quel temps fait-il ?", sans, MAINTENANT, 0).slice(1), [
      "METAR FTTJ : absent du relevé (la station est parfois muette).",
    ]);
  });

  it("TRAFIC : les plus proches d'abord, chacun avec sa distance (le Caire en dernier)", () => {
    const f = faitsCapteurs("Combien d'avions ?", PIC, MAINTENANT, 0);
    assert.match(f[1]!, /^1090ES : 3 contacts en Afrique, 2 au Sahel, 1 à moins de 120 km/);
    assert.deepEqual(
      f.slice(2).map((l) => l.trim().split(" ")[0]),
      ["AFR123", "TCH01", "THY6139"],
    );
  });

  it("MILITAIRES, SIGMET, GNSS, ESPACE : seulement ce qui compte (AO, cellules chaudes)", () => {
    const f = faitsCapteurs("Résume la situation", PIC, MAINTENANT, 0);
    assert.ok(f.includes("Contacts militaires : 1, les plus proches de FTTJ :"));
    assert.ok(f.includes("SIGMET touchant l'AO : 1") && f.includes("  FTTT TS EMBD"));
    assert.ok(!f.some((l) => l.includes("LFFF")), "un SIGMET hors AO n'est pas rapporté");
    assert.ok(f.includes("GNSS dégradé (NIC/NACp des avions) : 1 cellule(s)"));
    assert.ok(f.includes("  13.0, 14.0 : 75 % de 40 avions (forte)"));
    assert.ok(f.includes("Météo spatiale : Kp 3 (G0), rayons X GOES B5.1."));
    assert.ok(f.includes("Alertes SWPC : aucune."));
  });

  it("RIEN À SIGNALER : les « aucun » sont dits, pas omis", () => {
    const calme = {
      ...PIC,
      aircraft: [CAIRE],
      emergencies: [],
      sigmets: [],
      jam: [],
    } as LivePicture;
    const f = faitsCapteurs("Résume la situation", calme, MAINTENANT, 0);
    for (const l of [
      "Urgences (7500/7600/7700) : aucune.",
      "Contacts militaires : aucun.",
      "GNSS dégradé (NIC/NACp des avions) : aucune cellule chaude.",
      "SIGMET touchant l'AO : aucun.",
    ])
      assert.ok(f.includes(l), l);
  });

  it("VUE D'ENSEMBLE : trois contacts par liste ; un sujet précis : cinq", () => {
    const beaucoup = {
      ...PIC,
      aircraft: Array.from({ length: 8 }, (_, i) =>
        avion({ flight: `X${i}`, lat: 12 + i, lon: 15 }),
      ),
    } as LivePicture;
    const contacts = (f: string[]) => f.filter((l) => /^ {2}X\d/.test(l)).length;
    assert.equal(contacts(faitsCapteurs("Combien d'avions ?", beaucoup, MAINTENANT, 0)), 5);
    assert.equal(contacts(faitsCapteurs("Résume la situation", beaucoup, MAINTENANT, 0)), 3);
  });

  it("GNSS : les trois cellules les plus dégradées, de la pire à la moins pire", () => {
    const jam = [
      { lat: 1, lon: 1, n: 10, bad: 3, pct: 30, level: "medium" },
      { lat: 2, lon: 2, n: 10, bad: 9, pct: 90, level: "high" },
      { lat: 3, lon: 3, n: 10, bad: 5, pct: 50, level: "medium" },
      { lat: 4, lon: 4, n: 10, bad: 7, pct: 70, level: "high" },
    ];
    const f = faitsCapteurs("Du brouillage GPS ?", { ...PIC, jam } as LivePicture, MAINTENANT, 0);
    assert.deepEqual(
      f.slice(2).map((l) => l.trim().split(" : ")[1]),
      ["90 % de 10 avions (forte)", "70 % de 10 avions (forte)", "50 % de 10 avions (moyenne)"],
    );
  });

  it("PAS DE RELEVÉ : le dit, sans rien inventer", () => {
    assert.deepEqual(faitsCapteurs("Y a-t-il des urgences ?", null, MAINTENANT, 0), [
      "Pas encore de relevé des capteurs (1090ES / METAR en attente).",
    ]);
  });

  it("PISTE CIBLÉE : rappelée en tête, champ par champ", () => {
    const f = faitsCapteurs(
      "Faut-il s'inquiéter ?",
      PIC,
      MAINTENANT,
      0,
      "Indicatif: AFR123\nSquawk: 7700",
    );
    assert.deepEqual(f.slice(0, 3), [
      "Piste ciblée (champs reçus) :",
      "  Indicatif: AFR123",
      "  Squawk: 7700",
    ]);
  });

  it("CONTACTS PROCHES : rien que des champs reçus, les vides omis, MIL et code d'urgence en fin", () => {
    const [simple] = contactsProches([avion({ flight: "AB12", hex: "abc123", nic: null })], 1);
    assert.match(simple!, /^AB12 abc123 A320 FL350 nic=\? à \d+ km$/);
    const [plein] = contactsProches(
      [avion({ flight: "CD34", reg: "TT-ABC", military: true, emergency: "7600" })],
      1,
    );
    assert.match(plein!, /^CD34 000000 A320 TT-ABC FL350 nic=8 à \d+ km MIL 7600$/);
  });

  it("SOURCE MUETTE : « inconnu » ou « non reçu », jamais un « aucun » qui rassurerait à tort", () => {
    // Rien n'a répondu : pas de TAF non plus (sa source est « ok » dès qu'un TAF arrive).
    const muet = { ...PIC, sources: [], taf: [] } as unknown as LivePicture;
    assert.deepEqual(faitsCapteurs("Résume la situation", muet, MAINTENANT, 0).slice(1), [
      "Urgences (7500/7600/7700) : inconnues, aucune trame 1090 reçue (antenne et ADS-B Internet muets).",
      "Contacts militaires : inconnus, aucune trame 1090 reçue (antenne et ADS-B Internet muets).",
      "Trafic 1090ES : inconnu, aucune trame 1090 reçue (antenne et ADS-B Internet muets).",
      "GNSS dégradé (NIC/NACp des avions) : inconnu, aucune trame 1090 reçue (antenne et ADS-B Internet muets).",
      "SIGMET : non reçus au dernier relevé.",
      "METAR FTTJ : non reçu au dernier relevé.",
      "Météo spatiale (NOAA SWPC) : non reçue au dernier relevé.",
    ]);
  });

  it("SOURCE EN ÉCHEC : une source qui a répondu en erreur compte comme muette", () => {
    const echec = {
      ...PIC,
      sources: PIC.sources.map((s) => ({ ...s, ok: s.id !== "sigmet" && s.id !== "metar" })),
    } as LivePicture;
    const f = faitsCapteurs("Résume la situation", echec, MAINTENANT, 0);
    assert.ok(f.includes("SIGMET : non reçus au dernier relevé."));
    assert.ok(f.includes("METAR FTTJ : non reçu au dernier relevé."));
    // Le TAF, reçu par sa propre source, reste dit.
    assert.ok(f.includes("TAF FTTJ 021100Z 0212/0312 05012KT CAVOK"));
    assert.ok(f.includes("Urgences : 1"), "le 1090 a répondu : ses faits restent");
  });

  it("ANTENNE SEULE (poste hors ligne) : ses contacts sont dits, ce qui vient d'Internet non", () => {
    const antenne = {
      ...PIC,
      sources: [{ id: "rx", label: "Antenne 1090 du poste", ok: true, detail: "" }],
    } as unknown as LivePicture;
    const f = faitsCapteurs("Résume la situation", antenne, MAINTENANT, 0);
    assert.ok(f.includes("Urgences : 1"));
    assert.ok(f.some((l) => l.startsWith("1090ES : 3 contacts en Afrique")));
    assert.ok(f.includes("GNSS dégradé (NIC/NACp des avions) : 1 cellule(s)"));
    assert.ok(
      f.includes(
        "Contacts militaires : inconnus, le marquage vient de l'ADS-B Internet, non reçu.",
      ),
    );
    assert.ok(f.includes("SIGMET : non reçus au dernier relevé."));
    assert.ok(f.includes("METAR FTTJ : non reçu au dernier relevé."));
  });

  it("CONTACTS PROCHES : la distance est la vraie distance au poste (FTTJ)", () => {
    // 1° de latitude au nord de FTTJ : 111 km.
    const [l] = contactsProches([avion({ lat: 13.1348, lon: 15.0557 })], 1);
    assert.match(l!, / à 111 km$/);
  });
});
