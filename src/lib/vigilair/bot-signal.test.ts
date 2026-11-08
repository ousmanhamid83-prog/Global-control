import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AIDE_BOT,
  APPAIRAGE_ESSAIS,
  APPAIRAGE_MS,
  PERIME_MS,
  codeAppairage,
  autorisesEffectifs,
  idNumero,
  numerosValides,
  REPONSE_MAX,
  TROP_DE_COMMANDES,
  commandeSansBarre,
  creerLimiteur,
  decider,
  listeAutorises,
  masquer,
  dureeLisible,
  messagesRecus,
  noteReleve,
  numeroE164,
  reponseBot,
  type MessageRecu,
} from "./bot-signal.ts";
import { IA_QUESTION_MAX } from "./ia-limites.ts";

const T = Date.UTC(2026, 10, 3, 7, 30);
const CHEF = "+23566000001";
const AUTORISES = new Set([CHEF]);
const toujours = () => "ok" as const;
const msg = (m: Partial<MessageRecu>): MessageRecu => ({
  expediteur: CHEF,
  compte: "",
  texte: "/situation",
  groupe: false,
  at: T,
  ...m,
});

describe("bot Signal : ce que le relais a reçu", () => {
  it("MESSAGES TEXTE : expéditeur, texte resserré, groupe, heure d'envoi", () => {
    const recus = messagesRecus([
      {
        account: "+23566009999",
        envelope: {
          source: CHEF,
          sourceNumber: CHEF,
          sourceUuid: "0f6e…",
          timestamp: T,
          dataMessage: { timestamp: T, message: "  /meteo \n" },
        },
      },
      // Accusé de réception, frappe, synchronisation : pas de dataMessage.
      { envelope: { sourceNumber: CHEF, timestamp: T, receiptMessage: { isDelivery: true } } },
      { envelope: { sourceNumber: CHEF, typingMessage: { action: "STARTED" } } },
      // Réaction ou pièce jointe seule : message null.
      { envelope: { sourceNumber: CHEF, dataMessage: { message: null } } },
      { envelope: { sourceNumber: CHEF, dataMessage: { message: "   " } } },
      // Message de groupe, heure absente.
      {
        envelope: {
          source: "+23566000002",
          sourceNumber: "+23566000002",
          dataMessage: { message: "/aide", groupInfo: { groupId: "abc", type: "DELIVER" } },
        },
      },
    ]);
    assert.deepEqual(recus, [
      { expediteur: CHEF, compte: "0f6e…", texte: "/meteo", groupe: false, at: T },
      { expediteur: "+23566000002", compte: "", texte: "/aide", groupe: true, at: 0 },
    ]);
  });

  it("NUMÉRO MASQUÉ : le message reste, sans expéditeur mais avec son compte Signal", () => {
    // Le relais met alors l'identifiant Signal dans « source » ; même un « source » en numéro
    // sans sourceNumber ne vaut pas : seul sourceNumber est le numéro.
    const recus = messagesRecus([
      {
        envelope: {
          source: "6a1f0c2e-uuid",
          sourceNumber: null,
          sourceUuid: "6a1f0c2e-uuid",
          dataMessage: { message: "/aide" },
        },
      },
      { envelope: { source: CHEF, dataMessage: { message: "/aide" } } },
    ]);
    assert.deepEqual(
      recus.map((m) => [m.expediteur, m.compte]),
      [
        ["", "6a1f0c2e-uuid"],
        ["", ""],
      ],
    );
  });

  it("RÉPONSE INATTENDUE DU RELAIS : rien, sans planter", () => {
    assert.deepEqual(messagesRecus({ error: "User +235 is not registered." }), []);
    assert.deepEqual(messagesRecus(null), []);
    assert.deepEqual(messagesRecus([null, 3, "x", {}]), []);
  });
});

describe("bot Signal : numéros", () => {
  it("E.164 : espaces, points, tirets ôtés ; 00 devient + ; le reste refusé", () => {
    assert.equal(numeroE164("+235 66 00-12.34"), "+23566001234");
    assert.equal(numeroE164("00235 66 00 12 34"), "+23566001234");
    assert.equal(numeroE164("66001234"), null, "sans indicatif pays");
    assert.equal(numeroE164("+235abc"), null);
    assert.equal(numeroE164("tel+23566001234"), null);
    assert.equal(numeroE164("+12345"), null, "trop court");
    assert.equal(numeroE164("+1234567890123456"), null, "trop long");
    assert.equal(numeroE164("+123456"), "+123456");
  });

  it("AUTORISÉS : liste à virgules ou points-virgules, entrées invalides écartées", () => {
    assert.deepEqual(
      [...listeAutorises(" +235 66 00 00 01 ; 0023566000002,  , pas-un-numéro,+23566000001")],
      ["+23566000001", "+23566000002"],
    );
    assert.equal(listeAutorises(undefined).size, 0);
  });

  it("MASQUÉ À L'ÉCRAN : indicatif et trois derniers chiffres seulement", () => {
    assert.equal(masquer("+23566001234"), "+235•••••234");
    assert.equal(masquer("+1234567"), "+123•567");
    assert.equal(masquer("+123456"), "•••");
  });
});

describe("bot Signal : numéros ajoutés par le chef depuis la console", () => {
  it("ÉCOUTÉS : ceux de poste.env toujours, ceux de la console une fois activés", () => {
    const poste = new Set(["+23566000001"]);
    const numeros = [
      { numero: "+23566000002", actif: true, ajouteA: 1 },
      { numero: "+23566000003", actif: false, ajouteA: 2 },
    ];
    assert.deepEqual([...autorisesEffectifs(poste, numeros)].sort(), ["+23566000001", "+23566000002"]);
    assert.deepEqual([...autorisesEffectifs(new Set(), [])], []);
  });

  it("RELUS DU DISQUE : valides seulement, sans doublon, « actif » strictement vrai", () => {
    assert.deepEqual(
      numerosValides([
        { numero: "0023566000002", actif: true, ajouteA: 1700 },
        { numero: "+23566000002", actif: true },
        { numero: "pas un numéro", actif: true },
        { numero: "+23566000003", actif: "oui" },
        null,
        { numero: "+23566000004", actif: false, ajouteA: "x" },
      ]),
      [
        { numero: "+23566000002", actif: true, ajouteA: 1700 },
        { numero: "+23566000003", actif: false, ajouteA: 0 },
        { numero: "+23566000004", actif: false, ajouteA: 0 },
      ],
    );
    assert.deepEqual(numerosValides({ numero: "+23566000002" }), []);
    assert.deepEqual(numerosValides(undefined), []);
  });

  it("COMPTE APPAIRÉ RELU DU DISQUE : gardé s'il a la forme d'un compte Signal, écarté sinon", () => {
    const compte = "63881a87-0f6e-4c2a-9d1b-3e5f7a9c0b12";
    assert.deepEqual(
      numerosValides([
        { numero: "+23566000002", actif: true, ajouteA: 1, compte },
        { numero: "+23566000003", actif: true, ajouteA: 2, compte: "pas-un-compte" },
        { numero: "+23566000004", actif: true, ajouteA: 3, compte: 42 },
      ]),
      [
        { numero: "+23566000002", actif: true, ajouteA: 1, compte },
        { numero: "+23566000003", actif: true, ajouteA: 2 },
        { numero: "+23566000004", actif: true, ajouteA: 3 },
      ],
    );
  });

  it("IDENTIFIANT D'ÉCRAN : stable, huit chiffres hexadécimaux, propre à chaque numéro", () => {
    const a = idNumero("+23566000002");
    assert.match(a, /^[0-9a-f]{8}$/);
    assert.equal(idNumero("+23566000002"), a);
    assert.notEqual(idNumero("+23566000003"), a);
    assert.equal(idNumero(""), "811c9dc5", "valeur de départ de FNV-1a");
  });
});

describe("bot Signal : code d'appairage", () => {
  it("LU DANS LE MESSAGE : « appairer » puis six chiffres, espaces et tirets permis ; le reste, non", () => {
    assert.equal(codeAppairage("appairer 123456"), "123456");
    assert.equal(codeAppairage("  /Appairer : 123 456 "), "123456");
    assert.equal(codeAppairage("APPAIRER 123-456"), "123456");
    assert.equal(codeAppairage("appairer 12345"), null, "cinq chiffres");
    assert.equal(codeAppairage("appairer 1234567"), null, "sept chiffres");
    assert.equal(codeAppairage("appairer abcdef"), null);
    assert.equal(codeAppairage("123456"), null, "le mot « appairer » est exigé");
    assert.equal(codeAppairage("appairer 123456 merci"), null);
    assert.equal(codeAppairage("appairerx 123456"), null);
    assert.equal(codeAppairage("appairer"), null);
  });

  it("VALIDITÉ : cinq minutes, trois essais", () => {
    assert.equal(APPAIRAGE_MS, 300_000);
    assert.equal(APPAIRAGE_ESSAIS, 3);
  });
});

describe("bot Signal : limiteur", () => {
  it("AU-DELÀ DE max SUR LA FENÊTRE : un refus, puis le silence, puis de nouveau ok", () => {
    const l = creerLimiteur(2, 60_000);
    assert.equal(l("a", 0), "ok");
    assert.equal(l("a", 1000), "ok");
    assert.equal(l("b", 1000), "ok", "chaque expéditeur a son compte");
    assert.equal(l("a", 2000), "refus");
    assert.equal(l("a", 3000), "silence");
    assert.equal(l("a", 59_999), "silence", "fenêtre glissante : rien ne s'est libéré");
    assert.equal(l("a", 60_000), "ok", "le premier message est sorti de la fenêtre");
    assert.equal(l("a", 60_500), "refus", "nouvel avertissement après un ok");
  });
});

describe("bot Signal : décision", () => {
  it("COMMANDE D'UN AUTORISÉ : exécutée", () => {
    assert.deepEqual(decider(msg({}), AUTORISES, toujours, T), {
      action: "executer",
      commande: "/situation",
    });
  });

  it("COMMANDE TRÈS LONGUE : coupée à la longueur d'une question", () => {
    const d = decider(msg({ texte: `/ia ${"x".repeat(5000)}` }), AUTORISES, toujours, T);
    assert.ok(d.action === "executer" && d.commande.length === IA_QUESTION_MAX);
  });

  it("INCONNU, GROUPE, NUMÉRO MASQUÉ : ignorés, sans réponse ni compte au limiteur", () => {
    let appels = 0;
    const compte = () => {
      appels++;
      return "ok" as const;
    };
    assert.deepEqual(decider(msg({ expediteur: "+23599999999" }), AUTORISES, compte, T), {
      action: "ignorer",
      raison: "numéro non autorisé",
    });
    assert.deepEqual(decider(msg({ groupe: true }), AUTORISES, compte, T), {
      action: "ignorer",
      raison: "message de groupe",
    });
    const masque = decider(msg({ expediteur: "" }), AUTORISES, compte, T);
    assert.ok(masque.action === "ignorer" && /^numéro masqué par Signal/.test(masque.raison));
    assert.equal(appels, 0);
  });

  it("TROP DE MESSAGES : un avertissement, puis plus rien", () => {
    const l = creerLimiteur(1, 60_000);
    assert.equal(decider(msg({}), AUTORISES, l, T).action, "executer");
    assert.deepEqual(decider(msg({}), AUTORISES, l, T), {
      action: "repondre",
      texte: TROP_DE_COMMANDES,
    });
    assert.deepEqual(decider(msg({}), AUTORISES, l, T), {
      action: "ignorer",
      raison: "trop de commandes",
    });
  });

  it("PÉRIMÉE : envoyée pendant que le bot était coupé — dite, pas exécutée", () => {
    const vieux = T - PERIME_MS - 1;
    assert.deepEqual(decider(msg({ at: vieux }), AUTORISES, toujours, T), {
      action: "repondre",
      texte:
        "Message envoyé à 07:24 Z, arrivé au poste à 07:30 Z : trop ancien, non exécuté. Le renvoyer s'il vaut encore.",
    });
    assert.equal(decider(msg({ at: T - PERIME_MS }), AUTORISES, toujours, T).action, "executer");
    assert.equal(decider(msg({ at: 0 }), AUTORISES, toujours, T).action, "executer", "heure inconnue");
  });

  it("TEXTE SANS « / » : une commande nommée en premier mot vaut commande ; sinon l'aide du bot", () => {
    assert.deepEqual(decider(msg({ texte: "bonjour" }), AUTORISES, toujours, T), {
      action: "repondre",
      texte: AIDE_BOT,
    });
    assert.deepEqual(decider(msg({ texte: "Situation" }), AUTORISES, toujours, T), {
      action: "executer",
      commande: "/situation",
    });
  });

  it("COMMANDE SANS BARRE : nom ou alias, casse, accents et ponctuation finale ignorés", () => {
    assert.equal(commandeSansBarre("Situation"), "/situation");
    assert.equal(commandeSansBarre("  Météo. "), "/meteo");
    assert.equal(commandeSansBarre("METAR!"), "/meteo", "alias");
    assert.equal(commandeSansBarre("piste  TST101"), "/piste TST101", "argument gardé");
    assert.equal(commandeSansBarre("7700"), "/urgences");
    assert.equal(commandeSansBarre("bonjour le poste"), null);
    assert.equal(commandeSansBarre("?"), null, "ponctuation seule : pas une commande");
    assert.equal(commandeSansBarre(""), null);
  });
});

describe("bot Signal : âge du relevé Internet sous la réponse", () => {
  it("DURÉE LISIBLE : secondes, minutes, heures", () => {
    assert.equal(dureeLisible(45_000), "45 s");
    assert.equal(dureeLisible(89_000), "89 s");
    assert.equal(dureeLisible(90_000), "2 min");
    assert.equal(dureeLisible(89 * 60_000), "89 min");
    assert.equal(dureeLisible(90 * 60_000), "2 h");
    assert.equal(dureeLisible(3 * 3_600_000), "3 h");
    assert.equal(dureeLisible(-5000), "0 s", "horloge du poste qui recule");
  });

  it("VIEUX OU ABSENT : dit sous une commande réussie qui a lu le relevé ; frais, rien", () => {
    const vieux = { ageMs: 3 * 3_600_000, frais: false };
    assert.equal(
      noteReleve({ ok: true, commande: "meteo" }, vieux),
      "Relevé Internet du poste vieux de 3 h : un nouveau est en cours, pour la commande suivante.",
    );
    assert.equal(
      noteReleve({ ok: true, commande: "situation" }, { ageMs: null, frais: false }),
      "Pas encore de relevé Internet au poste : le premier est en cours, pour la commande suivante.",
    );
    assert.equal(noteReleve({ ok: true, commande: "meteo" }, { ageMs: 5000, frais: true }), null);
  });

  it("PAS DE NOTE : commande refusée, inconnue, ou qui ne lit pas le relevé", () => {
    const vieux = { ageMs: 3 * 3_600_000, frais: false };
    assert.equal(noteReleve({ ok: false, commande: "trafic" }, vieux), null);
    assert.equal(noteReleve({ ok: false, commande: null }, vieux), null);
    assert.equal(noteReleve({ ok: true, commande: null }, vieux), null);
    for (const c of ["aide", "notice", "recherche"]) {
      assert.equal(noteReleve({ ok: true, commande: c }, vieux), null, c);
    }
  });
});

describe("bot Signal : réponse", () => {
  it("LIGNES ET TEMPS SUR LE POSTE", () => {
    assert.equal(reponseBot(["a", "b"], 1.25), "a\nb\n— poste AfriControl, 1,25 ms");
  });

  it("TROP LONGUE : coupée à REPONSE_MAX, et la suite à la console", () => {
    const r = reponseBot(["x".repeat(REPONSE_MAX + 10)], 3);
    assert.ok(r.startsWith(`${"x".repeat(REPONSE_MAX - 1)}…\n(réponse tronquée : la suite à la console)`));
    assert.ok(r.endsWith("— poste AfriControl, 3 ms"));
    assert.equal(reponseBot(["x".repeat(REPONSE_MAX)], 3), `${"x".repeat(REPONSE_MAX)}\n— poste AfriControl, 3 ms`);
  });
});
