import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliquer,
  CONFIRMATION_1090_MS,
  constat1090,
  etapes,
  etatVide,
  liaisonVivante,
  lireLiaison,
  missionPatrouille,
  nomMode,
  ORDRES_DRONE,
  pilotable,
  refus,
  REGLAGES_DEFAUT,
  reglagesValides,
  resultatEnClair,
  type EtatDrone,
  type OrdreDrone,
} from "./drones-pilotage.ts";
import type { OwnDrone, Patrouille } from "./drones-core.ts";
import type { MessageMav } from "./mavlink.ts";

const T = 1_800_000_000_000;
const DE = { sys: 1, comp: 1, v1: false };
const battement = (plus: Partial<Extract<MessageMav, { nom: "HEARTBEAT" }>> = {}): MessageMav => ({
  ...DE,
  nom: "HEARTBEAT",
  type: 2,
  autopilote: 3,
  modeBase: 217,
  mode: 4,
  ...plus,
});
const position = (hauteurM: number, lat = 12.1331, lon = 15.0339): MessageMav => ({
  ...DE,
  nom: "GLOBAL_POSITION_INT",
  lat,
  lon,
  altM: 295 + hauteurM,
  hauteurM,
  vitesseMs: 3,
  cap: 90,
});

/** Un multirotor ArduPilot en vol à 40 m, parti de FTTJ, tout juste entendu. */
function enVol(): EtatDrone {
  const e = etatVide("d1");
  e.lie = true;
  for (const m of [
    battement(),
    position(40),
    { ...DE, nom: "HOME_POSITION", lat: 12.1331, lon: 15.0339, altM: 295 } as const,
    { ...DE, nom: "GPS_RAW_INT", fix: 3, satellites: 12 } as const,
    { ...DE, nom: "SYS_STATUS", tensionV: 15.2, batteriePct: 80 } as const,
  ]) {
    appliquer(e, m, T);
  }
  return e;
}
/** Le même, posé, moteurs coupés. */
function pose(): EtatDrone {
  const e = enVol();
  appliquer(e, battement({ modeBase: 89 }), T);
  appliquer(e, position(0), T);
  return e;
}
const CIRCUIT: Patrouille = {
  points: [
    { lat: 12.1345, lon: 15.0345 },
    { lat: 12.1345, lon: 15.036 },
  ],
  hauteurM: 40,
  tours: 2,
};
const non = (
  ordre: OrdreDrone,
  e: EtatDrone,
  p = {},
  circuit: Patrouille | undefined = CIRCUIT,
  r = REGLAGES_DEFAUT,
  quand = T,
) => refus(ordre, p, e, circuit, r, quand);

describe("pilotage : l'état d'un drone, lu de sa liaison", () => {
  it("battement d'autopilote : cible, famille, mode, moteurs ; une station sol ou une nacelle ne comptent pas", () => {
    const e = etatVide("d1");
    appliquer(e, battement({ sys: 255, comp: 190, type: 6, autopilote: 8 }), T);
    // Une station sol qui s'annonce « autopilote générique » reste une station sol.
    appliquer(e, battement({ sys: 255, comp: 190, type: 6, autopilote: 0 }), T);
    appliquer(e, battement({ comp: 154, type: 26, autopilote: 8 }), T);
    assert.equal(e.cible, null);
    assert.equal(e.battementA, null);
    appliquer(e, battement(), T);
    assert.deepEqual(e.cible, { sys: 1, comp: 1 });
    assert.deepEqual(
      [e.autopilote, e.engin, e.mode, e.arme, e.battementA],
      ["ardupilot", "multirotor", 4, true, T],
    );
    appliquer(e, battement({ modeBase: 89, mode: 9, v1: true }), T + 1000);
    assert.deepEqual([e.mode, e.arme, e.v1, e.battementA], [9, false, true, T + 1000]);
  });

  it("un autre système sur la même liaison ne prend pas la place du drone, ni ne change sa position", () => {
    const e = enVol();
    appliquer(e, battement({ sys: 7, mode: 6, modeBase: 89 }), T + 500);
    appliquer(e, { ...position(900, 0, 0), sys: 7 }, T + 500);
    appliquer(e, { ...position(900, 0, 0), comp: 154 }, T + 500);
    assert.deepEqual([e.cible?.sys, e.mode, e.arme, e.battementA], [1, 4, true, T]);
    assert.equal(e.position?.hauteurM, 40);
  });

  it("avant tout battement d'autopilote, une position n'est pas prise", () => {
    const e = etatVide("d1");
    appliquer(e, position(40), T);
    assert.equal(e.position, null);
  });

  it("sans position estimée l'autopilote envoie 0, 0 : le poste n'y voit pas une position", () => {
    const lue = (lat: number, lon: number) => {
      const e = enVol();
      appliquer(e, position(40, lat, lon), T + 1000);
      return e.position && [e.position.lat, e.position.lon];
    };
    assert.equal(lue(0, 0), null);
    // Une seule coordonnée nulle est une vraie position (équateur, méridien d'origine).
    assert.deepEqual(lue(0, 15.0339), [0, 15.0339]);
    assert.deepEqual(lue(12.1331, 0), [12.1331, 0]);
  });

  it("position, départ, batterie, GPS, point de mission ; six textes gardés, le plus récent d'abord", () => {
    const e = enVol();
    assert.deepEqual(e.position, {
      lat: 12.1331,
      lon: 15.0339,
      altM: 335,
      hauteurM: 40,
      vitesseMs: 3,
      cap: 90,
      a: T,
    });
    assert.deepEqual(e.depart, { lat: 12.1331, lon: 15.0339, altM: 295 });
    assert.deepEqual([e.batteriePct, e.tensionV, e.gps], [80, 15.2, { fix: 3, satellites: 12 }]);
    appliquer(e, { ...DE, nom: "MISSION_CURRENT", seq: 2 }, T);
    assert.equal(e.pointMission, 2);
    for (let i = 1; i <= 8; i++) {
      appliquer(e, { ...DE, nom: "STATUSTEXT", gravite: 4, texte: `texte ${i}` }, T + i);
    }
    assert.deepEqual(
      e.textes.map((x) => x.texte),
      ["texte 8", "texte 7", "texte 6", "texte 5", "texte 4", "texte 3"],
    );
    assert.deepEqual(e.textes[0], { a: T + 8, gravite: 4, texte: "texte 8" });
  });

  it("liaison vivante : ouverte ET un battement de moins de 5 s", () => {
    const e = enVol();
    assert.equal(liaisonVivante(e, T + 5000), true);
    assert.equal(liaisonVivante(e, T + 5001), false);
    e.lie = false;
    assert.equal(liaisonVivante(e, T), false);
    const jamais = etatVide("d2");
    jamais.lie = true;
    assert.equal(liaisonVivante(jamais, T), false);
  });

  it("mode par son nom ArduPilot (multirotor, avion) ; ailleurs son numéro ; pilotable : multirotor ArduPilot seul", () => {
    const e = enVol();
    assert.equal(nomMode(e), "GUIDED");
    assert.equal(pilotable(e), true);
    appliquer(e, battement({ mode: 99 }), T);
    assert.equal(nomMode(e), "mode 99");
    const avion = etatVide("a");
    assert.equal(nomMode(avion), "—");
    appliquer(avion, battement({ type: 1, mode: 12 }), T);
    assert.deepEqual([nomMode(avion), pilotable(avion)], ["LOITER", false]);
    const px4 = etatVide("p");
    appliquer(px4, battement({ autopilote: 12, mode: 4 }), T);
    assert.deepEqual([px4.autopilote, nomMode(px4), pilotable(px4)], ["px4", "mode 4", false]);
    const rover = etatVide("r");
    appliquer(rover, battement({ type: 10, mode: 4 }), T);
    assert.deepEqual([rover.engin, nomMode(rover), pilotable(rover)], ["autre", "mode 4", false]);
    const inconnu = etatVide("i");
    appliquer(inconnu, battement({ autopilote: 4 }), T);
    assert.deepEqual([inconnu.autopilote, pilotable(inconnu)], ["autre", false]);
  });
});

describe("pilotage : ce que le poste vérifie avant d'envoyer", () => {
  it("en vol, liaison vivante, dans le rayon et les bornes : tout part", () => {
    const e = enVol();
    assert.equal(non("retour", e), null);
    assert.equal(non("stationnaire", e), null);
    assert.equal(non("atterrir", e), null);
    assert.equal(non("aller", e, { lat: 12.14, lon: 15.04, hauteurM: 40 }), null);
    assert.equal(non("patrouille", e), null);
    assert.equal(non("decoller", pose(), { hauteurM: 30 }), null);
  });

  it("ordre coupé par le chef : refusé avant tout le reste", () => {
    const r = { ...REGLAGES_DEFAUT, ordres: { ...REGLAGES_DEFAUT.ordres, retour: false } };
    assert.match(non("retour", enVol(), {}, CIRCUIT, r)!, /coupé par le chef/);
    assert.equal(non("atterrir", enVol(), {}, CIRCUIT, r), null);
  });

  it("liaison muette (battement de plus de 5 s) : aucun ordre", () => {
    for (const o of ORDRES_DRONE) {
      assert.match(
        non(o.id, enVol(), { hauteurM: 30 }, CIRCUIT, REGLAGES_DEFAUT, T + 6000)!,
        /liaison muette/,
        o.id,
      );
    }
  });

  it("PX4 ou avion : suivi, pas piloté", () => {
    const px4 = enVol();
    appliquer(px4, battement({ autopilote: 12 }), T);
    assert.match(non("retour", px4)!, /suivi, pas piloté/);
    const avion = enVol();
    appliquer(avion, battement({ type: 1 }), T);
    assert.match(non("retour", avion)!, /suivi, pas piloté/);
  });

  it("DRONE POSÉ, MOTEURS COUPÉS (il accepterait tout sans rien faire) : seuls « décoller » part", () => {
    for (const o of ["retour", "stationnaire", "atterrir", "aller", "patrouille"] as const) {
      assert.match(
        non(o, pose(), { lat: 12.14, lon: 15.04, hauteurM: 40 })!,
        /posé, moteurs coupés/,
        o,
      );
    }
  });

  it("moteurs armés mais au sol, ou position vieille de plus de 5 s : ni aller ni patrouille", () => {
    const auSol = enVol();
    appliquer(auSol, position(1.9), T);
    assert.match(non("aller", auSol, { lat: 12.14, lon: 15.04, hauteurM: 40 })!, /pas en vol/);
    assert.match(non("patrouille", auSol)!, /pas en vol/);
    assert.equal(non("retour", auSol), null, "le ramener reste permis");
    const juste = enVol();
    appliquer(juste, position(2), T);
    assert.equal(non("aller", juste, { lat: 12.14, lon: 15.04, hauteurM: 40 }), null);
    const vieille = enVol();
    appliquer(vieille, battement(), T + 5001);
    assert.match(
      non(
        "aller",
        vieille,
        { lat: 12.14, lon: 15.04, hauteurM: 40 },
        CIRCUIT,
        REGLAGES_DEFAUT,
        T + 5001,
      )!,
      /pas en vol/,
    );
    const sans = enVol();
    sans.position = null;
    assert.match(non("aller", sans, { lat: 12.14, lon: 15.04, hauteurM: 40 })!, /pas en vol/);
  });

  it("RAYON : un point au-delà du rayon permis, compté du départ du drone, est refusé ; au bord, il part", () => {
    const e = enVol();
    // 0,0269° de latitude ≈ 2,99 km ; 0,0271° ≈ 3,01 km.
    assert.equal(non("aller", e, { lat: 12.1331 + 0.0269, lon: 15.0339, hauteurM: 40 }), null);
    assert.match(
      non("aller", e, { lat: 12.1331 + 0.0271, lon: 15.0339, hauteurM: 40 })!,
      /à 3\.01 km du départ.*rayon permis \(3 km\)/,
    );
    const large = { ...REGLAGES_DEFAUT, rayonKm: 10 };
    assert.equal(
      non("aller", e, { lat: 12.1331 + 0.0271, lon: 15.0339, hauteurM: 40 }, CIRCUIT, large),
      null,
    );
    const loin = { ...CIRCUIT, points: [CIRCUIT.points[0]!, { lat: 12.2, lon: 15.0339 }] };
    assert.match(non("patrouille", e, {}, loin)!, /au-delà du rayon permis/);
  });

  it("départ pas encore reçu : pas de point sans pouvoir vérifier le rayon", () => {
    const e = enVol();
    e.depart = null;
    assert.match(
      non("aller", e, { lat: 12.14, lon: 15.04, hauteurM: 40 })!,
      /point de départ du drone pas encore reçu/,
    );
    assert.match(non("patrouille", e)!, /point de départ du drone pas encore reçu/);
  });

  it("point illisible (absent, hors du globe, pas un nombre) : refusé", () => {
    const e = enVol();
    for (const p of [
      {},
      { lat: 12.14 },
      { lat: 91, lon: 15 },
      { lat: 12, lon: 181 },
      { lat: Number.NaN, lon: 15 },
      { lat: 12, lon: Infinity },
    ]) {
      assert.match(non("aller", e, { hauteurM: 40, ...p })!, /point illisible/, JSON.stringify(p));
    }
  });

  it("HAUTEUR : hors des bornes (15 à 120 m), absente ou pas un nombre — refusée ; aux bornes, elle part", () => {
    const e = enVol();
    const ici = { lat: 12.14, lon: 15.04 };
    for (const h of [14.9, 120.1, undefined, Number.NaN]) {
      assert.match(
        non("aller", e, { ...ici, hauteurM: h })!,
        /hauteur hors des bornes permises \(15 à 120 m/,
        String(h),
      );
      assert.match(non("decoller", pose(), { hauteurM: h })!, /hauteur hors des bornes/, String(h));
    }
    for (const h of [15, 120]) {
      assert.equal(non("aller", e, { ...ici, hauteurM: h }), null);
      assert.equal(non("decoller", pose(), { hauteurM: h }), null);
    }
    assert.match(
      non("patrouille", e, {}, { ...CIRCUIT, hauteurM: 200 })!,
      /hauteur hors des bornes/,
    );
  });

  it("DÉCOLLER : pas si les moteurs sont déjà armés, sans GPS 3D, ou sous 30 % de batterie connue", () => {
    assert.match(non("decoller", enVol(), { hauteurM: 30 })!, /moteurs déjà armés/);
    const sansGps = pose();
    sansGps.gps = null;
    assert.match(non("decoller", sansGps, { hauteurM: 30 })!, /pas de position GPS 3D/);
    const fix2d = pose();
    fix2d.gps = { fix: 2, satellites: 5 };
    assert.match(non("decoller", fix2d, { hauteurM: 30 })!, /pas de position GPS 3D/);
    const faible = pose();
    faible.batteriePct = 29;
    assert.match(
      non("decoller", faible, { hauteurM: 30 })!,
      /batterie à 29 % : pas de décollage sous 30 %/,
    );
    faible.batteriePct = 30;
    assert.equal(non("decoller", faible, { hauteurM: 30 }), null);
    faible.batteriePct = null;
    assert.equal(
      non("decoller", faible, { hauteurM: 30 }),
      null,
      "batterie inconnue : l'autopilote garde la main",
    );
  });

  it("PATROUILLE : il faut un circuit de 2 points au moins, et 1 à 20 tours entiers", () => {
    const e = enVol();
    assert.match(
      refus("patrouille", {}, e, undefined, REGLAGES_DEFAUT, T)!,
      /pas de circuit de patrouille/,
    );
    assert.match(
      non("patrouille", e, {}, { ...CIRCUIT, points: [CIRCUIT.points[0]!] })!,
      /pas de circuit de patrouille/,
    );
    for (const tours of [0, 21, 1.5]) {
      assert.match(
        non("patrouille", e, {}, { ...CIRCUIT, tours })!,
        /nombre de tours hors bornes/,
        String(tours),
      );
    }
    for (const tours of [1, 20])
      assert.equal(non("patrouille", e, {}, { ...CIRCUIT, tours }), null);
  });
});

describe("pilotage : ce qui part, étape par étape", () => {
  it("retour, stationnaire (arrêt sur place, mode 17), atterrir : un seul ordre chacun", () => {
    const e = enVol();
    assert.deepEqual(etapes("retour", {}, e, undefined), [
      { quoi: "ordre", nom: "retour à la base", ordre: 20, p: [] },
    ]);
    assert.deepEqual(etapes("stationnaire", {}, e, undefined), [
      { quoi: "ordre", nom: "arrêt sur place", ordre: 176, p: [1, 17] },
    ]);
    assert.deepEqual(etapes("atterrir", {}, e, undefined), [
      { quoi: "ordre", nom: "atterrissage", ordre: 21, p: [] },
    ]);
    assert.deepEqual(etapes("aller", { lat: 12.14, lon: 15.04, hauteurM: 40 }, e, undefined), [
      { quoi: "aller", nom: "aller au point", lat: 12.14, lon: 15.04, hauteurM: 40 },
    ]);
  });

  it("décoller : mode guidé (4), armement des moteurs, décollage à la hauteur — dans cet ordre", () => {
    assert.deepEqual(etapes("decoller", { hauteurM: 30 }, pose(), undefined), [
      { quoi: "ordre", nom: "mode guidé", ordre: 176, p: [1, 4] },
      { quoi: "ordre", nom: "armement des moteurs", ordre: 400, p: [1] },
      { quoi: "ordre", nom: "décollage", ordre: 22, p: [0, 0, 0, 0, 0, 0, 30] },
    ]);
  });

  it("patrouille : la mission (départ, circuit, reprise des tours, retour) puis son départ", () => {
    const mission = [
      { quoi: "passage", lat: 12.1331, lon: 15.0339, hauteurM: 0 },
      { quoi: "passage", lat: 12.1345, lon: 15.0345, hauteurM: 40 },
      { quoi: "passage", lat: 12.1345, lon: 15.036, hauteurM: 40 },
      { quoi: "reprendre", aSeq: 1, fois: 1 },
      { quoi: "retour" },
    ];
    assert.deepEqual(etapes("patrouille", {}, enVol(), CIRCUIT), [
      { quoi: "mission", nom: "circuit chargé", points: mission },
      { quoi: "ordre", nom: "départ en patrouille", ordre: 300, p: [] },
    ]);
    assert.deepEqual(
      missionPatrouille({ lat: 1, lon: 2 }, { ...CIRCUIT, tours: 1 }).map((p) => p.quoi),
      ["passage", "passage", "passage", "retour"],
      "un seul tour : pas de reprise",
    );
    assert.deepEqual(missionPatrouille({ lat: 1, lon: 2 }, { ...CIRCUIT, tours: 5 })[3], {
      quoi: "reprendre",
      aSeq: 1,
      fois: 4,
    });
  });

  it("réponse du drone en clair", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(resultatEnClair), [
      "accepté",
      "refusé pour l'instant",
      "refusé",
      "non géré par ce drone",
      "échoué",
      "en cours",
      "annulé",
      "résultat 9",
    ]);
  });
});

describe("pilotage : réglages du chef", () => {
  it("par défaut : tous les ordres permis, 3 km, 15 à 120 m ; chaque ordre a son nom, trois sans sceau", () => {
    assert.deepEqual(reglagesValides(null), REGLAGES_DEFAUT);
    assert.deepEqual(reglagesValides("n'importe quoi"), REGLAGES_DEFAUT);
    assert.deepEqual(
      Object.keys(REGLAGES_DEFAUT.ordres).sort(),
      ORDRES_DRONE.map((o) => o.id).sort(),
    );
    assert.deepEqual(
      ORDRES_DRONE.filter((o) => !o.sceau).map((o) => o.id),
      ["retour", "stationnaire", "atterrir"],
    );
  });

  it("valeurs bornées, ordre absent ou illisible gardé permis, plafond toujours au-dessus du plancher", () => {
    assert.deepEqual(
      reglagesValides({
        ordres: { decoller: false, aller: "non" },
        rayonKm: 999,
        hauteurMinM: 1,
        hauteurMaxM: 9999,
      }),
      {
        ordres: { ...REGLAGES_DEFAUT.ordres, decoller: false },
        rayonKm: 50,
        hauteurMinM: 5,
        hauteurMaxM: 500,
      },
    );
    assert.deepEqual(reglagesValides({ rayonKm: 0, hauteurMinM: 100, hauteurMaxM: 50 }), {
      ordres: REGLAGES_DEFAUT.ordres,
      rayonKm: 0.1,
      hauteurMinM: 100,
      hauteurMaxM: 105,
    });
    assert.deepEqual(
      reglagesValides({ rayonKm: "3", hauteurMinM: Number.NaN, hauteurMaxM: Infinity }),
      REGLAGES_DEFAUT,
    );
    assert.deepEqual(reglagesValides({ rayonKm: 7.5, hauteurMinM: 20, hauteurMaxM: 60 }), {
      ordres: REGLAGES_DEFAUT.ordres,
      rayonKm: 7.5,
      hauteurMinM: 20,
      hauteurMaxM: 60,
    });
    assert.equal(reglagesValides({ hauteurMinM: 450 }).hauteurMinM, 400);
  });
});

describe("pilotage : l'adresse de liaison d'un drone", () => {
  it("serie:// : la radio de télémétrie sur un port série connu, à un débit de radio ; rien d'autre", () => {
    assert.deepEqual(lireLiaison("serie:///dev/ttyUSB0"), {
      proto: "serie",
      chemin: "/dev/ttyUSB0",
      debit: 57600,
    });
    assert.deepEqual(
      lireLiaison(
        "serie:///dev/serial/by-id/usb-FTDI_FT231X_USB_UART_D30ABC-if00-port0?debit=115200",
      ),
      {
        proto: "serie",
        chemin: "/dev/serial/by-id/usb-FTDI_FT231X_USB_UART_D30ABC-if00-port0",
        debit: 115200,
      },
    );
    for (const port of ["/dev/ttyACM1", "/dev/ttyS0", "/dev/ttyAMA0", "/dev/pts/3"]) {
      assert.equal((lireLiaison(`serie://${port}`) as { chemin: string }).chemin, port);
    }
    // Jamais un disque ni un fichier : le poste écrirait ses trames dedans.
    for (const faux of [
      "/dev/sda",
      "/dev/nvme0n1",
      "/etc/passwd",
      "/dev/ttyUSB0/../sda",
      "/dev/ttyUSB0x",
      "/dev/tty",
    ]) {
      assert.match(
        (lireLiaison(`serie://${faux}`) as { erreur: string }).erreur,
        /port série inconnu/,
        faux,
      );
    }
    assert.match(
      (lireLiaison("serie:///dev/ttyUSB0?debit=12345") as { erreur: string }).erreur,
      /débit 12345 : 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 bit\/s/,
    );
    assert.match(
      (lireLiaison("serie://COM3") as { erreur: string }).erreur,
      /sous Linux seulement/,
    );
  });

  it("tcp:// ou udp://, hôte du réseau du poste, port donné", () => {
    assert.deepEqual(lireLiaison("tcp://192.168.1.20:5760"), {
      proto: "tcp",
      hote: "192.168.1.20",
      port: 5760,
    });
    assert.deepEqual(lireLiaison("  udp://10.0.0.7:14550 "), {
      proto: "udp",
      hote: "10.0.0.7",
      port: 14550,
    });
    assert.deepEqual(lireLiaison("tcp://station.local:5760"), {
      proto: "tcp",
      hote: "station.local",
      port: 5760,
    });
    assert.deepEqual(lireLiaison("tcp://[::1]:5760"), { proto: "tcp", hote: "::1", port: 5760 });
    assert.deepEqual(lireLiaison("tcp://127.0.0.1:1"), {
      proto: "tcp",
      hote: "127.0.0.1",
      port: 1,
    });
    assert.deepEqual(lireLiaison("tcp://127.0.0.1:65535"), {
      proto: "tcp",
      hote: "127.0.0.1",
      port: 65535,
    });
  });

  it("HORS DU RÉSEAU DU POSTE : refusée — un ordre de vol ne traverse pas Internet en clair", () => {
    for (const a of [
      "tcp://8.8.8.8:5760",
      "udp://41.74.1.9:14550",
      "tcp://drone.example.com:5760",
      "tcp://station:5760",
    ]) {
      const r = lireLiaison(a);
      assert.ok("erreur" in r && /reste sur le réseau du poste/.test(r.erreur), a);
    }
  });

  it("autre protocole, port absent ou nul, texte quelconque : refusés", () => {
    const erreur = (a: string) => {
      const r = lireLiaison(a);
      return "erreur" in r ? r.erreur : "";
    };
    assert.match(
      erreur("http://192.168.1.20:5760"),
      /tcp:\/\/hôte:port, udp:\/\/hôte:port ou serie:\/\/\/dev\/… attendu/,
    );
    assert.match(erreur("serial:///dev/ttyUSB0"), /attendu/);
    assert.match(erreur("192.168.1.20:5760"), /attendu/);
    assert.match(erreur("pas une adresse"), /adresse illisible/);
    assert.match(erreur("tcp://192.168.1.20"), /port manquant/);
    assert.match(erreur("tcp://192.168.1.20:0"), /port manquant/);
  });

  it("UDP : une adresse IPv4, pas un nom — le poste n'entend que la station nommée", () => {
    const r = lireLiaison("udp://station.local:14550");
    assert.ok("erreur" in r && /adresse IPv4 de la station sol/.test(r.erreur));
    const v6 = lireLiaison("udp://[::1]:14550");
    assert.ok("erreur" in v6 && /adresse IPv4/.test(v6.erreur));
  });
});

describe("piste 1090ES à l'adresse d'un de nos drones", () => {
  const drone = (ami1090Jusqua?: number): OwnDrone => ({
    id: "d1",
    name: "Aile-01",
    ident: "3C6DD2",
    site: "FTTJ",
    ami1090Jusqua,
    at: 0,
  });
  const ICI = { lat: 12.1331, lon: 15.0339 };

  it("PAS CONFIRMÉE : une intrusion, niveau élevé (relayé au chef) ; sans télémétrie, c'est dit", () => {
    const c = constat1090(drone(), ICI, null, T);
    assert.deepEqual(
      [c.ami, c.niveau, c.titre],
      [false, "elevee", "Aile-01 · piste 1090ES à confirmer"],
    );
    assert.match(
      c.corps,
      /intrusion tant que le chef ne l'a pas confirmée.*Pas de télémétrie du drone/,
    );
    assert.equal(
      constat1090(drone(T), ICI, null, T).ami,
      false,
      "confirmation échue à l'instant même",
    );
  });

  it("pas confirmée mais la télémétrie concorde : toujours une intrusion, l'écart est donné au chef", () => {
    const c = constat1090(drone(), ICI, { lat: 12.1331 + 0.001, lon: 15.0339 }, T);
    assert.deepEqual([c.ami, c.niveau], [false, "elevee"]);
    assert.match(c.corps, /Sa télémétrie concorde \(écart 111 m\)/);
  });

  it("CONFIRMÉE par le chef : amie, niveau faible, jusqu'à l'heure dite — pas au-delà", () => {
    const jusqua = Date.UTC(2026, 10, 15, 14, 30);
    const c = constat1090(drone(jusqua), ICI, null, jusqua - 1);
    assert.deepEqual([c.ami, c.niveau, c.titre], [true, "faible", "Aile-01 · notre drone en vol"]);
    assert.match(c.corps, /confirmée par le chef jusqu'à 14:30 Z/);
    assert.equal(constat1090(drone(jusqua), ICI, null, jusqua + 1).ami, false);
    assert.equal(CONFIRMATION_1090_MS, 7_200_000);
  });

  it("ADRESSE COPIÉE : la télémétrie situe notre drone à plus de 2 km — critique, même confirmée", () => {
    // 0,0181° de latitude ≈ 2,01 km ; 0,0179° ≈ 1,99 km.
    const loin = constat1090(drone(T + 3600_000), ICI, { lat: 12.1331 + 0.0181, lon: 15.0339 }, T);
    assert.deepEqual(
      [loin.ami, loin.niveau, loin.titre],
      [false, "critique", "Aile-01 · piste 1090ES à 2.0 km de notre drone"],
    );
    assert.match(loin.corps, /adresse copiée \?/);
    const pres = constat1090(drone(T + 3600_000), ICI, { lat: 12.1331 + 0.0179, lon: 15.0339 }, T);
    assert.deepEqual([pres.ami, pres.niveau], [true, "faible"]);
  });
});
