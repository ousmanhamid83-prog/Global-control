import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { commander, etatDrone, synchroniserLiaisons } from "./drones-liaison.server.ts";
import { liaisonVivante, REGLAGES_DEFAUT } from "./drones-pilotage.ts";
import { trame } from "./mavlink.ts";

// Un faux drone : il parle MAVLink avec les trames du poste (trame(), vérifiée contre pymavlink) et
// répond ce que l'essai lui dit. Le vrai programme de vol est essayé à part (scripts/drones).
type Recue = { id: number; sys: number; comp: number; v: DataView };

/** Les trames MAVLink 2 d'un bloc d'octets venu du poste, charge remise à 40 octets. */
function trames(octets: Uint8Array): Recue[] {
  const r: Recue[] = [];
  for (let i = 0; i < octets.length;) {
    assert.equal(octets[i], 0xfd, "le poste n'écrit que du MAVLink 2");
    const taille = octets[i + 1]!;
    const charge = new Uint8Array(40);
    charge.set(octets.subarray(i + 10, i + 10 + taille));
    r.push({
      id: octets[i + 7]! | (octets[i + 8]! << 8),
      sys: octets[i + 5]!,
      comp: octets[i + 6]!,
      v: new DataView(charge.buffer),
    });
    i += 12 + taille;
  }
  return r;
}

const u16 = (n: number) => [n & 0xff, n >> 8];
const BATTEMENT_EN_VOL = Uint8Array.of(4, 0, 0, 0, 2, 3, 217, 4, 3);
const BATTEMENT_POSE = Uint8Array.of(0, 0, 0, 0, 2, 3, 89, 3, 3);
function position(hauteurM: number, lat = 12.1331, lon = 15.0339): Uint8Array {
  const c = new Uint8Array(28);
  const v = new DataView(c.buffer);
  v.setInt32(4, Math.round(lat * 1e7), true);
  v.setInt32(8, Math.round(lon * 1e7), true);
  v.setInt32(12, (295 + hauteurM) * 1000, true);
  v.setInt32(16, hauteurM * 1000, true);
  return c;
}
function depart(): Uint8Array {
  const c = new Uint8Array(52);
  const v = new DataView(c.buffer);
  v.setInt32(0, 121331000, true);
  v.setInt32(4, 150339000, true);
  v.setInt32(8, 295000, true);
  return c;
}
function gps3d(): Uint8Array {
  const c = new Uint8Array(30);
  c.set([3, 12], 28);
  return c;
}
const texte = (t: string) => Uint8Array.from([4, ...Buffer.from(t.padEnd(50, "\0"), "latin1")]);
const accuse = (ordre: number, resultat: number) => Uint8Array.from([...u16(ordre), resultat]);
const demande = (seq: number) => Uint8Array.from([...u16(seq), 254, 190]);

type Faux = {
  port: number;
  recues: Recue[];
  /** Ordres reçus (COMMAND_LONG 76, COMMAND_INT 75), hors demandes de télémétrie (511). */
  ordres: () => Recue[];
  dire: (id: number, charge: Uint8Array, sys?: number) => void;
  /** Appelé à chaque trame du poste, pour répondre. */
  repondre: (f: (t: Recue) => void) => void;
  couper: () => void;
  fermer: () => Promise<void>;
  connexions: () => number;
};

/**
 * Tout ce qu'un essai ouvre est refermé à la fin du fichier, qu'il ait réussi ou non : un faux
 * drone resté ouvert après un échec garderait le processus en vie, et l'échec ne serait jamais dit.
 */
const aFermer = new Set<() => Promise<void> | void>();

async function fauxDrone(): Promise<Faux> {
  let prise: net.Socket | null = null;
  let seq = 0;
  let nb = 0;
  let surTrame: (t: Recue) => void = () => undefined;
  const recues: Recue[] = [];
  const serveur = net.createServer((s) => {
    prise = s;
    nb += 1;
    s.on("error", () => undefined);
    s.on("data", (d) => {
      for (const t of trames(d)) {
        recues.push(t);
        surTrame(t);
      }
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const fermer = () =>
    new Promise<void>((ok) => {
      aFermer.delete(fermer);
      prise?.destroy();
      serveur.close(() => ok());
    });
  aFermer.add(fermer);
  return {
    port: (serveur.address() as AddressInfo).port,
    recues,
    ordres: () =>
      recues.filter((t) => (t.id === 76 || t.id === 75) && t.v.getUint16(28, true) !== 511),
    dire: (id, charge, sys = 1) => prise?.write(trame(seq++, sys, 1, id, charge)),
    repondre: (f) => {
      surTrame = f;
    },
    couper: () => prise?.destroy(),
    fermer,
    connexions: () => nb,
  };
}

async function attendre(quoi: string, vrai: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!vrai()) {
    if (Date.now() - t0 > ms) throw new Error(`jamais : ${quoi}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Un drone lié, entendu, en vol à 40 m (ou posé), départ et GPS reçus. */
async function lie(id: string, enVol = true): Promise<Faux> {
  const d = await fauxDrone();
  synchroniserLiaisons([{ id, liaison: `tcp://127.0.0.1:${d.port}` }]);
  await attendre("connecté", () => d.connexions() === 1);
  d.dire(0, enVol ? BATTEMENT_EN_VOL : BATTEMENT_POSE);
  d.dire(33, position(enVol ? 40 : 0));
  d.dire(242, depart());
  d.dire(24, gps3d());
  await attendre("état reçu", () => etatDrone(id)?.gps?.fix === 3);
  return d;
}

const CIRCUIT = {
  points: [
    { lat: 12.1345, lon: 15.0345 },
    { lat: 12.1345, lon: 15.036 },
  ],
  hauteurM: 40,
  tours: 2,
};
const ordre = (id: string, nom: Parameters<typeof commander>[1], p = {}) =>
  commander(id, nom, p, CIRCUIT, REGLAGES_DEFAUT);

after(async () => {
  synchroniserLiaisons([]);
  for (const f of [...aFermer]) await f();
});

describe("liaison d'un drone : le poste se branche, suit, et demande la télémétrie", () => {
  it("au premier battement de l'autopilote : cible retenue, télémétrie demandée à lui seul, par le système 254", async () => {
    const d = await fauxDrone();
    synchroniserLiaisons([{ id: "a", liaison: `tcp://127.0.0.1:${d.port}` }]);
    await attendre("connecté", () => d.connexions() === 1);
    assert.deepEqual([etatDrone("a")?.lie, etatDrone("a")?.cible], [true, null]);
    assert.equal(
      d.recues.filter((t) => t.id === 76).length,
      0,
      "rien demandé avant de savoir à qui",
    );
    d.dire(0, BATTEMENT_EN_VOL);
    await attendre("5 demandes", () => d.recues.filter((t) => t.id === 76).length === 5);
    const demandes = d.recues.filter((t) => t.id === 76);
    assert.deepEqual(
      demandes.map((t) => [
        t.v.getUint16(28, true),
        t.v.getFloat32(0, true),
        t.v.getFloat32(4, true),
      ]),
      [
        [511, 33, 250000],
        [511, 1, 1e6],
        [511, 24, 1e6],
        [511, 42, 1e6],
        [511, 242, 5e6],
      ],
    );
    for (const t of demandes) {
      assert.deepEqual([t.sys, t.comp, t.v.getUint8(30), t.v.getUint8(31)], [254, 190, 1, 1]);
    }
    const e = etatDrone("a")!;
    assert.deepEqual(
      [e.cible, e.autopilote, e.engin, e.arme, liaisonVivante(e, Date.now())],
      [{ sys: 1, comp: 1 }, "ardupilot", "multirotor", true, true],
    );
    // Le battement du poste, chaque seconde : une station sol (6), sans autopilote (8).
    await attendre("battement du poste", () => d.recues.some((t) => t.id === 0), 2500);
    const b = d.recues.find((t) => t.id === 0)!;
    assert.deepEqual([b.sys, b.comp, b.v.getUint8(4), b.v.getUint8(5)], [254, 190, 6, 8]);
    await d.fermer();
  });

  it("position qui se tait 5 s (autopilote redémarré) : la télémétrie est redemandée", async () => {
    const d = await lie("muet");
    const avant = d.recues.filter((t) => t.id === 76).length;
    await attendre(
      "redemandée",
      () => d.recues.filter((t) => t.id === 76).length >= avant + 5,
      8000,
    );
    await d.fermer();
  });

  it("liaison coupée : dite, puis rouverte seule ; drone retiré du registre : fermée pour de bon", async () => {
    const d = await lie("c");
    d.couper();
    await attendre("coupée", () => etatDrone("c")?.lie === false);
    await attendre("rouverte", () => d.connexions() === 2 && etatDrone("c")?.lie === true, 5000);
    synchroniserLiaisons([]);
    assert.equal(etatDrone("c"), null);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(d.connexions(), 2, "plus de nouvelle tentative");
    await d.fermer();
  });

  it("personne à l'adresse : l'erreur est dite ; adresse changée : l'ancienne liaison fermée, la nouvelle ouverte ; adresse refusée : rien", async () => {
    const mort = await fauxDrone();
    await mort.fermer();
    synchroniserLiaisons([{ id: "x", liaison: `tcp://127.0.0.1:${mort.port}` }]);
    await attendre("erreur dite", () => /connexion refusée/.test(etatDrone("x")?.erreur ?? ""));
    const d = await fauxDrone();
    synchroniserLiaisons([{ id: "x", liaison: `tcp://127.0.0.1:${d.port}` }]);
    await attendre("nouvelle adresse", () => d.connexions() === 1 && etatDrone("x")?.lie === true);
    assert.equal(etatDrone("x")?.erreur, null);
    synchroniserLiaisons([{ id: "x", liaison: "tcp://8.8.8.8:5760" }, { id: "y" }]);
    assert.deepEqual([etatDrone("x"), etatDrone("y")], [null, null]);
    await d.fermer();
  });

  it("UDP : le poste n'entend que la station nommée, et lui répond là d'où elle parle", async () => {
    const libre = dgram.createSocket("udp4");
    await new Promise<void>((ok) => libre.bind(0, "127.0.0.1", ok));
    const port = libre.address().port;
    await new Promise<void>((ok) => libre.close(() => ok()));
    synchroniserLiaisons([{ id: "u", liaison: `udp://127.0.0.1:${port}` }]);
    const station = dgram.createSocket("udp4");
    const intrus = dgram.createSocket("udp4");
    aFermer.add(() => {
      station.close();
      intrus.close();
    });
    const recues: Recue[] = [];
    const chezIntrus: Recue[] = [];
    station.on("message", (m) => recues.push(...trames(m)));
    intrus.on("message", (m) => chezIntrus.push(...trames(m)));
    await new Promise<void>((ok) => station.bind(0, "127.0.0.1", ok));
    await new Promise<void>((ok) => intrus.bind(0, "127.0.0.2", ok));
    await new Promise((r) => setTimeout(r, 100));
    // L'intrus parle le premier, d'une autre adresse : ni entendu, ni servi.
    intrus.send(trame(0, 1, 1, 0, BATTEMENT_POSE), port, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([etatDrone("u")?.lie, etatDrone("u")?.cible], [false, null]);
    // Deux trames dans un datagramme, puis un datagramme fini sur un faux début : rien de décalé.
    station.send(
      Buffer.concat([
        trame(0, 1, 1, 0, BATTEMENT_EN_VOL),
        trame(1, 1, 1, 33, position(40)),
        Buffer.of(0xfe),
      ]),
      port,
      "127.0.0.1",
    );
    await attendre("station entendue", () => etatDrone("u")?.position?.hauteurM === 40);
    station.send(trame(2, 1, 1, 24, gps3d()), port, "127.0.0.1");
    await attendre("datagramme suivant lu", () => etatDrone("u")?.gps?.fix === 3);
    await attendre(
      "télémétrie demandée à la station",
      () => recues.filter((t) => t.id === 76).length === 5,
    );
    assert.equal(chezIntrus.length, 0);
    synchroniserLiaisons([]);
  });
});

describe("liaison d'un drone : un ordre part, est redit, est jugé sur la réponse du drone", () => {
  it("accepté : un seul envoi, à l'autopilote, et ce qui s'est passé est rendu", async () => {
    const d = await lie("o1");
    d.repondre((t) => {
      if (t.id === 76 && t.v.getUint16(28, true) === 20) d.dire(77, accuse(20, 0));
    });
    assert.deepEqual(await ordre("o1", "retour"), {
      ok: true,
      suite: ["retour à la base : accepté"],
    });
    const o = d.ordres();
    assert.equal(o.length, 1);
    assert.deepEqual([o[0]!.v.getUint8(30), o[0]!.v.getUint8(31), o[0]!.v.getUint8(32)], [1, 1, 0]);
    await d.fermer();
  });

  it("refusé PAR LE POSTE (drone posé) : rien ne part sur la liaison", async () => {
    const d = await lie("o2", false);
    const r = await ordre("o2", "aller", { lat: 12.14, lon: 15.04, hauteurM: 40 });
    assert.deepEqual(r, {
      ok: false,
      suite: ["refusé par le poste : le drone est posé, moteurs coupés : rien à faire"],
    });
    await new Promise((x) => setTimeout(x, 200));
    assert.equal(d.ordres().length, 0);
    assert.deepEqual(await ordre("inconnu", "retour"), {
      ok: false,
      suite: ["pas de liaison réglée pour ce drone"],
    });
    await d.fermer();
  });

  it("accusé perdu deux fois : l'ordre est redit (confirmation 0, 1, 2), puis accepté", async () => {
    const d = await lie("o3");
    let vus = 0;
    d.repondre((t) => {
      if (t.id === 76 && t.v.getUint16(28, true) === 21 && ++vus === 3) d.dire(77, accuse(21, 0));
    });
    assert.deepEqual(await ordre("o3", "atterrir"), {
      ok: true,
      suite: ["atterrissage : accepté"],
    });
    assert.deepEqual(
      d.ordres().map((t) => t.v.getUint8(32)),
      [0, 1, 2],
    );
    await d.fermer();
  });

  it("drone muet — ou accusé venu d'un AUTRE système, ou d'un autre ordre : sans réponse après 4 envois", async () => {
    const d = await lie("o4");
    d.repondre((t) => {
      if (t.id !== 76 || t.v.getUint16(28, true) !== 20) return;
      d.dire(77, accuse(20, 0), 7); // un autre drone sur la liaison dit « accepté »
      d.dire(77, accuse(21, 0)); // le nôtre accuse un autre ordre
    });
    assert.deepEqual(await ordre("o4", "retour"), {
      ok: false,
      suite: ["retour à la base : sans réponse du drone après 4 envois"],
    });
    assert.equal(d.ordres().length, 4);
    await d.fermer();
  });

  it("« en cours » puis accepté : l'accusé final est attendu, sans redire", async () => {
    const d = await lie("o5");
    d.repondre((t) => {
      if (t.id !== 76 || t.v.getUint16(28, true) !== 21) return;
      d.dire(77, accuse(21, 5));
      setTimeout(() => d.dire(77, accuse(21, 0)), 2200);
    });
    assert.deepEqual(await ordre("o5", "atterrir"), {
      ok: true,
      suite: ["atterrissage : accepté"],
    });
    assert.equal(d.ordres().length, 1);
    await d.fermer();
  });

  it("DÉCOLLER refusé à l'armement : la raison du drone est rendue, et le décollage ne part pas", async () => {
    const d = await lie("o6", false);
    d.repondre((t) => {
      if (t.id !== 76) return;
      const o = t.v.getUint16(28, true);
      if (o === 176) d.dire(77, accuse(176, 0));
      if (o === 400) {
        d.dire(253, texte("PreArm: Battery 1 low voltage failsafe"));
        d.dire(77, accuse(400, 4));
      }
    });
    assert.deepEqual(await ordre("o6", "decoller", { hauteurM: 30 }), {
      ok: false,
      suite: [
        "mode guidé : accepté",
        "armement des moteurs : échoué — le drone dit : PreArm: Battery 1 low voltage failsafe",
      ],
    });
    assert.deepEqual(
      d.ordres().map((t) => t.v.getUint16(28, true)),
      [176, 400],
    );
    await d.fermer();
  });

  it("DÉCOLLER accepté : mode guidé, armement (jamais forcé), décollage à la hauteur — et pas deux ordres à la fois", async () => {
    const d = await lie("o7", false);
    d.repondre((t) => {
      if (t.id === 76) setTimeout(() => d.dire(77, accuse(t.v.getUint16(28, true), 0)), 60);
    });
    const [premier, second] = await Promise.all([
      ordre("o7", "decoller", { hauteurM: 30 }),
      ordre("o7", "decoller", { hauteurM: 30 }),
    ]);
    assert.deepEqual(premier, {
      ok: true,
      suite: ["mode guidé : accepté", "armement des moteurs : accepté", "décollage : accepté"],
    });
    assert.deepEqual(second, { ok: false, suite: ["un ordre est déjà en cours pour ce drone"] });
    assert.deepEqual(
      d
        .ordres()
        .map((t) => [
          t.v.getUint16(28, true),
          t.v.getFloat32(0, true),
          t.v.getFloat32(4, true),
          t.v.getFloat32(24, true),
        ]),
      [
        [176, 1, 4, 0],
        [400, 1, 0, 0],
        [22, 0, 0, 30],
      ],
    );
    await d.fermer();
  });

  it("ALLER : le point part en coordonnées entières, hauteur au-dessus du départ, mode guidé permis", async () => {
    const d = await lie("o8");
    d.repondre((t) => {
      if (t.id === 75) d.dire(77, accuse(192, 0));
    });
    assert.deepEqual(await ordre("o8", "aller", { lat: 12.14, lon: 15.04, hauteurM: 45 }), {
      ok: true,
      suite: ["aller au point : accepté"],
    });
    const t = d.ordres()[0]!;
    assert.deepEqual(
      [
        t.id,
        t.v.getUint16(28, true),
        t.v.getInt32(16, true),
        t.v.getInt32(20, true),
        t.v.getFloat32(24, true),
        t.v.getUint8(32),
        t.v.getFloat32(4, true),
      ],
      [75, 192, 121400000, 150400000, 45, 6, 1],
    );
    await d.fermer();
  });
});

describe("liaison d'un drone : la mission d'une patrouille", () => {
  /** Les points de mission (MISSION_ITEM_INT) reçus : numéro, commande, lat, lon, hauteur, p1, p2. */
  const points = (d: Faux) =>
    d.recues
      .filter((t) => t.id === 73)
      .map((t) => [
        t.v.getUint16(28, true),
        t.v.getUint16(30, true),
        t.v.getInt32(16, true),
        t.v.getInt32(20, true),
        t.v.getFloat32(24, true),
        t.v.getFloat32(0, true),
        t.v.getFloat32(4, true),
      ]);

  it("le poste annonce 5 points, le drone les demande un à un (sous ses deux formes), puis la mission démarre", async () => {
    const d = await lie("m1");
    d.repondre((t) => {
      if (t.id === 44) {
        assert.equal(t.v.getUint16(0, true), 5);
        d.dire(51, demande(0));
      }
      if (t.id === 73) {
        const seq = t.v.getUint16(28, true);
        if (seq < 4) d.dire(seq % 2 ? 51 : 40, demande(seq + 1));
        else d.dire(47, Uint8Array.of(254, 190, 0));
      }
      if (t.id === 76 && t.v.getUint16(28, true) === 300) d.dire(77, accuse(300, 0));
    });
    assert.deepEqual(await ordre("m1", "patrouille"), {
      ok: true,
      suite: ["circuit chargé : accepté", "départ en patrouille : accepté"],
    });
    assert.deepEqual(points(d), [
      [0, 16, 121331000, 150339000, 0, 0, 0],
      [1, 16, 121345000, 150345000, 40, 0, 0],
      [2, 16, 121345000, 150360000, 40, 0, 0],
      [3, 177, 0, 0, 0, 1, 1],
      [4, 20, 0, 0, 0, 0, 0],
    ]);
    await d.fermer();
  });

  it("demande perdue : le dernier point est redit ; mission refusée par le drone : dite, et rien ne démarre", async () => {
    const d = await lie("m2");
    let comptes = 0;
    d.repondre((t) => {
      if (t.id === 44 && ++comptes === 2) d.dire(40, demande(0));
      if (t.id === 73) d.dire(47, Uint8Array.of(254, 190, 13));
    });
    assert.deepEqual(await ordre("m2", "patrouille"), {
      ok: false,
      suite: ["circuit chargé : mission refusée par le drone (code 13)"],
    });
    assert.equal(comptes, 2);
    assert.equal(d.ordres().length, 0, "pas de départ en patrouille");
    await d.fermer();
  });

  it("le drone demande un point qui n'existe pas : arrêt ; drone muet : sans réponse", async () => {
    const d = await lie("m3");
    d.repondre((t) => {
      if (t.id === 44) d.dire(40, demande(9));
    });
    assert.deepEqual(await ordre("m3", "patrouille"), {
      ok: false,
      suite: ["circuit chargé : le drone demande le point 9, qui n'existe pas"],
    });
    d.repondre(() => undefined);
    assert.deepEqual(await ordre("m3", "patrouille"), {
      ok: false,
      suite: ["circuit chargé : sans réponse du drone après 4 envois"],
    });
    await d.fermer();
  });
});
