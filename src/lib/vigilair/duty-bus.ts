/** Bus client : le COP signale une action, DutyWatch la verse au serveur. */

export type DutyKind =
  | "lock"
  | "ident"
  | "m4"
  | "bulletin"
  | "ew"
  | "clip"
  | "download"
  | "copy"
  | "print"
  | "delete_denied"
  | "replay";

export type DutyEvent = {
  kind: DutyKind;
  title: string;
  detail?: string;
  trackId?: string;
  severity?: "info" | "warn" | "crit";
};

type DutyListener = (e: DutyEvent) => void;

const listeners = new Set<DutyListener>();

export function emitDuty(e: DutyEvent): void {
  for (const fn of listeners) fn(e);
}

export function onDuty(fn: DutyListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
