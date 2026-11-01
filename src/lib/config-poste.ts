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
