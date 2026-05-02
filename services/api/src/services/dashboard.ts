import { LAST_NEW_JOBS_COUNT_KEY, LAST_UPDATED_JOBS_COUNT_KEY } from "../constants";
import { jobStateKv } from "../lib/bindings";
import { tenantScopedKey } from "../lib/tenant";
import { jobKey } from "../lib/utils";
import type { AppliedJobRecord, Env, InventorySnapshot, TrendPoint } from "../types";

type DashboardPreloadedState = {
  trend: TrendPoint[];
  lastNewJobsCount: number;
  lastUpdatedJobsCount: number;
};

export function combinedKeywordCounts(
  inventory: InventorySnapshot,
  appliedJobs: Record<string, AppliedJobRecord>
): Record<string, number> {
  const counts = { ...inventory.stats.keywordCounts };
  const liveInventoryKeys = new Set(inventory.jobs.map((job) => jobKey(job)));

  for (const applied of Object.values(appliedJobs)) {
    if (liveInventoryKeys.has(applied.jobKey)) continue;
    for (const keyword of applied.job.matchedKeywords ?? []) {
      counts[keyword] = (counts[keyword] ?? 0) + 1;
    }
  }

  return counts;
}

export async function buildDashboardPayload(
  env: Env,
  inventory: InventorySnapshot,
  appliedJobs: Record<string, AppliedJobRecord>,
  tenantId?: string,
  preloadedState?: DashboardPreloadedState,
  companiesByAts?: Array<{ ats: string; count: number }>,
) {
  const appliedRows = Object.values(appliedJobs);
  const inventoryKeys = new Set(inventory.jobs.map((job) => jobKey(job)));

  const appliedCount = appliedRows.length;
  const interviewCount = appliedRows.filter((row) => row.status === "Interview").length;
  const negotiationsCount = appliedRows.filter((row) => row.status === "Negotiations").length;
  const offeredCount = appliedRows.filter((row) => row.status === "Offered").length;
  const rejectedCount = appliedRows.filter((row) => row.status === "Rejected").length;

  const availableJobs = inventory.jobs.filter((job) => !appliedJobs[jobKey(job)]).length;
  const totalTrackedJobs = availableJobs + appliedCount;
  const offMarketAppliedJobs = appliedRows.filter((row) => !inventoryKeys.has(row.jobKey)).length;

  const applicationRatio = totalTrackedJobs > 0 ? Math.round((appliedCount / totalTrackedJobs) * 1000) / 10 : 0;
  const interviewRatio = appliedCount > 0 ? Math.round((interviewCount / appliedCount) * 1000) / 10 : 0;
  const offerRatio = appliedCount > 0 ? Math.round((offeredCount / appliedCount) * 1000) / 10 : 0;
  const matchRate = inventory.stats.totalFetched > 0
    ? Math.round((inventory.stats.totalJobsMatched / inventory.stats.totalFetched) * 1000) / 10
    : 0;

  const trend: TrendPoint[] = [];

  // Dashboard callers that already loaded inventory state can skip these DynamoDB reads.
  const lastNewJobsCount = preloadedState?.lastNewJobsCount
    ?? (Number(await jobStateKv(env).get(tenantScopedKey(tenantId, LAST_NEW_JOBS_COUNT_KEY)) ?? "0") || 0);
  const lastUpdatedJobsCount = preloadedState?.lastUpdatedJobsCount
    ?? (Number(await jobStateKv(env).get(tenantScopedKey(tenantId, LAST_UPDATED_JOBS_COUNT_KEY)) ?? "0") || 0);

  const statusBreakdown = {
    Applied: appliedRows.filter((row) => row.status === "Applied").length,
    Interview: interviewCount,
    Rejected: rejectedCount,
    Negotiations: negotiationsCount,
    Offered: offeredCount,
  };

  return {
    generatedAt: new Date().toISOString(),
    appName: env.APP_NAME ?? "Career Jump",
    lastRunAt: inventory.runAt,
    trend,
    kpis: {
      availableJobs,
      appliedJobs: appliedCount,
      totalTrackedJobs,
      totalMatched: inventory.stats.totalJobsMatched,
      offMarketAppliedJobs,
      applicationRatio,
      interviewRatio,
      offerRatio,
      interview: interviewCount,
      negotiations: negotiationsCount,
      offered: offeredCount,
      rejected: rejectedCount,
      companiesConfigured: inventory.stats.totalCompaniesConfigured,
      companiesDetected: inventory.stats.totalCompaniesDetected,
      totalFetched: inventory.stats.totalFetched,
      matchRate,
      newJobsLatestRun: lastNewJobsCount,
      updatedJobsLatestRun: lastUpdatedJobsCount,
    },
    companiesByAts: companiesByAts ?? [],
    keywordCounts: combinedKeywordCounts(inventory, appliedJobs),
    statusBreakdown,
  };
}
