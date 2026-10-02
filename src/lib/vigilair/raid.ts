import { PLATFORM_BY_ID, originLabel, threatRank } from "./catalog";
import { isFriend } from "./friends";
import type { Origin, Threat, Track } from "./types";

export type Raid = {
  corridor: string;
  count: number;
  origins: Origin[];
  originLabels: string[];
  trackIds: string[];
  worst: Threat;
  leadCallsign: string;
};

const RAID_MIN = 3;

function threatOf(track: Track): Threat {
  const id = track.hypotheses[0]?.platformId ?? track.truePlatformId;
  return PLATFORM_BY_ID[id]?.threat ?? "moderee";
}

/** Essaim / raid : ≥3 pistes mandatées issues du même couloir sahélien. */
export function detectRaids(tracks: Track[]): Raid[] {
  const live = tracks.filter(
    (t) =>
      t.idState !== "perdu" &&
      t.idState !== "hors-mandat" &&
      Boolean(t.corridor) &&
      !isFriend(t),
  );
  const by = new Map<string, Track[]>();
  for (const t of live) {
    const k = t.corridor!;
    const arr = by.get(k);
    if (arr) arr.push(t);
    else by.set(k, [t]);
  }
  const raids: Raid[] = [];
  for (const [corridor, group] of by) {
    if (group.length < RAID_MIN) continue;
    const origins = [...new Set(group.map((t) => t.origin ?? "XX"))].filter(
      (o) => o !== "XX",
    ) as Origin[];
    if (origins.length === 0) continue;
    let worst: Threat = "faible";
    let lead = group[0];
    for (const t of group) {
      const th = threatOf(t);
      if (threatRank(th) > threatRank(worst)) {
        worst = th;
        lead = t;
      }
    }
    raids.push({
      corridor,
      count: group.length,
      origins,
      originLabels: origins.map(originLabel),
      trackIds: group.map((t) => t.id),
      worst,
      leadCallsign: lead.callsign,
    });
  }
  raids.sort((a, b) => b.count - a.count || threatRank(b.worst) - threatRank(a.worst));
  return raids;
}

export function raidTrackIds(raids: Raid[]): Set<string> {
  const s = new Set<string>();
  for (const r of raids) for (const id of r.trackIds) s.add(id);
  return s;
}
