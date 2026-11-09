/**
 * Le contrôle des copies du poste — CÔTÉ SERVEUR. Au démarrage, chaque jour, et dès que le dossier
 * des copies n'est plus le même (sa marque) — un autre disque, une autre clé, vidé —, chaque fichier
 * gardé est comparé à sa copie AU CONTENU, par les empreintes scellées du poste
 * (empreintes-poste.server.ts), jamais à la seule taille :
 *   - copie absente, ancienne (une vieille clé rebranchée), abîmée ou trafiquée : recopiée en
 *     entier, dans la file du fichier (une ligne qui arrive passe avant ou après, jamais entre
 *     l'ancienne copie et la nouvelle), puis relue ;
 *   - fichier du poste abîmé (son disque l'a altéré), copie saine : réparé depuis sa copie, relu ;
 *   - les deux pareils mais pas ce que le poste a scellé : rescellés, et dit ;
 *   - les deux abîmés, différents : rien n'est écrasé, c'est dit.
 * Les journaux encore ouverts (trafic et relevé non compressés, empreintes) : le poste y écrit, il
 * fait foi. Les petits fichiers (1 Mio au plus : registres) sont relus à chaque contrôle ; les gros
 * (phonie, journaux compressés, archives), à la taille entre deux passages d'un contrôle progressif
 * qui en relit 2 Gio de chaque côté au plus par jour, repris où il s'était arrêté.
 *
 * Le dossier des copies changé, ce que l'ancien gardait y est aussi rapatrié (rapatrierAnciennes).
 */
import { randomUUID } from "node:crypto";
import { cp, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { hacherFichier } from "./empreintes-poste.server.ts";
import {
  copieDe,
  dossierCopies,
  dossierRegistres,
  ecrireDurable,
  ecrireFichierPoste,
  empreintes,
  enFile,
  type EtatEmpreintes,
  fichiersGardes,
  forcer,
  forcerArbre,
  lireFichierPoste,
  noterDefautCopie,
  noterEmpreinte,
  recopierDurable,
  relatif,
} from "./disque-poste.server.ts";

/** Relus au contenu à chaque contrôle. */
const PETIT = 1 << 20;
/** Relus au plus par jour par le contrôle progressif, les deux côtés ensemble. */
const BUDGET = 4 * 2 ** 30;

/** Ce que la Division montre de l'intégrité des fichiers gardés. */
export type Integrite = {
  /** Le dernier contrôle complet (ms) ; null avant le premier. */
  derniere: number | null;
  /** Relus au contenu, des deux côtés, au dernier contrôle. */
  relus: number;
  /** Recopiés au dernier contrôle (copie absente, ancienne, abîmée ou trafiquée). */
  recopies: number;
  /** Abîmés au poste et dans leur copie, différemment, au dernier contrôle : laissés tels quels. */
  abimees: string[];
  /** Réparés depuis leur copie, depuis le démarrage (les 20 derniers). */
  reparees: { f: string; at: number }[];
  /** Pareils des deux côtés mais pas ce que le poste avait scellé, rescellés (les 20 derniers). */
  rescellees: { f: string; at: number }[];
  /** Empreintes au sceau faux, écartées. */
  fausses: number;
  /** Clé du poste illisible : rien ne se scelle. */
  sansCle: boolean;
  /** Le dernier rapatriement des anciennes copies. */
  rapatriement: { de: string; vers: string; fichiers: number; octets: number; at: number } | null;
};

const g = globalThis as typeof globalThis & {
  /** Le dernier contrôle complet : la marque laissée dans le dossier des copies, et le jour. */
  __afriControle?: { id: string; jour: string };
  __afriIntegrite?: Integrite;
};

const integrite = (): Integrite =>
  (g.__afriIntegrite ??= {
    derniere: null,
    relus: 0,
    recopies: 0,
    abimees: [],
    reparees: [],
    rescellees: [],
    fausses: 0,
    sansCle: false,
    rapatriement: null,
  });

/** L'intégrité des fichiers gardés, pour la Division. */
export function etatIntegrite(): Integrite {
  return integrite();
}

/** La marque laissée dans le dossier des copies : qui l'a contrôlé, où en est le contrôle
 * progressif, et de quel jour est son dernier passage. */
type Marque = { id: string; curseur: string; jour: string };

async function lireMarque(fichier: string): Promise<Marque | null> {
  try {
    const v = JSON.parse(await readFile(fichier, "utf8")) as Partial<Marque>;
    return typeof v.id === "string" && typeof v.curseur === "string" && typeof v.jour === "string"
      ? { id: v.id, curseur: v.curseur, jour: v.jour }
      : null;
  } catch {
    return null;
  }
}

type Bilan = {
  relus: number;
  recopies: number;
  abimees: string[];
  reparees: string[];
  rescellees: string[];
};

/** Recopie `source` sur `cible`, puis la relit : un disque qui écrit faux ne passe pas. */
async function recopierRelu(source: string, cible: string, attendu: string): Promise<void> {
  await recopierDurable(source, cible);
  if ((await hacherFichier(cible)).h !== attendu) {
    throw new Error(`${cible} : relu différent de ce qui y a été écrit`);
  }
}

/** `f` et sa copie relus au contenu, le côté abîmé réparé. Rend les octets relus. */
async function controler(
  f: string,
  copies: string,
  etat: EtatEmpreintes,
  bilan: Bilan,
): Promise<number> {
  const copie = copieDe(f, copies);
  const hp = await hacherFichier(f).catch(() => null);
  if (hp === null) return 0; // compressé ou effacé depuis
  const hc = await hacherFichier(copie).catch(() => null);
  bilan.relus++;
  const lus = hp.t + (hc?.t ?? 0);
  const rel = relatif(f);
  if (f.endsWith(".jsonl")) {
    // Journal ouvert : le poste y écrit encore, il fait foi.
    if (hc?.h !== hp.h) {
      await recopierRelu(f, copie, hp.h);
      bilan.recopies++;
    }
    return lus;
  }
  let versions = etat.index.get(rel);
  if (!versions) {
    // Pas encore scellé (gardé avant les empreintes) : le poste fait foi, une fois.
    await noterEmpreinte(f, hp);
    versions = [{ f: rel, ...hp }];
  }
  const bonnes = versions.map((v) => v.h);
  if (bonnes.includes(hp.h)) {
    // Coupé entre son empreinte et son écriture, le fichier est resté à sa version d'avant.
    if (hp.h !== versions[0]!.h) await noterEmpreinte(f, hp);
    if (hc?.h !== hp.h) {
      await recopierRelu(f, copie, hp.h);
      bilan.recopies++;
    }
  } else if (hc !== null && bonnes.includes(hc.h)) {
    await recopierRelu(copie, f, hc.h);
    bilan.reparees.push(rel);
    console.error(`[copies] ${rel} abîmé sur le disque du poste : réparé depuis sa copie`);
  } else if (hc?.h === hp.h) {
    await noterEmpreinte(f, hp);
    bilan.rescellees.push(rel);
    console.error(
      `[copies] ${rel} : pareil au poste et dans sa copie, mais pas ce que le poste avait scellé (modifié hors du poste ?) — rescellé`,
    );
  } else {
    bilan.abimees.push(rel);
    console.error(
      `[copies] ${rel} abîmé au poste et dans sa copie, différemment : laissé tel quel`,
    );
  }
  return lus;
}

/**
 * Le contrôle des copies (voir en tête). Fait au démarrage, chaque jour, et dès que la marque du
 * dossier des copies n'est plus celle du dernier contrôle ; sinon, rien. Rend le nombre de fichiers
 * recopiés ; jette si une recopie échoue (tout est refait au contrôle suivant).
 */
export async function alignerCopies(
  jour: string,
  copies = dossierCopies(),
  budget = BUDGET,
): Promise<number> {
  const marque = path.join(copies, "recopie-faite");
  const lue = await lireMarque(marque);
  if (lue !== null && lue.id === g.__afriControle?.id && jour === g.__afriControle.jour) return 0;
  const debut = Date.now();
  const etat = await empreintes();
  const bilan: Bilan = { relus: 0, recopies: 0, abimees: [], reparees: [], rescellees: [] };
  const gros: string[] = [];
  const relusDeja = new Set<string>();
  for (const f of await fichiersGardes()) {
    await enFile(f, async () => {
      const [p, c] = await Promise.all([
        stat(f).catch(() => null),
        stat(copieDe(f, copies)).catch(() => null),
      ]);
      if (p === null) return;
      if (p.size > PETIT && !f.endsWith(".jsonl")) {
        gros.push(f);
        // Entre deux passages du contrôle progressif : à la taille, au contenu si elle ne va pas.
        const tailles = etat.index.get(relatif(f))?.map((v) => v.t) ?? [p.size];
        if (c !== null && c.size === p.size && tailles.includes(p.size)) return;
      }
      relusDeja.add(f);
      await controler(f, copies, etat, bilan);
    });
  }
  // Le contrôle progressif des gros fichiers, une fois par jour, repris après le dernier relu.
  let curseur = lue?.curseur ?? "";
  if (lue?.jour !== jour && gros.length > 0) {
    const ordre = gros.map((f) => [relatif(f), f] as const).sort(([a], [b]) => (a < b ? -1 : 1));
    const depart = Math.max(
      0,
      ordre.findIndex(([r]) => r > curseur),
    );
    let lus = 0;
    for (let k = 0; k < ordre.length && lus < budget; k++) {
      const [r, f] = ordre[(depart + k) % ordre.length]!;
      curseur = r;
      if (relusDeja.has(f)) continue;
      await enFile(f, async () => {
        lus += await controler(f, copies, etat, bilan);
      });
    }
  }
  const id = `${new Date().toISOString()} ${randomUUID()}`;
  await ecrireDurable(marque, `${JSON.stringify({ id, curseur, jour })}\n`);
  g.__afriControle = { id, jour };
  console.log(
    `[copies] contrôle au contenu : ${bilan.relus} fichier(s) relu(s) au poste et dans sa copie, ${bilan.recopies} recopié(s), en ${Date.now() - debut} ms`,
  );

  const at = Date.now();
  const i = integrite();
  i.derniere = at;
  i.relus = bilan.relus;
  i.recopies = bilan.recopies;
  i.abimees = bilan.abimees;
  i.reparees = [...bilan.reparees.map((f) => ({ f, at })), ...i.reparees].slice(0, 20);
  i.rescellees = [...bilan.rescellees.map((f) => ({ f, at })), ...i.rescellees].slice(0, 20);
  i.fausses = etat.fausses;
  i.sansCle = etat.cle === null;
  noterDefautCopie(
    "intégrité des fichiers gardés",
    bilan.abimees.length > 0
      ? new Error(
          `abîmés au poste ET dans leur copie, laissés tels quels : ${bilan.abimees.join(", ")}`,
        )
      : null,
  );
  noterDefautCopie(
    "empreintes des fichiers gardés",
    etat.cle === null
      ? new Error("clé du poste (data/empreintes.cle) illisible : rien ne se scelle")
      : etat.fausses > 0
        ? new Error(
            `${etat.fausses} empreinte(s) au sceau faux (journal modifié hors du poste ?), écartée(s)`,
          )
        : null,
  );
  return bilan.recopies;
}

/** Le dossier des copies en service, retenu pour rapatrier l'ancien quand il change. */
type Registre = { dossier: string; precedent: string | null; archive: string | null };

/** Préfixe des archives d'un ancien dossier des copies : copies/ancien-dossier-<date>. */
export const ANCIEN_DOSSIER = "ancien-dossier-";

const registre = () => path.join(dossierRegistres(), "copies-dossier.json");

/** Deux chemins du même dossier (Windows ne distingue pas les majuscules). */
function meme(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** `a` est-il `b`, ou dans `b` ? */
function dans(a: string, b: string): boolean {
  const r = path.relative(path.resolve(b), path.resolve(a));
  return !r.startsWith("..") && !path.isAbsolute(r);
}

/** Compare deux arbres fichier par fichier (SHA-256) ; jette au premier écart. */
async function comparerArbres(a: string, b: string): Promise<{ fichiers: number; octets: number }> {
  let fichiers = 0;
  let octets = 0;
  for (const e of await readdir(a, { withFileTypes: true })) {
    const [x, y] = [path.join(a, e.name), path.join(b, e.name)];
    if (e.isDirectory()) {
      const s = await comparerArbres(x, y);
      fichiers += s.fichiers;
      octets += s.octets;
    } else if (e.isFile()) {
      const [hx, hy] = await Promise.all([hacherFichier(x), hacherFichier(y).catch(() => null)]);
      if (hx.h !== hy?.h) throw new Error(`${y} : recopié différent de ${x}`);
      fichiers++;
      octets += hx.t;
    }
  }
  return { fichiers, octets };
}

/**
 * Le dossier des copies a changé (un autre disque) : ce que l'ancien gardait — copies de la base,
 * écritures doublées, copies des fichiers, archives — est rapatrié dans le nouveau, sous
 * ancien-dossier-<date> : recopié dans un .part, forcé, comparé fichier par fichier (SHA-256),
 * renommé ; alors seulement retiré de l'ancien dossier. Coupé n'importe où, repris au contrôle
 * suivant ; l'ancien dossier injoignable (clé retirée), jette — dit, réessayé. Une archive, jamais
 * mêlée aux copies en service : la reprise ne la prend pas d'elle-même. Rend ce qui a été rapatrié,
 * ou null s'il n'y avait rien à faire.
 */
export async function rapatrierAnciennes(
  copies = dossierCopies(),
): Promise<{ fichiers: number; octets: number } | null> {
  const lu = await lireFichierPoste(registre(), (t) => JSON.parse(t) as Registre);
  let precedent = lu?.precedent ?? null;
  if (lu && precedent === null && !meme(lu.dossier, copies)) precedent = lu.dossier;
  if (!lu) {
    // Avant ce registre, les copies allaient par défaut dans data/copies.
    const defaut = path.join(dossierRegistres(), "copies");
    if (!meme(defaut, copies) && (await readdir(defaut).catch(() => [])).length > 0) {
      precedent = defaut;
    }
  }
  if (precedent !== null && (dans(precedent, copies) || dans(copies, precedent))) precedent = null;
  if (precedent === null) {
    if (!lu || !meme(lu.dossier, copies) || lu.precedent !== null || lu.archive !== null) {
      await ecrireFichierPoste(
        registre(),
        `${JSON.stringify({ dossier: copies, precedent: null, archive: null })}\n`,
      );
    }
    return null;
  }
  const archive =
    lu?.archive ??
    path.join(copies, `${ANCIEN_DOSSIER}${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (!lu || lu.precedent !== precedent || lu.archive !== archive || !meme(lu.dossier, copies)) {
    await ecrireFichierPoste(
      registre(),
      `${JSON.stringify({ dossier: copies, precedent, archive })}\n`,
    );
  }
  const noms = await readdir(precedent); // injoignable : jette, réessayé au contrôle suivant
  const fini = () =>
    ecrireFichierPoste(
      registre(),
      `${JSON.stringify({ dossier: copies, precedent: null, archive: null })}\n`,
    );
  if (noms.length === 0) {
    await fini();
    return null;
  }
  let bilan: { fichiers: number; octets: number };
  if (await stat(archive).catch(() => null)) {
    // Repris après le renommage : revérifiée avant que rien ne soit retiré.
    bilan = await comparerArbres(precedent, archive);
  } else {
    const part = `${archive}.part`;
    await rm(part, { recursive: true, force: true });
    await cp(precedent, part, { recursive: true });
    await forcerArbre(part);
    bilan = await comparerArbres(precedent, part);
    await rename(part, archive);
    await forcer(copies, true);
  }
  // Tout ce que l'ancien dossier avait est dans l'archive, à l'identique : il se vide.
  for (const n of noms) await rm(path.join(precedent, n), { recursive: true, force: true });
  await rmdir(precedent).catch(() => undefined); // vide : retiré ; la racine d'un disque reste
  await fini();
  integrite().rapatriement = { de: precedent, vers: archive, ...bilan, at: Date.now() };
  console.log(
    `[copies] anciennes copies rapatriées de ${precedent} dans ${archive} : ${bilan.fichiers} fichier(s), ${(bilan.octets / 1e6).toFixed(1)} Mo, comparés un à un`,
  );
  return bilan;
}
