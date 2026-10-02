import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COP_LOCK_MSG } from "@/lib/vigilair/guard";
import { setCopLock } from "@/lib/vigilair/guard-ops";
import { withChefSeal } from "@/lib/vigilair/seal-client";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";

export function GuardBanner() {
  const lock = useVigilair((s) => s.copLock);
  const setLock = useVigilair((s) => s.setCopLock);
  const { isSuperadmin } = useStaff();
  if (!lock?.locked) return null;

  const onUnlock = () => {
    void withChefSeal(() => setCopLock({ data: { locked: false, reason: "" } }))
      .then((row) => setLock(row))
      .catch(() => undefined);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-crit/40 bg-crit/15 px-4 py-2"
      role="alert"
    >
      <ShieldOff className="size-5 shrink-0 text-crit" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight">
          COP figé · tentative d'intrusion
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {lock.reason || COP_LOCK_MSG}
        </p>
      </div>
      {isSuperadmin ? (
        <Button type="button" size="sm" variant="outline" onClick={onUnlock}>
          Lever le verrou
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Chef alerté · lecture seule</p>
      )}
    </div>
  );
}
