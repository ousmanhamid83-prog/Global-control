/**
 * Commandes du poste : un seul registre pour la console, l'agent IA et le bot Signal. Chaque
 * commande se règle PAR CANAL — activée ou non — et certaines partent désactivées : ce qui en
 * dirait trop par un téléphone (positions des contacts, marquage militaire). Le chef de division
 * les active sur demande ; l'effet est immédiat, sans redémarrage.
 *
 * Module pur, lu par la console et par le serveur : analyse d'une ligne « /commande argument »,
 * état des bascules, aide, et exécution des commandes qui ne lisent que l'image du poste. Elles
 * répondent en une fraction de milliseconde : aucune n'attend le réseau ni un modèle. Le reste
 * (notice, état des serveurs, IA, recherche) s'exécute côté serveur (commandes-poste.server).
 */
import { ORDRE, PAS_DE_RELEVE, enTeteReleve, faitsSujets, type Sujet } from "./faits-capteurs.ts";
import { AO, THEATER_LABEL, haversineKm } from "./geo.ts";
import type { LiveAc, LivePicture } from "./live-adsb.ts";
import { bearingDeg, cardinal } from "./nav.ts";

export type Canal = "console" | "bot";

export const LIBELLE_CANAL: Record<Canal, string> = {
  console: "la console",
  bot: "le bot Signal",
};

export type Commande = {
  nom: string;
  alias: string[];
  /** Ce que fait la commande, en une ligne. */
  resume: string;
  /** Argument attendu, pour l'aide : « <question> », « [nombre] ». */
  argument?: string;
  /** Activée à la livraison, par canal. */
  defaut: Record<Canal, boolean>;
  /** Ne se désactive pas : sans elle, on ne saurait plus rien activer. */
  fixe?: true;
};

const PARTOUT = { console: true, bot: true };
/**
 * À la console, pas par téléphone tant que le chef ne l'a pas voulu : positions et marquages des
 * contacts, et l'IA (lente, et elle lit tout le relevé).
 */
const CONSOLE_SEULE = { console: true, bot: false };
/** Ce qui fait sortir une requête du poste : nulle part tant que le chef ne l'a pas activé. */
const NULLE_PART = { console: false, bot: false };

export const COMMANDES: Commande[] = [
  {
    nom: "aide",
    alias: ["?", "commandes"],
    resume: "Les commandes de ce canal et leur état",
    argument: "[commande]",
    defaut: PARTOUT,
    fixe: true,
  },
  {
    nom: "situation",
    alias: ["point", "sit"],
    resume: "Vue d'ensemble du dernier relevé",
    defaut: PARTOUT,
  },
  { nom: "urgences", alias: ["7700"], resume: "Codes 7500, 7600 et 7700", defaut: PARTOUT },
  {
    nom: "trafic",
    alias: ["avions", "proches"],
    resume: "Contacts 1090 les plus proches du poste",
    argument: "[nombre]",
    defaut: CONSOLE_SEULE,
  },
  {
    nom: "piste",
    alias: ["contact"],
    resume: "Un contact, par indicatif ou adresse ICAO",
    argument: "<indicatif|adresse>",
    defaut: CONSOLE_SEULE,
  },
  {
    nom: "militaires",
    alias: ["mil"],
    resume: "Contacts marqués militaires",
    defaut: CONSOLE_SEULE,
  },
  {
    nom: "gnss",
    alias: ["gps", "brouillage"],
    resume: "Cellules GNSS dégradées (NIC/NACp)",
    defaut: PARTOUT,
  },
  { nom: "sigmet", alias: [], resume: "SIGMET touchant l'AO", defaut: PARTOUT },
  { nom: "meteo", alias: ["metar", "taf"], resume: "METAR et TAF de FTTJ", defaut: PARTOUT },
  {
    nom: "espace",
    alias: ["kp"],
    resume: "Météo spatiale : Kp, rayons X, alertes",
    defaut: PARTOUT,
  },
  {
    nom: "soleil",
    alias: ["nuit", "jour"],
    resume: "Lever, coucher et crépuscule civil à FTTJ",
    defaut: PARTOUT,
  },
  {
    nom: "phenomenes",
    alias: ["feux", "seismes"],
    resume: "Feux, séismes, crues… du théâtre",
    argument: "[nombre]",
    defaut: PARTOUT,
  },
  {
    nom: "capteurs",
    alias: ["etat", "sources"],
    resume: "État des sources et des serveurs du poste",
    defaut: PARTOUT,
  },
  {
    nom: "notice",
    alias: ["doc", "liremoi"],
    resume: "Ce que dit la notice du poste",
    argument: "<question>",
    defaut: PARTOUT,
  },
  {
    nom: "ia",
    alias: ["question", "assistant"],
    resume: "Question libre à l'IA du poste, qui consulte les commandes utiles",
    argument: "<question>",
    defaut: CONSOLE_SEULE,
  },
  {
    nom: "briefing",
    alias: ["brief"],
    resume: "Briefing de la situation rédigé par l'IA du poste",
    defaut: CONSOLE_SEULE,
  },
  {
    nom: "recherche",
    alias: ["web", "internet"],
    resume: "Recherche en ligne par le moteur SearXNG du poste (la requête sort du poste)",
    argument: "<requête>",
    defaut: NULLE_PART,
  },
];

/** Bascules réglées au poste ; une commande absente garde son réglage de livraison. */
export type Bascules = Record<string, Partial<Record<Canal, boolean>>>;

/** Ne garde du fichier que des bascules valides : commande connue, réglable, canal, booléen. */
export function basculesValides(brut: unknown): Bascules {
  const b: Bascules = {};
  if (!brut || typeof brut !== "object") return b;
  for (const c of COMMANDES) {
    if (c.fixe) continue;
    const r = (brut as Record<string, unknown>)[c.nom];
    if (!r || typeof r !== "object") continue;
    for (const canal of ["console", "bot"] as const) {
      const v = (r as Record<string, unknown>)[canal];
      if (typeof v === "boolean") (b[c.nom] ??= {})[canal] = v;
    }
  }
  return b;
}

export function commandeActive(c: Commande, canal: Canal, b: Bascules): boolean {
  return c.fixe === true || (b[c.nom]?.[canal] ?? c.defaut[canal]);
}

function normaliser(mot: string): string {
  return mot.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function trouverCommande(mot: string): Commande | undefined {
  const m = normaliser(mot);
  return COMMANDES.find((c) => c.nom === m || c.alias.includes(m));
}

export type Analyse = { commande: Commande; argument: string } | { inconnue: string };

/** « /meteo », « /Piste TST101 », « /? » ; null : la ligne n'est pas une commande. */
export function analyser(texte: string): Analyse | null {
  const t = texte.trim();
  if (!t.startsWith("/")) return null;
  const [mot = "", ...reste] = t.slice(1).split(/\s+/);
  const commande = trouverCommande(mot);
  return commande ? { commande, argument: reste.join(" ") } : { inconnue: mot };
}

/** Les commandes qui commencent par ce qui est tapé après « / », les activées d'abord. */
export function suggestions(texte: string, canal: Canal, b: Bascules): Commande[] {
  const t = texte.trimStart();
  if (!t.startsWith("/")) return [];
  const debut = normaliser(t.slice(1));
  const vues = COMMANDES.filter(
    (c) => c.nom.startsWith(debut) || c.alias.some((a) => a.startsWith(debut)),
  );
  return [
    ...vues.filter((c) => commandeActive(c, canal, b)),
    ...vues.filter((c) => !commandeActive(c, canal, b)),
  ];
}

function usage(c: Commande): string {
  return `/${c.nom}${c.argument ? ` ${c.argument}` : ""}`;
}

/** /aide : la liste du canal, ou le détail d'une commande. */
export function aide(argument: string, canal: Canal, b: Bascules): string[] {
  if (argument) {
    const c = trouverCommande(argument.replace(/^\//, ""));
    if (!c) return [`Commande inconnue : ${argument}. /aide pour la liste.`];
    return [
      `${usage(c)} — ${c.resume}.`,
      ...(c.alias.length ? [`Autres noms : ${c.alias.map((a) => `/${a}`).join(", ")}.`] : []),
      `Console : ${commandeActive(c, "console", b) ? "activée" : "désactivée"} · bot Signal : ${commandeActive(c, "bot", b) ? "activée" : "désactivée"}${c.fixe ? " (toujours)" : ""}.`,
    ];
  }
  const actives = COMMANDES.filter((c) => commandeActive(c, canal, b));
  const eteintes = COMMANDES.filter((c) => !commandeActive(c, canal, b));
  return [
    `Commandes de ${LIBELLE_CANAL[canal]} :`,
    ...actives.map((c) => `  ${usage(c)} — ${c.resume}`),
    ...(eteintes.length
      ? [
          `Désactivées au poste : ${eteintes.map((c) => `/${c.nom}`).join(", ")} (le chef de division les active).`,
        ]
      : []),
  ];
}

/** Un nombre entre 1 et `max`, sinon `defaut`. */
function nombre(argument: string, defaut: number, max: number): number {
  const n = Number.parseInt(argument, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : defaut;
}

function recu(pic: LivePicture, id: string): boolean {
  return pic.sources.some((s) => s.id === id && s.ok);
}

function ficheContact(a: LiveAc): string[] {
  const km = haversineKm(AO.centerLat, AO.centerLon, a.lat, a.lon);
  const cap = Math.round(bearingDeg(AO.centerLat, AO.centerLon, a.lat, a.lon));
  return [
    `${a.flight || "(sans indicatif)"} · adresse ${a.hex} · type ${a.icaoType ?? "?"} · immat ${a.reg ?? "?"}${a.military ? " · MIL" : ""}`,
    `À ${Math.round(km)} km de FTTJ, relèvement ${String(cap).padStart(3, "0")}° (${cardinal(cap)}) · ${a.onGround ? "au sol" : `FL${Math.round(a.altM / 30.48)}`}`,
    // En vol, 0 km/h veut dire « pas encore reçue » : l'antenne n'a pas eu le message de vitesse.
    !a.onGround && a.gsKmh === 0
      ? `Vitesse et route : pas encore reçues · NIC ${a.nic ?? "?"}`
      : `Vitesse ${Math.round(a.gsKmh)} km/h · route ${Math.round(a.track)}° · NIC ${a.nic ?? "?"}`,
    `Squawk ${a.squawk ?? "?"} · urgence : ${a.emergency ?? "aucune"}`,
    `Vu il y a ${Math.round(a.seenS)} s · ${a.via === "antenne" ? "par l'antenne du poste" : "par l'ADS-B Internet"}`,
  ];
}

function piste(argument: string, pic: LivePicture): string[] {
  const q = argument.trim().toUpperCase();
  if (!q) return ["/piste attend un indicatif ou une adresse ICAO : /piste AFR123, /piste 06a1f0."];
  const exact = pic.aircraft.find(
    (a) => a.flight.trim().toUpperCase() === q || a.hex.toUpperCase() === q,
  );
  if (exact) return ficheContact(exact);
  const proches = pic.aircraft.filter((a) => a.flight.trim().toUpperCase().startsWith(q));
  if (proches.length === 1) return ficheContact(proches[0]!);
  if (proches.length > 1) {
    return [
      `Plusieurs contacts commencent par « ${argument.trim()} » : ${proches
        .slice(0, 8)
        .map((a) => a.flight.trim())
        .join(", ")}. Préciser.`,
    ];
  }
  return [`Aucun contact « ${argument.trim()} » dans le dernier relevé.`];
}

function soleil(pic: LivePicture): string[] {
  const s = pic.solar;
  return [
    `Soleil à FTTJ (heure locale) : lever ${s.sunrise}, coucher ${s.sunset}.`,
    `Crépuscule civil : ${s.civilBegin} – ${s.civilEnd} · jour de ${Math.floor(s.dayLengthMin / 60)} h ${String(s.dayLengthMin % 60).padStart(2, "0")}.`,
    `En ce moment : ${s.nightOps ? "nuit" : "jour"}.`,
  ];
}

function phenomenes(argument: string, pic: LivePicture, maintenant: number): string[] {
  if (!recu(pic, "nat")) return ["Phénomènes (NASA, USGS, GDACS) : non reçus au dernier relevé."];
  const n = nombre(argument, 5, 15);
  const vus = pic.phenomena
    .filter((p) => p.theater !== "monde")
    .map((p) => ({ p, km: haversineKm(AO.centerLat, AO.centerLon, p.lat, p.lon) }))
    .sort((x, y) => x.km - y.km);
  if (vus.length === 0) return ["Phénomènes du théâtre : aucun au dernier relevé."];
  return [
    `Phénomènes du théâtre : ${vus.length}, les plus proches de FTTJ :`,
    ...vus.slice(0, n).map(({ p, km }) => {
      const h = Math.max(0, Math.round((maintenant - p.at) / 3_600_000));
      return `  ${p.kind} · ${p.title} · à ${Math.round(km)} km (${THEATER_LABEL[p.theater]}) · ${p.source} · il y a ${h} h`;
    }),
  ];
}

/** Les commandes de sujet portent le nom du sujet (/urgences, /meteo…). */
const SUJETS_COMMANDES = new Set<string>(ORDRE);

/**
 * Les commandes qui ne lisent que l'image du poste. `active` : la commande est-elle activée sur
 * ce canal (la /situation n'y montre que les sujets activés). undefined : pas une de celles-ci.
 */
export function executerImage(
  nom: string,
  argument: string,
  pic: LivePicture | null,
  maintenant: number,
  active: (nom: string) => boolean,
): string[] | undefined {
  const image = ["situation", "piste", "soleil", "phenomenes", ...ORDRE].includes(nom);
  if (!image) return undefined;
  if (!pic) return [PAS_DE_RELEVE];
  const tete = enTeteReleve(pic, maintenant);
  if (nom === "situation") {
    return [tete, ...faitsSujets(ORDRE.filter(active), pic, 3)];
  }
  if (nom === "trafic") return [tete, ...faitsSujets(["trafic"], pic, nombre(argument, 5, 20))];
  if (SUJETS_COMMANDES.has(nom)) return [tete, ...faitsSujets([nom as Sujet], pic, 5)];
  if (nom === "piste") return [tete, ...piste(argument, pic)];
  if (nom === "soleil") return soleil(pic);
  return [tete, ...phenomenes(argument, pic, maintenant)];
}

/** /capteurs : chaque source de l'image, en service ou non, avec son détail. */
export function lignesSources(pic: LivePicture | null, maintenant: number): string[] {
  if (!pic) return [PAS_DE_RELEVE];
  return [
    enTeteReleve(pic, maintenant),
    ...pic.sources.map((s) => `  ${s.ok ? "✔" : "✖"} ${s.label} : ${s.detail}`),
  ];
}
