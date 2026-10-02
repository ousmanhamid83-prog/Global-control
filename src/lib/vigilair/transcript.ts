import { interceptChannel } from "./acoustics";
import { PLATFORM_BY_ID } from "./catalog";
import type { Origin, Track } from "./types";

export type TranscriptLine = {
  id: string;
  tS: number;
  speaker: string;
  lang: string;
  original: string;
  fr: string;
  conf: number;
};

type Pack = {
  lang: string;
  operator: string;
  relay: string;
  lines: [string, string][];
};

const PACKS: Record<Exclude<Origin, "XX">, Pack> = {
  CN: {
    lang: "zh-CN",
    operator: "Opérateur CN",
    relay: "Relais local",
    lines: [
      ["保持航线，目标城市方位不变。", "Garde le cap, azimut ville inchangé."],
      ["高度一千二，速度稳定。", "Altitude 1 200, vitesse stable."],
      ["不要开灯，保持静默。", "Pas de feux, reste en silence radio."],
      ["收到，继续接近。", "Reçu, poursuis l'approche."],
      ["图像清楚，继续录像。", "Image nette, on continue l'enregistrement."],
      ["风向从北，补偿两度。", "Vent du nord, compenser deux degrés."],
      ["到达点后盘旋等待指令。", "Au point, mets en holding et attends l'ordre."],
      ["不要回话，只收。", "Pas de réponse, écoute seulement."],
    ],
  },
  TR: {
    lang: "tr-TR",
    operator: "Opérateur TR",
    relay: "Relais local",
    lines: [
      ["İrtifa iki bin, rota aynı.", "Altitude deux mille, route inchangée."],
      ["Hedefe yaklaş, sessiz kal.", "Approche la cible, reste silencieux."],
      ["Kamera kilit, devam.", "Caméra verrouillée, continue."],
      ["Rüzgar yan, üç derece sağ.", "Vent de travers, trois degrés à droite."],
      ["Bekleme turu yap.", "Fais un tour d'attente."],
      ["Komuta bekliyorum.", "J'attends la consigne."],
      ["Işık yok, gece uçuşu.", "Pas de feux, vol de nuit."],
      ["Anlaşıldı, basıyoruz.", "Compris, on pousse."],
    ],
  },
  RU: {
    lang: "ru-RU",
    operator: "Opérateur RU",
    relay: "Relais local",
    lines: [
      ["Курс на город, высота три тысячи.", "Cap sur la ville, altitude trois mille."],
      ["Связь держать коротко.", "Garder la liaison brève."],
      ["Цель в кадре, продолжай.", "Cible dans le cadre, continue."],
      ["Ветер с востока.", "Vent d'est."],
      ["Круг ожидания над точкой.", "Holding au-dessus du point."],
      ["Без огней, только приборы.", "Sans feux, instruments seulement."],
      ["Принял, работаю.", "Reçu, je travaille."],
      ["Молчать в эфире.", "Silence sur le net."],
    ],
  },
  IR: {
    lang: "fa-IR",
    operator: "Opérateur IR",
    relay: "Relais local",
    lines: [
      ["ارتفاع را نگه دار، مسیر مستقیم.", "Garde l'altitude, route directe."],
      ["به سمت شهر، آرام.", "Vers la ville, tout calme."],
      ["دوربین قفل است.", "Caméra verrouillée."],
      ["باد از شمال است.", "Le vent vient du nord."],
      ["منتظر دستور بمان.", "Reste en attente d'ordre."],
      ["چراغ خاموش.", "Feux éteints."],
      ["ادامه بده.", "Continue."],
      ["سکوت رادیو.", "Silence radio."],
    ],
  },
};

const LOCAL: [string, string][] = [
  ["Poste, je confirme le départ, silence.", "Poste, je confirme le départ, silence."],
  ["Relais Geneina, piste vue, on garde.", "Relais Geneina, piste vue, on garde."],
  ["Vent sable, visibilité mauvaise.", "Vent de sable, visibilité mauvaise."],
  ["Pas de réponse vers le contrôleur adverse.", "Pas de réponse vers le contrôleur adverse."],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function voiceAvailable(track: Track): { ok: boolean; reason: string } {
  const plat = PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  if (!plat || plat.origin === "XX") {
    return { ok: false, reason: "Hors mandat — pas de voix cible versée." };
  }
  if (plat.uasClass === "chasse") {
    return { ok: false, reason: "Chasse habitée — IFF seulement, pas de voix poste." };
  }
  const ch = interceptChannel(plat);
  if (ch.channel === "analog-fpv") {
    return { ok: true, reason: "Sous-porteuse analogique — voix cible démodulée." };
  }
  if (track.pilotFix) {
    return {
      ok: true,
      reason:
        "Voix interceptée sur le filet local du poste de pilotage (VHF/UHF), pas sur la liaison C2 chiffrée.",
    };
  }
  return {
    ok: false,
    reason: "Pas de gonio poste — filet voix non acquis. Métadonnées RF seulement.",
  };
}

export function transcriptFor(track: Track): TranscriptLine[] {
  const plat = PLATFORM_BY_ID[track.hypotheses[0]?.platformId ?? track.truePlatformId];
  const check = voiceAvailable(track);
  if (!plat || !check.ok) return [];
  const origin = plat.origin === "XX" ? "CN" : plat.origin;
  const pack = PACKS[origin];
  const seed = hash(track.id);
  const n =
    track.idState === "confirme"
      ? 8
      : track.idState === "candidat"
        ? 6
        : 4;
  const out: TranscriptLine[] = [];
  for (let i = 0; i < n; i++) {
    const useLocal = i % 3 === 2;
    const pair = useLocal
      ? LOCAL[(seed + i) % LOCAL.length]!
      : pack.lines[(seed + i * 3) % pack.lines.length]!;
    const conf = Math.min(
      94,
      58 + (track.pilotFix?.quality ?? 20) / 4 + (i % 4) * 3 - (useLocal ? 0 : 6),
    );
    out.push({
      id: `${track.id}-tx-${i}`,
      tS: 4 + i * 7 + (seed % 3),
      speaker: useLocal ? pack.relay : pack.operator,
      lang: useLocal ? "fr-FR" : pack.lang,
      original: pair[0],
      fr: pair[1],
      conf: Math.round(conf),
    });
  }
  return out;
}

export function transcriptText(track: Track): string {
  return transcriptFor(track)
    .map((l) => `[${l.speaker} · ${l.conf} %] ${l.original} / ${l.fr}`)
    .join("\n");
}

export function speakLine(line: TranscriptLine): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(line.original);
  u.lang = line.lang;
  u.rate = 0.92;
  u.pitch = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang.toLowerCase().startsWith(line.lang.slice(0, 2)));
  if (match) u.voice = match;
  window.speechSynthesis.speak(u);
  return u;
}

export function stopVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
