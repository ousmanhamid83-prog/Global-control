/**
 * Le réseau du poste : la seule destination où une donnée du poste peut partir. Relais d'alertes
 * détaillées, serveur d'IA, serveurs d'itinéraire et de relief : chacun n'est utilisé que si son
 * adresse est ici.
 *
 * « Sur le réseau du poste » se lit dans l'adresse elle-même, jamais par une résolution DNS (qui
 * peut mentir) : bouclage (127/8, ::1), privé (10/8, 172.16/12, 192.168/16), lien local
 * (169.254/16, fe80::/10), IPv6 locale unique (fc00::/7), ou nom réservé au réseau local
 * (localhost, .local, .home.arpa, .internal). Un nom public qui pointe vers une adresse privée
 * compte comme extérieur, de même qu'un nom sans point (une recherche DNS peut le compléter vers
 * l'extérieur) et l'espace partagé 100.64/10 (opérateurs, réseaux superposés) : dans le doute,
 * rien ne sort.
 */

function ipv4SurPlace(a: number, b: number): boolean {
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Adresse IPv6 telle que l'écrit l'analyseur d'URL : minuscules, forme compressée. */
function ipv6SurPlace(h: string): boolean {
  if (h === "::1") return true;
  // IPv4 encapsulée (::ffff:10.0.0.5), que l'analyseur d'URL écrit en hexadécimal : ::ffff:a00:5.
  const v4 = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4) {
    const haut = Number.parseInt(v4[1]!, 16);
    return ipv4SurPlace(haut >> 8, haut & 0xff);
  }
  const premier = h.startsWith("::") ? 0 : Number.parseInt(h.split(":")[0]!, 16);
  return (premier & 0xfe00) === 0xfc00 || (premier & 0xffc0) === 0xfe80;
}

export function hoteSurPlace(adresse: string): boolean {
  let hote: string;
  try {
    hote = new URL(adresse).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hote.startsWith("[") && hote.endsWith("]")) return ipv6SurPlace(hote.slice(1, -1));
  // L'analyseur d'URL ramène toute écriture d'une IPv4 (hexadécimale, octale, abrégée) à la forme
  // pointée : « http://0x0a000005/ » arrive ici en 10.0.0.5, sans échappatoire.
  const v4 = hote.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return ipv4SurPlace(Number(v4[1]), Number(v4[2]));
  const nom = hote.endsWith(".") ? hote.slice(0, -1) : hote;
  return nom === "localhost" || /\.(localhost|local|home\.arpa|internal)$/.test(nom);
}

/** Ce que l'opérateur lit quand une adresse est refusée parce qu'elle sort du poste. */
export const RESEAU_POSTE_EXEMPLES =
  "127.x, 10.x, 172.16–31.x, 192.168.x, nom en .local ou .internal";

/**
 * Adresse d'un serveur du poste réglée par l'opérateur (IA, itinéraire, relief) : utilisable
 * seulement si elle est sur le réseau du poste. Sans barre finale, prête à recevoir un chemin.
 */
export function serveurPoste(
  adresse: string | undefined,
): { base: string } | { refus: "absente" | "hors-poste" } {
  if (!adresse) return { refus: "absente" };
  if (!hoteSurPlace(adresse)) return { refus: "hors-poste" };
  return { base: adresse.replace(/\/+$/, "") };
}
