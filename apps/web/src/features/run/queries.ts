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
  type ActionPlanEnvelope,
  type AppliedJobsEnvelope,
  type Dashboard,
  type JobsEnvelope,
  type RunStatus,
} from "@/lib/api";
import type { LogsEnvelope } from "@/features/logs/queries";

export const runStatusKey = ["run", "status"] as const;

export function useRunStatus() {
  return useQuery({
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

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunStatus>("/api/run"),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: runStatusKey });
      const previousStatus = qc.getQueryData<RunStatus>(runStatusKey);
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
    onSettled: () => qc.invalidateQueries({ queryKey: runStatusKey }),
  });
}

export function useAbortRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/run/abort"),
    onSuccess: () => qc.invalidateQueries({ queryKey: runStatusKey }),
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
        pagination: { offset: 0, limit: 0, nextOffset: 0, hasMore: false },
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
