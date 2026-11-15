// Vol d'essai sur le VRAI programme de vol ArduCopter, dans son simulateur (SITL) : le code du
// poste — le même que celui du serveur — fait décoller, déplace, arrête, fait patrouiller, pose et
// ramène le drone, et refuse ce qu'il doit refuser. Rien n'est simulé côté poste.
//
//   arducopter --model + --defaults copter.parm --home 12.1331,15.0339,295,0 -w &
//   node --experimental-strip-types scripts/drones/vol-simulateur.mjs tcp://127.0.0.1:5760
import assert from "node:assert/strict";

const liaison = process.argv[2] ?? "tcp://127.0.0.1:5760";
const { commander, etatDrone, synchroniserLiaisons } =
  await import("../../src/lib/vigilair/drones-liaison.server.ts");
const { liaisonVivante, nomMode, REGLAGES_DEFAUT } =
  await import("../../src/lib/vigilair/drones-pilotage.ts");
const { haversineKm } = await import("../../src/lib/vigilair/geo.ts");

const ID = "essai";
const CIRCUIT = {
  points: [
    { lat: 12.1345, lon: 15.0345 },
    { lat: 12.1345, lon: 15.036 },
  ],
  hauteurM: 40,
  tours: 2,
};
const debut = Date.now();
const dire = (...a) =>
  console.log(`[${((Date.now() - debut) / 1000).toFixed(1).padStart(6)} s]`, ...a);
const etat = () => etatDrone(ID);
const metres = (p, lat, lon) => haversineKm(p.lat, p.lon, lat, lon) * 1000;

async function attendre(quoi, vrai, maxS) {
  const t0 = Date.now();
  while (!vrai(etat())) {
    if (Date.now() - t0 > maxS * 1000) {
      throw new Error(`jamais : ${quoi} (en ${maxS} s) — ${JSON.stringify(etat())}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  dire(`✓ ${quoi} — en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const ordre = async (nom, p = {}) => {
  const r = await commander(ID, nom, p, CIRCUIT, REGLAGES_DEFAUT);
  dire(`${nom} →`, r.ok ? "envoyé :" : "PAS parti :", r.suite.join(" | "));
  return r;
};
const pose = (e) => !e.arme;
const enVolA = (h) => (e) => e.arme && Math.abs(e.position.hauteurM - h) < 1.5;

synchroniserLiaisons([{ id: ID, liaison }]);
await attendre(
  "liaison vivante, position, départ et GPS 3D reçus",
  (e) => liaisonVivante(e, Date.now()) && e.position && e.depart && e.gps?.fix >= 3,
  90,
);
{
  const e = etat();
  dire(
    `drone ${e.autopilote} ${e.engin}, mode ${nomMode(e)}, départ ${e.depart.lat.toFixed(4)},${e.depart.lon.toFixed(4)}, ${e.gps.satellites} satellites, batterie ${e.batteriePct} %`,
  );
  assert.deepEqual([e.autopilote, e.engin, e.arme], ["ardupilot", "multirotor", false]);
}

dire(
  "— AU SOL, MOTEURS COUPÉS : le drone accepterait tout sans rien faire ; le poste, lui, refuse",
);
for (const nom of ["aller", "patrouille", "stationnaire", "retour", "atterrir"]) {
  const r = await ordre(nom, { lat: 12.135, lon: 15.0359, hauteurM: 40 });
  assert.match(r.suite[0], /refusé par le poste : le drone est posé, moteurs coupés/);
}

dire("— DÉCOLLER à 30 m (tant que le drone refuse d'armer, il dit pourquoi)");
for (let essai = 1; ; essai++) {
  const r = await ordre("decoller", { hauteurM: 30 });
  if (r.ok) break;
  assert.ok(essai < 30, "le drone n'a jamais accepté d'armer");
  await new Promise((ok) => setTimeout(ok, 3000));
}
await attendre("à 30 m", enVolA(30), 60);
assert.equal(nomMode(etat()), "GUIDED");
assert.match((await ordre("decoller", { hauteurM: 30 })).suite[0], /moteurs déjà armés/);

dire("— ALLER : hors du rayon (3 km), trop haut — refusés par le poste ; puis à 300 m, à 40 m");
assert.match(
  (await ordre("aller", { lat: 12.18, lon: 15.0339, hauteurM: 40 })).suite[0],
  /au-delà du rayon permis \(3 km\)/,
);
assert.match(
  (await ordre("aller", { lat: 12.135, lon: 15.0359, hauteurM: 150 })).suite[0],
  /hauteur hors des bornes/,
);
assert.equal((await ordre("aller", { lat: 12.135, lon: 15.0359, hauteurM: 40 })).ok, true);
await attendre(
  "au point (moins de 3 m), à 40 m",
  (e) => metres(e.position, 12.135, 15.0359) < 3 && Math.abs(e.position.hauteurM - 40) < 1.5,
  120,
);

dire("— STATIONNAIRE en plein trajet : arrêt sur place, tenu 10 s");
assert.equal((await ordre("aller", { lat: 12.1331, lon: 15.0339, hauteurM: 40 })).ok, true);
await attendre("reparti (plus de 5 m/s)", (e) => e.position.vitesseMs > 5, 30);
assert.equal((await ordre("stationnaire")).ok, true);
await attendre(
  "arrêté (mode BRAKE, moins de 0,3 m/s)",
  (e) => nomMode(e) === "BRAKE" && e.position.vitesseMs < 0.3,
  30,
);
{
  const a = etat().position;
  await new Promise((r) => setTimeout(r, 10_000));
  const b = etat().position;
  const derive = metres(a, b.lat, b.lon);
  dire(
    `dérive en 10 s : ${derive.toFixed(2)} m, hauteur ${a.hauteurM.toFixed(1)} → ${b.hauteurM.toFixed(1)} m`,
  );
  assert.ok(derive < 2 && Math.abs(a.hauteurM - b.hauteurM) < 1);
  assert.ok(metres(b, 12.1331, 15.0339) > 50, "arrêté en route, pas arrivé");
}

dire("— PATROUILLE : 2 points, 2 tours, puis retour à la base de lui-même");
assert.equal((await ordre("patrouille")).ok, true);
const vus = [];
const suivi = setInterval(() => {
  const s = etat().pointMission;
  if (s !== vus.at(-1)) vus.push(s);
}, 100);
await attendre("mission en cours (mode AUTO)", (e) => nomMode(e) === "AUTO", 10);
await attendre("posé à la base, moteurs coupés", pose, 400);
clearInterval(suivi);
dire("points de mission suivis :", vus.join(" → "));
assert.match(vus.join(" "), /1 2 1 2 4/, "les deux tours puis le retour");
{
  const e = etat();
  const ecart = metres(e.position, e.depart.lat, e.depart.lon);
  dire(`posé à ${ecart.toFixed(2)} m de son départ`);
  assert.ok(ecart < 3);
}

dire("— ATTERRIR SUR PLACE : redécollé à 20 m, parti, posé où il est");
for (let essai = 1; !(await ordre("decoller", { hauteurM: 20 })).ok; essai++) {
  assert.ok(essai < 30);
  await new Promise((ok) => setTimeout(ok, 3000));
}
await attendre("à 20 m", enVolA(20), 60);
assert.equal((await ordre("aller", { lat: 12.1343, lon: 15.0339, hauteurM: 20 })).ok, true);
await attendre(
  "à plus de 60 m du départ",
  (e) => metres(e.position, e.depart.lat, e.depart.lon) > 60,
  60,
);
assert.equal((await ordre("atterrir")).ok, true);
await attendre("mode LAND", (e) => nomMode(e) === "LAND", 10);
await attendre("posé, moteurs coupés", pose, 120);
{
  const e = etat();
  const ecart = metres(e.position, e.depart.lat, e.depart.lon);
  dire(`posé à ${ecart.toFixed(0)} m de son départ (sur place, pas rentré)`);
  assert.ok(ecart > 55);
}

dire("— RETOUR À LA BASE : redécollé, parti à 200 m, rappelé");
for (let essai = 1; !(await ordre("decoller", { hauteurM: 25 })).ok; essai++) {
  assert.ok(essai < 30);
  await new Promise((ok) => setTimeout(ok, 3000));
}
await attendre("à 25 m", enVolA(25), 60);
{
  // Le départ est repris à chaque armement : le drone vient de s'armer là où il s'était posé.
  const d = etat().depart;
  assert.equal((await ordre("aller", { lat: d.lat + 0.0018, lon: d.lon, hauteurM: 25 })).ok, true);
  await attendre("à plus de 150 m du départ", (e) => metres(e.position, d.lat, d.lon) > 150, 90);
  assert.equal((await ordre("retour")).ok, true);
  await attendre("mode RTL", (e) => nomMode(e) === "RTL", 10);
  await attendre("posé, moteurs coupés", pose, 240);
  const ecart = metres(etat().position, d.lat, d.lon);
  dire(`rentré et posé à ${ecart.toFixed(2)} m de son départ`);
  assert.ok(ecart < 3);
}

dire(`VOL D'ESSAI RÉUSSI en ${((Date.now() - debut) / 1000).toFixed(0)} s`);
synchroniserLiaisons([]);
