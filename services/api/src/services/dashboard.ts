import { DASHBOARD_SUMMARY_KEY, LAST_NEW_JOBS_COUNT_KEY, LAST_UPDATED_JOBS_COUNT_KEY } from "../constants";
import { jobStateKv } from "../lib/bindings";
import { tenantScopedKey } from "../lib/tenant";
import { jobKey } from "../lib/utils";
import type { AppliedJobRecord, Env, InventorySnapshot, TrendPoint } from "../types";

type DashboardPreloadedState = {
  trend: TrendPoint[];
  lastNewJobsCount: number;
  lastUpdatedJobsCount: number;
};

type DashboardActivityItem = {
  jobKey: string;
  company: string;
  jobTitle: string;
  status: string;
  appliedAt: string;
  lastStatusChangedAt?: string;
  location?: string;
};

type DashboardSummaryCountItem = {
  label: string;
  count: number;
};

type DashboardAppliedSummary = {
  statusCounts: Record<string, number>;
  topCompanies: DashboardSummaryCountItem[];
  topLocations: DashboardSummaryCountItem[];
  recentActivity: DashboardActivityItem[];
  staleApplications: DashboardActivityItem[];
};

export type DashboardPayload = {
  generatedAt: string;
  summaryBuiltAt: string;
  dashboardAsOf: string;
  inventorySource: string;
  freshnessProbeSkipped: boolean;
  staleReason: string | null;
  appName: string;
  lastRunAt?: string;
  trend: TrendPoint[];
  kpis: {
    availableJobs: number;
    appliedJobs: number;
    totalTrackedJobs: number;
    totalMatched: number;
    offMarketAppliedJobs: number;
    applicationRatio: number;
    interviewRatio: number;
    offerRatio: number;
    interview: number;
    negotiations: number;
    offered: number;
    rejected: number;
    companiesConfigured: number;
    companiesDetected: number;
    totalFetched: number;
    matchRate: number;
    newJobsLatestRun: number;
    updatedJobsLatestRun: number;
  };
  companiesByAts: Array<{ ats: string; count: number }>;
  keywordCounts: Record<string, number>;
  statusBreakdown: Record<string, number>;
  appliedSummary: DashboardAppliedSummary;
};

type CachedDashboardPayload = {
  fingerprint: string;
  generatedAt: string;
  payload: DashboardPayload;
};

export type DashboardFreshnessMeta = {
  inventorySource: string;
  freshnessProbeSkipped: boolean;
  staleReason: string | null;
};

function normalizeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

function summarizeCountItems(rows: string[], limit: number): DashboardSummaryCountItem[] {
  const counts = rows.reduce<Record<string, number>>((acc, value) => {
    const key = value.trim() || "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function activityTimestamp(row: AppliedJobRecord): number {
  return Date.parse(row.lastStatusChangedAt ?? row.appliedAt) || 0;
}

function toActivityItem(row: AppliedJobRecord): DashboardActivityItem {
  return {
    jobKey: row.jobKey,
    company: row.job.company,
    jobTitle: row.job.title,
    status: row.status,
    appliedAt: row.appliedAt,
    lastStatusChangedAt: row.lastStatusChangedAt,
    location: row.job.location,
  };
}

function summarizeAppliedRows(appliedRows: AppliedJobRecord[]): DashboardAppliedSummary {
  const statusCounts = {
    Applied: 0,
    Interview: 0,
    Negotiations: 0,
    Offered: 0,
    Rejected: 0,
  } satisfies Record<string, number>;

  for (const row of appliedRows) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  }

  const recentActivity = [...appliedRows]
    .sort((a, b) => activityTimestamp(b) - activityTimestamp(a))
    .slice(0, 6)
    .map(toActivityItem);

  const staleCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const staleApplications = appliedRows
    .filter((row) => row.status !== "Offered" && row.status !== "Rejected")
    .filter((row) => activityTimestamp(row) < staleCutoff)
    .sort((a, b) => activityTimestamp(a) - activityTimestamp(b))
    .slice(0, 6)
    .map(toActivityItem);

  return {
    statusCounts,
    topCompanies: summarizeCountItems(appliedRows.map((row) => row.job.company), 7),
    topLocations: summarizeCountItems(appliedRows.map((row) => row.job.location || "Unknown"), 6),
    recentActivity,
    staleApplications,
  };
}

function latestAppliedMutationAt(appliedRows: AppliedJobRecord[]): string {
  return appliedRows.reduce((latest, row) => {
    const value = row.lastStatusChangedAt ?? row.appliedAt;
    if (!latest || value.localeCompare(latest) > 0) return value;
    return latest;
  }, "");
}

export function buildDashboardSummaryFingerprint(
  inventory: InventorySnapshot,
  appliedJobs: Record<string, AppliedJobRecord>,
  companiesByAts: Array<{ ats: string; count: number }> = [],
  latestRunCounts: { lastNewJobsCount: number; lastUpdatedJobsCount: number } = {
    lastNewJobsCount: 0,
    lastUpdatedJobsCount: 0,
  },
): string {
  const appliedRows = Object.values(appliedJobs);
  return JSON.stringify({
    runAt: inventory.runAt,
    totalJobsMatched: inventory.stats.totalJobsMatched,
    totalFetched: inventory.stats.totalFetched,
    companiesConfigured: inventory.stats.totalCompaniesConfigured,
    companiesDetected: inventory.stats.totalCompaniesDetected,
    availableInventoryCount: inventory.jobs.length,
    appliedCount: appliedRows.length,
    latestAppliedMutationAt: latestAppliedMutationAt(appliedRows),
    // Latest-run badges must invalidate the cache when the counts change even
    // if the underlying inventory snapshot is otherwise identical.
    lastNewJobsCount: latestRunCounts.lastNewJobsCount,
    lastUpdatedJobsCount: latestRunCounts.lastUpdatedJobsCount,
    companiesByAts,
  });
}

export async function loadCachedDashboardPayload(
  env: Env,
  tenantId: string | undefined,
  fingerprint: string,
): Promise<DashboardPayload | null> {
  const cached = await jobStateKv(env).get(
    tenantScopedKey(tenantId, DASHBOARD_SUMMARY_KEY),
    "json",
  ) as CachedDashboardPayload | null;
  if (!cached || cached.fingerprint !== fingerprint) return null;
  return cached.payload;
}

export async function saveCachedDashboardPayload(
  env: Env,
  tenantId: string | undefined,
  fingerprint: string,
  payload: DashboardPayload,
): Promise<void> {
  const cached: CachedDashboardPayload = {
    fingerprint,
    generatedAt: new Date().toISOString(),
    payload,
  };
  await jobStateKv(env).put(
    tenantScopedKey(tenantId, DASHBOARD_SUMMARY_KEY),
    JSON.stringify(cached),
  );
}

export function summarizeCompaniesByAtsFromInventory(
  inventory: InventorySnapshot,
): Array<{ ats: string; count: number }> {
  return Object.entries(inventory.stats.bySource ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ats, count]) => ({ ats, count }));
}

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
  freshnessMeta: DashboardFreshnessMeta = {
    inventorySource: "stored-snapshot",
    freshnessProbeSkipped: false,
    staleReason: null,
  },
): Promise<DashboardPayload> {
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

  const applicationRatio = normalizeRatio(appliedCount, totalTrackedJobs);
  const interviewRatio = normalizeRatio(interviewCount + negotiationsCount + offeredCount, appliedCount);
  const offerRatio = normalizeRatio(offeredCount, appliedCount);
  const matchRate = normalizeRatio(inventory.stats.totalJobsMatched, inventory.stats.totalFetched);

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
  const appliedSummary = summarizeAppliedRows(appliedRows);

  return {
    generatedAt: new Date().toISOString(),
    summaryBuiltAt: new Date().toISOString(),
    dashboardAsOf: inventory.runAt,
    inventorySource: freshnessMeta.inventorySource,
    freshnessProbeSkipped: freshnessMeta.freshnessProbeSkipped,
    staleReason: freshnessMeta.staleReason,
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
    appliedSummary,
  };
}
