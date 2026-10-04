#!/usr/bin/env node
/**
 * Enregistre du VRAI trafic 1090ES (adsb.lol, adsb.fi en secours) sur les cellules africaines
 * d'AfriControl, pour l'archive de l'inject « REJEU RÉEL » (src/lib/vigilair/rejeu-archive.json).
 * Rien n'est inventé : chaque ligne est un squitter reçu par un agrégateur, horodaté à la seconde.
 *
 *   node scripts/rejeu-enregistrer.mjs [minutes=10] [pas_s=30]
 *
 * Écoute seule : le script lit des API publiques, il n'émet rien vers un aéronef.
 */
import { writeFileSync } from "node:fs";

const MINUTES = Number(process.argv[2] ?? 10);
const STEP_S = Number(process.argv[3] ?? 30);
const OUT = new URL("../src/lib/vigilair/rejeu-archive.json", import.meta.url);
const UA = "AfriControl-COP/rejeu (lecture seule)";
const NM = 250;

// Mêmes cellules que live-feeds.ts : théâtre d'abord, puis les zones couvertes du continent.
const CELLS = [
  [12.1348, 15.0557, "FTTJ"],
  [4.006, 9.719, "Douala"],
  [13.481, 2.184, "Niamey"],
  [15.589, 32.553, "Khartoum"],
  [36.7, 3.2, "Alger"],
  [36.8, 10.2, "Tunis"],
  [32.7, 13.2, "Tripoli"],
  [32.1, 20.1, "Benghazi"],
  [30.1, 31.4, "Le Caire"],
  [33.4, -7.6, "Casablanca"],
  [30.4, -9.6, "Agadir"],
  [-1.3, 36.9, "Nairobi"],
  [-26.1, 28.2, "Johannesburg"],
  [-29.9, 31.0, "Durban"],
  [-33.9, 18.6, "Le Cap"],
];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pull(lat, lon) {
  for (const base of ["https://api.adsb.lol/v2", "https://opendata.adsb.fi/api/v2"]) {
    try {
      const res = await fetch(`${base}/lat/${lat}/lon/${lon}/dist/${NM}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      return { at: Date.now(), list: j.ac ?? j.aircraft ?? [], base };
    } catch {
      /* cellule muette : on passe au secours */
    }
  }
  return null;
}

const ac = {};
const frames = [];
const heard = new Set();
const t0 = Date.now();
const end = t0 + MINUTES * 60_000;
while (Date.now() < end) {
  const tick = Date.now();
  const rows = new Map();
  for (const [lat, lon] of CELLS) {
    const got = await pull(lat, lon);
    await sleep(350);
    if (!got) continue;
    for (const r of got.list) {
      const hex = String(r.hex ?? "").toLowerCase().replace(/^~/, "");
      if (!/^[0-9a-f]{6}$/.test(hex)) continue;
      const la = num(r.lat);
      const lo = num(r.lon);
      const seen = num(r.seen_pos) ?? num(r.seen) ?? 0;
      if (la == null || lo == null || seen > 30) continue;
      const ground = r.alt_baro === "ground";
      const altFt = num(r.alt_baro) ?? num(r.alt_geom) ?? (ground ? 0 : null);
      if (altFt == null) continue;
      const at = Math.round(got.at - seen * 1000);
      const prev = rows.get(hex);
      if (prev && prev.at >= at) continue;
      const sq = typeof r.squawk === "string" && /^\d{4}$/.test(r.squawk) ? r.squawk : null;
      const em =
        (typeof r.emergency === "string" && r.emergency !== "none" ? r.emergency : null) ??
        (sq === "7700" || sq === "7600" || sq === "7500" ? sq : null);
      if (!ac[hex]) {
        // « @@@@@@@@ » = indicatif non transmis : on retombe sur l'immatriculation, puis l'adresse.
        const raw = String(r.flight ?? "").replace(/@/g, "").trim();
        const flight = (raw || String(r.r ?? hex)).toUpperCase().slice(0, 8);
        ac[hex] = [
          flight,
          typeof r.t === "string" && r.t ? r.t : null,
          typeof r.r === "string" && r.r ? r.r : null,
          typeof r.category === "string" ? r.category : null,
          (num(r.dbFlags) ?? 0) % 2 === 1 ? 1 : 0,
        ];
      }
      heard.add(hex);
      rows.set(hex, {
        at,
        row: [
          hex,
          r4(la),
          r4(lo),
          ground ? 0 : Math.round(altFt * 0.3048),
          Math.round((num(r.gs) ?? 0) * 1.852),
          Math.round(num(r.track) ?? num(r.true_heading) ?? 0) % 360,
          Math.round((num(r.baro_rate) ?? num(r.geom_rate) ?? 0) * 0.0508) / 10,
          sq,
          em,
          num(r.nic),
          num(r.nac_p),
          ground ? 1 : 0,
          // Décalage (s) entre la position et l'instant de l'image : la lecture en tient compte.
          0,
        ],
      });
    }
  }
  const at = Date.now();
  frames.push({
    at,
    rows: [...rows.values()].map(({ at: pa, row }) => {
      row[12] = Math.round((at - pa) / 1000);
      return row;
    }),
  });
  console.log(`${new Date(at).toISOString()} · image ${frames.length} · ${rows.size} avions · ${heard.size} entendus au total`);
  const wait = tick + STEP_S * 1000 - Date.now();
  if (wait > 0 && Date.now() + wait < end) await sleep(wait);
  else if (Date.now() + Math.max(0, wait) >= end) break;
}

const tape = {
  kind: "archive",
  source: "adsb.lol / adsb.fi · 15 cellules Afrique · enregistré par AfriControl",
  from: frames[0]?.at ?? t0,
  to: frames.at(-1)?.at ?? t0,
  ac,
  frames,
};
writeFileSync(OUT, JSON.stringify(tape));
console.log(`écrit ${OUT.pathname} · ${frames.length} images · ${Object.keys(ac).length} avions`);
