/**
 * Capteurs SOL du périmètre (caméra, barrière, radar…) — le cœur PUR : ce qu'un capteur a dit, ce
 * que le poste en affiche, ce qu'il en dit au chef.
 *
 * Un capteur n'est « OK » que s'il l'a dit LUI-MÊME il y a moins que son délai de silence. Jamais
 * entendu, il est « jamais entendu » ; au-delà du délai, MUET — câble coupé, courant, panne : qui
 * veut passer commence souvent par là. Personne ne pose son état à la main : un clic n'est pas une
 * mesure. Le poste reçoit ; il n'envoie rien au capteur.
 */

export type SensorType = "camera" | "barriere" | "radar" | "autre";
export type SensorState = "ok" | "alarme" | "hs";

export type MessageRecu = {
  etat: SensorState;
  /** Début de cet état : le message qui l'a dit le premier (redit, il garde son début). */
  depuis: number;
  /** Dernier message reçu. */
  at: number;
  /** Texte court du capteur (zone, voie…), nettoyé. */
  detail: string;
};

export type GroundSensor = {
  id: string;
  site: string;
  type: SensorType;
  name: string;
  /** Inscription. */
  at: number;
  /** Empreinte SHA-256 (hex) de la clé du capteur ; la clé elle-même n'est jamais gardée. */
  empreinteCle: string | null;
  /** Au-delà, sans message, le capteur est muet (secondes). */
  silenceS: number;
  recu: MessageRecu | null;
  /** Début de la dernière alarme dite par le capteur (null : jamais). */
  derniereAlarme: number | null;
};

export type CodeEtat = "jamais" | "muet" | SensorState;
export type EtatCapteur = { code: CodeEtat; depuis: number | null };

/** Ce que la console reçoit : rien de la clé, l'état lu par le serveur à son heure. */
export type GroundSensorVue = {
  id: string;
  site: string;
  type: SensorType;
  name: string;
  at: number;
  aCle: boolean;
  silenceS: number;
  etat: EtatCapteur;
  /** Dernier message reçu (null : jamais). */
  dernier: number | null;
  detail: string;
  derniereAlarme: number | null;
  /** L'avis de l'état présent, tel que le serveur le dit au chef (même id, même texte). */
  avis: Avis | null;
};

export type Avis = {
  /** Fixé par l'épisode : redit, il ne repart pas (voir dispatchChefAlert). */
  id: string;
  niveau: "elevee" | "moderee" | "info";
  titre: string;
  corps: string;
  /** Au relais du chef (Telegram, Signal) en plus du journal. */
  relayer: boolean;
};

export const SILENCE_DEFAUT_S = 120;
export const SILENCE_MIN_S = 10;
export const SILENCE_MAX_S = 86_400;
export const DETAIL_MAX = 120;
export const TYPES: SensorType[] = ["camera", "barriere", "radar", "autre"];
const ETATS: SensorState[] = ["ok", "alarme", "hs"];

const LIBELLE: Record<SensorType, string> = {
  camera: "Caméra",
  barriere: "Barrière",
  radar: "Radar",
  autre: "Capteur",
};

/** Le type en clair : « Barrière », pas « barriere ». */
export const libelleType = (t: SensorType) => LIBELLE[t];

export function etatCapteur(
  s: Pick<GroundSensor, "recu" | "silenceS">,
  maintenant: number,
): EtatCapteur {
  if (!s.recu) return { code: "jamais", depuis: null };
  if (maintenant - s.recu.at > s.silenceS * 1000) return { code: "muet", depuis: s.recu.at };
  return { code: s.recu.etat, depuis: s.recu.depuis };
}

/** Un délai de silence entier et borné ; illisible, le défaut. */
export function silenceValide(v: unknown): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return SILENCE_DEFAUT_S;
  return Math.min(SILENCE_MAX_S, Math.max(SILENCE_MIN_S, Math.round(n)));
}

/**
 * Caractères qui ne s'affichent pas ou retournent le texte : commandes, largeur nulle, contrôles
 * bidi. (Le BOM, U+FEFF, est déjà un espace pour \s, qui le resserre ensuite.)
 */
function invisible(k: number): boolean {
  return (
    k < 32 ||
    (k >= 0x7f && k < 0xa0) ||
    (k >= 0x200b && k <= 0x200f) ||
    (k >= 0x202a && k <= 0x202e) ||
    (k >= 0x2066 && k <= 0x2069)
  );
}

/** Texte court venu du capteur : sans caractère invisible, espaces resserrés, borné. */
export function nettoyerDetail(v: unknown): string {
  if (typeof v !== "string") return "";
  let t = "";
  for (const c of v) t += invisible(c.codePointAt(0)!) ? " " : c;
  return t.replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX);
}

export type Message = { id: string; etat: SensorState; detail: string };

/** Le message d'un capteur, tel qu'il arrive (paramètres d'URL, formulaire ou JSON). */
export function lireMessage(
  champs: Record<string, unknown>,
): { message: Message } | { erreur: string } {
  const id = typeof champs.id === "string" ? champs.id.trim() : "";
  if (!id || id.length > 80) return { erreur: "id du capteur requis" };
  const etat = typeof champs.etat === "string" ? champs.etat.trim().toLowerCase() : "";
  if (!(ETATS as string[]).includes(etat)) return { erreur: "etat : ok, alarme ou hs" };
  return { message: { id, etat: etat as SensorState, detail: nettoyerDetail(champs.detail) } };
}

/**
 * Le capteur après son message. Un état redit garde son début ; dit après un silence, c'est un
 * nouvel épisode (une alarme qui revient après une coupure est une nouvelle alarme).
 */
export function appliquerMessage(
  s: GroundSensor,
  m: Pick<Message, "etat" | "detail">,
  maintenant: number,
): GroundSensor {
  const meme = etatCapteur(s, maintenant).code === m.etat;
  return {
    ...s,
    recu: {
      etat: m.etat,
      depuis: meme ? s.recu!.depuis : maintenant,
      at: maintenant,
      detail: m.detail,
    },
    derniereAlarme: m.etat === "alarme" && !meme ? maintenant : s.derniereAlarme,
  };
}

const heure = (t: number) => `${new Date(t).toISOString().slice(11, 19)} Z`;

function ou(s: GroundSensor): string {
  const d = s.recu?.detail;
  return `${LIBELLE[s.type]} · ${s.site}${d ? ` · « ${d} »` : ""}`;
}

/**
 * L'avis de l'état présent (alarme, panne dite par le capteur, silence) ; aucun pour « OK » ou
 * « jamais entendu ». La veille du serveur et la réception le calculent : même épisode, même id.
 */
export function avisEtat(s: GroundSensor, maintenant: number): Avis | null {
  const e = etatCapteur(s, maintenant);
  if (e.code === "alarme") {
    return {
      id: `sol-${s.id}-alarme-${e.depuis}`,
      niveau: "elevee",
      titre: `Capteur sol en alarme · ${s.name}`,
      corps: `${ou(s)}. Dit par le capteur à ${heure(e.depuis!)}.`,
      relayer: true,
    };
  }
  if (e.code === "hs") {
    return {
      id: `sol-${s.id}-hs-${e.depuis}`,
      niveau: "moderee",
      titre: `Capteur sol hors service · ${s.name}`,
      corps: `${ou(s)}. Le capteur se dit en panne (${heure(e.depuis!)}).`,
      relayer: true,
    };
  }
  if (e.code === "muet") {
    return {
      id: `sol-${s.id}-muet-${e.depuis}`,
      niveau: "elevee",
      titre: `Capteur sol muet · ${s.name}`,
      corps:
        `${LIBELLE[s.type]} · ${s.site}. Rien reçu depuis ${heure(e.depuis!)} (délai de silence ` +
        `${s.silenceS} s) : câble, courant ou capteur, à voir sur place.`,
      relayer: true,
    };
  }
  return null;
}

/** Un capteur qui (re)dit « OK » : au journal seulement, avec ce qui précédait. */
export function avisRetour(s: GroundSensor, avant: CodeEtat, maintenant: number): Avis | null {
  const e = etatCapteur(s, maintenant);
  if (e.code !== "ok" || avant === "ok") return null;
  const quoi =
    avant === "jamais"
      ? "Premier message reçu"
      : avant === "muet"
        ? "Il reparle après un silence"
        : avant === "alarme"
          ? "Fin d'alarme dite par le capteur"
          : "Le capteur se dit réparé";
  return {
    id: `sol-${s.id}-ok-${e.depuis}`,
    niveau: "info",
    titre: `Capteur sol OK · ${s.name}`,
    corps: `${LIBELLE[s.type]} · ${s.site}. ${quoi} (${heure(e.depuis!)}).`,
    relayer: false,
  };
}

/** Ce que la console reçoit d'un capteur, à l'heure du serveur. */
export function vueCapteur(s: GroundSensor, maintenant: number): GroundSensorVue {
  return {
    id: s.id,
    site: s.site,
    type: s.type,
    name: s.name,
    at: s.at,
    aCle: s.empreinteCle !== null,
    silenceS: s.silenceS,
    etat: etatCapteur(s, maintenant),
    dernier: s.recu?.at ?? null,
    detail: s.recu?.detail ?? "",
    derniereAlarme: s.derniereAlarme,
    avis: avisEtat(s, maintenant),
  };
}

/**
 * Une alarme que la console n'a pas vue en cours (finie entre deux lectures, ou suivie d'un
 * silence) : même id que l'avis du serveur pour cet épisode.
 */
export function avisAlarmeVue(v: GroundSensorVue): Avis | null {
  if (v.derniereAlarme === null) return null;
  return {
    id: `sol-${v.id}-alarme-${v.derniereAlarme}`,
    niveau: "elevee",
    titre: `Capteur sol en alarme · ${v.name}`,
    corps: `${LIBELLE[v.type]} · ${v.site}. Alarme dite par le capteur à ${heure(v.derniereAlarme)}.`,
    relayer: true,
  };
}

const fini = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Un capteur relu du registre ; null s'il est illisible. Une fiche d'avant (« state » posé à la
 * main) perd cet état : ce n'était pas une mesure, et elle reste sans clé jusqu'à ce que le chef
 * lui en donne une.
 */
export function normaliserCapteur(raw: unknown): GroundSensor | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = texte(r.id, 80);
  const site = texte(r.site, 60);
  const name = texte(r.name, 60);
  if (!id || !site || !name) return null;
  const m = r.recu as Record<string, unknown> | null | undefined;
  const recu: MessageRecu | null =
    m &&
    typeof m === "object" &&
    (ETATS as unknown[]).includes(m.etat) &&
    fini(m.depuis) &&
    fini(m.at) &&
    m.depuis <= m.at
      ? {
          etat: m.etat as SensorState,
          depuis: m.depuis,
          at: m.at,
          detail: nettoyerDetail(m.detail),
        }
      : null;
  return {
    id,
    site,
    name,
    type: (TYPES as unknown[]).includes(r.type) ? (r.type as SensorType) : "autre",
    at: fini(r.at) ? r.at : 0,
    empreinteCle:
      typeof r.empreinteCle === "string" && /^[0-9a-f]{64}$/.test(r.empreinteCle)
        ? r.empreinteCle
        : null,
    silenceS: silenceValide(r.silenceS),
    recu,
    derniereAlarme: fini(r.derniereAlarme) ? r.derniereAlarme : null,
  };
}
