/**
 * Mise à l'abri — sûreté des travailleurs. Module DÉFENSIF : il sert à mettre les employés à
 * couvert et à les compter, jamais à pister ni à désigner qui que ce soit. Aucune donnée ne sort
 * du poste : tout vit en local (localStorage), pour fonctionner sur un site isolé sans réseau.
 *
 * Trois états : normal → alerte (« à couvert ») → levée (« tout est clair ») → normal.
 */

export type AbriState = "normal" | "alerte" | "levee";

/** Statut d'un employé pendant une alerte. « manque » = pas encore pointé, à aller chercher. */
export type WorkerStatus = "present" | "abri" | "manque" | "detresse";

export type Site = {
  id: string;
  name: string;
  /** Où se mettre à l'abri sur ce site (texte clair). */
  shelter: string;
  /** Point de regroupement après la levée. */
  muster: string;
  note: string;
};

export type Worker = { id: string; name: string; siteId: string; status: WorkerStatus; at: number };

export type AbriConfig = { sites: Site[]; workers: Worker[] };

export type AbriEvent = {
  at: number;
  kind: "alerte" | "levee" | "detresse" | "exercice" | "abri" | "manque" | "present";
  by: string;
  site?: string;
  worker?: string;
  note?: string;
};

export type AbriSession = {
  state: AbriState;
  since: number;
  /** Exercice : même déroulé, mais tout le monde sait que c'est un entraînement. */
  drill: boolean;
  /** Mode discret : écran sombre, pas de son ni de lumière qui trahit une position. */
  discreet: boolean;
  /** Raison saisie par le chef (texte libre). */
  reason: string;
  /** Site concerné, ou null = tous les sites. */
  siteId: string | null;
  log: AbriEvent[];
};

const CONFIG_KEY = "africontrol.abri.config.v1";
const SESSION_KEY = "africontrol.abri.session.v1";
const LOG_MAX = 200;

export function defaultConfig(): AbriConfig {
  // Modèle à adapter : le chef renomme ses sites et son équipe. Pas de vraies coordonnées requises.
  const sites: Site[] = [
    {
      id: "site-1",
      name: "Site 1 (à renommer)",
      shelter: "Bâtiment en dur / abri désigné, loin des fenêtres.",
      muster: "Point de regroupement à l'arrière du camp.",
      note: "",
    },
  ];
  const workers: Worker[] = Array.from({ length: 6 }, (_, i) => ({
    id: `w-${i + 1}`,
    name: `Employé ${i + 1}`,
    siteId: "site-1",
    status: "present" as WorkerStatus,
    at: 0,
  }));
  return { sites, workers };
}

export function normalSession(): AbriSession {
  return { state: "normal", since: Date.now(), drill: false, discreet: false, reason: "", siteId: null, log: [] };
}

function pushLog(session: AbriSession, ev: AbriEvent): AbriEvent[] {
  return [ev, ...session.log].slice(0, LOG_MAX);
}

/** Déclenche l'alerte « à couvert ». Un exercice est identique, juste marqué comme tel. */
export function raiseAlert(
  session: AbriSession,
  opts: { by: string; siteId: string | null; reason: string; drill?: boolean },
): AbriSession {
  const now = Date.now();
  return {
    ...session,
    state: "alerte",
    since: now,
    drill: Boolean(opts.drill),
    discreet: false,
    reason: opts.reason,
    siteId: opts.siteId,
    log: pushLog(session, {
      at: now,
      kind: opts.drill ? "exercice" : "alerte",
      by: opts.by,
      site: opts.siteId ?? undefined,
      note: opts.reason || undefined,
    }),
  };
}

/** Lève l'alerte (« tout est clair »). Repasse en normal après avoir consigné la levée. */
export function clearAlert(session: AbriSession, by: string): AbriSession {
  const now = Date.now();
  return {
    ...session,
    state: "normal",
    since: now,
    drill: false,
    discreet: false,
    reason: "",
    siteId: null,
    log: pushLog(session, { at: now, kind: "levee", by }),
  };
}

export type Counts = { total: number; present: number; abri: number; manque: number; detresse: number };

/** Comptage des employés, pour ne laisser personne dehors. Filtré par site si demandé. */
export function counts(config: AbriConfig, siteId?: string | null): Counts {
  const list = siteId ? config.workers.filter((w) => w.siteId === siteId) : config.workers;
  const c: Counts = { total: list.length, present: 0, abri: 0, manque: 0, detresse: 0 };
  for (const w of list) c[w.status] += 1;
  return c;
}

/** Change le statut d'un employé et renvoie {config, event} à consigner. */
export function setWorkerStatus(
  config: AbriConfig,
  workerId: string,
  status: WorkerStatus,
  by: string,
): { config: AbriConfig; event: AbriEvent | null } {
  const w = config.workers.find((x) => x.id === workerId);
  if (!w || w.status === status) return { config, event: null };
  const now = Date.now();
  const workers = config.workers.map((x) => (x.id === workerId ? { ...x, status, at: now } : x));
  const event: AbriEvent =
    status === "detresse" || status === "abri" || status === "manque" || status === "present"
      ? { at: now, kind: status, by, worker: w.name, site: w.siteId }
      : { at: now, kind: "present", by, worker: w.name, site: w.siteId };
  return { config: { ...config, workers }, event };
}

/** Remet tout le monde « présent » (fin d'alerte / début d'exercice). */
export function resetStatuses(config: AbriConfig): AbriConfig {
  return { ...config, workers: config.workers.map((w) => ({ ...w, status: "present" as WorkerStatus, at: 0 })) };
}

// ---- Persistance locale (hors ligne). Jamais de réseau : la sûreté ne doit pas dépendre du wifi.
function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein ou bloqué : le module reste utilisable en mémoire */
  }
}

export function loadConfig(): AbriConfig {
  return read<AbriConfig>(CONFIG_KEY, defaultConfig());
}
export function saveConfig(c: AbriConfig): void {
  write(CONFIG_KEY, c);
}
export function loadSession(): AbriSession {
  return read<AbriSession>(SESSION_KEY, normalSession());
}
export function saveSession(s: AbriSession): void {
  write(SESSION_KEY, s);
}
