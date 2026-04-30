/**
 * Run-progress banner shown at the top of the main content area while
 * a scan is active. Pulls live state from /api/run/status (polled by
 * useRunStatus) so it appears as soon as a scan starts and disappears
 * when it completes. The same shell slot also surfaces a strong idle
 * warning when the most recent run was fully quota-blocked.
 */
import { useEffect, useRef, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useLatestRunResult, useRunStatus, useScanQuota, runStatusKey, startRunMutationKey } from "@/features/run/queries";
import { formatFullyBlockedBanner, formatRunCompletionToast, isQueuedRunPending, wasRunFullyQuotaBlocked } from "@/features/run/presentation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { RunStatus } from "@/lib/api";

const COMPLETION_LINGER_MS = 1800;

export function RunProgress() {
  const queryClient = useQueryClient();
  const { data } = useRunStatus();
  const { data: latestRun } = useLatestRunResult();
  const { data: quota } = useScanQuota();
  const startMutations = useIsMutating({ mutationKey: startRunMutationKey });
  const [lastActiveStatus, setLastActiveStatus] = useState<RunStatus | null>(null);
  const [lingerUntil, setLingerUntil] = useState<number | null>(null);
  const wasActiveRef = useRef(false);

  // React Query can briefly have no server-backed run status while the
  // long-running `/api/run` mutation is still in flight. Reuse the locally
  // optimistic snapshot so the shell-level progress banner appears
  // immediately on the first click instead of relying on the next poll.
  const cachedStatus = queryClient.getQueryData<RunStatus>(runStatusKey);
  const status = data ?? cachedStatus ?? null;
  const isStarting = startMutations > 0;
  const serverActive = data?.active === true;
  const queuedPending = isQueuedRunPending(latestRun);
  const isActive = serverActive || isStarting || queuedPending;

  useEffect(() => {
    if (serverActive && data) {
      setLastActiveStatus(data);
      setLingerUntil(null);
      // Only the real server-backed active state is allowed to transition into
      // the completed linger banner. A 202 Accepted mutation by itself is only
      // a queued run request, not proof that company scans have started.
      wasActiveRef.current = true;
      return;
    }

    if (wasActiveRef.current && lastActiveStatus && lingerUntil === null) {
      // Keep the progress shell visible briefly after a fast scan completes so
      // users can actually perceive the scan lifecycle instead of only seeing
      // start/finish toasts with no persistent progress banner in between.
      setLingerUntil(Date.now() + COMPLETION_LINGER_MS);
      wasActiveRef.current = false;
    }
  }, [data, lastActiveStatus, lingerUntil, serverActive]);

  useEffect(() => {
    if (lingerUntil === null) return undefined;
    const remainingMs = lingerUntil - Date.now();
    if (remainingMs <= 0) {
      setLingerUntil(null);
      // Clear the cached active snapshot once the completion linger window has
      // elapsed so an old "scan finished" banner cannot reappear forever.
      setLastActiveStatus(null);
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setLingerUntil(null);
      setLastActiveStatus(null);
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [lingerUntil]);

  const shouldShowCompletedLinger = !isActive && lingerUntil !== null && lastActiveStatus !== null;

  if (!isActive && !shouldShowCompletedLinger) {
    if (!wasRunFullyQuotaBlocked(latestRun)) return null;
    return (
      <div className="mx-6 mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 text-amber-600" />
          <div className="space-y-1">
            <div className="text-sm font-semibold text-amber-900">Last scan was quota-limited</div>
            {/* Keep this shell-level state explicit so users do not have to infer
                an all-blocked run from unchanged jobs tables deeper in the app. */}
            <div className="text-[12.5px] text-amber-900/80">
              {formatFullyBlockedBanner(latestRun, quota)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Derive the displayed banner state without introducing extra hooks below
  // the early-return branch. This keeps render order stable across the idle ->
  // active transition that happens when a scan starts.
  const bannerStatus = serverActive
    ? (data ?? lastActiveStatus)
    : isStarting
      ? (status ?? lastActiveStatus)
      : queuedPending
        ? (status ?? lastActiveStatus)
      : lastActiveStatus;

  const fetched = bannerStatus?.fetchedCompanies ?? 0;
  const total = bannerStatus?.totalCompanies ?? 0;
  const percent = shouldShowCompletedLinger
    ? 100
    : typeof bannerStatus?.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(bannerStatus.percent * (bannerStatus.percent <= 1 ? 100 : 1))))
    : total > 0 ? Math.round((fetched / total) * 100) : 0;

  const title = shouldShowCompletedLinger
    ? "Scan finished"
    : isStarting
      ? "Scan starting"
      : queuedPending && !serverActive
        ? "Scan queued"
        : "Scan in progress";
  const progressLabel = total > 0
    ? `${fetched}/${total} companies${bannerStatus?.currentCompany ? ` · ${bannerStatus.currentCompany}` : ""}`
    : queuedPending || isStarting
      ? "Preparing company progress…"
      : bannerStatus?.currentCompany ?? "Waiting for company progress…";
  const detail = shouldShowCompletedLinger
    ? formatRunCompletionToast(latestRun ?? {
      ok: true,
      runAt: new Date().toISOString(),
      totalNewMatches: 0,
      totalUpdatedMatches: 0,
      totalMatched: 0,
      totalFetched: 0,
      byCompany: {},
      emailedJobs: [],
      emailedUpdatedJobs: [],
      emailStatus: "skipped",
      emailError: null,
      scanMeta: {
        cacheHits: 0,
        liveFetchCompanies: 0,
        quotaBlockedCompanies: [],
        remainingLiveScansToday: quota?.remainingLiveScansToday ?? null,
        filteredOutCompanies: 0,
        filteredOutJobs: 0,
      },
    })
    : queuedPending && !serverActive && !isStarting
      ? "Scan request accepted. Progress will appear here as soon as scanning begins."
      : bannerStatus?.detail ?? (isStarting ? "starting scan" : undefined);

  return (
    <div className="mx-6 mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-sm font-semibold inline-flex items-center gap-2">
            {shouldShowCompletedLinger
              ? <CheckCircle2 size={14} className="text-emerald-600" />
              : <Loader2 size={14} className="animate-spin text-[hsl(var(--primary))]" />}
            {title}
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {progressLabel}
          </div>
        </div>
        <strong className="text-sm">{percent}%</strong>
      </div>
      <div className="h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
        <div
          className="h-full bg-[hsl(var(--primary))] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {detail && (
        <div className="mt-2 text-[12.5px] text-[hsl(var(--muted-foreground))]">{detail}</div>
      )}
    </div>
  );
}
