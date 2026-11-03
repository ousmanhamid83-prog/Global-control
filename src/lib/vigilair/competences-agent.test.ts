import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMANDES, commandeActive } from "./commandes-poste.ts";
import { competencesPour, consulter } from "./competences-agent.ts";
import type { LiveAc, LivePicture } from "./live-adsb.ts";

function avion(p: Partial<LiveAc>): LiveAc {
  return {
    hex: "000000",
    flight: "XXX000",
    flightTx: true,
    messages: null,
    lat: 12.3,
    lon: 15.2,
    altM: 10668,
    gsKmh: 800,
    track: 90,
    climbMs: 0,
    squawk: null,
    icaoType: "A320",
    reg: null,
    rssi: null,
    emergency: null,
    seenS: 2,
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
const MAINTENANT = AT + 4000;
const URGENCE = avion({ hex: "06a1f0", flight: "AFR123", emergency: "7700" });
const PIC = {
  at: AT,
  aircraft: [
    URGENCE,
    avion({ hex: "0a0001", flight: "TCH01", lat: 13.6, lon: 25.3, military: true }),
  ],
  localN: 1,
  sahelN: 2,
  emergencies: [URGENCE],
  metar: [{ icao: "FTTJ", raw: "FTTJ 021200Z 05010KT 9999 FEW040 35/10 Q1008" }],
  taf: [],
  space: { kp: 2, gScale: "G0", xrayClass: "B2.0" },
  sigmets: [],
  jam: [],
  alerts: [],
  solar: {
    sunrise: "05:52",
    sunset: "17:21",
    civilBegin: "05:30",
    civilEnd: "17:43",
    dayLengthMin: 689,
    nightOps: false,
  },
  phenomena: [],
  sources: ["1090", "rx", "metar", "sigmet", "swpc", "nat"].map((id) => ({
    id,
    label: `Source ${id}`,
    ok: true,
    detail: "ok",
  })),
} as unknown as LivePicture;

const tout = () => true;
const noms = (question: string, notice = 0, pic: LivePicture | null = PIC) =>
  competencesPour(question, pic, notice).map(
    (c) => `/${c.nom}${c.argument ? ` ${c.argument}` : ""}`,
  );
/** Les bascules de livraison d'un canal. */
const livraison = (canal: "console" | "bot") => (nom: string) =>
  commandeActive(
    COMMANDES.find((c) => c.nom === nom)!,
    canal,
    {},
  );

describe("compétences de l'agent IA : les commandes du poste qu'il consulte lui-même", () => {
  it("QUESTION D'USAGE : aucune commande (la notice y répond), rien consulté", () => {
    assert.deepEqual(noms("Comment régler le GPS du poste ?"), []);
    assert.deepEqual(consulter([], PIC, MAINTENANT, tout), { noms: [], lignes: [] });
  });

  it("SUJETS : la commande de chaque sujet ; /trafic avec les 10 contacts de l'assistant", () => {
    assert.deepEqual(noms("Y a-t-il des urgences ?"), ["/urgences"]);
    assert.deepEqual(noms("Combien d'avions près de N'Djamena ?"), ["/trafic 10"]);
    assert.deepEqual(noms("La météo et le brouillage GPS ?"), ["/gnss", "/meteo"]);
    assert.deepEqual(noms("Faut-il s'inquiéter ?"), [
      "/urgences",
      "/militaires",
      "/trafic 10",
      "/gnss",
    ]);
    assert.deepEqual(noms("Résume la situation"), ["/situation"]);
  });

  it("SANS SUJET : la notice répond si elle a trouvé ; sinon, la vue d'ensemble plutôt que rien", () => {
    assert.deepEqual(noms("Comment marche le garde-fou ?", 2), []);
    assert.deepEqual(noms("Et maintenant ?", 0), ["/situation"]);
  });

  it("AUTRES COMPÉTENCES : soleil, phénomènes, état des sources, quand la question en parle", () => {
    assert.deepEqual(noms("À quelle heure se couche le soleil ?"), ["/soleil"]);
    assert.deepEqual(noms("Des feux ou des séismes dans le théâtre ?"), ["/phenomenes"]);
    assert.deepEqual(noms("L'antenne marche-t-elle ?"), ["/capteurs"]);
    assert.deepEqual(noms("Une urgence cette nuit ?"), ["/urgences", "/soleil"]);
  });

  it("CONTACT NOMMÉ : sa /piste, par indicatif ou adresse ICAO présents dans le relevé", () => {
    assert.deepEqual(noms("Que fait AFR123 ?"), ["/piste AFR123"]);
    assert.deepEqual(noms("Et 06a1f0 ?"), ["/piste 06a1f0"]);
    assert.deepEqual(
      noms("Et ZZZ999 ?"),
      ["/situation"],
      "absent du relevé : pas de fiche inventée",
    );
    assert.deepEqual(
      noms("Que fait AFR123 ?", 0, null),
      ["/situation"],
      "pas de relevé, pas de fiche",
    );
  });

  it("CONTACT NOMMÉ : un contact sans indicatif n'est jamais « nommé » ; trois fiches au plus", () => {
    const sansIndicatif = {
      ...PIC,
      aircraft: [...PIC.aircraft, avion({ hex: "0a0b07", flight: "" })],
    } as LivePicture;
    assert.deepEqual(noms("Et ZZZ999 ?", 0, sansIndicatif), ["/situation"]);
    const quatre = {
      ...PIC,
      aircraft: ["AAA111", "BBB222", "CCC333", "DDD444"].map((f, i) =>
        avion({ flight: f, hex: `0a0c0${i}` }),
      ),
    } as LivePicture;
    assert.deepEqual(noms("AAA111 BBB222 CCC333 DDD444 ?", 0, quatre), [
      "/piste AAA111",
      "/piste BBB222",
      "/piste CCC333",
    ]);
  });

  it("RIEN À CONSULTER : une piste ciblée seule ne fait rien consulter ni afficher", () => {
    assert.deepEqual(consulter([], PIC, MAINTENANT, tout, "Indicatif: AFR123"), {
      noms: [],
      lignes: [],
    });
  });

  it("CONSULTER : l'heure du relevé une seule fois, puis les lignes de chaque commande", () => {
    const vu = consulter(competencesPour("Urgences et météo ?", PIC, 0), PIC, MAINTENANT, tout);
    assert.deepEqual(vu.noms, ["/urgences", "/meteo"]);
    assert.deepEqual(vu.lignes.filter((l) => l.startsWith("Dernier relevé")).length, 1);
    assert.equal(vu.lignes[0], "Dernier relevé des capteurs : 12:00:00 UTC, il y a 4 s.");
    assert.ok(vu.lignes.includes("Urgences : 1"));
    assert.ok(vu.lignes.includes("METAR FTTJ : FTTJ 021200Z 05010KT 9999 FEW040 35/10 Q1008"));
  });

  it("BASCULES DU CANAL : une commande désactivée ne nourrit pas l'agent de ce canal", () => {
    const q = competencesPour("Faut-il s'inquiéter ?", PIC, 0);
    const bot = consulter(q, PIC, MAINTENANT, livraison("bot"));
    assert.deepEqual(bot.noms, ["/urgences", "/gnss"], "/militaires et /trafic : console seule");
    assert.ok(!bot.lignes.some((l) => l.includes("TCH01")), "le contact militaire ne sort pas");
    const console_ = consulter(q, PIC, MAINTENANT, livraison("console"));
    assert.deepEqual(console_.noms, ["/urgences", "/militaires", "/trafic 10", "/gnss"]);
    const rien = consulter(
      competencesPour("Combien d'avions ?", PIC, 0),
      PIC,
      MAINTENANT,
      livraison("bot"),
    );
    assert.deepEqual(rien, { noms: [], lignes: [] });
  });

  it("VUE D'ENSEMBLE : trois contacts par liste ; le trafic demandé : dix", () => {
    const beaucoup = {
      ...PIC,
      aircraft: Array.from({ length: 14 }, (_, i) => avion({ flight: `X${i}`, lat: 12 + i / 10 })),
    } as LivePicture;
    const contacts = (q: string) =>
      consulter(competencesPour(q, beaucoup, 0), beaucoup, MAINTENANT, tout).lignes.filter((l) =>
        /^ {2}X\d/.test(l),
      ).length;
    assert.equal(contacts("Combien d'avions ?"), 10);
    assert.equal(contacts("Résume la situation"), 3);
  });

  it("PAS DE RELEVÉ : une seule ligne pour le dire, quelles que soient les commandes", () => {
    const vu = consulter(competencesPour("Urgences et météo ?", null, 0), null, MAINTENANT, tout);
    assert.deepEqual(vu.lignes, ["Pas encore de relevé des capteurs (1090ES / METAR en attente)."]);
  });

  it("PISTE CIBLÉE : rappelée en tête, champ par champ", () => {
    const vu = consulter(
      competencesPour("Faut-il s'inquiéter ?", PIC, 0),
      PIC,
      MAINTENANT,
      tout,
      "Indicatif: AFR123\nSquawk: 7700",
    );
    assert.deepEqual(vu.lignes.slice(0, 3), [
      "Piste ciblée (champs reçus) :",
      "  Indicatif: AFR123",
      "  Squawk: 7700",
    ]);
  });

  it("ÉTAT DES SOURCES : chaque source du relevé, en service ou non", () => {
    const vu = consulter(
      competencesPour("L'antenne marche-t-elle ?", PIC, 0),
      PIC,
      MAINTENANT,
      tout,
    );
    assert.ok(vu.lignes.includes("  ✔ Source rx : ok"));
  });
});
