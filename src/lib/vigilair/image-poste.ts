/**
 * L'image du poste : le dernier relevé réseau, vieilli de son âge, plus les contacts de l'antenne
 * 1090 du poste. Une seule fusion, pour la console ET pour tout ce qui lit l'image côté serveur :
 * assistant, briefing, faits sans IA, relève de quart, commandes du poste, bot.
 *
 * Avant, ces lecteurs côté serveur lisaient le relevé réseau seul. Mesuré sur le serveur
 * construit, Internet coupé, antenne branchée : trois avions sur la carte de la console,
 * « pas encore de relevé des capteurs » à l'assistant. Sur un poste hors ligne, l'antenne est
 * pourtant LA source de trafic.
 *
 * Module pur : ni réseau, ni horloge — l'instant est passé en paramètre.
 */
import { theaterOf } from "./geo.ts";
import {
  ageLiveAc,
  jamFromAircraft,
  type JamCell,
  type LiveAc,
  type LivePicture,
  type SourceHealth,
} from "./live-adsb.ts";
import type { ReceiverStatus } from "./rx1090.server.ts";

export function health(id: string, label: string, ok: boolean, detail: string): SourceHealth {
  return { id, label, ok, detail };
}

/** Avions au-dessus du Sahel (Tchad, Darfour, AES, bande Dakar → mer Rouge). */
export function sahelCount(ac: LiveAc[]): number {
  return ac.filter((a) => theaterOf(a.lat, a.lon) !== "monde").length;
}

/** Avions à 120 km de FTTJ au plus. */
export function localN(ac: LiveAc[]): number {
  let n = 0;
  for (const a of ac) {
    const dlat = a.lat - 12.1348;
    const dlon = a.lon - 15.0557;
    const km = Math.hypot(dlat * 110.57, dlon * 111.32 * Math.cos((12.1348 * Math.PI) / 180));
    if (km <= 120) n += 1;
  }
  return n;
}

export function nicHealth(ac: LiveAc[], jam: JamCell[]): SourceHealth {
  return health(
    "nic",
    "GNSS NIC (ADS-B)",
    jam.length > 0 || ac.some((a) => a.nic != null),
    jam.some((j) => j.level !== "low")
      ? `${jam.filter((j) => j.level !== "low").length} cellules dégradées`
      : "pas de jamming mesuré sur le flux",
  );
}

/** L'antenne entend : réglée, connectée, et une trame reçue il y a moins d'une minute. */
export function antenneVivante(rx: ReceiverStatus, now: number): boolean {
  return rx.enabled && rx.connected && rx.lastLineAt != null && now - rx.lastLineAt < 60_000;
}

/**
 * Les contacts d'un relevé vieillis de son âge : un relevé gardé en cache ou en secours ne doit
 * pas annoncer des positions plus fraîches qu'elles ne sont.
 */
export function vieillir(pic: LivePicture, now: number): LivePicture {
  return { ...pic, aircraft: ageLiveAc(pic.aircraft, (now - pic.at) / 1000) };
}

/**
 * Ajoute l'antenne du poste à l'image réseau : ses avions passent devant ceux des agrégateurs
 * (plus frais, entendus en direct), le registre réseau complète le type et l'immatriculation.
 */
export function fusionAntenne(
  net: LivePicture,
  rx: ReceiverStatus,
  rxAc: LiveAc[],
  now: number,
): LivePicture {
  const live = antenneVivante(rx, now);
  const silentS = rx.lastLineAt ? Math.round((now - rx.lastLineAt) / 1000) : null;
  const rxHealth = health(
    "rx",
    "Antenne 1090 du poste",
    live,
    !rx.enabled
      ? "coupée (AFRICONTROL_1090=off)"
      : live
        ? `${rx.positioned} positionnés · ${rx.heard} entendus · ${rx.msgPerS} msg/s · ${rx.endpoint}`
        : rx.connected
          ? `connectée ${rx.endpoint} · aucune trame${silentS != null ? ` depuis ${silentS} s` : ""}`
          : `${rx.lastError ?? "connexion en cours"} · ${rx.endpoint}`,
  );
  const byHex = new Map(net.aircraft.map((a) => [a.hex, a] as const));
  for (const a of rxAc) {
    const n = byHex.get(a.hex);
    byHex.set(
      a.hex,
      n
        ? {
            ...a,
            // L'indicatif du réseau ne supplée que si l'antenne ne l'a pas encore décodé : dans les
            // deux cas il a été émis par l'appareil, entendu par un autre récepteur.
            flight: a.flightTx ? a.flight : n.flight,
            flightTx: a.flightTx || n.flightTx,
            // L'une ou l'autre source suffit à établir l'adresse : on garde la plus parlante.
            messages: Math.max(a.messages ?? 0, n.messages ?? 0) || null,
            icaoType: n.icaoType,
            reg: n.reg,
            military: n.military,
            category: a.category ?? n.category,
          }
        : a,
    );
  }
  const aircraft = [...byHex.values()];
  const jam = jamFromAircraft(aircraft);
  const sources: SourceHealth[] = [];
  for (const src of net.sources) {
    sources.push(src.id === "nic" ? nicHealth(aircraft, jam) : src);
    if (src.id === "1090") sources.push(rxHealth);
  }
  if (!sources.includes(rxHealth)) sources.unshift(rxHealth);
  const sourceAt: Record<string, number> = { ...net.sourceAt };
  for (const src of net.sources) sourceAt[src.id] ??= net.at;
  sourceAt.rx = now;
  if (live) sourceAt.nic = now;
  return {
    ...net,
    at: live ? now : net.at,
    sourceAt,
    source: live
      ? `antenne ${rx.endpoint} · ${rxAc.length} avions${net.aircraft.length ? ` + ${net.source}` : ""}`
      : net.source,
    aircraft,
    localN: localN(aircraft),
    sahelN: sahelCount(aircraft),
    emergencies: aircraft.filter((a) => Boolean(a.emergency)),
    jam,
    sources,
    errors:
      !live && rx.enabled && rx.lastError
        ? [...net.errors, `Antenne: ${rx.lastError}`]
        : net.errors,
  };
}

/**
 * L'image du poste à l'instant `now`, sans relevé Internet de plus : le dernier relevé réseau
 * (`net`, peut-être vieux, peut-être absent) vieilli, et l'antenne. `vide` fournit l'image de base
 * quand seule l'antenne entend. null tant que ni l'un ni l'autre n'a rien donné.
 */
export function imageDuPoste(
  net: LivePicture | null,
  rx: ReceiverStatus,
  rxAc: LiveAc[],
  now: number,
  vide: () => LivePicture,
): LivePicture | null {
  if (!net && !antenneVivante(rx, now)) return null;
  return fusionAntenne(net ? vieillir(net, now) : vide(), rx, rxAc, now);
}
