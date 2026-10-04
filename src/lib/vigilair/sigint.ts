import { interceptChannel } from "./acoustics";
import { PLATFORM_BY_ID } from "./catalog";
import { formatCoordShort } from "./geo";
import { isFriend } from "./friends";
import type { AlertItem, SigintStream, Track } from "./types";
import { collectSigintAlerts } from "./sigint-alerts";

export function sigintStreams(track: Track): SigintStream[] {
  const plat = PLATFORM_BY_ID[track.truePlatformId];
  if (track.feed === "adsb") {
    const iff = track.iff;
    return [
      {
        id: "stealth",
        label: "ADS-B 1090ES live",
        state: "lock",
        detail: `${iff?.flightId ?? track.callsign} · ICAO ${iff?.icao24 ?? "—"} · squawk ${iff?.squawk ?? "—"} · ${track.nation ?? "nationalité OACI inconnue"} · NIC ${track.nic ?? "—"} · réseau passif, pas un radar FATL.`,
      },
      {
        id: "iff",
        label: "Squitter DF17",
        state: "lock",
        detail: `${track.icaoType ?? "type —"} ${track.reg ?? ""} · ${track.military ? "dbFlags militaire" : "civil"} · Mode 4 absent (émetteur Mode S).`,
      },
      {
        id: "c2",
        label: "Contrôle",
        state: "denied",
        detail:
          "Contact 1090ES — pas d'écoute « contrôleur adverse », pas d'injection C2, pas d'effet RF.",
      },
      {
        id: "ew",
        label: "Brouillage",
        state: "denied",
        detail: "Effecteur interdit sur le trafic 1090ES. AfriControl n'émet pas.",
      },
    ];
  }
  if (isFriend(track)) {
    const iff = track.iff;
    const fatl = track.friendKind === "fatl";
    return [
      {
        id: "stealth",
        label: fatl ? "IFF FATL" : "ADS-B ASECNA",
        state: "lock",
        detail: fatl
          ? `Mode ${iff?.mode ?? "3/A"} · squawk ${iff?.squawk ?? "—"} · ICAO ${iff?.icao24 ?? "—"} · affiliation Tchad. Pas un C-UAS.`
          : `ADS-B 1090ES · ${iff?.flightId ?? track.callsign} · squawk ${iff?.squawk ?? "—"} · ICAO ${iff?.icao24 ?? "—"} · inject de formation, pas un flux live.`,
      },
      {
        id: "iff",
        label: iff?.mode === "ADS-B" ? "Squitter ADS-B" : "Transpondeur IFF",
        state: "lock",
        detail: plat
          ? `${plat.protocol} · ${plat.rfBands.join(" · ")} · origine constructeur ${plat.originLabel}`
          : "IFF / ADS-B",
      },
      {
        id: "c2",
        label: "Contrôle",
        state: "denied",
        detail:
          "Piste amie — pas d'écoute « contrôleur adverse », pas d'injection C2, pas d'effet RF.",
      },
      {
        id: "ew",
        label: "Brouillage",
        state: "denied",
        detail:
          "Effecteur interdit sur FATL / ASECNA. L'affiliation IFF prime sur l'origine constructeur.",
      },
    ];
  }
  const ac = track.acoustic;
  const ch = plat ? interceptChannel(plat) : null;
  const streams: SigintStream[] = [];
  const jammed = track.ew?.state === "effet";

  streams.push({
    id: "stealth",
    label: "Contrôleur adverse",
    state: "lock",
    detail: jammed
      ? "Perte de liaison côté télépilote — cause indéterminée pour lui. Pas d'indication d'interception, pas d'identité AfriControl."
      : "Aucune rétroaction. Le télépilote ne voit ni détection, ni lock, ni interception. Écoute passive seulement.",
  });

  streams.push({
    id: "aco",
    label: "Acoustique BPF",
    state: ac?.locked ? "lock" : "scan",
    detail: ac?.locked
      ? `Lock ${ac.bpfHz} Hz · SNR ${ac.snrDb} dB · ${ac.bearings.length} azimuts · ${ac.splDb} dB SPL`
      : "Hors portée des réseaux de micros.",
  });

  streams.push({
    id: "proto",
    label: "Empreinte protocole",
    state: plat ? "lock" : "scan",
    detail: plat
      ? `${plat.protocol} · ${plat.rfBands.join(" · ")} · ${plat.originLabel}`
      : "En cours de classification.",
  });

  if (plat?.remoteId) {
    streams.push({
      id: "rid",
      label: "Remote ID",
      state: "lock",
      detail: `Broadcast civil observé · ${plat.manufacturer} ${plat.name} · position ${formatCoordShort(track.lat, track.lon)}`,
    });
  }

  if (ch?.channel === "analog-fpv" && ac?.locked) {
    streams.push({
      id: "fpv-a",
      label: "Audio analogique FPV",
      state: jammed ? "scan" : "lock",
      detail: jammed
        ? "Porteuse analogique affaiblie — présence résiduelle, pas de transcription."
        : "Sous-porteuse démodulée — présence audio, pas de transcription.",
    });
    streams.push({
      id: "fpv-v",
      label: "Vidéo analogique",
      state: jammed ? "scan" : "lock",
      detail: jammed
        ? "Porteuse 5.8 GHz / UHF instable. Image non stockée. Pas d'injection."
        : "Porteuse 5.8 GHz / UHF verrouillée — image non stockée ici.",
    });
    streams.push({
      id: "tlm",
      label: "Télémétrie claire",
      state: jammed ? "scan" : "lock",
      detail: `Analogique · ${formatCoordShort(track.lat, track.lon)} · ${Math.round(track.altM)} m · ${Math.round(track.speedKmh)} km/h · cap ${Math.round(track.heading)}°`,
    });
  } else if (ch?.channel === "blocked-crypto") {
    streams.push({
      id: "fpv-a",
      label: "Audio / vidéo",
      state: "denied",
      detail: "Liaison numérique chiffrée — contenu illisible. Pas d'injection C2.",
    });
    streams.push({
      id: "meta",
      label: "Métadonnées RF",
      state: jammed ? "scan" : "lock",
      detail: jammed
        ? `Occupation canal réduite · ${plat?.protocol ?? "—"} · hops/bursts clairsemés.`
        : `Occupation canal · ${plat?.protocol ?? "—"} · ${plat?.rfBands.join(" · ") ?? ""} · hop/burst observés, pas de clair.`,
    });
  } else if (ch?.channel === "acoustic") {
    streams.push({
      id: "meta",
      label: "Liaison C2",
      state: "scan",
      detail: "Pas de sous-porteuse analogique. Écoute limitée au BPF et à l'enveloppe RF.",
    });
  } else {
    streams.push({
      id: "air",
      label: "IFF / datalink",
      state: "scan",
      detail: "Chasse / jet — écoute IFF et cinématique, pas de FPV.",
    });
  }

  const gnss = plat?.rfBands.some((b) => /gnss|gps|glonass|beidou/i.test(b))
    || plat?.protocol.toLowerCase().includes("gnss");
  if (gnss) {
    streams.push({
      id: "gnss",
      label: "Occupation GNSS",
      state: jammed ? "scan" : "lock",
      detail: jammed
        ? "Présence L1 affaiblie (effecteur externe). Écoute passive — pas de spoofing."
        : "Présence L1 observée. Écoute passive uniquement — pas de spoofing, pas de leurre.",
    });
  }

  if (plat?.rfBands.some((b) => /satcom/i.test(b))) {
    streams.push({
      id: "sat",
      label: "Balise SATCOM",
      state: "scan",
      detail: "Occupation SATCOM détectée — métadonnées de créneau, pas de contenu.",
    });
  }

  streams.push({
    id: "c2",
    label: "Source de commandement",
    state: track.pilotFix ? (jammed ? "scan" : "lock") : "scan",
    detail: track.pilotFix
      ? `Gonio TEL ${formatCoordShort(track.pilotFix.lat, track.pilotFix.lon)} · ${Math.round(track.pilotFix.quality)} % · ${track.pilotFix.method}`
      : "Pas de gonio opérateur (hors RF, GNSS-only, ou chasse habitée).",
  });

  if (jammed) {
    streams.push({
      id: "ew",
      label: "Brouillage",
      state: "lock",
      detail:
        "Effet RF simulé par effecteur externe. AfriControl n'émet pas. Liaison C2 dégradée. Pas de prise de contrôle.",
    });
  } else if (track.ew?.state === "demande") {
    streams.push({
      id: "ew",
      label: "Brouillage",
      state: "scan",
      detail: "Demande transmise à l'autorité. En attente d'effet. AfriControl n'émet pas.",
    });
  } else if (track.ew?.state === "refuse") {
    streams.push({
      id: "ew",
      label: "Brouillage",
      state: "denied",
      detail: track.ew.note,
    });
  } else {
    streams.push({
      id: "ew",
      label: "Brouillage",
      state: "denied",
      detail:
        "AfriControl n'émet pas. Demande d'effet à l'autorité pour modèles CN / TR / RU identifiés.",
    });
  }

  return streams;
}

const sigintWarned = new Set<string>();

/** Une alerte par verrou d'écoute. Pas les flux refusés, pas les amis, pas le 1090. */
export function raiseSigintAlerts(tracks: Track[], now: number, alerts: AlertItem[]): void {
  const live = new Set(tracks.filter((t) => t.idState !== "perdu").map((t) => t.id));
  for (const key of [...sigintWarned]) {
    const tid = key.slice(0, key.indexOf(":"));
    if (!live.has(tid)) sigintWarned.delete(key);
  }
  for (const track of tracks) {
    if (track.idState === "perdu" || track.feed === "adsb" || isFriend(track)) continue;
    const plat = PLATFORM_BY_ID[track.truePlatformId];
    alerts.push(
      ...collectSigintAlerts({
        id: track.id,
        callsign: track.callsign,
        lat: track.lat,
        lon: track.lon,
        threat: plat?.threat,
        streams: sigintStreams(track),
        now,
        warned: sigintWarned,
      }),
    );
  }
}
