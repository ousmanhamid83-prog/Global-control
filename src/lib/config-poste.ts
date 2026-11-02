/**
 * Réglages du poste écrits une fois pour toutes par scripts/poste/preparer-poste (IA, itinéraire,
 * relief…), dans le fichier poste.env à la racine du poste. Le serveur les charge au démarrage :
 * plus besoin de retaper AFRICONTROL_IA=… à chaque lancement.
 *
 * Seules les clés AFRICONTROL_* sont lues : le fichier règle le poste, pas Node ni le réseau. Une
 * variable déjà posée au lancement garde la main sur le fichier.
 */
import { existsSync, readFileSync } from "node:fs";

export function chargerConfigPoste(
  chemin = "poste.env",
  cible: Record<string, string | undefined> = process.env,
): string[] {
  if (!existsSync(chemin)) return [];
  const chargees: string[] = [];
  for (const ligne of readFileSync(chemin, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*(AFRICONTROL_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const cle = m[1]!;
    if (cible[cle]?.trim()) continue;
    cible[cle] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
    chargees.push(cle);
  }
  return chargees;
}

/**
 * Charge poste.env et dit au journal ce qui en a été lu. Appelé au lancement du serveur construit
 * (plugin poste-au-demarrage) puis par le point d'entrée (seul à tourner en développement) : le
 * second appel ne trouve plus rien à charger, la ligne de journal ne sort qu'une fois.
 */
export function chargerEtAnnoncer(
  chemin = "poste.env",
  cible: Record<string, string | undefined> = process.env,
  journal: (ligne: string) => void = console.log,
): void {
  const reglages = chargerConfigPoste(chemin, cible);
  if (reglages.length > 0) journal(`[poste] réglages lus dans poste.env : ${reglages.join(", ")}`);
}
