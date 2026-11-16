import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OwnDrone } from "./drones-core.ts";
import { etatVide, type EtatDrone } from "./drones-pilotage.ts";
import { avisDrones1090, OUBLI_MS, type Episode } from "./drones-veille.server.ts";
import type { LiveAc } from "./live-adsb.ts";

const T = Date.UTC(2026, 10, 16, 9, 0, 0);
const AILE: OwnDrone = { id: "d1", name: "Aile-02", ident: "4D2023", site: "", at: 0 };
/** Une piste 1090ES reçue, telle que l'image du poste la donne. */
const piste = (hex: string, lat = 12.1348, lon = 15.0557, flight = hex.toUpperCase()): LiveAc =>
  ({ hex, flight, flightTx: false, lat, lon }) as LiveAc;
/** Ce que la liaison du drone en sait : vivante, position reçue `age` ms plus tôt. */
function liaison(lat: number, lon: number, maintenant: number, age = 1000): EtatDrone {
  const e = etatVide("d1");
  e.lie = true;
  e.battementA = maintenant - 500;
  e.position = { lat, lon, altM: 335, hauteurM: 40, vitesseMs: 0, cap: 0, a: maintenant - age };
  return e;
}

describe("veille serveur : piste 1090ES à l'adresse d'un de nos drones", () => {
  it("pas confirmée : dite une fois (élevée), pas à chaque image ; une autre adresse : rien", () => {
    const ep = new Map<string, Episode>();
    const sans = () => null;
    const a = avisDrones1090([AILE], [piste("4d2023"), piste("3c6dd2")], sans, ep, T);
    assert.equal(a.length, 1);
    assert.deepEqual(
      { ...a[0], corps: undefined },
      {
        id: `owndrone-4d2023-elevee-${T}`,
        niveau: "elevee",
        titre: "Aile-02 · piste 1090ES à confirmer",
        corps: undefined,
        trackId: "live-4d2023",
      },
    );
    assert.match(a[0]!.corps, /compte comme une intrusion tant que le chef ne l'a pas confirmée/);
    assert.deepEqual(avisDrones1090([AILE], [piste("4d2023")], sans, ep, T + 5000), []);
    // Toujours là, sans trou, bien au-delà de 10 min : le même épisode, pas redit.
    for (let m = 1; m <= 25; m++) {
      assert.deepEqual(avisDrones1090([AILE], [piste("4d2023")], sans, ep, T + m * 60_000), []);
    }
  });

  it("par son indicatif aussi ; une caméra de site ne s'apparie jamais à une piste", () => {
    const ep = new Map<string, Episode>();
    const parIndicatif = { ...AILE, ident: "AIL02" };
    const camera: OwnDrone = { ...AILE, id: "c1", kind: "camera", ident: "4D2023" };
    assert.equal(
      avisDrones1090([parIndicatif], [piste("abcdef", 12, 15, "AIL02")], () => null, ep, T).length,
      1,
    );
    assert.deepEqual(
      avisDrones1090([camera], [piste("4d2023")], () => null, new Map(), T),
      [],
    );
  });

  it("confirmée par le chef : amie, rien n'est dit ; la confirmation échue : redite", () => {
    const ep = new Map<string, Episode>();
    const confirme = { ...AILE, ami1090Jusqua: T + 3600_000 };
    assert.deepEqual(
      avisDrones1090([confirme], [piste("4d2023")], () => null, ep, T),
      [],
    );
    assert.equal(ep.get("4d2023")?.niveau, "faible");
    const apres = avisDrones1090([confirme], [piste("4d2023")], () => null, ep, T + 3600_001);
    assert.deepEqual(
      apres.map((x) => x.niveau),
      ["elevee"],
    );
  });

  it("la télémétrie du drone le place à plus de 2 km : critique, même confirmée ; vieille, elle ne compte pas", () => {
    const confirme = { ...AILE, liaison: "tcp://127.0.0.1:5760", ami1090Jusqua: T + 3600_000 };
    const loin = () => liaison(36.99, 13.84, T);
    const a = avisDrones1090([confirme], [piste("4d2023")], loin, new Map(), T);
    assert.deepEqual(
      a.map((x) => x.niveau),
      ["critique"],
    );
    assert.match(a[0]!.titre, /Aile-02 · piste 1090ES à \d+\.\d km de notre drone/);
    // Une position de plus de 5 s, ou une liaison sans battement : pas de recoupement.
    const vieille = () => liaison(36.99, 13.84, T, 6000);
    assert.deepEqual(avisDrones1090([confirme], [piste("4d2023")], vieille, new Map(), T), []);
    const muette = () => ({ ...liaison(36.99, 13.84, T), battementA: T - 6000 });
    assert.deepEqual(avisDrones1090([confirme], [piste("4d2023")], muette, new Map(), T), []);
    // Sans liaison réglée, l'état d'une ancienne liaison n'est pas lu.
    const sansLiaison = { ...confirme, liaison: undefined };
    assert.deepEqual(avisDrones1090([sansLiaison], [piste("4d2023")], loin, new Map(), T), []);
  });

  it("le niveau change (télémétrie qui arrive) : redite ; la piste revient après 10 min : redite", () => {
    const ep = new Map<string, Episode>();
    const avecLiaison = { ...AILE, liaison: "tcp://127.0.0.1:5760" };
    let tele: EtatDrone | null = null;
    const etat = () => tele;
    assert.deepEqual(
      avisDrones1090([avecLiaison], [piste("4d2023")], etat, ep, T).map((x) => x.niveau),
      ["elevee"],
    );
    tele = liaison(36.99, 13.84, T + 3000);
    assert.deepEqual(
      avisDrones1090([avecLiaison], [piste("4d2023")], etat, ep, T + 3000).map((x) => x.niveau),
      ["critique"],
    );
    tele = null;
    // Absente moins de 10 min : même épisode ; au-delà : oubliée, et son retour est redit.
    assert.deepEqual(avisDrones1090([AILE], [], etat, ep, T + OUBLI_MS), []);
    assert.equal(ep.has("4d2023"), true);
    assert.deepEqual(avisDrones1090([AILE], [], etat, ep, T + 3000 + OUBLI_MS + 1), []);
    assert.equal(ep.has("4d2023"), false);
    assert.deepEqual(
      avisDrones1090([AILE], [piste("4d2023")], etat, ep, T + 2 * OUBLI_MS).map((x) => x.niveau),
      ["elevee"],
    );
  });
});
