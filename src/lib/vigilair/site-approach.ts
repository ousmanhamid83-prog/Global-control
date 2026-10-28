/**
 * APPROCHE D'UN SITE PROTÉGÉ — cœur PUR, testable.
 *
 * Le CPA calculé par le poste est purement HORIZONTAL : il ne connaît que la distance au sol et le
 * cap. Pris tel quel, un avion de ligne à 10 000 m passant à la verticale d'une mine affiche une
 * distance nulle « en rapprochement » — et déclencherait une alerte de protection de site à chaque
 * survol. Ce module pose la question qui manque : cet aéronef approche-t-il vraiment le site, ou
 * se contente-t-il de le survoler ?
 *
 * Géométrie et cinématique seulement, jamais d'identité.
 */

export type ApproachCfg = {
  /** Plafond au-dessus duquel on survole le site sans l'approcher (m, altitude barométrique). */
  ceilingM: number;
  /** En deçà, la piste est au sol ou à l'arrêt : ce n'est pas une approche aérienne. */
  minSpeedKmh: number;
  /** Distance au-delà de laquelle le site n'est pas concerné (km). */
  watchKm: number;
};

/**
 * Plafond à 1500 m : au-dessus, même à la verticale, un aéronef ne menace pas un site au sol et
 * relève du trafic de transit. En dessous, il est dans la tranche qui compte pour un site isolé —
 * reconnaissance, largage, approche d'hélicoptère, drone.
 */
export const DEFAULT_APPROACH_CFG: ApproachCfg = {
  ceilingM: 1500,
  minSpeedKmh: 20,
  watchKm: 3.2,
};

export type ApproachVerdict = {
  /** Ce CPA mérite-t-il l'attention de l'opérateur ? */
  relevant: boolean;
  /** Pourquoi on écarte, quand on écarte : à afficher plutôt qu'à taire. */
  reason?: string;
};

/**
 * Filtre le CPA brut pour la protection du site. On garde seulement ce qui est BAS, EN MOUVEMENT,
 * PROCHE et EN RAPPROCHEMENT — le reste est du survol ou du trafic qui s'éloigne.
 */
export function siteApproach(
  t: { altM: number; speedKmh: number },
  cpa: { distKm: number; closing: boolean } | null,
  cfg: ApproachCfg = DEFAULT_APPROACH_CFG,
): ApproachVerdict {
  if (!cpa) return { relevant: false, reason: "pas de site à portée" };
  if (cpa.distKm > cfg.watchKm) return { relevant: false, reason: "site hors de portée" };
  if (!cpa.closing) return { relevant: false, reason: "ne se rapproche pas" };
  if (t.altM > cfg.ceilingM) {
    return { relevant: false, reason: `survol à ${Math.round(t.altM)} m, pas une approche` };
  }
  if (t.speedKmh < cfg.minSpeedKmh) return { relevant: false, reason: "au sol ou à l'arrêt" };
  return { relevant: true };
}

/**
 * TRANSPONDEUR MUET PRÈS D'UN SITE : faut-il PRÉVENIR, ou seulement afficher ?
 *
 * Deux seuils différents, et c'est tout le point. Le scope signale dès qu'une position est
 * ESTIMÉE (quelques secondes d'âge suffisent) parce que l'opérateur a le droit de savoir que le
 * symbole n'est pas une mesure. Mais mesuré sur du trafic réel, un agrégateur livre 7 % de ses
 * positions avec plus de 5 s de retard : prévenir là-dessus noierait le poste sous des alertes de
 * latence. On ne parle donc qu'au-delà d'un silence FRANC, hors de portée de la latence ordinaire.
 *
 * On n'exige pas que la piste « se rapproche » : son rapprochement est lui-même extrapolé, et une
 * piste qui vient de se taire est précisément celle dont on ne sait plus où elle va.
 */
export function silentAlarm(
  t: { altM: number; coast?: { silentS: number } },
  cpa: { distKm: number } | null,
  silentAlertS: number,
  cfg: ApproachCfg = DEFAULT_APPROACH_CFG,
): ApproachVerdict {
  if (!t.coast) return { relevant: false, reason: "la piste émet normalement" };
  if (t.coast.silentS < silentAlertS) {
    return { relevant: false, reason: `âge du relevé : ${t.coast.silentS} s, latence ordinaire` };
  }
  if (!cpa) return { relevant: false, reason: "pas de site à portée" };
  if (cpa.distKm > cfg.watchKm) return { relevant: false, reason: "site hors de portée" };
  if (t.altM > cfg.ceilingM) {
    return { relevant: false, reason: `survol à ${Math.round(t.altM)} m, pas une approche` };
  }
  return { relevant: true };
}
