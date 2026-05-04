/**
 * Hooks for the long-running scan ("run") workflow.
 *
 * `useRunStatus` polls /api/run/status every 2 seconds while a scan is
 * active so the progress monitor in the sidebar updates in near real
 * time, and pauses polling when no run is in flight.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type ActionPlanEnvelope,
  type AppliedJobsEnvelope,
  type Dashboard,
  type JobsEnvelope,
  type ScanContextEnvelope,
  type RunStartResponse,
  type RunStatus,
  type ScanQuotaEnvelope,
} from "@/lib/api";
import type { LogsEnvelope } from "@/features/logs/queries";
import { isAcceptedRun } from "./presentation";

export const runStatusKey = ["run", "status"] as const;
export const latestRunResultKey = ["run", "latest-result"] as const;
export const scanQuotaKey = ["run", "scan-quota"] as const;
export const scanContextKey = ["run", "scan-context"] as const;
export const startRunMutationKey = ["run", "start"] as const;

function normalizeRunStartResponse(result: RunStartResponse): RunStartResponse {
  // Keep the client resilient during phased deploys by filling in the new
  // quota-aware fields when an older backend response shape is returned.
  return {
    ...result,
    queuedAt: result.queuedAt ?? (isAcceptedRun(result) ? new Date().toISOString() : result.runAt),
    scanMeta: {
      cacheHits: result.scanMeta?.cacheHits ?? 0,
      liveFetchCompanies: result.scanMeta?.liveFetchCompanies ?? 0,
      quotaBlockedCompanies: result.scanMeta?.quotaBlockedCompanies ?? [],
      remainingLiveScansToday: result.scanMeta?.remainingLiveScansToday ?? null,
      filteredOutCompanies: result.scanMeta?.filteredOutCompanies ?? 0,
      filteredOutJobs: result.scanMeta?.filteredOutJobs ?? 0,
    },
  };
}

export function useRunStatus() {
  return useQuery<RunStatus>({
    queryKey: runStatusKey,
    queryFn: async () => {
      const result = await api.get<RunStatus & { activeRun?: RunStatus }>("/api/run/status");
      // Accept both the newer flattened shape and the older nested activeRun
      // response so the progress UI survives incremental backend deploys.
      if (result.active !== undefined) return result;
      if (!result.activeRun) return result;
      return {
        ...result.activeRun,
        ok: true,
        active: true,
      };
    },
    refetchInterval: (q) => (q.state.data?.active ? 2000 : 30_000),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useLatestRunResult() {
  return useQuery({
    queryKey: latestRunResultKey,
    // Keep this query local-only. We only use it to preserve the latest run
    // completion summary in memory after the long-running mutation settles.
    enabled: false,
    initialData: null as RunStartResponse | null,
    queryFn: () => Promise.resolve(null as RunStartResponse | null),
    staleTime: Infinity,
  });
}

export function useScanQuota() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: scanQuotaKey,
    queryFn: () => api.get<ScanQuotaEnvelope>("/api/scan-quota"),
    // Refresh quota passively while a run is active so the remaining count
    // updates soon after completion without forcing manual reloads.
    refetchInterval: () => (qc.getQueryData<RunStatus>(runStatusKey)?.active ? 5_000 : 60_000),
    staleTime: 10_000,
  });
}

export function useScanContext(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: scanContextKey,
    queryFn: () => api.get<ScanContextEnvelope>("/api/scan-context"),
    enabled: options.enabled !== false,
    staleTime: 60_000,
    // This endpoint is invoked right before manual scan confirmation. A brief
    // retry is acceptable here because the user is already waiting on the run
    // action and 429s are typically transient concurrency bursts.
    retry: (failureCount, error) => error instanceof ApiError && error.status === 429 && failureCount < 1,
    retryDelay: 750,
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: startRunMutationKey,
    mutationFn: async (payload?: { confirmLargeScan?: boolean }) =>
      normalizeRunStartResponse(await api.post<RunStartResponse>("/api/run", payload)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: runStatusKey });
      const previousStatus = qc.getQueryData<RunStatus>(runStatusKey);
      // Starting a new scan should clear the previous completion snapshot
      // immediately so the progress shell cannot briefly flash the old
      // "Scan finished" banner before the new queued/progress state arrives.
      qc.setQueryData(latestRunResultKey, null);
      // `/api/run` is a long-running request today, so flip the UI into an
      // active polling state immediately instead of waiting for the mutation to
      // finish before the first `/api/run/status` refresh happens.
      qc.setQueryData<RunStatus>(runStatusKey, {
        ok: true,
        active: true,
        triggerType: "manual",
        startedAt: new Date().toISOString(),
        fetchedCompanies: 0,
        totalCompanies: previousStatus?.totalCompanies,
        detail: "starting scan",
        message: "scan starting",
        percent: 0,
      });
      return { previousStatus };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousStatus) {
        qc.setQueryData(runStatusKey, context.previousStatus);
        return;
      }
      qc.removeQueries({ queryKey: runStatusKey, exact: true });
    },
    onSuccess: (result) => {
      // Persist both accepted and completed responses so the UI can keep a
      // scan in a visible queued state until the first real progress heartbeat
      // arrives from `/api/run/status`.
      qc.setQueryData(latestRunResultKey, result);
      if (result.status === "accepted") {
        qc.setQueryData<RunStatus>(runStatusKey, (current) => ({
          ok: true,
          active: current?.active ?? true,
          runId: result.runId ?? current?.runId,
          triggerType: "manual",
          startedAt: current?.startedAt ?? result.queuedAt ?? new Date().toISOString(),
          fetchedCompanies: current?.fetchedCompanies ?? 0,
          totalCompanies: current?.totalCompanies,
          detail: "scan queued",
          message: "scan queued",
          percent: current?.percent ?? 0,
        }));
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: runStatusKey });
      qc.invalidateQueries({ queryKey: scanQuotaKey });
    },
  });
}

export function useAbortRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { runId?: string | null }) => api.post<{ ok: boolean; cleared?: boolean; aborted?: boolean; runId?: string | null }>("/api/run/abort", payload),
    onSuccess: () => {
      // Clear both the queued banner snapshot and the optimistic active status
      // immediately so aborting a just-queued run feels responsive on click.
      qc.setQueryData(latestRunResultKey, null);
      qc.setQueryData<RunStatus>(runStatusKey, {
        ok: true,
        active: false,
      });
      qc.invalidateQueries({ queryKey: runStatusKey });
    },
  });
}

export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/cache/clear"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useResetData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/data/clear"),
    onSuccess: async () => {
      // After a destructive reset, overwrite mounted query results before
      // refetching so dashboard widgets cannot keep showing stale analytics.
      await Promise.all([
        qc.cancelQueries({ queryKey: ["jobs"] }),
        qc.cancelQueries({ queryKey: ["applied"] }),
        qc.cancelQueries({ queryKey: ["actionPlan"] }),
        qc.cancelQueries({ queryKey: ["dashboard"] }),
        qc.cancelQueries({ queryKey: ["logs"] }),
      ]);

      const emptyJobs: JobsEnvelope = {
        ok: true,
        total: 0,
        pagination: { limit: 0, nextCursor: null, hasMore: false },
        totals: { availableJobs: 0, newJobs: 0, updatedJobs: 0 },
        companyOptions: [],
        jobs: [],
      };
      const emptyApplied: AppliedJobsEnvelope = { ok: true, jobs: [], companyOptions: [] };
      const emptyActionPlan: ActionPlanEnvelope = { ok: true, jobs: [] };
      const emptyDashboard: Dashboard = {
        ok: true,
        kpis: {
          availableJobs: 0,
          appliedJobs: 0,
          totalTrackedJobs: 0,
          newJobsLatestRun: 0,
          updatedJobsLatestRun: 0,
          applicationRatio: 0,
          interviewRatio: 0,
          offerRatio: 0,
          interview: 0,
          negotiations: 0,
          offered: 0,
          rejected: 0,
          companiesDetected: 0,
          totalFetched: 0,
          matchRate: 0,
        },
        statusBreakdown: {},
        keywordCounts: {},
      };
      const emptyLogs: LogsEnvelope = { ok: true, logs: [], total: 0, retentionHours: 24, companyOptions: [], runOptions: [] };

      qc.setQueriesData<JobsEnvelope>({ queryKey: ["jobs"] }, emptyJobs);
      qc.setQueriesData<AppliedJobsEnvelope>({ queryKey: ["applied"] }, emptyApplied);
      qc.setQueriesData<ActionPlanEnvelope>({ queryKey: ["actionPlan"] }, emptyActionPlan);
      qc.setQueryData<Dashboard>(["dashboard"], emptyDashboard);
      qc.setQueriesData<LogsEnvelope>({ queryKey: ["logs"] }, emptyLogs);

      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}

export function useRemoveBrokenLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; removed?: number }>("/api/jobs/remove-broken-links"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useToggleAllCompanies() {
  return useMutation({
    mutationFn: (paused: boolean) => api.post<{ ok: boolean }>("/api/companies/toggle-all", { paused }),
  });
}
