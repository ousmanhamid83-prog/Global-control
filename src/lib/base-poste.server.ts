/**
 * La base embarquée du poste sur disque — CÔTÉ SERVEUR. Sans DATABASE_URL, le poste garde sa base
 * PGLite dans data/base : journal, comptes, quarts, zones et preuves survivent à l'arrêt, sans
 * limite de durée. AFRICONTROL_BASE=memoire la garde en mémoire (perdue à l'arrêt) ; un autre
 * chemin la place ailleurs.
 *
 * Un seul serveur par dossier : deux PGLite ouverts sur les mêmes fichiers ne se voient pas et
 * corrompent la base (mesuré : illisible une fois les deux fermés). Le serveur qui tient la base
 * écoute sur 127.0.0.1, sur un port pris par le système, et y répond par un jeton tiré au hasard ;
 * data/base.verrou porte son pid, ce port et ce jeton. Le suivant ne reprend le verrou que si son
 * serveur est mort, si personne n'écoute plus sur ce port (le système ferme le port à la mort du
 * processus, même tué net, et au redémarrage de la machine) ou si on y répond autre chose. Un
 * serveur muet est cru vivant : le doute laisse le second en mémoire, et le dit, plutôt que
 * d'ouvrir deux fois la base.
 *
 * L'état vit sur globalThis, car le serveur construit a plusieurs copies de chaque module.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";

export type EtatBase = { mode: "disque"; dossier: string } | { mode: "memoire"; raison: string };

const g = globalThis as typeof globalThis & { __afriBase?: EtatBase };

/** Où se trouve la base, ou null hors PGLite (DATABASE_URL : la base du déploiement). */
export function etatBase(): EtatBase | null {
  return g.__afriBase ?? null;
}

/** Où le poste garde sa base, d'après AFRICONTROL_BASE (vide : data/base). */
export function choisirBase(valeur: string | undefined, cwd: string): EtatBase {
  const v = valeur?.trim();
  if (v === "memoire") {
    return {
      mode: "memoire",
      raison: "AFRICONTROL_BASE=memoire : la base est perdue à l'arrêt du serveur",
    };
  }
  return { mode: "disque", dossier: path.resolve(cwd, v || path.join("data", "base")) };
}

const SECRET_VALIDE = /^[0-9a-f]{64}$/;

function lireSecret(fichier: string): string | null {
  try {
    const lu = readFileSync(fichier, "utf8").trim();
    return SECRET_VALIDE.test(lu) ? lu : null;
  } catch {
    return null;
  }
}

/**
 * Le secret qui signe les sessions de connexion, gardé à côté de la base sur disque
 * (data/base.secret, lisible du seul compte du serveur) : une session ouverte survit au redémarrage
 * comme la base qui la garde, au lieu de déconnecter tout le personnel. Base en mémoire, disque
 * refusé ou fichier abîmé : null — un secret tiré pour la vie du processus, comme avant.
 */
export function secretDuPoste(valeur: string | undefined, cwd: string): string | null {
  const choix = choisirBase(valeur, cwd);
  if (choix.mode !== "disque") return null;
  const fichier = `${choix.dossier}.secret`;
  try {
    mkdirSync(path.dirname(fichier), { recursive: true });
    const secret = randomBytes(32).toString("hex");
    // « wx » : jamais par-dessus un secret déjà là — celui d'avant le redémarrage, ou d'un autre
    // serveur — qui est alors relu.
    writeFileSync(fichier, `${secret}\n`, { mode: 0o600, flag: "wx" });
    return secret;
  } catch {
    return lireSecret(fichier);
  }
}

type Verrou = { pid: number; port: number; jeton: string };

function lire(fichier: string): Verrou | null {
  try {
    const v = JSON.parse(readFileSync(fichier, "utf8")) as Partial<Verrou>;
    return typeof v.pid === "number" && typeof v.port === "number" && typeof v.jeton === "string"
      ? { pid: v.pid, port: v.port, jeton: v.jeton }
      : null;
  } catch {
    return null;
  }
}

const memeVerrou = (a: Verrou | null, b: Verrou | null) =>
  a !== null && b !== null && a.pid === b.pid && a.port === b.port && a.jeton === b.jeton;

const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code ?? String(e);

function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return code(e) === "EPERM";
  }
}

/** Le serveur du verrou répond-il, avec son jeton ? Seul un refus net ou un autre jeton dit non. */
function serveurDuVerrou(v: Verrou, delaiMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let recu = "";
    const s = connect({ host: "127.0.0.1", port: v.port });
    const fin = (vivant: boolean) => {
      clearTimeout(minuterie);
      s.destroy();
      resolve(vivant);
    };
    const minuterie = setTimeout(() => fin(true), delaiMs);
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      recu += d;
      if (recu.length >= v.jeton.length) fin(recu.startsWith(v.jeton));
    });
    s.on("end", () => fin(recu === v.jeton));
    s.on("error", (e) => fin(code(e) !== "ECONNREFUSED"));
  });
}

/** Le témoin : répond le jeton à qui se connecte ; ne retient pas le processus. */
function temoin(jeton: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer((s) => s.end(jeton));
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      srv.unref();
      resolve(srv);
    });
  });
}

/** Refus `occupee` : un autre serveur, vivant, tient la base. */
export type Prise =
  { ok: true; liberer: () => void } | { ok: false; raison: string; occupee?: true };

/**
 * Prend le dossier de la base pour ce serveur : le crée, pose le verrou, ou dit pourquoi non.
 * `delaiMs` : l'attente de la réponse du serveur d'un verrou existant ; Windows met environ 2 s à
 * refuser une connexion vers un port local fermé.
 */
export async function prendreBase(dossier: string, delaiMs = 5000): Promise<Prise> {
  try {
    mkdirSync(dossier, { recursive: true });
  } catch (e) {
    return { ok: false, raison: `dossier ${dossier} impossible à créer (${code(e)})` };
  }
  const fichier = `${dossier}.verrou`;
  const jeton = randomBytes(16).toString("hex");
  let srv: Server;
  try {
    srv = await temoin(jeton);
  } catch (e) {
    return { ok: false, raison: `témoin du verrou impossible à ouvrir sur 127.0.0.1 (${code(e)})` };
  }
  const moi: Verrou = { pid: process.pid, port: (srv.address() as AddressInfo).port, jeton };
  const refus = (raison: string): Prise => {
    srv.close();
    return { ok: false, raison };
  };

  for (let essai = 0; essai < 3; essai += 1) {
    try {
      const fd = openSync(fichier, "wx");
      writeSync(fd, JSON.stringify(moi));
      closeSync(fd);
      const liberer = () => {
        srv.close();
        process.removeListener("exit", liberer);
        try {
          if (memeVerrou(lire(fichier), moi)) unlinkSync(fichier);
        } catch {
          // Déjà retiré.
        }
      };
      process.once("exit", liberer);
      return { ok: true, liberer };
    } catch (e) {
      if (code(e) !== "EEXIST") return refus(`verrou ${fichier} impossible à poser (${code(e)})`);
    }
    // Un verrou illisible peut être en cours d'écriture : relu un instant plus tard.
    let v = lire(fichier);
    if (!v) {
      await new Promise((r) => setTimeout(r, 100));
      v = lire(fichier);
    }
    if (v && processusVivant(v.pid) && (await serveurDuVerrou(v, delaiMs))) {
      srv.close();
      return {
        ok: false,
        raison: `base déjà ouverte par un autre serveur du poste (pid ${v.pid})`,
        occupee: true,
      };
    }
    // Mort, ou plus personne pour répondre : repris, s'il n'a pas changé entre-temps.
    if (v === null || memeVerrou(lire(fichier), v)) {
      try {
        unlinkSync(fichier);
      } catch {
        // Retiré par un autre entre-temps.
      }
    }
  }
  return refus(`verrou ${fichier} disputé`);
}

/**
 * Ouvre la base du poste : sur disque, verrou pris, ou en mémoire — choisi, refusé (verrou, disque
 * en lecture seule) ou base illisible, dit au journal du serveur. `ouvrir(dossier)` ouvre PGLite
 * sur ce dossier, ou en mémoire sans dossier.
 *
 * Tenue par un autre serveur, la base est attendue `attenteMs` : un serveur relancé aussitôt
 * arrêté trouve le précédent encore en train de finir ses requêtes (jusqu'à 7 s, arret-serveur.ts)
 * et la reprend dès qu'il est sorti, au lieu de tourner toute sa vie en mémoire.
 */
export async function ouvrirBase<T>(
  ouvrir: (dossier?: string) => Promise<T>,
  valeur: string | undefined,
  cwd: string,
  attenteMs = 10_000,
): Promise<T> {
  const choix = choisirBase(valeur, cwd);
  let raison = choix.mode === "memoire" ? choix.raison : "";
  if (choix.mode === "disque") {
    const fin = Date.now() + attenteMs;
    let prise = await prendreBase(choix.dossier);
    while (!prise.ok && prise.occupee && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 500));
      prise = await prendreBase(choix.dossier);
    }
    if (prise.ok) {
      try {
        const pg = await ouvrir(choix.dossier);
        g.__afriBase = choix;
        console.log(`[base] sur disque : ${choix.dossier}`);
        return pg;
      } catch (e) {
        prise.liberer();
        raison = `base de ${choix.dossier} illisible (${e instanceof Error ? e.message : String(e)}) ; ses fichiers sont laissés tels quels`;
      }
    } else {
      raison = prise.raison;
    }
    console.error(`[base] EN MÉMOIRE, perdue à l'arrêt : ${raison}`);
  }
  const pg = await ouvrir();
  g.__afriBase = { mode: "memoire", raison };
  return pg;
}
