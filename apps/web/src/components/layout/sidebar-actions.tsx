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
  useStartRun, useAbortRun, useRunStatus, useClearCache, useRemoveBrokenLinks, useLatestRunResult, useScanQuota,
} from "@/features/run/queries";
import { formatLastRunSummary, formatRunCompletionToast, formatScanQuotaHint, isQueuedRunPending } from "@/features/run/presentation";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

export function SidebarActions() {
  const status = useRunStatus();
  const quota = useScanQuota();
  const latestRun = useLatestRunResult();
  const startRun = useStartRun();
  const abortRun = useAbortRun();
  const clearCache = useClearCache();
  const removeBroken = useRemoveBrokenLinks();
  const qc = useQueryClient();
  const prevActive = useRef(false);

  const queuedPending = isQueuedRunPending(latestRun.data);
  const active = status.data?.active === true || startRun.isPending || queuedPending;
  const busy = abortRun.isPending || clearCache.isPending || removeBroken.isPending;
  const abortableRunId = status.data?.runId ?? latestRun.data?.runId ?? null;

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
          onClick={() => abortRun.mutate({ runId: abortableRunId }, {
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
          onClick={() => {
            toast("Scan starting", "info");
            startRun.mutate(undefined, {
              onSuccess: (result) => toast(formatRunCompletionToast(result)),
              onError: (e) => toast(e instanceof Error ? e.message : "Start failed", "error"),
            });
          }}
          disabled={busy}
        >
          {startRun.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run scan
        </Button>
      )}
      {!active ? (
        <div className="rounded-md border border-[hsl(var(--border))]/60 bg-[hsl(var(--secondary))]/40 px-2.5 py-2 text-[12px] text-[hsl(var(--muted-foreground))]">
          {/* Keep quota and completion context visible while idle so users can
              tell whether the next scan will fetch live data or just reuse cache. */}
          <div>{formatScanQuotaHint(quota.data)}</div>
          <div className="mt-1">{formatLastRunSummary(latestRun.data)}</div>
        </div>
      ) : null}
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
