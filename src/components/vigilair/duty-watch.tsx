import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth/client";
import { SIGN_IN_PATH } from "@/lib/auth/gates";
import {
  bindMyMachine,
  guardMyAccess,
  listIncidents,
  logOp,
  reportIncident,
} from "@/lib/vigilair/command";
import { onDuty } from "@/lib/vigilair/duty-bus";
import {
  EXFIL_MSG,
  isSoftwareHotkey,
  machineFingerprint,
} from "@/lib/vigilair/sentinel";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";

const EXTRACT_WINDOW_MS = 60_000;
const EXTRACT_LIMIT = 4;

/**
 * Garde de poste : présence, éjection, copie logiciel / dossier, clé déplacée.
 * Un agent déclenche alerte + coupure + dossier. Le chef n'est pas collé.
 */
export function DutyWatch() {
  const { isSuperadmin, profile } = useStaff();
  const seenIncidents = useRef(new Set<string>());
  const downloads = useRef<number[]>([]);
  const cutting = useRef(false);
  const lastKind = useRef<{ kind: string; at: number }>({ kind: "", at: 0 });
  const fpRef = useRef<{ fingerprint: string; machineLabel: string } | null>(null);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  const cut = (msg: string, query: "exfil" | "eject" | "machine") => {
    if (cutting.current) return;
    cutting.current = true;
    setLockMsg(msg);
    window.setTimeout(() => {
      void signOut(`${SIGN_IN_PATH}?${query}=1`);
    }, 1400);
  };

  useEffect(() => {
    if (isSuperadmin || !profile) return;
    let live = true;
    machineFingerprint()
      .then((fp) => {
        if (!live) return;
        fpRef.current = fp;
        return bindMyMachine({ data: fp });
      })
      .then((r) => {
        if (!live || !r) return;
        if (r.ejected) {
          cut(
            r.reason === "machine"
              ? "Cette clé est déjà liée à un autre poste. Session coupée."
              : EXFIL_MSG,
            r.reason === "machine" ? "machine" : "eject",
          );
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isSuperadmin, profile?.userId]);

  useEffect(() => {
    let live = true;
    const tick = () => {
      guardMyAccess()
        .then((g) => {
          if (!live) return;
          if (g.ejected) {
            cut(
              "Accès retiré. Session coupée. Toute reconnexion alerte le chef.",
              "eject",
            );
          }
        })
        .catch(() => {
          /* réseau — prochain cycle */
        });
      if (isSuperadmin) {
        listIncidents()
          .then((rows) => {
            if (!live) return;
            const alerts = useVigilair.getState().alerts;
            const existing = new Set(alerts.map((a) => a.id));
            const fresh = rows.filter(
              (r) =>
                !r.acked &&
                !seenIncidents.current.has(r.id) &&
                !existing.has(`sec-${r.id}`),
            );
            if (fresh.length === 0) return;
            for (const r of fresh) seenIncidents.current.add(r.id);
            const incoming = fresh.map((r) => ({
              id: `sec-${r.id}`,
              trackId: "",
              at: Date.parse(r.at) || Date.now(),
              level: "critique" as const,
              title: r.title,
              body: `${r.actor} · ${r.detail}${r.autoEjected ? " · session coupée" : ""}`,
              acked: false,
            }));
            useVigilair.setState({
              alerts: [...incoming, ...alerts].slice(0, 40),
            });
          })
          .catch(() => undefined);
      }
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [isSuperadmin]);

  useEffect(() => {
    return onDuty((e) => {
      if (isSuperadmin) {
        if (e.kind === "copy" || e.kind === "print" || e.kind === "delete_denied") return;
        void logOp({
          data: {
            kind: e.kind,
            title: e.title,
            detail: e.detail ?? "",
            trackId: e.trackId,
            severity: e.severity,
          },
        }).catch(() => undefined);
        return;
      }
      if (e.kind === "download") {
        const now = Date.now();
        downloads.current = downloads.current.filter((t) => now - t < EXTRACT_WINDOW_MS);
        downloads.current.push(now);
        if (downloads.current.length >= EXTRACT_LIMIT) {
          void reportAndCut("sabotage_folder", `Extraction massive · ${profile?.label ?? "agent"}`, `${downloads.current.length} dossiers PDF en moins d'une minute.`);
          downloads.current = [];
        } else {
          void logOp({
            data: {
              kind: "download",
              title: e.title,
              detail: e.detail ?? "",
              trackId: e.trackId,
              severity: e.severity ?? "warn",
            },
          }).catch(() => undefined);
        }
        return;
      }
      if (e.kind === "copy") {
        void reportAndCut("sabotage_copy", `Copie de données · ${profile?.label ?? "agent"}`, e.detail || e.title);
        return;
      }
      if (e.kind === "print") {
        void reportAndCut("sabotage_print", `Impression · ${profile?.label ?? "agent"}`, "Tentative d'impression / export du COP.");
        return;
      }
      if (e.kind === "delete_denied") {
        void reportAndCut("delete_denied", `Effacement refusé · ${profile?.label ?? "agent"}`, e.detail || "Seul le chef de division peut modifier ou effacer.");
        return;
      }
      void logOp({
        data: {
          kind: e.kind,
          title: e.title,
          detail: e.detail ?? "",
          trackId: e.trackId,
          severity: e.severity,
        },
      }).catch(() => undefined);
    });

    async function reportAndCut(
      kind: "sabotage_copy" | "sabotage_extract" | "sabotage_print" | "sabotage_software" | "sabotage_folder" | "delete_denied",
      title: string,
      detail: string,
    ) {
      if (cutting.current) return;
      const now = Date.now();
      if (lastKind.current.kind === kind && now - lastKind.current.at < 8000) return;
      lastKind.current = { kind, at: now };
      try {
        const r = await reportIncident({
          data: {
            kind,
            title,
            detail,
            fingerprint: fpRef.current?.fingerprint,
            machineLabel: fpRef.current?.machineLabel,
          },
        });
        if (r.ejected) cut(EXFIL_MSG, "exfil");
      } catch {
        /* réseau */
      }
    }
  }, [isSuperadmin, profile?.label]);

  useEffect(() => {
    if (isSuperadmin) return;

    const onCopy = (ev: ClipboardEvent) => {
      const text = ev.clipboardData?.getData("text") || window.getSelection()?.toString() || "";
      if (text.trim().length < 48) return;
      ev.preventDefault();
      void reportIncident({
        data: {
          kind: "sabotage_copy",
          title: `Copie presse-papiers · ${profile?.label ?? "agent"}`,
          detail: `${text.trim().length} caractères copiés depuis le COP.`,
          fingerprint: fpRef.current?.fingerprint,
          machineLabel: fpRef.current?.machineLabel,
        },
      })
        .then((r) => {
          if (r.ejected) cut(EXFIL_MSG, "exfil");
        })
        .catch(() => undefined);
    };

    const onPrint = () => {
      void reportIncident({
        data: {
          kind: "sabotage_print",
          title: `Impression · ${profile?.label ?? "agent"}`,
          detail: "beforeprint — export papier / PDF système.",
          fingerprint: fpRef.current?.fingerprint,
          machineLabel: fpRef.current?.machineLabel,
        },
      })
        .then((r) => {
          if (r.ejected) cut(EXFIL_MSG, "exfil");
        })
        .catch(() => undefined);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isSoftwareHotkey(e)) return;
      e.preventDefault();
      const folder = e.key.toLowerCase() === "p";
      void reportIncident({
        data: {
          kind: folder ? "sabotage_folder" : "sabotage_software",
          title: folder
            ? `Impression / export dossier · ${profile?.label ?? "agent"}`
            : `Copie du logiciel · ${profile?.label ?? "agent"}`,
          detail: folder
            ? "Ctrl+P — tentative d'emporter un dossier hors du COP."
            : `Raccourci ${e.key} — tentative d'emporter VIGILAIR hors du poste scellé.`,
          fingerprint: fpRef.current?.fingerprint,
          machineLabel: fpRef.current?.machineLabel,
        },
      })
        .then((r) => {
          if (r.ejected) cut(EXFIL_MSG, "exfil");
        })
        .catch(() => undefined);
    };

    const onDrag = (ev: DragEvent) => {
      const types = ev.dataTransfer?.types;
      if (!types) return;
      const listed = Array.from(types);
      if (!listed.includes("Files") && !listed.includes("text/uri-list")) return;
      ev.preventDefault();
      void reportIncident({
        data: {
          kind: "sabotage_folder",
          title: `Copie d'un dossier · ${profile?.label ?? "agent"}`,
          detail: "Glisser-déposer hors du COP.",
          fingerprint: fpRef.current?.fingerprint,
          machineLabel: fpRef.current?.machineLabel,
        },
      })
        .then((r) => {
          if (r.ejected) cut(EXFIL_MSG, "exfil");
        })
        .catch(() => undefined);
    };

    document.addEventListener("copy", onCopy);
    window.addEventListener("beforeprint", onPrint);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("dragstart", onDrag);
    return () => {
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("beforeprint", onPrint);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("dragstart", onDrag);
    };
  }, [isSuperadmin, profile?.label]);

  if (!lockMsg) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/95 p-6">
      <div className="max-w-md space-y-3 rounded-md border border-crit/40 bg-surface p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-crit">
          Session coupée
        </p>
        <p className="text-sm font-semibold">Sentinelle VIGILAIR</p>
        <p className="text-sm text-muted-foreground">{lockMsg}</p>
        <p className="text-xs text-muted-foreground">
          Incident documenté, clé morte, chef de division alerté.
        </p>
      </div>
    </div>
  );
}
