import { test } from "node:test";
import assert from "node:assert/strict";
import {
  altAged,
  broadcastsPosition,
  declaredRcKm,
  gnssDegraded,
  JAM_MIN_SAMPLE,
  MLAT_RC_KM,
  NIC_DEGRADED,
  posSourceOf,
  RC_M_BY_NIC,
  totalUncertaintyKm,
} from "./integrity.ts";

/* Les valeurs de ces tests ne sont pas inventées : elles viennent d'un relevé réel de 881 avions
 * (api.adsb.lol), où le champ `rc` de l'agrégateur confirme la table DO-260B au mètre près. */

test("PROVENANCE : on distingue une position ÉMISE d'une position CALCULÉE", () => {
  assert.equal(posSourceOf("adsb_icao"), "adsb");
  assert.equal(posSourceOf("adsb_icao_nt"), "adsb");
  assert.equal(posSourceOf("adsb_other"), "adsb");
  assert.equal(posSourceOf("mlat"), "mlat");
  assert.equal(posSourceOf("mode_s"), "modes");
  assert.equal(posSourceOf(null), "autre");
  assert.equal(posSourceOf("quelque_chose_de_neuf"), "autre");
  // Seule une position émise porte un NIC : c'est la distinction dont tout le reste dépend.
  assert.equal(broadcastsPosition("adsb"), true);
  assert.equal(broadcastsPosition("mlat"), false);
  assert.equal(broadcastsPosition("modes"), false);
  assert.equal(broadcastsPosition("autre"), false);
});

test("TABLE NIC : les valeurs correspondent au champ `rc` réel de l'agrégateur", () => {
  // Couples (NIC, rc en m) relevés tels quels sur le trafic réel.
  for (const [nic, rc] of [[11, 8], [10, 25], [9, 75], [8, 186], [7, 371], [6, 926], [3, 7408]]) {
    const attendu = RC_M_BY_NIC[nic!]!;
    assert.ok(
      Math.abs(attendu - rc!) <= 1,
      `NIC ${nic} : table ${attendu} m, agrégateur ${rc} m`,
    );
  }
});

test("PIÈGE rc = 0 : « inconnu » ne doit PAS être lu comme « rayon nul »", () => {
  // 102 pistes réelles ont rc = 0. Ce sont les PIRES du lot ; les lire comme exactes inverserait
  // complètement le classement de précision du scope.
  const v = declaredRcKm({ rcM: 0, nic: 0, posSource: "mlat" });
  assert.notEqual(v.km, 0, "rc = 0 ne doit pas donner un rayon nul");
  assert.equal(v.km, MLAT_RC_KM);
  const sansRien = declaredRcKm({ rcM: 0, nic: 0, posSource: "adsb" });
  assert.equal(sansRien.km, null, "faute de tout, on dit qu'on ne sait pas");
  assert.match(sansRien.note, /non annoncée/);
});

test("RAYON : le chiffre de l'agrégateur prime sur la table", () => {
  const v = declaredRcKm({ rcM: 926, nic: 6, posSource: "adsb" });
  assert.ok(Math.abs(v.km! - 0.926) < 1e-9);
  assert.match(v.note, /rayon annoncé/);
});

test("RAYON : sans `rc`, la table NIC sert de repli", () => {
  const v = declaredRcKm({ rcM: null, nic: 7, posSource: "adsb" });
  assert.ok(Math.abs(v.km! - 0.37) < 1e-9);
  assert.match(v.note, /NIC 7/);
});

test("RAYON : une piste MLAT reçoit un plancher prudent, pas une fausse précision", () => {
  const v = declaredRcKm({ rcM: 0, nic: null, posSource: "mlat" });
  assert.equal(v.km, MLAT_RC_KM);
  assert.match(v.note, /multilatération/);
  assert.ok(MLAT_RC_KM > RC_M_BY_NIC[8]! / 1000, "le MLAT doit être moins précis qu'un bon ADS-B");
});

test("FAUX BROUILLAGE : une piste MLAT n'est PAS un GNSS dégradé", () => {
  // Le bug mesuré : 89 pistes MLAT (nic = 0) comptaient comme brouillage, et produisaient 8 des
  // 9 cellules de « brouillage élevé » du lot réel. Elles n'émettent aucune position.
  assert.equal(gnssDegraded({ nic: 0, nacp: null, posSource: "mlat" }), false);
  assert.equal(gnssDegraded({ nic: 0, nacp: null, posSource: "modes" }), false);
  // En revanche un ADS-B qui annonce lui-même un NIC bas, c'est bien le signal qu'on cherche.
  assert.equal(gnssDegraded({ nic: 3, nacp: null, posSource: "adsb" }), true);
  assert.equal(gnssDegraded({ nic: 0, nacp: null, posSource: "adsb" }), true);
});

test("BROUILLAGE : un NIC sain ne déclenche rien, et NACp compte aussi", () => {
  assert.equal(gnssDegraded({ nic: 8, nacp: 9, posSource: "adsb" }), false);
  assert.equal(gnssDegraded({ nic: NIC_DEGRADED, nacp: null, posSource: "adsb" }), false);
  assert.equal(gnssDegraded({ nic: NIC_DEGRADED - 1, nacp: null, posSource: "adsb" }), true);
  assert.equal(gnssDegraded({ nic: 8, nacp: 0, posSource: "adsb" }), true);
  // Rien d'annoncé du tout : on ne conclut pas.
  assert.equal(gnssDegraded({ nic: null, nacp: null, posSource: "adsb" }), false);
});

test("INCERTITUDE TOTALE : déclarée et extrapolée se composent en quadrature", () => {
  // 3 km déclarés + 4 km d'extrapolation = 5 km, pas 7 : les deux causes sont indépendantes.
  assert.ok(Math.abs(totalUncertaintyKm(3, 4) - 5) < 1e-9);
  assert.equal(totalUncertaintyKm(null, null), 0);
  assert.equal(totalUncertaintyKm(2, null), 2);
  assert.equal(totalUncertaintyKm(null, 2), 2);
  // Le total ne peut jamais être inférieur à la plus grande des deux causes.
  const t = totalUncertaintyKm(0.185, 4);
  assert.ok(t >= 4, `total ${t} doit couvrir au moins l'extrapolation`);
});

test("ALTITUDE : recalée de l'âge du relevé", () => {
  // Cas réel du lot : -1728 ft/min (-8,78 m/s) avec 42 s d'âge → 370 m plus bas qu'affiché.
  const descente = altAged(2000, -8.78, 42, 80);
  assert.ok(Math.abs(descente - (2000 - 368.8)) < 1, `obtenu ${descente}`);
  assert.equal(altAged(2000, 0, 42, 80), 2000, "sans taux de montée, rien à corriger");
  assert.equal(altAged(2000, -5, 0, 80), 2000, "sans âge, rien à corriger");
});

test("ALTITUDE : un taux de montée ABERRANT est borné, pas appliqué", () => {
  // Relevé réel : +33 245 ft/min = 169 m/s. Rien ne monte à cette vitesse ; appliquer tel quel
  // ajouterait 101 m d'erreur à une piste qui n'en avait pas. On borne au crédible.
  const borne = altAged(900, 169, 10, 80);
  assert.equal(borne, 900 + 80 * 10, "le taux doit être ramené au maximum crédible");
  const bas = altAged(900, -169, 10, 80);
  assert.equal(bas, Math.max(0, 900 - 80 * 10));
});

test("ALTITUDE : jamais négative", () => {
  assert.equal(altAged(50, -20, 30, 80), 0, "un avion ne descend pas sous le sol");
});

test("ÉCHANTILLON : le seuil de cellule écarte les pourcentages tirés de 2 avions", () => {
  // 7 cellules sur 28 du lot réel comptent moins de 10 aéronefs. « 1 sur 2 = 50 % de brouillage »
  // est du bruit présenté comme un fait.
  assert.ok(JAM_MIN_SAMPLE >= 5, "un pourcentage sur moins de 5 avions ne veut rien dire");
});
