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
  /** Les anciens dossiers des copies qui ne répondent pas (clé retirée, disque absent ou perdu) :
   * depuis quand (gardé dans le registre, il survit aux redémarrages), le dernier essai, et
   * pourquoi. Jamais abandonnés d'eux-mêmes : leurs copies attendent qu'ils reviennent. */
  attentes: { de: string; depuis: number; dernier: number; raison: string }[];
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
    attentes: [],
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

/** Un ancien dossier des copies à rapatrier : le nom de son archive dans le dossier en service
 * (ancien-dossier-<date>), et depuis quand il ne répond pas (ms), ou null. */
type Ancien = { de: string; archive: string; attente: number | null };

/** Le dossier des copies en service, et la file des anciens à y rapatrier. Écrit par la version
 * d'avant : un seul ancien, `precedent`, son archive en chemin entier. */
type Registre = {
  dossier: string;
  anciens?: Ancien[];
  precedent?: string | null;
  archive?: string | null;
};

/** Préfixe des archives d'un ancien dossier des copies : copies/ancien-dossier-<date>. */
export const ANCIEN_DOSSIER = "ancien-dossier-";

const registre = () => path.join(dossierRegistres(), "copies-dossier.json");

/** `a` est-il `b`, ou dans `b` ? (sous Windows, sans distinguer les majuscules) */
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
 * Un ancien dossier, lisible, rapatrié dans son archive : recopié dans un .part, forcé, comparé
 * fichier par fichier (SHA-256), renommé — ou l'archive déjà là (coupé après le renommage),
 * revérifiée ; alors seulement il se vide. Rend ce qui a été rapatrié, ou null s'il était vide.
 */
async function vider(
  de: string,
  noms: string[],
  archive: string,
  copies: string,
): Promise<{ fichiers: number; octets: number } | null> {
  if (noms.length === 0) return null;
  let bilan: { fichiers: number; octets: number };
  if (await stat(archive).catch(() => null)) {
    bilan = await comparerArbres(de, archive);
  } else {
    const part = `${archive}.part`;
    await rm(part, { recursive: true, force: true });
    await cp(de, part, { recursive: true });
    await forcerArbre(part);
    bilan = await comparerArbres(de, part);
    await rename(part, archive);
    await forcer(copies, true);
  }
  // Tout ce que l'ancien dossier avait est dans l'archive, à l'identique : il se vide.
  for (const n of noms) await rm(path.join(de, n), { recursive: true, force: true });
  await rmdir(de).catch(() => undefined); // vide : retiré ; la racine d'un disque reste
  integrite().rapatriement = { de, vers: archive, ...bilan, at: Date.now() };
  console.log(
    `[copies] anciennes copies rapatriées de ${de} dans ${archive} : ${bilan.fichiers} fichier(s), ${(bilan.octets / 1e6).toFixed(1)} Mo, comparés un à un`,
  );
  return bilan;
}

/**
 * Le dossier des copies a changé (un autre disque) : ce que l'ancien gardait — copies de la base,
 * écritures doublées, copies des fichiers, archives — est rapatrié dans le nouveau, sous
 * ancien-dossier-<date> (vider). Les anciens dossiers forment une file, gardée dans le registre
 * avant d'y toucher : coupé n'importe où, repris au contrôle suivant. Un ancien dossier injoignable
 * (clé retirée, disque absent ou perdu) y reste, la Division dit depuis quand (gardé dans le
 * registre) et pourquoi — réessayé à chaque contrôle, jamais abandonné de lui-même, même si le
 * dossier des copies change encore entre-temps : des copies qui pourraient revenir ne sont jamais
 * oubliées. Une archive, jamais mêlée aux copies en service : la reprise ne la prend pas d'elle-même.
 * Rend ce qui a été rapatrié, dossier par dossier ; jette, après avoir fait tout ce qui se pouvait,
 * si un ancien dossier attend ou a échoué.
 */
export async function rapatrierAnciennes(
  copies = dossierCopies(),
): Promise<{ fichiers: number; octets: number }[]> {
  const lu = await lireFichierPoste(registre(), (t) => JSON.parse(t) as Registre);
  // Réécrit seulement s'il change : le journal des empreintes ne grossit pas toutes les 5 min.
  const ecrit = JSON.stringify(lu);
  let anciens: Ancien[] =
    lu?.anciens ??
    (lu?.precedent
      ? [{ de: lu.precedent, archive: path.basename(lu.archive as string), attente: null }]
      : []);
  // Le dossier quitté ; sans registre, celui d'avant lui : data/copies, s'il garde quelque chose.
  const quitte = lu?.dossier ?? path.join(dossierRegistres(), "copies");
  if (lu !== null || (await readdir(quitte).catch(() => [])).length > 0) {
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    anciens.push({ de: quitte, archive: `${ANCIEN_DOSSIER}${date}`, attente: null });
  }
  // Ni le dossier en service, ni celui qui le contient : jamais un dossier recopié dans lui-même.
  anciens = anciens.filter((a) => !dans(copies, a.de));
  const noter = async () => {
    const texte = JSON.stringify({ dossier: copies, anciens });
    if (texte !== ecrit) await ecrireFichierPoste(registre(), `${texte}\n`);
  };
  await noter(); // la file gardée avant d'y toucher : coupé, repris sous les mêmes archives
  const attentes: Integrite["attentes"] = [];
  const erreurs: string[] = [];
  const faits: { fichiers: number; octets: number }[] = [];
  for (const a of anciens) {
    const archive = path.join(copies, a.archive);
    const noms = await readdir(a.de).catch((e: NodeJS.ErrnoException) => e.code as string);
    if (typeof noms === "string") {
      if (await stat(archive).catch(() => null)) {
        // Archivé, vérifié, vidé ; coupé avant que la file soit réécrite : rien ne manque.
        anciens = anciens.filter((x) => x !== a);
        console.log(`[copies] ${a.de} ne répond plus, son archive ${archive} est complète`);
        continue;
      }
      a.attente ??= Date.now();
      attentes.push({ de: a.de, depuis: a.attente, dernier: Date.now(), raison: noms });
      erreurs.push(
        `l'ancien dossier des copies ${a.de} ne répond pas (${noms}) : ses copies seront rapatriées dès qu'il répondra — rien n'est oublié`,
      );
      continue;
    }
    a.attente = null; // il répond
    try {
      const bilan = await vider(a.de, noms, archive, copies);
      anciens = anciens.filter((x) => x !== a);
      if (bilan) faits.push(bilan);
    } catch (e) {
      erreurs.push((e as Error).message);
    }
  }
  await noter();
  integrite().attentes = attentes;
  if (erreurs.length > 0) throw new Error(erreurs.join(" ; "));
  return faits;
}
