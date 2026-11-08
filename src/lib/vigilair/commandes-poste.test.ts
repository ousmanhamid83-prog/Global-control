import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDES,
  aide,
  analyser,
  basculesValides,
  commandeActive,
  commandeProche,
  executerImage,
  lignesSources,
  suggestions,
  trouverCommande,
  type Bascules,
  type Commande,
} from "./commandes-poste.ts";
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
// 1° au nord de FTTJ (12.1348, 15.0557) : 111 km, plein nord.
const NORD = avion({
  hex: "0a0b01",
  flight: "TST101",
  lat: 13.1348,
  lon: 15.0557,
  via: "antenne",
} as Partial<LiveAc>);
const URGENCE = avion({
  hex: "06a1f0",
  flight: "AFR123",
  lat: 12.3,
  lon: 15.2,
  emergency: "7700",
  squawk: "7700",
});
const AFR456 = avion({ hex: "06a1f1", flight: "AFR456", lat: 12.5, lon: 15.5 });
const MIL = avion({ hex: "0a0001", flight: "TCH01", lat: 13.6, lon: 25.3, military: true });

const sources = (ids: string[]) =>
  ids.map((id) => ({ id, label: `Source ${id}`, ok: true, detail: "ok" }));

const PIC = {
  at: AT,
  aircraft: [NORD, URGENCE, AFR456, MIL],
  localN: 2,
  sahelN: 4,
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
  phenomena: [
    {
      kind: "feu",
      title: "Feu FIRMS",
      lat: 12.5,
      lon: 15.3,
      at: AT - 3 * 3_600_000,
      theater: "tchad",
      source: "NASA FIRMS",
    },
    { kind: "seisme", title: "M5.1", lat: 35, lon: 140, at: AT, theater: "monde", source: "USGS" },
    {
      kind: "inondation",
      title: "Crue du Chari",
      lat: 11.0,
      lon: 15.0,
      at: AT - 7_200_000,
      theater: "tchad",
      source: "GDACS",
    },
  ],
  sources: sources(["1090", "rx", "metar", "taf", "sigmet", "swpc", "nat"]),
} as unknown as LivePicture;

const RIEN: Bascules = {};
const tous = () => true;
const cmd = (nom: string) => trouverCommande(nom) as Commande;

describe("commandes du poste : un registre pour la console, l'agent et le bot", () => {
  it("ANALYSE : « /commande argument », sans accents ni majuscules exigés", () => {
    assert.deepEqual(analyser("/meteo"), { commande: cmd("meteo"), argument: "" });
    assert.deepEqual(analyser("  /Météo  "), { commande: cmd("meteo"), argument: "" });
    assert.deepEqual(analyser("/piste  TST101 "), { commande: cmd("piste"), argument: "TST101" });
    assert.deepEqual(analyser("/notice comment relier Signal ?"), {
      commande: cmd("notice"),
      argument: "comment relier Signal ?",
    });
    assert.deepEqual(analyser("/xyz 3"), { inconnue: "xyz" });
    assert.equal(analyser("Quel temps fait-il ?"), null, "une question n'est pas une commande");
  });

  it("AUTRES NOMS : /metar, /7700, /feux, /? mènent à leur commande", () => {
    assert.equal(cmd("metar").nom, "meteo");
    assert.equal(cmd("7700").nom, "urgences");
    assert.equal(cmd("feux").nom, "phenomenes");
    assert.equal(cmd("?").nom, "aide");
    assert.equal(cmd("Phénomènes").nom, "phenomenes");
  });

  it("NOMS UNIQUES : aucun nom ni autre nom n'en cache un autre", () => {
    const tous = COMMANDES.flatMap((c) => [c.nom, ...c.alias]);
    assert.equal(new Set(tous).size, tous.length);
  });

  it("BASCULES : réglage de livraison, puis ce que le chef a réglé ; l'aide ne s'éteint pas", () => {
    assert.equal(commandeActive(cmd("trafic"), "console", RIEN), true);
    assert.equal(
      commandeActive(cmd("trafic"), "bot", RIEN),
      false,
      "positions : pas par téléphone",
    );
    assert.equal(commandeActive(cmd("meteo"), "bot", RIEN), true);
    assert.equal(commandeActive(cmd("trafic"), "bot", { trafic: { bot: true } }), true);
    assert.equal(commandeActive(cmd("meteo"), "console", { meteo: { console: false } }), false);
    assert.equal(commandeActive(cmd("aide"), "bot", { aide: { bot: false } }), true);
  });

  it("DÉSACTIVÉES À LA LIVRAISON pour le bot : positions et marquage militaire seulement", () => {
    assert.deepEqual(
      COMMANDES.filter((c) => !c.defaut.bot).map((c) => c.nom),
      ["trafic", "piste", "militaires", "ia", "briefing", "recherche"],
    );
    assert.deepEqual(
      COMMANDES.filter((c) => !c.defaut.console).map((c) => c.nom),
      ["recherche"],
      "la requête sort du poste : désactivée partout",
    );
  });

  it("FICHIER DES BASCULES : seules des bascules valides sont reprises", () => {
    assert.deepEqual(
      basculesValides({
        trafic: { bot: true, console: "oui", fax: true },
        aide: { bot: false },
        inconnue: { bot: true },
        meteo: null,
        sigmet: { console: false },
      }),
      { trafic: { bot: true }, sigmet: { console: false } },
    );
    for (const brut of [null, "texte", 3, undefined]) assert.deepEqual(basculesValides(brut), {});
  });

  it("SUGGESTIONS : ce qui commence par la saisie, les activées d'abord", () => {
    assert.deepEqual(
      suggestions("/me", "console", RIEN).map((c) => c.nom),
      ["meteo"],
    );
    assert.deepEqual(
      suggestions("/p", "bot", RIEN).map((c) => c.nom),
      ["situation", "phenomenes", "trafic", "piste"],
      "/situation par « point », /trafic par « proches » ; désactivées pour le bot, en dernier",
    );
    assert.equal(suggestions("/", "console", RIEN).length, COMMANDES.length);
    assert.deepEqual(suggestions("/meteo FTTJ", "console", RIEN), [], "argument en cours : rien");
    assert.deepEqual(suggestions("meteo", "console", RIEN), []);
  });

  it("MOT MAL TAPÉ : la commande proche ; rien pour un mot sans rapport ou trop court", () => {
    // Vu sur un vrai téléphone : « Situtation ».
    assert.equal(commandeProche("Situtation")?.nom, "situation");
    assert.equal(commandeProche("metoe")?.nom, "meteo", "deux lettres inversées : une seule faute");
    assert.equal(commandeProche("maseo"), null, "deux fautes : trop pour un nom de 5 lettres");
    assert.equal(commandeProche("capteur")?.nom, "capteurs");
    assert.equal(commandeProche("urgence")?.nom, "urgences");
    assert.equal(commandeProche("Soliel")?.nom, "soleil");
    assert.equal(commandeProche("bonjour"), null);
    assert.equal(commandeProche("merci"), null);
    assert.equal(commandeProche("mto"), null, "moins de 4 lettres");
  });

  it("AIDE : la liste du canal ; ce qui est désactivé est dit, avec qui peut l'activer", () => {
    const console_ = aide("", "console", RIEN);
    assert.equal(console_[0], "Commandes de la console :");
    assert.ok(
      console_.includes("  /piste <indicatif|adresse> — Un contact, par indicatif ou adresse ICAO"),
    );
    assert.equal(
      console_.at(-1),
      "Désactivées au poste : /recherche (le chef de division les active).",
    );
    const bot = aide("", "bot", RIEN);
    // Vu sur un vrai téléphone : « Commandes de le bot Signal ».
    assert.equal(bot[0], "Commandes du bot Signal :");
    assert.ok(!bot.some((l) => l.startsWith("  /trafic")));
    assert.equal(
      bot.at(-2),
      "Désactivées au poste : /trafic, /piste, /militaires, /ia, /briefing, /recherche (le chef de division les active).",
    );
    assert.equal(bot.at(-1), "La barre « / » est facultative : « meteo » suffit.");
    assert.ok(!console_.some((l) => l.includes("facultative")), "à la console, la barre reste la règle");
  });

  it("AIDE D'UNE COMMANDE : usage, autres noms, état par canal", () => {
    assert.deepEqual(aide("/metar", "bot", { meteo: { bot: false } }), [
      "/meteo — METAR et TAF de FTTJ.",
      "Autres noms : /metar, /taf.",
      "Console : activée · bot Signal : désactivée.",
    ]);
    assert.deepEqual(
      aide("aide", "bot", RIEN).at(-1),
      "Console : activée · bot Signal : activée (toujours).",
    );
    assert.deepEqual(aide("xyz", "bot", RIEN), ["Commande inconnue : xyz. /aide pour la liste."]);
  });

  it("IMAGE : sans relevé, le dire ; une commande qui ne lit pas l'image n'est pas exécutée ici", () => {
    assert.deepEqual(executerImage("meteo", "", null, MAINTENANT, tous), [
      "Pas encore de relevé des capteurs (1090ES / METAR en attente).",
    ]);
    assert.equal(executerImage("notice", "x", PIC, MAINTENANT, tous), undefined);
    assert.equal(executerImage("aide", "", PIC, MAINTENANT, tous), undefined);
  });

  it("SUJETS : /urgences, /meteo… donnent les faits du relevé, en-tête d'heure compris", () => {
    const u = executerImage("urgences", "", PIC, MAINTENANT, tous)!;
    assert.equal(u[0], "Dernier relevé des capteurs : 12:00:00 UTC, il y a 4 s.");
    assert.equal(u[1], "Urgences : 1");
    assert.match(u[2]!, /^ {2}AFR123 06a1f0/);
    assert.deepEqual(executerImage("meteo", "", PIC, MAINTENANT, tous)!.slice(1), [
      "METAR FTTJ : FTTJ 021200Z 05010KT 9999 FEW040 35/10 Q1008",
    ]);
  });

  it("SITUATION : seulement les sujets activés sur le canal", () => {
    const sansPositions = (nom: string) => !["trafic", "militaires"].includes(nom);
    const s = executerImage("situation", "", PIC, MAINTENANT, sansPositions)!;
    assert.ok(s.includes("Urgences : 1"));
    assert.ok(!s.some((l) => l.startsWith("1090ES") || l.startsWith("Contacts militaires")));
    const tout = executerImage("situation", "", PIC, MAINTENANT, tous)!;
    assert.ok(tout.some((l) => l.startsWith("1090ES : 4 contacts")));
    assert.equal(tout.filter((l) => /^ {2}(TST|AFR|TCH)/.test(l)).length, 3 + 1 + 1);
  });

  it("TRAFIC [nombre] : 5 par défaut, 20 au plus, un nombre absurde ignoré", () => {
    const n = (arg: string) =>
      executerImage("trafic", arg, PIC, MAINTENANT, tous)!.filter((l) => l.startsWith("  ")).length;
    assert.equal(n(""), 4, "4 contacts seulement : tous");
    assert.equal(n("2"), 2);
    assert.equal(n("abc"), 4);
    assert.equal(n("0"), 4);
    const beaucoup = {
      ...PIC,
      aircraft: Array.from({ length: 30 }, (_, i) => avion({ flight: `X${i}` })),
    } as LivePicture;
    const m = executerImage("trafic", "50", beaucoup, MAINTENANT, tous)!;
    assert.equal(m.filter((l) => l.startsWith("  ")).length, 20);
  });

  it("PISTE : par indicatif ou adresse, distance et relèvement depuis FTTJ, source dite", () => {
    assert.deepEqual(executerImage("piste", "tst101", PIC, MAINTENANT, tous)!.slice(1), [
      "TST101 · adresse 0a0b01 · type A320 · immat ?",
      "À 111 km de FTTJ, relèvement 000° (N) · FL350",
      "Vitesse 800 km/h · route 90° · NIC 8",
      "Squawk ? · urgence : aucune",
      "Vu il y a 2 s · par l'antenne du poste",
    ]);
    const u = executerImage("piste", "06A1F0", PIC, MAINTENANT, tous)!;
    assert.equal(u[1], "AFR123 · adresse 06a1f0 · type A320 · immat ?");
    assert.equal(u[4], "Squawk 7700 · urgence : 7700");
    assert.equal(u[5], "Vu il y a 2 s · par l'ADS-B Internet");
    assert.match(executerImage("piste", "TCH", PIC, MAINTENANT, tous)![1]!, /^TCH01 .* · MIL$/);
  });

  it("PISTE : vitesse pas encore reçue par l'antenne — le dire, pas « 0 km/h »", () => {
    const lent = { ...PIC, aircraft: [{ ...NORD, gsKmh: 0, track: 0 }] } as LivePicture;
    assert.equal(
      executerImage("piste", "TST101", lent, MAINTENANT, tous)![3],
      "Vitesse et route : pas encore reçues · NIC 8",
    );
    const sol = { ...PIC, aircraft: [{ ...NORD, gsKmh: 0, onGround: true }] } as LivePicture;
    assert.equal(
      executerImage("piste", "TST101", sol, MAINTENANT, tous)![3],
      "Vitesse 0 km/h · route 90° · NIC 8",
      "au sol, 0 km/h est une vraie valeur",
    );
    assert.equal(
      executerImage("piste", "TST101", sol, MAINTENANT, tous)![2],
      "À 111 km de FTTJ, relèvement 000° (N) · au sol",
    );
  });

  it("PISTE : plusieurs candidats, aucun, ou rien de demandé — le dire", () => {
    assert.equal(
      executerImage("piste", "AFR", PIC, MAINTENANT, tous)![1],
      "Plusieurs contacts commencent par « AFR » : AFR123, AFR456. Préciser.",
    );
    assert.equal(
      executerImage("piste", "ZZZ9", PIC, MAINTENANT, tous)![1],
      "Aucun contact « ZZZ9 » dans le dernier relevé.",
    );
    assert.match(executerImage("piste", "", PIC, MAINTENANT, tous)![1]!, /^\/piste attend/);
  });

  it("SOLEIL : lever, coucher, crépuscule civil, jour ou nuit", () => {
    assert.deepEqual(executerImage("soleil", "", PIC, MAINTENANT, tous), [
      "Soleil à FTTJ (heure locale) : lever 05:52, coucher 17:21.",
      "Crépuscule civil : 05:30 – 17:43 · jour de 11 h 29.",
      "En ce moment : jour.",
    ]);
  });

  it("PHÉNOMÈNES : ceux du théâtre, du plus proche au plus lointain ; non reçus, le dire", () => {
    const p = executerImage("phenomenes", "", PIC, MAINTENANT, tous)!;
    assert.deepEqual(p.slice(1), [
      "Phénomènes du théâtre : 2, les plus proches de FTTJ :",
      "  feu · Feu FIRMS · à 49 km (Tchad) · NASA FIRMS · il y a 3 h",
      "  inondation · Crue du Chari · à 126 km (Tchad) · GDACS · il y a 2 h",
    ]);
    assert.equal(executerImage("phenomenes", "1", PIC, MAINTENANT, tous)!.length, 3);
    const muet = { ...PIC, sources: sources(["rx"]) } as LivePicture;
    assert.equal(
      executerImage("phenomenes", "", muet, MAINTENANT, tous)![1],
      "Phénomènes (NASA, USGS, GDACS) : non reçus au dernier relevé.",
    );
    const enEchec = {
      ...PIC,
      sources: [{ id: "nat", label: "Phénomènes", ok: false, detail: "délai" }],
    } as LivePicture;
    assert.equal(
      executerImage("phenomenes", "", enEchec, MAINTENANT, tous)![1],
      "Phénomènes (NASA, USGS, GDACS) : non reçus au dernier relevé.",
      "une source qui a répondu en erreur n'a rien donné",
    );
    const calme = { ...PIC, phenomena: [] } as unknown as LivePicture;
    assert.equal(
      executerImage("phenomenes", "", calme, MAINTENANT, tous)![1],
      "Phénomènes du théâtre : aucun au dernier relevé.",
    );
  });

  it("CAPTEURS : chaque source en service ou non, avec son détail", () => {
    const pic = {
      ...PIC,
      sources: [
        { id: "rx", label: "Antenne 1090 du poste", ok: true, detail: "3 positionnés" },
        { id: "metar", label: "METAR NOAA", ok: false, detail: "aucun METAR" },
      ],
    } as LivePicture;
    assert.deepEqual(lignesSources(pic, MAINTENANT).slice(1), [
      "  ✔ Antenne 1090 du poste : 3 positionnés",
      "  ✖ METAR NOAA : aucun METAR",
    ]);
    assert.deepEqual(lignesSources(null, MAINTENANT), [
      "Pas encore de relevé des capteurs (1090ES / METAR en attente).",
    ]);
  });
});
