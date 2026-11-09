/**
 * Le disque PHYSIQUE qui porte un dossier — CÔTÉ SERVEUR. Deux partitions d'un même disque meurent
 * ensemble : pour dire si le poste et ses copies survivraient l'un à l'autre, c'est le disque qui
 * compte, pas le volume.
 *   - Linux : le montage du dossier (le plus long de /proc/self/mountinfo qui le contient), son
 *     périphérique remonté dans /sys jusqu'au(x) disque(s) : une partition donne son disque ; LVM,
 *     chiffrement ou RAID donnent ceux qui les portent (…/slaves).
 *   - Windows : la lettre du lecteur, reliée à son disque par CIM (Win32_LogicalDiskToPartition),
 *     par Windows PowerShell — chemin absolu, sans shell, lettre vérifiée, 15 s au plus, réponse
 *     gardée 10 min.
 * null : on ne sait pas le dire (dossier réseau, conteneur, autre système) ; les volumes sont alors
 * comparés, et la Division le dit.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Où lire les montages et les périphériques (les essais en donnent d'autres). */
export type RacinesLinux = { mountinfo: string; sys: string };

const g = globalThis as typeof globalThis & {
  __afriDisquesWindows?: Map<string, { disques: string[] | null; at: number }>;
};

/** Un champ de mountinfo : espaces, tabulations, sauts de ligne et « \ » y sont en octal (\040). */
const decoder = (s: string) =>
  s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));

/** Majeur et mineur d'un numéro de périphérique Linux (codage de la glibc). */
const majeurMineur = (d: bigint) =>
  `${((d >> 8n) & 0xfffn) | ((d >> 32n) & ~0xfffn)}:${(d & 0xffn) | ((d >> 12n) & ~0xffn)}`;

/** Remonte un périphérique de /sys jusqu'à ses disques. */
async function remonter(lien: string, profondeur = 0): Promise<string[]> {
  const d = await realpath(lien).catch(() => null);
  if (d === null || profondeur > 8) return [];
  if (await stat(path.join(d, "partition")).catch(() => null)) {
    return [path.basename(path.dirname(d))];
  }
  const portants = await readdir(path.join(d, "slaves")).catch(() => [] as string[]);
  if (portants.length === 0) return [path.basename(d)];
  const disques: string[] = [];
  for (const p of portants)
    disques.push(...(await remonter(path.join(d, "slaves", p), profondeur + 1)));
  return disques;
}

/** Les disques Linux qui portent `dossier` (voir en tête). */
export async function disquesLinux(
  dossier: string,
  racines: RacinesLinux = { mountinfo: "/proc/self/mountinfo", sys: "/sys" },
): Promise<string[] | null> {
  const chemin = await realpath(dossier).catch(() => null);
  if (chemin === null) return null;
  let montage: { point: string; numero: string; source: string } | null = null;
  for (const ligne of (await readFile(racines.mountinfo, "utf8").catch(() => "")).split("\n")) {
    const champs = ligne.split(" ");
    const tiret = champs.indexOf("-");
    if (tiret < 6 || champs.length < tiret + 3) continue;
    const point = decoder(champs[4]!);
    const dedans = point === "/" || chemin === point || chemin.startsWith(`${point}/`);
    // Le plus long l'emporte ; deux au même endroit : le dernier monté.
    if (dedans && (montage === null || point.length >= montage.point.length)) {
      montage = { point, numero: champs[2]!, source: decoder(champs[tiret + 2]!) };
    }
  }
  if (montage === null) return null;
  let numero = montage.numero;
  if (numero.startsWith("0:")) {
    // Sans périphérique propre (btrfs, réseau…) : celui de sa source, si c'en est un.
    const s = await stat(montage.source, { bigint: true }).catch(() => null);
    if (!s?.isBlockDevice()) return null;
    numero = majeurMineur(s.rdev);
  }
  const disques = await remonter(path.join(racines.sys, "dev", "block", numero));
  return disques.length > 0 ? [...new Set(disques)].sort() : null;
}

/** Les disques Windows (leur numéro) qui portent `dossier`, par CIM ; gardés 10 min. */
async function disquesWindows(dossier: string): Promise<string[] | null> {
  const lettre = /^([A-Za-z]):\\$/.exec(path.win32.parse(path.win32.resolve(dossier)).root)?.[1];
  if (!lettre) return null; // dossier réseau (\\serveur\partage)
  const cle = lettre.toUpperCase();
  const cache = (g.__afriDisquesWindows ??= new Map());
  const deja = cache.get(cle);
  if (deja && Date.now() - deja.at < 600_000) return deja.disques;
  const powershell = path.win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const requete = `ASSOCIATORS OF {Win32_LogicalDisk.DeviceID='${cle}:'} WHERE AssocClass=Win32_LogicalDiskToPartition`;
  const disques = await new Promise<string[] | null>((ok) => {
    execFile(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance -Query "${requete}").DiskIndex`,
      ],
      { timeout: 15_000, windowsHide: true },
      (erreur, sortie) => {
        const numeros = String(sortie)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^\d+$/.test(l));
        ok(erreur || numeros.length === 0 ? null : [...new Set(numeros)].sort());
      },
    );
  });
  cache.set(cle, { disques, at: Date.now() });
  return disques;
}

/** Les disques physiques qui portent `dossier` ; null si on ne sait pas le dire. */
export function disquesPhysiques(dossier: string): Promise<string[] | null> {
  if (process.platform === "win32") return disquesWindows(dossier);
  if (process.platform === "linux") return disquesLinux(dossier);
  return Promise.resolve(null);
}
