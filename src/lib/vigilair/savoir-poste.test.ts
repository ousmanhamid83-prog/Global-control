import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decouperLiremoi, extraitsPertinents, termes } from "./savoir-poste.ts";

const VRAI = decouperLiremoi(readFileSync(join(process.cwd(), "LIREMOI.txt"), "utf8"));

const PETIT = [
  "Antenne 1090 du poste",
  "- Lancer dump1090 avec le port brut : dump1090 --net",
  "  puis AfriControl s'y branche sur 127.0.0.1:30002.",
  "",
  "- Réception seule : rien n'est émis.",
  "",
  "GPS du poste",
  "- Brancher un récepteur GPS USB : AFRICONTROL_GPS=/dev/ttyUSB0",
].join("\n");

describe("savoir local de l'assistant : le LIREMOI du poste", () => {
  it("DÉCOUPE : une puce et ses lignes indentées, rattachée à sa section", () => {
    const p = decouperLiremoi(PETIT);
    assert.equal(p.length, 3);
    assert.equal(p[0]!.titre, "Antenne 1090 du poste — Lancer dump1090 avec le port brut");
    assert.equal(
      p[0]!.texte,
      "- Lancer dump1090 avec le port brut : dump1090 --net\n  puis AfriControl s'y branche sur 127.0.0.1:30002.",
      "la ligne indentée suit sa puce, sans la ligne vide qui suit",
    );
    assert.equal(p[2]!.titre, "GPS du poste — Brancher un récepteur GPS USB");
  });

  it("SECTION SANS PUCES : son paragraphe est un passage, pas une suite de titres", () => {
    const p = decouperLiremoi(
      [
        "Antenne 1090 du poste",
        "Lancer dump1090 avec le port brut : dump1090 --net",
        "  --net-ro-port 30002",
        "Position de l'antenne : AFRICONTROL_ANTENNE=12.13,15.03",
        "",
        "GPS du poste",
        "- Brancher un récepteur GPS USB",
      ].join("\n"),
    );
    assert.deepEqual(
      p.map((x) => x.titre),
      [
        "Antenne 1090 du poste — Lancer dump1090 avec le port brut",
        "GPS du poste — Brancher un récepteur GPS USB",
      ],
    );
    assert.match(p[0]!.texte, /AFRICONTROL_ANTENNE/, "les lignes du paragraphe restent ensemble");
  });

  it("ANTENNE : « comment brancher l'antenne 1090 ? » trouve dump1090 dans le vrai LIREMOI", () => {
    const e = extraitsPertinents("Comment brancher l'antenne 1090 ?", VRAI);
    assert.match(e[0]!.texte, /dump1090 --interactive --net/);
  });

  it("TITRE COURT : une longue première ligne sans « : » ni « . » est coupée à 70 caractères", () => {
    const [p] = decouperLiremoi(`Section\n- ${"mot ".repeat(40)}`);
    assert.equal(p!.titre, `Section — ${"mot ".repeat(40).slice(0, 70)}`);
  });

  it("SANS ACCENTS, racine grossière : « téléphone » et « telephones » se rejoignent", () => {
    assert.deepEqual([...termes("téléphone")], [...termes("telephones")]);
  });

  it("PLURIEL COURT : « zones » et « zone », « tuiles » et « tuile » se rejoignent", () => {
    assert.deepEqual([...termes("zones tuiles")], [...termes("zone tuile")]);
  });

  it("PLURIEL EN X : « feux » et « feu » se rejoignent", () => {
    assert.deepEqual([...termes("feux")], [...termes("feu")]);
  });

  it("MOTS-OUTILS : « sous », « puis », « chaque » ne comptent pas", () => {
    assert.deepEqual([...termes("sous Windows, puis chaque relevé")], ["windo", "relev"]);
  });

  it("PAIRE : à termes égaux, le passage où ils se suivent passe devant", () => {
    const p = [
      { titre: "A — divers", texte: "- les drones volent loin ; ailleurs, des caméras fixes" },
      { titre: "B — registre", texte: "- registre des drones et caméras du site" },
    ];
    const e = extraitsPertinents("ajouter des drones et caméras", p);
    assert.deepEqual(
      e.map((x) => x.titre),
      ["B — registre", "A — divers"],
    );
  });

  it("COMPARATEUR : « comparateur avant/après » trouve sa section dans le vrai LIREMOI", () => {
    const e = extraitsPertinents("Comment utiliser le comparateur avant/après ?", VRAI);
    assert.ok(e.some((p) => p.texte.includes("deux PASSAGES DATÉS")));
  });

  it("CONJUGAISON : « régler » et « réglée » se rejoignent (racine sur cinq lettres)", () => {
    assert.deepEqual([...termes("régler")], [...termes("réglée")]);
  });

  it("PAS TROP COURTE : à quatre lettres, une question live tirait de la documentation au hasard", () => {
    // « faut » ~ « fautes », « cont » ~ « contrôle », « actu » ~ « actualisation » : mesuré, 6 questions
    // live sur 10 tiraient de la notice à quatre lettres, 4 à cinq.
    assert.deepEqual(extraitsPertinents("Faut-il s'inquiéter de ce contact ?", VRAI), []);
    assert.deepEqual(extraitsPertinents("Donne-moi la situation actuelle", VRAI), []);
  });

  it("TITRE DE SECTION : ses mots comptent (« intégrer ma propre API » trouve createFileRoute)", () => {
    const e = extraitsPertinents("Comment intégrer ma propre API ?", VRAI);
    assert.ok(e.some((p) => p.texte.includes("createFileRoute")));
  });

  it("IA : « comment changer le modèle de l'IA ? » trouve AFRICONTROL_IA_MODELE (« IA » compte)", () => {
    const e = extraitsPertinents("Comment changer le modèle de l'IA ?", VRAI);
    assert.ok(e.some((p) => p.texte.includes("AFRICONTROL_IA_MODELE")));
  });

  it("SIGLE DE TROIS LETTRES : « GPS » compte (« brancher le GPS » trouve le récepteur)", () => {
    const e = extraitsPertinents("brancher le GPS", decouperLiremoi(PETIT));
    assert.equal(e.length, 1);
    assert.match(e[0]!.titre, /récepteur GPS/);
  });

  it("SIGNAL : « comment relier le téléphone Signal ? » dit qu'on n'en relie plus, et pourquoi", () => {
    // Le poste ne relie plus de téléphone (un appareil relié voit tous les messages du compte) :
    // le bot a son numéro propre, inscrit par le relais.
    const e = extraitsPertinents("Comment relier le téléphone Signal ?", VRAI);
    assert.ok(e.length > 0);
    assert.match(e[0]!.texte, /aucun téléphone relié|sans relier de téléphone/i);
  });

  it("RELIEF : « où mettre les tuiles de relief ? » trouve data/relief", () => {
    const e = extraitsPertinents("Où mettre les tuiles de relief hors ligne ?", VRAI);
    assert.ok(e.some((p) => p.texte.includes("data/relief")));
  });

  it("IA : « comment installer Ollama ? » trouve la préparation de l'IA", () => {
    const e = extraitsPertinents("Comment installer Ollama pour l'IA ?", VRAI);
    assert.ok(e.some((p) => /ollama/i.test(p.texte)));
  });

  it("BUDGET : jamais plus de caractères que permis, même sur une question large", () => {
    const e = extraitsPertinents("imagerie satellite tuiles relief zone hors ligne", VRAI, 1800);
    assert.ok(e.reduce((n, p) => n + p.texte.length, 0) <= 1800);
  });

  it("BUDGET EXACT : le dernier passage est coupé net (…) pile au budget", () => {
    const long = [{ titre: "A", texte: `relais signal ${"x".repeat(986)}` }];
    const e = extraitsPertinents("relais signal", [...long, ...long], 1800);
    assert.deepEqual(
      e.map((p) => p.texte.length),
      [1000, 800],
    );
    assert.ok(e[1]!.texte.endsWith("…"));
  });

  it("RESSERRÉ : un long passage ne garde que sa tête et les lignes qui parlent de la question", () => {
    const bourre = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `  ligne de remplissage numéro ${i}, sans rapport aucun avec le sujet`,
      );
    const passage = (n: number) => ({
      titre: "S — tête",
      texte: [
        "- Tête du passage, gardée même sans mot de la question",
        ...bourre(n),
        "  le relais signal tourne sur 127.0.0.1:8085",
        ...bourre(n),
      ].join("\n"),
    });
    const [long] = extraitsPertinents("relais signal", [passage(7)]);
    assert.equal(
      long!.texte,
      [
        "- Tête du passage, gardée même sans mot de la question",
        "  […]",
        "  le relais signal tourne sur 127.0.0.1:8085",
        "  […]",
      ].join("\n"),
    );
    const court = passage(2);
    assert.equal(
      extraitsPertinents("relais signal", [court])[0]!.texte,
      court.texte,
      "court : entier",
    );
  });

  it("PAS DE MIETTE : sous 200 caractères restants, on s'arrête plutôt que d'envoyer un bout", () => {
    const moyen = { titre: "A", texte: `relais signal ${"x".repeat(836)}` };
    assert.equal(extraitsPertinents("relais signal", [moyen, moyen, moyen], 1800).length, 2);
  });

  it("PERTINENCE : un seul terme en commun ne suffit pas à tirer un passage", () => {
    assert.deepEqual(extraitsPertinents("dump1090 maintenant", decouperLiremoi(PETIT)), []);
    assert.equal(extraitsPertinents("lancer dump1090", decouperLiremoi(PETIT)).length, 1);
  });

  it("QUESTION VIDE ou faite de mots courants : aucun passage", () => {
    assert.deepEqual(extraitsPertinents("", VRAI), []);
    assert.deepEqual(extraitsPertinents("comment est-ce que", VRAI), []);
  });
});
