/**
 * Le journal des opérations dans la base du poste : gardé sans limite de durée, lu par pages des
 * plus récentes aux plus anciennes, effaçable par le chef — une entrée, ou toutes celles d'un
 * genre. Un effacement laisse sa trace (genre « effacement », jamais effaçable) : combien, de quel
 * genre, de quand à quand, par qui, sans rien garder de ce qui a été effacé. Les preuves chaînées
 * (bulletins, incidents de sécurité) sont dans leurs propres tables : rien ici n'y touche.
 *
 * Le client SQL est passé en paramètre : testable sous node, sur un vrai PGLite.
 */
import type { Sql } from "../db";

export const GENRE_EFFACEMENT = "effacement";

export type EntreeJournal = {
  id: string;
  userId: string;
  actor: string;
  role: string;
  team: string;
  kind: string;
  title: string;
  detail: string;
  trackId: string | null;
  severity: string;
  at: string;
};

/** Où reprendre : la dernière entrée lue (son heure exacte, puis son id en cas d'égalité). */
export type Curseur = { at: string; id: string };

export type PageJournal = { entrees: EntreeJournal[]; suite: Curseur | null };

type Ligne = {
  id: string;
  user_id: string;
  actor: string;
  role: string;
  team: string;
  kind: string;
  title: string;
  detail: string;
  track_id: string | null;
  severity: string;
  created_at: string;
};

/**
 * Une page du journal, des plus récentes aux plus anciennes : celles d'un agent (`userId`) ou de
 * tout le personnel, d'un genre ou de tous, avant `avant`. `suite` : null quand il n'y a plus rien.
 */
export async function pageDuJournal(
  sql: Sql,
  f: { userId: string | null; genre: string | null; avant: Curseur | null; limite: number },
): Promise<PageJournal> {
  const avantAt = f.avant?.at ?? null;
  const avantId = f.avant?.id ?? null;
  const lignes = await sql<Ligne>`
    select id, user_id, actor, role, team, kind, title, detail, track_id, severity,
           created_at::text as created_at
    from ops_log
    where (${f.userId}::text is null or user_id = ${f.userId}::text)
      and (${f.genre}::text is null or kind = ${f.genre}::text)
      and (${avantAt}::timestamptz is null
           or (created_at, id) < (${avantAt}::timestamptz, ${avantId}::text))
    order by created_at desc, id desc
    limit ${f.limite + 1}
  `;
  const entrees = lignes.slice(0, f.limite).map((r) => ({
    id: r.id,
    userId: r.user_id,
    actor: r.actor,
    role: r.role,
    team: r.team,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    trackId: r.track_id,
    severity: r.severity,
    at: r.created_at,
  }));
  const derniere = entrees.at(-1);
  return {
    entrees,
    suite: lignes.length > f.limite && derniere ? { at: derniere.at, id: derniere.id } : null,
  };
}

/** Combien d'entrées de chaque genre : de quoi choisir ce qu'on regarde, et ce qu'on efface. */
export async function genresDuJournal(sql: Sql): Promise<{ genre: string; n: number }[]> {
  return sql<{ genre: string; n: number }>`
    select kind as genre, count(*)::int as n from ops_log group by kind order by n desc, kind
  `;
}

export type CibleEffacement = { id: string } | { genre: string };

/** Ce qu'un effacement a retiré : combien, de quel genre, de quand à quand (heures exactes). */
export type Effacement = { n: number; genre: string | null; de: string | null; a: string | null };

/**
 * Efface une entrée, ou toutes celles d'un genre — jamais une trace d'effacement. Sans cible, rien :
 * une requête vide n'efface pas tout le journal.
 */
export async function effacerDuJournal(sql: Sql, cible: CibleEffacement): Promise<Effacement> {
  const id = "id" in cible ? cible.id : null;
  const genre = "genre" in cible ? cible.genre : null;
  if (!id && !genre) throw new Error("Effacement sans cible : rien n'est effacé.");
  const [r] = await sql<Effacement>`
    with effacees as (
      delete from ops_log
      where kind <> ${GENRE_EFFACEMENT}
        and (${id}::text is null or id = ${id}::text)
        and (${genre}::text is null or kind = ${genre}::text)
      returning kind, created_at
    )
    select count(*)::int as n, min(kind) as genre,
           min(created_at)::text as de, max(created_at)::text as a
    from effacees
  `;
  return r ?? { n: 0, genre: null, de: null, a: null };
}
