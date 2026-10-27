import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLiveTracks, type LiveAc } from "./live-adsb.ts";
import { DEFAULT_COAST_CFG, DUP_ADDR_WINDOW_MS } from "./coast.ts";
import { haversineKm } from "./geo.ts";
import type { Track } from "./types.ts";

/** Un avion 1090ES crédible : cap plein est, 720 km/h, au-dessus du Tchad. Pas de cast : on veut
 *  que le typage attrape un nom de champ faux plutôt que de produire une vitesse nulle en silence. */
function avion(over: Partial<LiveAc> = {}): LiveAc {
  return {
    hex: "3c6444",
    flight: "TEST123",
    lat: 12.0,
    lon: 15.0,
    altM: 9000,
    gsKmh: 720,
    track: 90,
    climbMs: 0,
    squawk: null,
    icaoType: null,
    reg: null,
    rssi: null,
    emergency: null,
    seenS: 0,
    onGround: false,
    category: null,
    nic: null,
    nacp: null,
    sil: null,
    military: false,
    ...over,
  };
}

const T0 = 1_700_000_000_000;

function premier(now = T0): Track[] {
  return mergeLiveTracks([], [avion()], now).tracks;
}

test("ingestion : une piste qui émet normalement n'est PAS une piste mémoire", () => {
  const t = premier()[0]!;
  assert.equal(t.coast, undefined);
  assert.equal(t.suspectJump, undefined);
  assert.ok(Math.abs(t.lat - 12) < 1e-6 && Math.abs(t.lon - 15) < 1e-6);
});

test("PISTE MUETTE : la position est EXTRAPOLÉE, plus figée", () => {
  const avant = premier();
  const posAvant = { lat: avant[0]!.lat, lon: avant[0]!.lon };
  // 20 s plus tard, plus rien ne tombe : la piste doit avancer à l'estime, pas rester sur place.
  const apres = mergeLiveTracks(avant, [], T0 + 20_000).tracks;
  const t = apres.find((x) => x.feed === "adsb")!;
  assert.ok(t.coast, "la piste doit être marquée comme tenue en mémoire");
  assert.equal(t.coast!.silentS, 20);
  const bouge = haversineKm(posAvant.lat, posAvant.lon, t.lat, t.lon);
  assert.ok(Math.abs(bouge - 4) < 0.3, `720 km/h x 20 s = 4 km, obtenu ${bouge.toFixed(2)} km`);
  assert.ok(t.coast!.radiusKm > 0, "l'incertitude doit être non nulle");
});

test("PISTE MUETTE : l'incertitude GRANDIT avec le silence", () => {
  const a = mergeLiveTracks(premier(), [], T0 + 10_000).tracks.find((x) => x.feed === "adsb")!;
  const b = mergeLiveTracks(premier(), [], T0 + 40_000).tracks.find((x) => x.feed === "adsb")!;
  assert.ok(b.coast!.radiusKm > a.coast!.radiusKm);
  assert.ok(b.coast!.silentS > a.coast!.silentS);
});

test("PISTE MUETTE : au-delà du délai elle est abandonnée, pas gardée indéfiniment", () => {
  const tard = T0 + (DEFAULT_COAST_CFG.dropAfterS + 5) * 1000;
  const apres = mergeLiveTracks(premier(), [], tard).tracks;
  assert.equal(apres.find((x) => x.feed === "adsb"), undefined, "la piste perdue est retirée");
});

test("PISTE MUETTE : si elle se remet à émettre, l'état mémoire s'efface", () => {
  const muette = mergeLiveTracks(premier(), [], T0 + 20_000).tracks;
  assert.ok(muette.find((x) => x.feed === "adsb")!.coast);
  const revenue = mergeLiveTracks(muette, [avion({ lon: 15.08 })], T0 + 25_000).tracks;
  const t = revenue.find((x) => x.feed === "adsb")!;
  assert.equal(t.coast, undefined, "une piste qui ré-émet n'est plus une piste mémoire");
  assert.equal(t.suspectJump, undefined);
});

test("SAUT IMPOSSIBLE : la téléportation est refusée et signalée, la piste reste à l'estime", () => {
  const avant = premier();
  // 10 s plus tard, la trame place l'avion 300 km plus au nord : physiquement impossible.
  const apres = mergeLiveTracks(avant, [avion({ lat: 14.7 })], T0 + 10_000).tracks;
  const t = apres.find((x) => x.feed === "adsb")!;
  assert.ok(t.suspectJump, "le saut doit être signalé");
  assert.match(t.suspectJump!, /saut de position/);
  // La position retenue n'est PAS celle de la trame douteuse : on a gardé l'estime.
  assert.ok(Math.abs(t.lat - 14.7) > 2, "la position falsifiée ne doit pas être adoptée");
  assert.ok(t.coast, "on continue à l'estime en attendant un relevé crédible");
});

test("ALERTE SITE : une piste réelle naît DÉVERROUILLÉE, sinon l'alerte d'approche est impossible", () => {
  // siteWarned valait « true » en dur à la création : la condition d'alerte (!siteWarned && …)
  // était donc définitivement fausse sur tout le trafic réel.
  const t = premier()[0]!;
  assert.equal(t.siteWarned, false);
});

test("ALERTE SITE : le verrou « déjà prévenu » SURVIT d'un relevé à l'autre", () => {
  // La piste est reconstruite à chaque tour : si le verrou repartait à zéro, l'alerte se rejouerait
  // en boucle à chaque relevé. C'est l'autre moitié du correctif.
  const avant = premier();
  avant[0]!.siteWarned = true;
  const apres = mergeLiveTracks(avant, [avion({ lon: 15.018 })], T0 + 10_000).tracks;
  assert.equal(apres.find((x) => x.feed === "adsb")!.siteWarned, true);
});

test("SAUT NORMAL : un déplacement crédible est accepté tel quel", () => {
  const avant = premier();
  // 10 s à 720 km/h = 2 km vers l'est, soit environ 0,018° de longitude à cette latitude.
  const apres = mergeLiveTracks(avant, [avion({ lon: 15.018 })], T0 + 10_000).tracks;
  const t = apres.find((x) => x.feed === "adsb")!;
  assert.equal(t.suspectJump, undefined);
  assert.equal(t.coast, undefined);
  assert.ok(Math.abs(t.lon - 15.018) < 1e-6, "la position mesurée est adoptée");
});

test("DOUBLON ICAO : deux émetteurs qui ALTERNENT sont démasqués", () => {
  // Le cas réel : l'émetteur légitime (lat 12) et un second sur la même adresse (lat 14.7) parlent
  // à tour de rôle. La piste se cale sur le légitime et refuse l'autre une fois sur deux — donc un
  // compteur de refus CONSÉCUTIFS ne dépasserait jamais 1. C'est la répétition qui trahit.
  let etat = premier();
  let t = etat.find((x) => x.feed === "adsb")!;
  let lon = 15.0;
  for (let i = 1; i <= 8; i++) {
    const faux = i % 2 === 1;
    lon += 0.018; // l'émetteur légitime avance normalement vers l'est
    etat = mergeLiveTracks(
      etat,
      [faux ? avion({ lat: 14.7, lon }) : avion({ lon })],
      T0 + i * 10_000,
    ).tracks;
    t = etat.find((x) => x.feed === "adsb")!;
  }
  assert.ok((t.suspect?.run ?? 0) >= 3, `attendu >= 3 refus comptés, obtenu ${t.suspect?.run}`);
  assert.match(t.suspectJump ?? "", /adresse ICAO partagée/);
});

test("DOUBLON ICAO : l'anomalie s'oublie une fois la fenêtre passée sans incident", () => {
  const apresFaux = mergeLiveTracks(premier(), [avion({ lat: 14.7 })], T0 + 10_000).tracks;
  assert.ok(apresFaux.find((x) => x.feed === "adsb")!.suspectJump);
  // Rien d'anormal pendant toute la fenêtre : la piste redevient saine.
  const tard = T0 + 10_000 + DUP_ADDR_WINDOW_MS + 1000;
  // 71 s a 720 km/h = ~14 km : un deplacement credible, sinon le relevé serait refusé lui aussi.
  const propre = mergeLiveTracks(apresFaux, [avion({ lon: 15.13 })], tard).tracks;
  const t = propre.find((x) => x.feed === "adsb")!;
  assert.equal(t.suspectJump, undefined);
  assert.equal(t.suspect, undefined);
});
