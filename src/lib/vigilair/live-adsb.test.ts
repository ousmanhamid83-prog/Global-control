import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLiveAc, jamFromAircraft, mergeLiveTracks, type LiveAc } from "./live-adsb.ts";
import { DEFAULT_COAST_CFG, DUP_ADDR_WINDOW_MS, FRESH_S } from "./coast.ts";
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
    posSource: "adsb",
    rcM: null,
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

/* ── RECALAGE D'ÂGE ──────────────────────────────────────────────────────────────────────────────
 * Mesuré sur 881 avions réels (api.adsb.lol) : l'âge des positions est de 0,1 s en médiane, mais
 * 3,1 % des pistes dépassent 30 s et la pire était à 2,65 km de là où AfriControl la dessinait.
 * La moyenne était donc rassurante et la QUEUE fausse — c'est elle qu'on corrige.
 */

test("RECALAGE D'ÂGE : une position vieille de 20 s est AVANCÉE, plus affichée telle quelle", () => {
  const t = mergeLiveTracks([], [avion({ seenS: 20 })], T0).tracks[0]!;
  // 720 km/h x 20 s = 4 km : c'est de cette distance que le symbole était faux, en silence.
  const ecart = haversineKm(12, 15, t.lat, t.lon);
  assert.ok(Math.abs(ecart - 4) < 0.1, `attendu ~4 km de recalage, obtenu ${ecart.toFixed(2)} km`);
  // La mesure BRUTE est conservée : elle seule permet de comparer deux relevés.
  assert.ok(t.fix, "la mesure brute doit être gardée");
  assert.ok(Math.abs(t.fix!.lat - 12) < 1e-9 && Math.abs(t.fix!.lon - 15) < 1e-9);
});

test("RECALAGE D'ÂGE : lastUpdate est l'heure d'OBSERVATION, pas celle de réception", () => {
  const t = mergeLiveTracks([], [avion({ seenS: 20 })], T0).tracks[0]!;
  assert.equal(t.lastUpdate, T0 - 20_000);
  assert.equal(t.fix!.at, T0 - 20_000);
  // Une piste déjà vieille de 20 s est tenue en mémoire dès son premier relevé : c'est précisément
  // ce qu'un transpondeur coupé produit, et ça passait pour un retour vivant.
  assert.equal(t.coast?.silentS, 20);
});

test("RECALAGE D'ÂGE : une position fraîche est recalée aussi, mais sans mention au scope", () => {
  const t = mergeLiveTracks([], [avion({ seenS: FRESH_S - 3 })], T0).tracks[0]!;
  const ecart = haversineKm(12, 15, t.lat, t.lon);
  assert.ok(Math.abs(ecart - 0.4) < 0.05, `2 s à 720 km/h = 0,4 km, obtenu ${ecart.toFixed(2)}`);
  assert.equal(t.coast, undefined, "en deçà du seuil on n'encombre pas le scope");
});

test("RECALAGE D'ÂGE : l'âge n'est PAS compté deux fois d'un relevé à l'autre", () => {
  // Deux relevés de même âge, 20 s d'écart, avion qui avance normalement de 4 km vers l'est.
  const un = mergeLiveTracks([], [avion({ seenS: 20 })], T0).tracks;
  const deux = mergeLiveTracks(un, [avion({ seenS: 20, lon: 15.03673 })], T0 + 20_000).tracks;
  const t = deux.find((x) => x.feed === "adsb")!;
  // Le symbole a avancé de 4 km (le vrai déplacement), pas de 8 : partir de la position AFFICHÉE
  // au lieu de la mesure l'aurait éjecté en avant un peu plus à chaque tour.
  const avance = haversineKm(un[0]!.lat, un[0]!.lon, t.lat, t.lon);
  assert.ok(Math.abs(avance - 4) < 0.15, `attendu ~4 km d'avance, obtenu ${avance.toFixed(2)} km`);
  assert.equal(t.coast?.silentS, 20, "le silence ne doit pas s'accumuler : l'âge est constant");
  assert.equal(t.suspectJump, undefined, "un déplacement normal ne doit pas passer pour un saut");
});

test("PLAUSIBILITÉ : deux relevés d'ÂGES différents ne fabriquent pas un faux saut", () => {
  // Le cas réel qui faisait refuser du bon trafic : premier relevé déjà vieux de 30 s, second tout
  // frais 10 s plus tard. Vrai intervalle d'observation = 40 s, donc 8 km à 720 km/h : normal.
  // En comparant sur l'intervalle entre RÉCEPTIONS (10 s), on lisait 2880 km/h — et on refusait.
  const un = mergeLiveTracks([], [avion({ seenS: 30 })], T0).tracks;
  const deux = mergeLiveTracks(un, [avion({ seenS: 0, lon: 15.07346 })], T0 + 10_000).tracks;
  const t = deux.find((x) => x.feed === "adsb")!;
  assert.equal(t.suspectJump, undefined, "ce relevé est crédible, il ne doit pas être refusé");
  assert.ok(Math.abs(t.lon - 15.07346) < 1e-6, "la position mesurée doit être adoptée");
  assert.equal(t.coast, undefined, "relevé frais : la piste n'est plus tenue en mémoire");
});

/* ── CACHE : une image resservie ne doit pas RAJEUNIR ses positions ───────────────────────────── */

test("CACHE : l'âge de l'image s'ajoute à l'âge déclaré des positions", () => {
  // L'image réseau est gardée 20 s. La resservir telle quelle annoncerait « vu à l'instant » une
  // position qui a en réalité 20 s de plus — et le recalage d'âge sous-corrigerait d'autant.
  const avant = [avion({ seenS: 3 }), avion({ hex: "abc123", seenS: 0 })];
  const apres = ageLiveAc(avant, 20);
  assert.equal(apres[0]!.seenS, 23);
  assert.equal(apres[1]!.seenS, 20);
  // Le lot d'origine n'est pas modifié : un cache partagé ne doit pas vieillir à chaque lecture.
  assert.equal(avant[0]!.seenS, 3);
});

test("CACHE : les avions de NOTRE antenne ne vieillissent pas avec le cache réseau", () => {
  // Ils sont relevés à chaque appel : les vieillir les rejetterait dans le passé sans raison.
  const lot = [avion({ via: "antenne", seenS: 2 }), avion({ hex: "abc123", via: "reseau", seenS: 2 })];
  const apres = ageLiveAc(lot, 20);
  assert.equal(apres[0]!.seenS, 2, "antenne : inchangé");
  assert.equal(apres[1]!.seenS, 22, "réseau : vieilli");
});

test("CACHE : une image fraîche ne change rien", () => {
  const lot = [avion({ seenS: 4 })];
  assert.equal(ageLiveAc(lot, 0), lot, "même référence : aucune copie inutile");
  assert.equal(ageLiveAc(lot, -1), lot, "un âge négatif ne rajeunit personne");
});

test("CACHE : le recalage de position tient compte de l'âge du cache", () => {
  // Bout en bout : position relevée il y a 0 s, mais servie depuis un cache de 20 s. Le symbole
  // doit avancer de 4 km (720 km/h × 20 s), pas rester sur la mesure.
  const [vieilli] = ageLiveAc([avion({ seenS: 0 })], 20);
  const t = mergeLiveTracks([], [vieilli!], T0).tracks[0]!;
  const ecart = haversineKm(12, 15, t.lat, t.lon);
  assert.ok(Math.abs(ecart - 4) < 0.1, `attendu ~4 km, obtenu ${ecart.toFixed(2)} km`);
  assert.equal(t.lastUpdate, T0 - 20_000, "l'heure d'observation remonte à avant le cache");
});

/* ── CONFIANCE D'IDENTIFICATION : plus de 99 % tapé en dur ────────────────────────────────────── */

test("CONFIANCE : un type inconnu n'affiche plus 99 %", () => {
  // Le défaut mesuré à l'écran d'accueil : 131 pistes réelles toutes à 99 %, types inconnus compris.
  const t = mergeLiveTracks([], [avion({ icaoType: null })], T0).tracks[0]!;
  assert.ok(t.confidence < 99, `obtenu ${t.confidence}`);
  assert.match(t.confidenceNote ?? "", /type inconnu/);
});

test("CONFIANCE : un type déclaré au registre reste haut, et le dit", () => {
  const t = mergeLiveTracks([], [avion({ icaoType: "A388" })], T0).tracks[0]!;
  assert.ok(t.confidence >= 90, `obtenu ${t.confidence}`);
  assert.match(t.confidenceNote ?? "", /type déclaré/);
  assert.equal(t.hypotheses[0]!.score, t.confidence, "hypothèse et confiance ne divergent pas");
});

test("CONFIANCE : un doublon d'adresse ICAO la fait CHUTER, même avec un type déclaré", () => {
  // Deux émetteurs qui alternent : on ne sait plus lequel on regarde. 95 % serait un mensonge.
  let etat = mergeLiveTracks([], [avion({ icaoType: "A388" })], T0).tracks;
  let lon = 15.0;
  for (let i = 1; i <= 8; i++) {
    lon += 0.018;
    const faux = i % 2 === 1;
    etat = mergeLiveTracks(
      etat,
      [faux ? avion({ icaoType: "A388", lat: 14.7, lon }) : avion({ icaoType: "A388", lon })],
      T0 + i * 10_000,
    ).tracks;
  }
  const t = etat.find((x) => x.feed === "adsb")!;
  assert.ok(t.confidence <= 30, `attendu ≤ 30 avec un doublon, obtenu ${t.confidence}`);
  assert.match(t.confidenceNote ?? "", /adresse ICAO douteuse/);
});

test("CONFIANCE : elle se RÉTABLIT une fois l'épisode refermé — un chiffre qui bouge", () => {
  const apresFaux = mergeLiveTracks(
    mergeLiveTracks([], [avion({ icaoType: "A388" })], T0).tracks,
    [avion({ icaoType: "A388", lat: 14.7 })],
    T0 + 10_000,
  ).tracks;
  const pendant = apresFaux.find((x) => x.feed === "adsb")!.confidence;
  const tard = T0 + 10_000 + DUP_ADDR_WINDOW_MS + 1000;
  const propre = mergeLiveTracks(apresFaux, [avion({ icaoType: "A388", lon: 15.13 })], tard).tracks;
  const apres = propre.find((x) => x.feed === "adsb")!.confidence;
  assert.ok(apres > pendant, `pendant ${pendant} → après ${apres} : la confiance doit remonter`);
});

/* ── INTÉGRITÉ DE POSITION, BRANCHÉE SUR L'INGESTION ───────────────────────────────────────────── */

test("INTÉGRITÉ : le rayon annoncé par l'aéronef arrive jusqu'à la piste", () => {
  const t = mergeLiveTracks([], [avion({ rcM: 926, nic: 6 })], T0).tracks[0]!;
  assert.ok(Math.abs((t.posRcKm ?? 0) - 0.926) < 1e-9, `obtenu ${t.posRcKm}`);
  assert.match(t.posRcNote ?? "", /rayon annoncé/);
  assert.equal(t.posSource, "adsb");
});

test("INTÉGRITÉ : une piste MLAT n'est pas peinte comme un point exact", () => {
  // 102 pistes réelles annoncent rc = 0, dont 89 en MLAT. Les lire comme exactes inverserait
  // le classement de précision du scope.
  const t = mergeLiveTracks([], [avion({ posSource: "mlat", rcM: 0, nic: 0 })], T0).tracks[0]!;
  assert.ok((t.posRcKm ?? 0) > 1, `une position calculée doit porter un rayon franc, obtenu ${t.posRcKm}`);
  assert.match(t.posRcNote ?? "", /multilatération/);
  assert.equal(t.posSource, "mlat");
});

test("INTÉGRITÉ : sans `rc`, le rayon est déduit du NIC", () => {
  const t = mergeLiveTracks([], [avion({ rcM: null, nic: 7 })], T0).tracks[0]!;
  assert.ok(Math.abs((t.posRcKm ?? 0) - 0.37) < 1e-9, `obtenu ${t.posRcKm}`);
  assert.match(t.posRcNote ?? "", /NIC 7/);
});

test("ALTITUDE : recalée de l'âge du relevé, et bornée si le taux est aberrant", () => {
  // Descente à 8,78 m/s vue avec 42 s de retard : l'avion est ~369 m plus bas qu'annoncé.
  const bas = mergeLiveTracks([], [avion({ altM: 2000, climbMs: -8.78, seenS: 42 })], T0).tracks[0]!;
  assert.ok(Math.abs(bas.altM - (2000 - 368.8)) < 2, `obtenu ${bas.altM}`);
  // Taux aberrant relevé en vrai (+169 m/s) : borné, sinon on AJOUTERAIT de l'erreur.
  const fou = mergeLiveTracks([], [avion({ altM: 900, climbMs: 169, seenS: 10 })], T0).tracks[0]!;
  assert.ok(fou.altM <= 900 + 80 * 10, `le taux doit être borné, obtenu ${fou.altM}`);
});

test("FAUX BROUILLAGE : les pistes MLAT ne nourrissent plus la carte de brouillage", () => {
  // Le bug mesuré : 89 pistes MLAT (nic = 0) produisaient 8 des 9 cellules de « brouillage élevé »
  // d'un relevé réel. Ici une cellule entièrement MLAT ne doit produire aucune cellule du tout.
  const mlat = Array.from({ length: 20 }, (_, i) =>
    avion({ hex: `m${i.toString().padStart(5, "0")}`, posSource: "mlat", nic: 0, lat: 12.1, lon: 15.1 }),
  );
  assert.equal(jamFromAircraft(mlat).length, 0, "aucune cellule : rien n'a émis de position");
  // Le même nombre d'ADS-B réellement dégradés, lui, doit bien ressortir.
  const degrades = Array.from({ length: 20 }, (_, i) =>
    avion({ hex: `a${i.toString().padStart(5, "0")}`, posSource: "adsb", nic: 2, lat: 12.1, lon: 15.1 }),
  );
  const cells = jamFromAircraft(degrades);
  assert.equal(cells.length, 1);
  assert.equal(cells[0]!.level, "high");
  assert.equal(cells[0]!.bad, 20);
});

test("FAUX BROUILLAGE : un pourcentage tiré de 2 avions n'est plus publié", () => {
  // « 1 dégradé sur 2 = 50 % de brouillage » est du bruit présenté comme un fait. 7 cellules sur
  // 28 du lot réel comptent moins de 10 aéronefs.
  const deux = [
    avion({ hex: "aa0001", nic: 2, lat: 12.1, lon: 15.1 }),
    avion({ hex: "aa0002", nic: 8, lat: 12.1, lon: 15.1 }),
  ];
  assert.equal(jamFromAircraft(deux).length, 0, "échantillon trop maigre : on se taît");
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
