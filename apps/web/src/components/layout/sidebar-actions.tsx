/**
 * Sidebar footer — action buttons that mirror the vanilla app:
 *   - Scan       (primary, kicks off /api/run)
 *   - Clear cache
 *   - Clean broken links
 *   - Reset data (destructive — confirm)
 *
 * All buttons disable themselves while a scan is active to avoid
 * concurrent destructive operations.
 */
import { useRef, useEffect } from "react";
import { Play, Trash2, Wand2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useStartRun, useAbortRun, useRunStatus, useClearCache, useRemoveBrokenLinks,
} from "@/features/run/queries";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

export function SidebarActions() {
  const status = useRunStatus();
  const startRun = useStartRun();
  const abortRun = useAbortRun();
  const clearCache = useClearCache();
  const removeBroken = useRemoveBrokenLinks();
  const qc = useQueryClient();
  const prevActive = useRef(false);

  const active = status.data?.active === true || startRun.isPending;
  const busy = abortRun.isPending || clearCache.isPending || removeBroken.isPending;

  useEffect(() => {
    if (prevActive.current && !active) {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
    prevActive.current = active;
  }, [active, qc]);

  return (
    <div className="p-3 border-t border-[hsl(var(--border))] flex flex-col gap-2">
      {active ? (
        <Button
          variant="destructive"
          onClick={() => abortRun.mutate(undefined, {
            onSuccess: () => toast("Scan aborted", "info"),
            onError: (e) => toast(e instanceof Error ? e.message : "Abort failed", "error"),
          })}
          disabled={busy || startRun.isPending}
        >
          {abortRun.isPending || startRun.isPending ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
          {startRun.isPending ? "Starting…" : "Stop scan"}
        </Button>
      ) : (
        <Button
          onClick={() => startRun.mutate(undefined, {
            onSuccess: () => toast("Scan started"),
            onError: (e) => toast(e instanceof Error ? e.message : "Start failed", "error"),
          })}
          disabled={busy}
        >
          {startRun.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run scan
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={busy || active}
        onClick={() => {
          if (!window.confirm("Clear Cache will remove only available jobs and cached scan results. Applied jobs will stay. Continue?")) return;
          clearCache.mutate(undefined, { onSuccess: () => toast("Cache cleared") });
        }}>
        <Trash2 size={13} /> Clear cache
      </Button>
      <Button variant="outline" size="sm" disabled={busy || active}
        onClick={() => {
          if (!window.confirm("Remove all jobs whose listing URL no longer resolves? This cannot be undone.")) return;
          removeBroken.mutate(undefined, { onSuccess: (r) => toast(`Removed ${r.removed ?? 0} broken links`) });
        }}>
        <Wand2 size={13} /> Clean broken links
      </Button>
    </div>
  );
}
