/**
 * Le théâtre autour du poste, en GeoJSON : fleuves et lac, frontières, États et villes, mines,
 * eaux, routes du lac, axes depuis FTTJ, pics, route de navigation, zone GPS, METAR, SIGMET,
 * phénomènes, capture. Les données arrivent en paramètres (registres du poste) : ce module ne
 * fait que les mettre en forme ; la bibliothèque de cartographie les projette et les dessine.
 */
import { cercle, collection, type Collection, type Position, type Trait } from "./carte-donnees.ts";
import { nomPoint, nomTriangle } from "./carte-icones.ts";
import { formatRange } from "./geo.ts";

type LatLon = { lat: number; lon: number };
const pt = (q: LatLon, p: Trait["properties"]): Trait => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [q.lon, q.lat] },
  properties: p,
});
const trait = (pts: readonly LatLon[], p: Trait["properties"], fermer = false): Trait => {
  const c = pts.map((q) => [q.lon, q.lat] as Position);
  if (fermer && c.length > 2) c.push(c[0]!);
  return { type: "Feature", geometry: { type: "LineString", coordinates: c }, properties: p };
};
const surface = (pts: readonly LatLon[], p: Trait["properties"]): Trait => {
  const c = pts.map((q) => [q.lon, q.lat] as Position);
  c.push(c[0]!);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [c] }, properties: p };
};
const disque = (q: LatLon, km: number, p: Trait["properties"]): Trait => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [cercle(q.lat, q.lon, km)] },
  properties: p,
});

/** Frontières des États (Natural Earth, anneaux [lon, lat]) : coupées là où elles sautent l'antiméridien. */
export function frontieresGeo(pays: readonly { p: number[][][] }[]): Collection {
  const features: Trait[] = [];
  for (const c of pays) {
    for (const anneau of c.p) {
      let morceau: Position[] = [];
      let avant: number | null = null;
      for (const q of anneau) {
        const lon = q[0]!;
        if (avant !== null && Math.abs(lon - avant) > 170) {
          if (morceau.length > 1)
            features.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: morceau },
              properties: {},
            });
          morceau = [];
        }
        morceau.push([lon, q[1]!]);
        avant = lon;
      }
      if (morceau.length > 1)
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: morceau },
          properties: {},
        });
    }
  }
  return collection(features);
}

/** Les eaux de fond : fleuves Chari et Logone (tracés), lac Tchad (surface), enveloppe AES (tiretés). */
export function eauxGeo(o: {
  chari: readonly LatLon[];
  logone: readonly LatLon[];
  lac: readonly LatLon[];
  aes: readonly LatLon[];
}): Collection {
  return collection([
    trait(o.chari, { quoi: "fleuve", fort: true }),
    trait(o.logone, { quoi: "fleuve", fort: false }),
    surface(o.lac, { quoi: "lac" }),
    trait(o.aes, { quoi: "aes" }, true),
  ]);
}

/** Noms d'États (l'AES en clair) et villes du Sahel, par rang. */
export function nomsGeo(
  etats: readonly { name: string; lat: number; lon: number; aes?: boolean }[],
  villes: readonly { name: string; lat: number; lon: number; tier: number }[],
): Collection {
  return collection([
    ...etats.map((e) =>
      pt(e, {
        quoi: "etat",
        nom: e.aes ? `${e.name.toUpperCase()}\nAES` : e.name.toUpperCase(),
        aes: Boolean(e.aes),
      }),
    ),
    ...villes.map((v) =>
      pt(v, { quoi: "ville", nom: v.name, rang: v.tier, capitale: v.name === "N'Djamena" }),
    ),
  ]);
}

export type NiveauZone = "veille" | "trafic" | "approche" | "intrusion";

/** Les zones du poste (sites protégés, mines, zones posées) en cercles, avec leur niveau courant. */
export function zonesGeo(
  zones: readonly {
    id: string;
    name: string;
    lat: number;
    lon: number;
    radiusKm: number;
    armed: boolean;
  }[],
  niveau: (id: string) => NiveauZone,
): Collection {
  const features: Trait[] = [];
  for (const z of zones) {
    const n = niveau(z.id);
    features.push(disque(z, z.radiusKm, { id: z.id, niveau: n, arme: z.armed }));
    features.push(pt(z, { id: z.id, nom: z.name, niveau: n }));
  }
  return collection(features);
}

/** Les mines : leur rayon, leur repère, leur nom court (et la substance pour celle qui est suivie). */
export function minesGeo(
  mines: readonly {
    id: string;
    short: string;
    commodity: string;
    lat: number;
    lon: number;
    radiusKm: number;
  }[],
  o: { mineId: string | null; niveau: (id: string) => NiveauZone },
): Collection {
  const features: Trait[] = [];
  for (const m of mines) {
    const suivie = m.id === o.mineId;
    const n = o.niveau(m.id);
    features.push(disque(m, m.radiusKm, { id: m.id, suivie, niveau: n }));
    features.push(
      pt(m, {
        id: m.id,
        quoi: "mine",
        suivie,
        niveau: n,
        nom: suivie ? `${m.short} · ${m.commodity}` : m.short,
      }),
    );
  }
  return collection(features);
}

/** Axes depuis FTTJ : le trait, le bout, la distance (« Abéché 744 km »). */
export function axesGeo(
  depuis: LatLon,
  axes: readonly { id: string; short: string; lat: number; lon: number }[],
  o: { axisId: string | null; km: (a: { id: string; lat: number; lon: number }) => number },
): Collection {
  const features: Trait[] = [];
  for (const a of axes) {
    const choisi = a.id === o.axisId;
    features.push(trait([depuis, a], { id: a.id, choisi }));
    features.push(pt(a, { id: a.id, choisi, nom: `${a.short} ${formatRange(o.km(a))}` }));
  }
  return collection(features);
}

/** Routes du lac (pirogue en tireté, jet-ski plein), leurs étapes, et leur nom au milieu. */
export function routesLacGeo(
  routes: readonly { id: string; short: string; craft: string; waypoints: readonly LatLon[] }[],
  o: { routeId: string | null; km: (id: string) => number },
): Collection {
  const features: Trait[] = [];
  for (const r of routes) {
    const choisie = r.id === o.routeId;
    features.push(trait(r.waypoints, { id: r.id, choisie, jetski: r.craft === "jetski" }));
    for (const w of r.waypoints) features.push(pt(w, { id: r.id, choisie, quoi: "etape" }));
    const milieu = r.waypoints[Math.floor(r.waypoints.length / 2)]!;
    features.push(
      pt(milieu, {
        id: r.id,
        choisie,
        quoi: "nom",
        nom: `${r.craft === "jetski" ? "JET" : "PIR"} ${r.short} ${formatRange(o.km(r.id))}`,
      }),
    );
  }
  return collection(features);
}

/** La carte marine (sur demande) : cours d'eau tracés, lacs en cercle d'ordre de grandeur, repères. */
export function hydroGeo(
  eaux: readonly {
    id: string;
    short: string;
    lat: number;
    lon: number;
    radiusKm: number;
    circle: boolean;
    region: string;
    line?: readonly LatLon[];
  }[],
  o: { waterId: string | null; km: (id: string) => number },
): Collection {
  const features: Trait[] = [];
  for (const e of eaux) {
    const choisie = e.id === o.waterId;
    if (e.line && e.line.length > 1) {
      features.push(trait(e.line, { id: e.id, choisie }));
      const milieu = e.line[Math.floor(e.line.length / 2)]!;
      features.push(
        pt(milieu, {
          id: e.id,
          choisie,
          quoi: "nom",
          nom: `${e.short} ${formatRange(o.km(e.id))}`,
        }),
      );
      continue;
    }
    if (e.circle) features.push(disque(e, e.radiusKm, { id: e.id, choisie }));
    features.push(
      pt(e, { id: e.id, choisie, quoi: "repere", nom: e.short, tchad: e.region === "tchad" }),
    );
  }
  return collection(features);
}

/** Les pics : triangle (plein pour celui qui est choisi), nom et altitude. */
export function picsGeo(
  pics: readonly {
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevM: number;
    mark: boolean;
  }[],
  o: { peakId: string | null; couleur: string },
): Collection {
  return collection(
    pics.map((p) =>
      pt(p, {
        id: p.id,
        choisi: p.id === o.peakId,
        marque: p.mark,
        icone: nomTriangle(o.couleur, p.id === o.peakId),
        nom: `${p.name} ${p.elevM} m`,
      }),
    ),
  );
}

/** La route de navigation active : l'axe, les obstacles captés, les étapes (départ, ét. n, arrivée). */
export function routeNavGeo(
  route: { points: readonly LatLon[]; hazards: readonly LatLon[] } | null,
): Collection {
  if (!route || route.points.length < 2) return collection([]);
  const n = route.points.length;
  return collection([
    trait(route.points, { quoi: "axe" }),
    ...route.hazards.map((h) => pt(h, { quoi: "obstacle" })),
    ...route.points.map((q, i) =>
      pt(q, {
        quoi: "etape",
        bout: i === 0 || i === n - 1,
        nom: i === 0 ? "départ" : i === n - 1 ? "arrivée" : `ét.${i}`,
      }),
    ),
  ]);
}

/** La zone GPS posée par le chef : son cercle, son centre, son nom, sa passabilité et ses coordonnées. */
export function zoneGpsGeo(
  z: { lat: number; lon: number; radiusKm: number; nom: string; coord: string } | null,
): Collection {
  if (!z) return collection([]);
  return collection([
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: cercle(z.lat, z.lon, z.radiusKm, 20) },
      properties: {},
    },
    pt(z, { nom: `${z.nom}\n${z.coord}` }),
  ]);
}

/** Stations METAR (catégorie de vol), SIGMET du théâtre (polygones), phénomènes (feux VIIRS, séismes…). */
export function meteoGeo(
  metar: readonly { icao: string; cat?: string | null; lat?: number | null; lon?: number | null }[],
  sigmets: readonly { inAo: boolean; coords: readonly LatLon[] }[],
  couleurs: { ok: string; warn: string; crit: string },
): Collection {
  const features: Trait[] = [];
  for (const m of metar) {
    if (m.lat == null || m.lon == null) continue;
    const c =
      m.cat === "IFR" || m.cat === "LIFR"
        ? couleurs.crit
        : m.cat === "MVFR"
          ? couleurs.warn
          : couleurs.ok;
    features.push(
      pt(
        { lat: m.lat, lon: m.lon },
        {
          quoi: "metar",
          icao: m.icao,
          icone: nomPoint(c, 5),
          nom: `${m.icao} ${m.cat ?? ""}`.trim(),
        },
      ),
    );
  }
  for (const s of sigmets) {
    if (!s.inAo || s.coords.length < 3) continue;
    features.push(surface(s.coords, { quoi: "sigmet" }));
  }
  return collection(features);
}

export function phenomenesGeo(
  phenomenes: readonly {
    id: string;
    kind: string;
    source: string;
    title: string;
    lat: number;
    lon: number;
    level: string;
    theater: string;
  }[],
  o: { ageFeu: (id: string) => string; couleurs: { crit: string; warn: string; ice: string } },
): Collection {
  return collection(
    phenomenes.map((p) => {
      const feu = p.kind === "feu" && p.source === "NASA FIRMS";
      const c =
        p.level === "critique"
          ? o.couleurs.crit
          : p.level === "elevee"
            ? o.couleurs.warn
            : o.couleurs.ice;
      return pt(p, {
        id: p.id,
        feu,
        icone: feu ? "" : nomPoint(c, 6),
        nom: feu ? `VIIRS ${o.ageFeu(p.id)}` : p.title.slice(0, 28),
        monde: p.theater === "monde",
        fort: p.level === "critique" || p.level === "elevee",
      });
    }),
  );
}

/** Le monde : graticule de 30°, noms des continents, noms des États par rang (le Tchad en tête). */
export function mondeGeo(
  pays: readonly { n: string; lat: number; lon: number; a: number }[],
  extras: readonly { n: string; lat: number; lon: number; r: 1 | 2 | 3 }[],
  continents: readonly { name: string; lat: number; lon: number }[],
  o: { sauf: ReadonlySet<string>; rang: (n: string, a: number) => 1 | 2 | 3 },
): Collection {
  const features: Trait[] = [];
  for (let lat = -60; lat <= 75; lat += 30) {
    const pts: LatLon[] = [];
    for (let lon = -180; lon <= 180; lon += 8) pts.push({ lat, lon });
    features.push(trait(pts, { quoi: "graticule" }));
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const pts: LatLon[] = [];
    for (let lat = -80; lat <= 80; lat += 8) pts.push({ lat, lon });
    features.push(trait(pts, { quoi: "graticule" }));
  }
  for (const c of continents) features.push(pt(c, { quoi: "continent", nom: c.name }));
  for (const c of pays) {
    if (o.sauf.has(c.n)) continue;
    features.push(
      pt(c, { quoi: "etat", nom: c.n, rang: o.rang(c.n, c.a), tchad: c.n === "Tchad" }),
    );
  }
  for (const e of extras) features.push(pt(e, { quoi: "etat", nom: e.n, rang: e.r, tchad: false }));
  return collection(features);
}

/** Cellules où le GNSS des avions se dégrade (NIC reçu) : un disque de 90 km, plus vif quand c'est fort. */
export function brouillageGeo(
  cellules: readonly { lat: number; lon: number; level: string }[],
): Collection {
  return collection(
    cellules
      .filter((c) => c.level !== "low")
      .map((c) => disque(c, 90, { fort: c.level === "high" })),
  );
}

/** L'aérodrome FTTJ : sa piste 05/23 à sa vraie longueur (2,8 km), son repère et son nom (catégorie METAR). */
export function aeroportGeo(
  ap: LatLon,
  categorie: string | null,
  bout: (cap: number) => LatLon,
): Collection {
  return collection([
    trait([bout(50), bout(230)], { quoi: "piste" }),
    pt(ap, { quoi: "repere", nom: categorie ? `FTTJ ${categorie}` : "FTTJ" }),
  ]);
}

/** La scène ouverte au double-clic : son centre, son titre et son GSD, puis les objets mesurés de près. */
export function captureGeo(
  c: {
    lat: number;
    lon: number;
    title: string;
    gsd: string;
    objects: readonly {
      id: string;
      lat?: number | null;
      lon?: number | null;
      label: string;
      kind: string;
      resolvable: boolean;
    }[];
  } | null,
): Collection {
  if (!c) return collection([]);
  const features: Trait[] = [
    pt(c, { quoi: "centre", nom: `${c.title.slice(0, 22)}\nGSD ${c.gsd}` }),
  ];
  for (const o of c.objects) {
    if (!o.resolvable || o.lat == null || o.lon == null) continue;
    if (o.id === "gsd" || o.id === "mgrs" || o.id === "land") continue;
    features.push(
      pt({ lat: o.lat, lon: o.lon }, { quoi: "objet", genre: o.kind, nom: o.label.slice(0, 22) }),
    );
  }
  return collection(features);
}

/**
 * Ce que l'analyse des pixels de l'image a mesuré au centre (de près, imagerie visible) : gabarits
 * d'homme, de voiture, de pirogue, et foyers chauds. Un repère par objet mesuré, avec sa classe.
 */
export function pixelsGeo(
  scan: {
    hits: readonly { id: string; lat: number; lon: number; cls: string }[];
    fires: readonly { kind: string; lat: number; lon: number }[];
  },
  o: { classe: (cls: string) => string; ageFeu: (id: string) => string },
): Collection {
  const features: Trait[] = [];
  for (const h of scan.hits) {
    const tag = h.id === "voiture" ? "V" : h.id === "pirogue" ? "P" : "H";
    features.push(pt(h, { feu: false, nom: `${tag} ${o.classe(h.cls)}` }));
  }
  for (const f of scan.fires) {
    const id = `px-${f.lat.toFixed(3)}-${f.lon.toFixed(3)}`;
    features.push(
      pt(f, {
        feu: true,
        id,
        nom: `${f.kind === "vehicule" ? "feu voiture" : "feu"} ${o.ageFeu(id)}`,
      }),
    );
  }
  return collection(features);
}
