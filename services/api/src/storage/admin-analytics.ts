import { billingTableName, eventsTableName, getRow, putRow, queryRows, registryTableName, scanAllRows } from "../aws/dynamo";
import { nowISO } from "../lib/utils";

const ADMIN_ANALYTICS_CACHE_TTL_SECONDS = 60 * 60;
const ADMIN_ANALYTICS_WINDOW_DAYS = 30;
const ADMIN_ANALYTICS_QUERY_LIMIT = 1000;
const EVENTS_INDEX_NAME = "eventType-index";

type EventRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  eventType: string;
  actor: string;
  createdAt: string;
  details?: Record<string, unknown>;
};

type AdminAnalyticsCacheRow<T> = {
  pk: "ADMIN#STATS";
  sk: string;
  data: T;
  cachedAt: string;
  cacheExpiresAt: string;
  expiresAtEpoch: number;
};

type GrowthAnalytics = {
  signupsPerDay: Array<{ date: string; count: number }>;
  activationRate: number;
  medianHoursToFirstScan: number | null;
  churnSignalCount: number;
};

type MarketIntelAnalytics = {
  mostScannedCompanies: Array<{ company: string; scanCount: number }>;
  scanVolumePerDay: Array<{ date: string; count: number }>;
  scanFailureRate: number;
};

type FeatureUsageAnalytics = {
  totalRunsLast30d: number;
  runDurationP50Ms: number | null;
  runDurationP95Ms: number | null;
  scanFailuresByLayer: Array<{ layer: string; count: number }>;
  jobViewedCount: number;
};

type SystemHealthAnalytics = {
  scanFailuresByReason: Array<{ reason: string; count: number }>;
  scanFailuresByAts: Array<{ atsType: string; count: number }>;
  recentFailures: Array<{ company: string; reason: string; layer: string; at: string }>;
};

type ScanQuotaAnalytics = {
  cacheHitRate: number;
  liveFetchRate: number;
  quotaBlockRate: number;
  totalRunsAnalyzed: number;
  totalCacheHits: number;
  totalLiveFetches: number;
  totalQuotaBlocked: number;
  perPlanUsage: Array<{ plan: string; totalLiveScansUsed: number; tenantCount: number; avgPerTenant: number }>;
  quotaUsagePerDay: Array<{ date: string; count: number }>;
};

type AnalyticsEnvelope<T> = {
  data: T;
  cachedAt: string;
  cacheExpiresAt: string;
};

function cacheSk(key: string): string {
  return `cache#${key}`;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
}

function toCountSeries(counts: Map<string, number>): Array<{ date: string; count: number }> {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

function incrementCount(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function dateKey(value?: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], percent: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function numericDetail(details: Record<string, unknown> | undefined, key: string): number | null {
  const value = details?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringDetail(details: Record<string, unknown> | undefined, key: string): string {
  const value = details?.[key];
  return typeof value === "string" ? value.trim() : "";
}

async function queryEvents(eventType: string, startIso: string, endIso: string): Promise<EventRow[]> {
  // Keep the first implementation bounded. We can add pagination later if the
  // admin analytics ceiling proves too low for active deployments.
  return queryRows<EventRow>(
    eventsTableName(),
    "gsi1pk = :eventType AND gsi1sk BETWEEN :start AND :end",
    { ":eventType": eventType, ":start": startIso, ":end": endIso },
    { indexName: EVENTS_INDEX_NAME, limit: ADMIN_ANALYTICS_QUERY_LIMIT }
  );
}

async function withAnalyticsCache<T>(key: string, compute: () => Promise<T>): Promise<AnalyticsEnvelope<T>> {
  const existing = await getRow<AdminAnalyticsCacheRow<T>>(
    registryTableName(),
    { pk: "ADMIN#STATS", sk: cacheSk(key) },
    true
  );

  const now = Date.now();
  if (existing) {
    const expiresAtMs = Date.parse(existing.cacheExpiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
      return {
        data: existing.data,
        cachedAt: existing.cachedAt,
        cacheExpiresAt: existing.cacheExpiresAt,
      };
    }
  }

  const data = await compute();
  const cachedAt = nowISO();
  const cacheExpiresAt = new Date(Date.now() + (ADMIN_ANALYTICS_CACHE_TTL_SECONDS * 1000)).toISOString();
  await putRow(registryTableName(), {
    pk: "ADMIN#STATS",
    sk: cacheSk(key),
    data,
    cachedAt,
    cacheExpiresAt,
    expiresAtEpoch: Math.floor(Date.now() / 1000) + ADMIN_ANALYTICS_CACHE_TTL_SECONDS,
  } satisfies AdminAnalyticsCacheRow<T>);

  return { data, cachedAt, cacheExpiresAt };
}

export async function getGrowthAnalytics(): Promise<AnalyticsEnvelope<GrowthAnalytics>> {
  return withAnalyticsCache("growth", async () => {
    const startIso = daysAgoIso(ADMIN_ANALYTICS_WINDOW_DAYS);
    const endIso = nowISO();
    const [userCreatedEvents, firstScanEvents, runCompletedEvents] = await Promise.all([
      queryEvents("USER_CREATED", startIso, endIso),
      queryEvents("FIRST_SCAN_RUN", startIso, endIso),
      queryEvents("RUN_COMPLETED", startIso, endIso),
    ]);

    const signupsPerDay = new Map<string, number>();
    const signedUpActors = new Set<string>();
    const activatedActors = new Set<string>();
    const completedActors = new Set<string>();
    const hoursToFirstScan: number[] = [];

    for (const event of userCreatedEvents) {
      incrementCount(signupsPerDay, dateKey(event.createdAt));
      signedUpActors.add(event.actor);
    }

    for (const event of firstScanEvents) {
      activatedActors.add(event.actor);
      const hoursAfterSignup = numericDetail(event.details, "hoursAfterSignup");
      if (hoursAfterSignup !== null) {
        hoursToFirstScan.push(hoursAfterSignup);
      }
    }

    for (const event of runCompletedEvents) {
      completedActors.add(event.actor);
    }

    let churnSignalCount = 0;
    const churnCutoffMs = Date.now() - (14 * 24 * 60 * 60 * 1000);
    for (const event of userCreatedEvents) {
      const createdAtMs = Date.parse(event.createdAt);
      if (Number.isFinite(createdAtMs) && createdAtMs <= churnCutoffMs && !completedActors.has(event.actor)) {
        churnSignalCount += 1;
      }
    }

    return {
      signupsPerDay: toCountSeries(signupsPerDay),
      activationRate: signedUpActors.size ? round(activatedActors.size / signedUpActors.size) : 0,
      medianHoursToFirstScan: percentile(hoursToFirstScan, 50),
      churnSignalCount,
    };
  });
}

export async function getMarketIntelAnalytics(): Promise<AnalyticsEnvelope<MarketIntelAnalytics>> {
  return withAnalyticsCache("market-intel", async () => {
    const startIso = daysAgoIso(ADMIN_ANALYTICS_WINDOW_DAYS);
    const endIso = nowISO();
    const [jobViewedEvents, runCompletedEvents, scanFailedEvents] = await Promise.all([
      queryEvents("JOB_VIEWED", startIso, endIso),
      queryEvents("RUN_COMPLETED", startIso, endIso),
      queryEvents("SCAN_FAILED", startIso, endIso),
    ]);

    const companyCounts = new Map<string, number>();
    const scanVolumePerDay = new Map<string, number>();
    for (const event of jobViewedEvents) {
      const companySlug = stringDetail(event.details, "companySlug");
      if (companySlug && companySlug !== "multi") {
        incrementCount(companyCounts, companySlug);
      }
    }

    for (const event of runCompletedEvents) {
      incrementCount(scanVolumePerDay, dateKey(event.createdAt));
    }

    return {
      mostScannedCompanies: [...companyCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 20)
        .map(([company, scanCount]) => ({ company, scanCount })),
      scanVolumePerDay: toCountSeries(scanVolumePerDay),
      scanFailureRate: (runCompletedEvents.length + scanFailedEvents.length)
        ? round(scanFailedEvents.length / (runCompletedEvents.length + scanFailedEvents.length))
        : 0,
    };
  });
}

export async function getFeatureUsageAnalytics(): Promise<AnalyticsEnvelope<FeatureUsageAnalytics>> {
  return withAnalyticsCache("feature-usage", async () => {
    const startIso = daysAgoIso(ADMIN_ANALYTICS_WINDOW_DAYS);
    const endIso = nowISO();
    const [runCompletedEvents, scanFailedEvents, jobViewedEvents] = await Promise.all([
      queryEvents("RUN_COMPLETED", startIso, endIso),
      queryEvents("SCAN_FAILED", startIso, endIso),
      queryEvents("JOB_VIEWED", startIso, endIso),
    ]);

    const durations = runCompletedEvents
      .map((event) => numericDetail(event.details, "durationMs"))
      .filter((value): value is number => value !== null);
    const failuresByLayer = new Map<string, number>();
    for (const event of scanFailedEvents) {
      const layer = stringDetail(event.details, "layer") || "unknown";
      incrementCount(failuresByLayer, layer);
    }

    return {
      totalRunsLast30d: runCompletedEvents.length,
      runDurationP50Ms: percentile(durations, 50),
      runDurationP95Ms: percentile(durations, 95),
      scanFailuresByLayer: [...failuresByLayer.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([layer, count]) => ({ layer, count })),
      jobViewedCount: jobViewedEvents.length,
    };
  });
}

export async function getScanQuotaAnalytics(): Promise<AnalyticsEnvelope<ScanQuotaAnalytics>> {
  return withAnalyticsCache("scan-quota", async () => {
    const startIso = daysAgoIso(ADMIN_ANALYTICS_WINDOW_DAYS);
    const endIso = nowISO();

    // Query aggregated per-run scan summaries emitted by buildInventory.
    const summaryEvents = await queryEvents("RUN_SCAN_SUMMARY", startIso, endIso);

    let totalCacheHits = 0;
    let totalLiveFetches = 0;
    let totalQuotaBlocked = 0;
    for (const event of summaryEvents) {
      totalCacheHits += numericDetail(event.details, "cacheHits") ?? 0;
      totalLiveFetches += numericDetail(event.details, "liveFetchCompanies") ?? 0;
      totalQuotaBlocked += numericDetail(event.details, "quotaBlocked") ?? 0;
    }
    const totalCompanySlots = totalCacheHits + totalLiveFetches + totalQuotaBlocked;
    const cacheHitRate = totalCompanySlots ? round(totalCacheHits / totalCompanySlots) : 0;
    const liveFetchRate = totalCompanySlots ? round(totalLiveFetches / totalCompanySlots) : 0;
    const quotaBlockRate = totalCompanySlots ? round(totalQuotaBlocked / totalCompanySlots) : 0;

    // Scan billing table for SCAN_USAGE#* rows in the window to build per-plan usage.
    const cutoffDate = startIso.slice(0, 10);
    const usageRows = await scanAllRows<{ pk: string; sk: string; liveScansUsed?: number }>(
      billingTableName(),
      {
        filterExpression: "begins_with(sk, :prefix) AND sk >= :cutoff",
        expressionAttributeValues: { ":prefix": "SCAN_USAGE#", ":cutoff": `SCAN_USAGE#${cutoffDate}` },
      },
    );

    // Group usage by tenant, then join with subscription plan.
    const usageByTenant = new Map<string, number>();
    const usageByDate = new Map<string, number>();
    for (const row of usageRows) {
      const tenantId = row.pk.replace(/^USER#/, "");
      const date = row.sk.replace(/^SCAN_USAGE#/, "");
      const used = row.liveScansUsed ?? 0;
      usageByTenant.set(tenantId, (usageByTenant.get(tenantId) ?? 0) + used);
      incrementCount(usageByDate, date, used);
    }

    // Look up plan for each tenant (best-effort, unknown plan if lookup fails).
    const planGroups = new Map<string, { total: number; tenants: Set<string> }>();
    await Promise.all(
      [...usageByTenant.entries()].map(async ([tenantId, used]) => {
        let plan = "unknown";
        try {
          const sub = await queryRows<{ plan?: string }>(
            billingTableName(),
            "pk = :pk AND sk = :sk",
            { ":pk": `USER#${tenantId}`, ":sk": "SUBSCRIPTION" },
            { limit: 1, consistentRead: false },
          );
          plan = sub[0]?.plan ?? "unknown";
        } catch { /* skip */ }
        if (!planGroups.has(plan)) planGroups.set(plan, { total: 0, tenants: new Set() });
        const group = planGroups.get(plan)!;
        group.total += used;
        group.tenants.add(tenantId);
      })
    );

    const perPlanUsage = [...planGroups.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([plan, { total, tenants }]) => ({
        plan,
        totalLiveScansUsed: total,
        tenantCount: tenants.size,
        avgPerTenant: tenants.size ? round(total / tenants.size) : 0,
      }));

    return {
      cacheHitRate,
      liveFetchRate,
      quotaBlockRate,
      totalRunsAnalyzed: summaryEvents.length,
      totalCacheHits,
      totalLiveFetches,
      totalQuotaBlocked,
      perPlanUsage,
      quotaUsagePerDay: toCountSeries(usageByDate),
    };
  });
}

export async function getSystemHealthAnalytics(): Promise<AnalyticsEnvelope<SystemHealthAnalytics>> {
  return withAnalyticsCache("system-health", async () => {
    const startIso = daysAgoIso(ADMIN_ANALYTICS_WINDOW_DAYS);
    const endIso = nowISO();
    const scanFailedEvents = await queryEvents("SCAN_FAILED", startIso, endIso);

    const failuresByReason = new Map<string, number>();
    const failuresByAts = new Map<string, number>();
    const recentFailures = scanFailedEvents
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20)
      .map((event) => ({
        company: stringDetail(event.details, "company"),
        reason: stringDetail(event.details, "failureReason"),
        layer: stringDetail(event.details, "layer"),
        at: event.createdAt,
      }));

    for (const event of scanFailedEvents) {
      incrementCount(failuresByReason, stringDetail(event.details, "failureReason") || "unknown");
      incrementCount(failuresByAts, stringDetail(event.details, "atsType") || "unknown");
    }

    return {
      scanFailuresByReason: [...failuresByReason.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([reason, count]) => ({ reason, count })),
      scanFailuresByAts: [...failuresByAts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([atsType, count]) => ({ atsType, count })),
      recentFailures,
    };
  });
}
