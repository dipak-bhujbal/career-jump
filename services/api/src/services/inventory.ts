import {
  DECISION_SUMMARY_PREFIX,
  DECISION_SUMMARY_TTL_SECONDS,
  DISCARDED_JOB_KEYS_KEY,
  INVENTORY_KEY,
  LAST_NEW_JOB_KEYS_KEY,
  LAST_NEW_JOBS_COUNT_KEY,
  LAST_UPDATED_JOB_KEYS_KEY,
  LAST_UPDATED_JOBS_COUNT_KEY,
} from "../constants";
import { jobStateKv } from "../lib/bindings";
import { logAppEvent } from "../lib/logger";
import { tenantScopedKey } from "../lib/tenant";
import { enrichJob, isInterestingTitle, jobKey, jobStableFingerprint, shouldKeepJobForUSInventory } from "../lib/utils";
import {
  ActiveRunOwnershipError,
  ensureActiveRunOwnership,
  firstSeenFingerprintKey,
  heartbeatActiveRun,
  legacySeenJobKeys,
  loadAppliedJobs,
  loadBillingSubscription,
  loadJobNotes,
  loadLatestRawScan,
  listCurrentRawScans,
  loadPlanConfig,
  markRegistryCompanyScanFailure,
  markRegistryCompanyScanMisconfigured,
  markRegistryCompanyScanSuccess,
  loadSystemWorkdayLayerFlags,
  loadWorkdayScanState,
  markWorkdayLayerPromotion,
  markWorkdayScanFailure,
  markWorkdayScanSuccess,
  promoteCustomCompaniesToRegistry,
  recordAppLog,
  recordEvent,
  saveRawScan,
  saveJobNotes,
  seenJobKey,
  shouldBypassLiveWorkdayScan,
  tryConsumeLiveScan,
  remainingLiveScans,
} from "../storage";
import { isScraperApiConfigured, scanWorkdayJobs } from "../ats/core/workday";
import { fetchJobsForDetectedConfig, getDetectedConfig } from "./discovery";
import { normalizeCompanyKey } from "../storage/tenant-keys";
import type {
  DetectedConfig,
  Env,
  InventorySnapshot,
  JobPosting,
  MatchDecisionSummary,
  RuntimeConfig,
  TrendPoint,
  UpdatedEmailJob,
  UpdatedJobChange,
  UserPlan,
  WorkdayScanLayer,
  WorkdayScanResult,
  WorkdayScanState,
} from "../types";

type DiscardReason =
  | "excluded_title"
  | "excluded_geography"
  | "not_returned_by_source"
  | "fetch_failed"
  | "skipped_unresolved_source";

export type InventoryDiff = {
  newJobs: JobPosting[];
  updatedJobs: JobPosting[];
};

type BuildInventoryMetadata = {
  firstSeenJobKeysThisRun: Set<string>;
  duplicateFingerprintJobKeysThisRun: Set<string>;
  firstSeenFingerprintsThisRun: Set<string>;
};

function companyIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function describeDetectedSource(config: Awaited<ReturnType<typeof getDetectedConfig>>): Record<string, unknown> {
  if (!config) return {};
  if (config.source !== "workday") return { detectedSource: config.source };
  return {
    detectedSource: config.source,
    workdayHost: config.host ?? null,
    workdayTenant: config.tenant ?? null,
    workdaySite: config.site ?? null,
    workdayBaseUrl: config.workdayBaseUrl ?? null,
    workdaySampleUrl: config.sampleUrl ?? null,
  };
}

function registryScanAdapterId(config: DetectedConfig | null, configuredSource?: string | null): string | null {
  if (config?.source === "registry-adapter") return config.adapterId ?? configuredSource ?? null;
  if (config?.source) return config.source;
  return configuredSource ?? null;
}

export type InventoryState = {
  inventory: InventorySnapshot | null;
  trend: TrendPoint[];
  lastNewJobsCount: number;
  lastNewJobKeys: string[];
  lastUpdatedJobsCount: number;
  lastUpdatedJobKeys: string[];
};

export type AvailableJobsCursor = {
  phase: "shared" | "manual";
  companyIndex: number;
  jobIndex: number;
  manualIndex: number;
  returnedCount: number;
};

export type StreamAvailableJobsFilters = {
  companies: string[];
  companySearch: string;
  location: string;
  keyword: string;
  source: string;
  usOnly: boolean;
  durationHours: number | null;
  newOnly: boolean;
  updatedOnly: boolean;
  appliedJobKeys: Set<string>;
  newJobKeys: Set<string>;
  updatedJobKeys: Set<string>;
};

export type StreamAvailableJobsPageResult = {
  jobs: JobPosting[];
  nextCursor: string | null;
  hasMore: boolean;
  inspectedCompanies: number;
  inspectedJobs: number;
  matchedJobs: number;
  durationMs: number;
};

export async function loadInventoryState(env: Env, tenantId?: string): Promise<InventoryState> {
  const [
    primaryExisting,
    trendRaw,
    lastNewCountRaw,
    lastNewKeysRaw,
    lastUpdatedCountRaw,
    lastUpdatedKeysRaw,
  ] = await Promise.all([
    jobStateKv(env).get(tenantScopedKey(tenantId, INVENTORY_KEY), "json"),
    Promise.resolve([]),
    jobStateKv(env).get(tenantScopedKey(tenantId, LAST_NEW_JOBS_COUNT_KEY)),
    jobStateKv(env).get(tenantScopedKey(tenantId, LAST_NEW_JOB_KEYS_KEY), "json"),
    jobStateKv(env).get(tenantScopedKey(tenantId, LAST_UPDATED_JOBS_COUNT_KEY)),
    jobStateKv(env).get(tenantScopedKey(tenantId, LAST_UPDATED_JOB_KEYS_KEY), "json"),
  ]);

  // Keep the tenant migration fallback ordered so legacy global inventory is only read when needed.
  const existing = primaryExisting ?? (tenantId ? await jobStateKv(env).get(INVENTORY_KEY, "json") : null);

  return {
    inventory: existing && typeof existing === "object" ? (existing as InventorySnapshot) : null,
    trend: Array.isArray(trendRaw) ? (trendRaw as TrendPoint[]) : [],
    lastNewJobsCount: Number(lastNewCountRaw ?? "0") || 0,
    lastNewJobKeys: Array.isArray(lastNewKeysRaw) ? lastNewKeysRaw.map(String) : [],
    lastUpdatedJobsCount: Number(lastUpdatedCountRaw ?? "0") || 0,
    lastUpdatedJobKeys: Array.isArray(lastUpdatedKeysRaw) ? lastUpdatedKeysRaw.map(String) : [],
  };
}

function encodeAvailableJobsCursor(cursor: AvailableJobsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeAvailableJobsCursor(rawCursor: string | null | undefined): AvailableJobsCursor {
  if (!rawCursor) {
    return { phase: "shared", companyIndex: 0, jobIndex: 0, manualIndex: 0, returnedCount: 0 };
  }

  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as Partial<AvailableJobsCursor>;
    const phase = parsed.phase === "manual" ? "manual" : "shared";
    return {
      phase,
      companyIndex: Math.max(0, Number(parsed.companyIndex) || 0),
      jobIndex: Math.max(0, Number(parsed.jobIndex) || 0),
      manualIndex: Math.max(0, Number(parsed.manualIndex) || 0),
      returnedCount: Math.max(0, Number(parsed.returnedCount) || 0),
    };
  } catch {
    return { phase: "shared", companyIndex: 0, jobIndex: 0, manualIndex: 0, returnedCount: 0 };
  }
}

function buildPreviousJobsByCompany(previousInventory: InventorySnapshot | null): Map<string, JobPosting[]> {
  const previousJobsByCompany = new Map<string, JobPosting[]>();
  for (const job of previousInventory?.jobs ?? []) {
    const key = companyIdentity(job.company);
    const rows = previousJobsByCompany.get(key) ?? [];
    rows.push(job);
    previousJobsByCompany.set(key, rows);
  }
  return previousJobsByCompany;
}

function sortJobsForInteractiveRead(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((left, right) => {
    const leftPostedAt = Date.parse(left.postedAt ?? "") || 0;
    const rightPostedAt = Date.parse(right.postedAt ?? "") || 0;
    if (leftPostedAt !== rightPostedAt) {
      return rightPostedAt - leftPostedAt;
    }
    return jobKey(left).localeCompare(jobKey(right));
  });
}

function matchesInteractiveAvailableJob(
  job: JobPosting,
  jobtitles: RuntimeConfig["jobtitles"],
  filters: StreamAvailableJobsFilters,
  discardRegistry: DiscardRegistry,
): boolean {
  if (!isInterestingTitle(job.title, jobtitles)) {
    return false;
  }
  if (!shouldKeepJobForUSInventory(job.location, job.title, job.url)) {
    return false;
  }
  if (isDiscarded(job, discardRegistry)) {
    return false;
  }

  const currentJobKey = jobKey(job);
  if (filters.appliedJobKeys.has(currentJobKey)) {
    return false;
  }
  if (filters.newOnly && !filters.newJobKeys.has(currentJobKey)) {
    return false;
  }
  if (filters.updatedOnly && !filters.updatedJobKeys.has(currentJobKey)) {
    return false;
  }
  if (filters.source && job.source !== filters.source) {
    return false;
  }
  if (filters.companies.length && !filters.companies.includes(job.company.toLowerCase())) {
    return false;
  }
  if (filters.companySearch && !job.company.toLowerCase().includes(filters.companySearch)) {
    return false;
  }
  if (filters.location && !job.location.toLowerCase().includes(filters.location)) {
    return false;
  }
  if (filters.keyword && !job.title.toLowerCase().includes(filters.keyword)) {
    return false;
  }
  if (filters.usOnly && job.isUSLikely === false) {
    return false;
  }
  if (filters.durationHours !== null) {
    if (!job.postedAt) return false;
    const postedAtMs = Date.parse(job.postedAt);
    if (!Number.isFinite(postedAtMs)) return false;
    const ageMs = Date.now() - postedAtMs;
    if (ageMs < 0 || ageMs > filters.durationHours * 60 * 60 * 1000) {
      return false;
    }
  }

  return true;
}

/**
 * Build the first visible jobs page incrementally instead of materializing the
 * full available-jobs inventory. The interactive route only needs enough rows
 * to paint the current page, so stop once the requested limit is satisfied.
 */
export async function streamAvailableJobsPage(
  env: Env,
  config: RuntimeConfig,
  previousInventory: InventorySnapshot | null,
  tenantId: string | undefined,
  limit: number,
  rawCursor: string | null | undefined,
  filters: StreamAvailableJobsFilters,
  maxVisibleJobs: number | null = null,
): Promise<StreamAvailableJobsPageResult> {
  const startedAt = Date.now();
  const cursor = decodeAvailableJobsCursor(rawCursor);
  const remainingVisibleJobs = maxVisibleJobs === null
    ? limit
    : Math.max(0, Math.min(limit, maxVisibleJobs - cursor.returnedCount));
  if (remainingVisibleJobs <= 0) {
    return {
      jobs: [],
      nextCursor: null,
      hasMore: false,
      inspectedCompanies: 0,
      inspectedJobs: 0,
      matchedJobs: 0,
      durationMs: Date.now() - startedAt,
    };
  }
  const enabledCompanies = config.companies.filter((company) => company.enabled !== false);
  const enabledCompanyNames = new Set(enabledCompanies.map((company) => companyIdentity(company.company)));
  const previousJobsByCompany = buildPreviousJobsByCompany(previousInventory);
  const discardRegistry = await loadDiscardRegistry(env, tenantId);
  const pageJobs: JobPosting[] = [];
  const pageJobKeys = new Set<string>();
  let inspectedCompanies = 0;
  let inspectedJobs = 0;
  let matchedJobs = 0;

  for (let companyIndex = cursor.companyIndex; companyIndex < enabledCompanies.length; companyIndex += 1) {
    const company = enabledCompanies[companyIndex];
    const detected = await getDetectedConfig(env, company, tenantId);
    if (!detected) continue;

    const cachedScan = process.env.AWS_RAW_SCANS_TABLE
      ? await loadLatestRawScan(company.company, detected, { allowStale: true })
      : null;
    const sharedJobs = cachedScan?.jobs ?? previousJobsByCompany.get(companyIdentity(company.company)) ?? [];
    inspectedCompanies += 1;
    const startJobIndex = cursor.phase === "shared" && companyIndex === cursor.companyIndex ? cursor.jobIndex : 0;

    for (let jobIndex = startJobIndex; jobIndex < sharedJobs.length; jobIndex += 1) {
      const enrichedJob = enrichJob(sharedJobs[jobIndex], config.jobtitles);
      inspectedJobs += 1;
      if (!matchesInteractiveAvailableJob(enrichedJob, config.jobtitles, filters, discardRegistry)) {
        continue;
      }

      const currentJobKey = jobKey(enrichedJob);
      if (pageJobKeys.has(currentJobKey)) continue;
      pageJobKeys.add(currentJobKey);
      pageJobs.push(enrichedJob);
      matchedJobs += 1;

      if (pageJobs.length >= remainingVisibleJobs) {
        return {
          jobs: pageJobs,
          nextCursor: encodeAvailableJobsCursor({
            phase: "shared",
            companyIndex,
            jobIndex: jobIndex + 1,
            manualIndex: 0,
            returnedCount: cursor.returnedCount + pageJobs.length,
          }),
          hasMore: true,
          inspectedCompanies,
          inspectedJobs,
          matchedJobs,
          durationMs: Date.now() - startedAt,
        };
      }
    }
  }

  const manualJobs = sortJobsForInteractiveRead(
    (previousInventory?.jobs ?? []).filter((job) =>
      job.manualEntry
      && enabledCompanyNames.has(companyIdentity(job.company))
    ),
  );

  for (let manualIndex = cursor.phase === "manual" ? cursor.manualIndex : 0; manualIndex < manualJobs.length; manualIndex += 1) {
    const manualJob = manualJobs[manualIndex];
    inspectedJobs += 1;
    if (!matchesInteractiveAvailableJob(manualJob, config.jobtitles, filters, discardRegistry)) {
      continue;
    }

    const currentJobKey = jobKey(manualJob);
    if (pageJobKeys.has(currentJobKey)) continue;
    pageJobKeys.add(currentJobKey);
    pageJobs.push(manualJob);
    matchedJobs += 1;

    if (pageJobs.length >= remainingVisibleJobs) {
      return {
        jobs: pageJobs,
        nextCursor: encodeAvailableJobsCursor({
          phase: "manual",
          companyIndex: enabledCompanies.length,
          jobIndex: 0,
          manualIndex: manualIndex + 1,
          returnedCount: cursor.returnedCount + pageJobs.length,
        }),
        hasMore: true,
        inspectedCompanies,
        inspectedJobs,
        matchedJobs,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  return {
    jobs: pageJobs,
    nextCursor: null,
    hasMore: false,
    inspectedCompanies,
    inspectedJobs,
    matchedJobs,
    durationMs: Date.now() - startedAt,
  };
}

function decisionSummaryKey(runId: string, company: string): string {
  return `${DECISION_SUMMARY_PREFIX}${runId}:${company.toLowerCase()}`;
}

function makeEmptyDecisionCounts() {
  return {
    total: 0,
    included: 0,
    excludedTitle: 0,
    excludedGeography: 0,
    groupedDuplicate: 0,
    suppressedSeen: 0,
    suppressedEmailed: 0,
    discardedFromPrevious: 0,
    newJobs: 0,
    updatedJobs: 0,
  };
}

async function saveDecisionSummaries(
  env: Env,
  tenantId: string | undefined,
  runId: string | undefined,
  summaries: MatchDecisionSummary[]
): Promise<void> {
  if (!runId) return;
  await Promise.all(
    summaries.map((summary) =>
      jobStateKv(env).put(
        tenantScopedKey(tenantId, decisionSummaryKey(runId, summary.company)),
        JSON.stringify(summary),
        { expirationTtl: DECISION_SUMMARY_TTL_SECONDS }
      )
    )
  );
}

function rebuildInventorySnapshot(inventory: InventorySnapshot, jobs: JobPosting[]): InventorySnapshot {
  const bySource: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};

  for (const job of jobs) {
    bySource[job.source] = (bySource[job.source] ?? 0) + 1;
    byCompany[job.company] = (byCompany[job.company] ?? 0) + 1;
    for (const keyword of job.matchedKeywords ?? []) {
      keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + 1;
    }
  }

  return {
    ...inventory,
    jobs,
    stats: {
      ...inventory.stats,
      totalJobsMatched: jobs.length,
      bySource,
      byCompany,
      keywordCounts,
    },
  };
}

/**
 * Shared raw inventory is the durable source of truth for current live jobs.
 * Tenant available-jobs views should therefore be derived on read from the
 * shared company snapshots instead of persisting a duplicated tenant copy.
 */
export async function buildAvailableJobsFromSharedInventory(
  env: Env,
  config: RuntimeConfig,
  previousInventory: InventorySnapshot | null,
  tenantId: string | undefined,
  options: { isAdmin?: boolean } = {},
): Promise<InventorySnapshot> {
  const enabledCompanies = config.companies.filter((company) => company.enabled !== false);
  const previousJobsByCompany = new Map<string, JobPosting[]>();
  const discardRegistry = await loadDiscardRegistry(env, tenantId);
  for (const job of previousInventory?.jobs ?? []) {
    const key = companyIdentity(job.company);
    const rows = previousJobsByCompany.get(key) ?? [];
    rows.push(job);
    previousJobsByCompany.set(key, rows);
  }

  const jobs: JobPosting[] = [];
  const seenJobKeys = new Set<string>();
  const bySource: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const byCompanyFetched: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  let totalFetched = 0;
  let totalCompaniesDetected = 0;
  let cacheHits = 0;
  let filteredOutJobs = 0;
  let filteredOutCompanies = 0;
  const adminAllRegistryCompanies = options.isAdmin && config.adminRegistryMode !== "none";

  if (options.isAdmin) {
    const currentRows = process.env.AWS_RAW_SCANS_TABLE ? await listCurrentRawScans() : [];
    const enabledCompanyNames = new Set(enabledCompanies.map((company) => normalizeCompanyKey(company.company)));
    for (const row of currentRows) {
      // Admin "all companies" mode should browse the whole shared registry inventory
      // without expanding thousands of registry rows into runtime config on every read.
      if (!adminAllRegistryCompanies && !enabledCompanyNames.has(normalizeCompanyKey(row.company))) continue;
      totalCompaniesDetected += 1;
      totalFetched += row.jobs.length;
      cacheHits += 1;
      byCompanyFetched[row.company] = row.jobs.length;
      let companyMatchedJobs = 0;
      for (const rawJob of row.jobs) {
        const enriched = enrichJob(rawJob, config.jobtitles);
        const titleMatched = isInterestingTitle(enriched.title, config.jobtitles);
        if (!titleMatched) {
          filteredOutJobs += 1;
          continue;
        }
        const geographyMatched = shouldKeepJobForUSInventory(enriched.location, enriched.title, enriched.url);
        if (!geographyMatched) {
          filteredOutJobs += 1;
          continue;
        }
        if (isDiscarded(enriched, discardRegistry)) {
          filteredOutJobs += 1;
          continue;
        }
        const nextJobKey = jobKey(enriched);
        if (seenJobKeys.has(nextJobKey)) continue;
        seenJobKeys.add(nextJobKey);
        jobs.push(enriched);
        companyMatchedJobs += 1;
        bySource[enriched.source] = (bySource[enriched.source] ?? 0) + 1;
        byCompany[enriched.company] = (byCompany[enriched.company] ?? 0) + 1;
        for (const keyword of enriched.matchedKeywords ?? []) {
          keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + 1;
        }
      }
      if (row.jobs.length > 0 && companyMatchedJobs === 0) {
        filteredOutCompanies += 1;
      }
    }
  } else {
    for (const company of enabledCompanies) {
      const detected = await getDetectedConfig(env, company, tenantId);
      if (!detected) continue;

      const cachedScan = process.env.AWS_RAW_SCANS_TABLE
        ? await loadLatestRawScan(company.company, detected, { allowStale: true })
        : null;
      const sharedJobs = cachedScan?.jobs ?? previousJobsByCompany.get(companyIdentity(company.company)) ?? [];
      if (!sharedJobs.length) continue;

      totalCompaniesDetected += 1;
      totalFetched += sharedJobs.length;
      if (cachedScan) cacheHits += 1;
      byCompanyFetched[company.company] = sharedJobs.length;

      const enrichedJobs = sharedJobs.map((job) => enrichJob(job, config.jobtitles));
      const matchedJobs = enrichedJobs.filter((job) => {
        const titleMatched = isInterestingTitle(job.title, config.jobtitles);
        if (!titleMatched) {
          filteredOutJobs += 1;
          return false;
        }
        const geographyMatched = shouldKeepJobForUSInventory(job.location, job.title, job.url);
        if (!geographyMatched) {
          filteredOutJobs += 1;
          return false;
        }
        return true;
      });

      if (sharedJobs.length > 0 && matchedJobs.length === 0) {
        filteredOutCompanies += 1;
      }

      for (const matchedJob of matchedJobs) {
        if (isDiscarded(matchedJob, discardRegistry)) {
          filteredOutJobs += 1;
          continue;
        }
        const nextJobKey = jobKey(matchedJob);
        if (seenJobKeys.has(nextJobKey)) continue;
        seenJobKeys.add(nextJobKey);
        jobs.push(matchedJob);
        bySource[matchedJob.source] = (bySource[matchedJob.source] ?? 0) + 1;
        byCompany[matchedJob.company] = (byCompany[matchedJob.company] ?? 0) + 1;
        for (const keyword of matchedJob.matchedKeywords ?? []) {
          keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + 1;
        }
      }
    }
  }

  // Manual jobs only exist in tenant state, so merge them after the shared raw
  // company snapshots are loaded. This keeps manual entries visible without
  // duplicating every shared job into tenant storage.
  const enabledCompanyNames = new Set(enabledCompanies.map((company) => companyIdentity(company.company)));
  for (const manualJob of previousInventory?.jobs ?? []) {
    if (!manualJob.manualEntry) continue;
    if (!enabledCompanyNames.has(companyIdentity(manualJob.company))) continue;
    if (isDiscarded(manualJob, discardRegistry)) continue;

    const nextJobKey = jobKey(manualJob);
    if (seenJobKeys.has(nextJobKey)) continue;
    seenJobKeys.add(nextJobKey);

    jobs.push(manualJob);
    bySource[manualJob.source] = (bySource[manualJob.source] ?? 0) + 1;
    byCompany[manualJob.company] = (byCompany[manualJob.company] ?? 0) + 1;
  }

  return {
    runAt: previousInventory?.runAt ?? new Date().toISOString(),
    jobs,
    stats: {
      totalJobsMatched: jobs.length,
      totalCompaniesConfigured: enabledCompanies.length,
      totalCompaniesDetected,
      totalFetched,
      bySource,
      byCompany,
      byCompanyFetched,
      keywordCounts,
      cacheHits,
      liveFetchCompanies: 0,
      filteredOutJobs,
      filteredOutCompanies,
    },
  };
}

// Discard registry — supports legacy plain-string jobKey entries and new { jobKey, fingerprint } pairs.
type DiscardEntry = string | { jobKey: string; fingerprint: string };

export type DiscardRegistry = {
  jobKeys: Set<string>;
  fingerprints: Set<string>;
};

function isDiscarded(job: JobPosting, registry: DiscardRegistry): boolean {
  return registry.jobKeys.has(jobKey(job)) || registry.fingerprints.has(jobStableFingerprint(job));
}

async function loadRawDiscardEntries(env: Env, tenantId?: string): Promise<DiscardEntry[]> {
  const raw = await jobStateKv(env).get(tenantScopedKey(tenantId, DISCARDED_JOB_KEYS_KEY), "json");
  return Array.isArray(raw) ? (raw as unknown[]).filter(Boolean) as DiscardEntry[] : [];
}

export async function loadDiscardRegistry(env: Env, tenantId?: string): Promise<DiscardRegistry> {
  const entries = await loadRawDiscardEntries(env, tenantId);
  const jobKeys = new Set<string>();
  const fingerprints = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (entry) jobKeys.add(entry);
    } else if (entry && typeof entry === "object") {
      if (entry.jobKey) jobKeys.add(entry.jobKey);
      if (entry.fingerprint) fingerprints.add(entry.fingerprint);
    }
  }
  return { jobKeys, fingerprints };
}

export async function addDiscardedJobKey(env: Env, job: JobPosting, tenantId?: string): Promise<void> {
  const entries = await loadRawDiscardEntries(env, tenantId);
  const existingJobKeys = new Set(entries.map((e) => (typeof e === "string" ? e : e.jobKey)));
  if (existingJobKeys.has(jobKey(job))) return;
  entries.push({ jobKey: jobKey(job), fingerprint: jobStableFingerprint(job) });
  await jobStateKv(env).put(tenantScopedKey(tenantId, DISCARDED_JOB_KEYS_KEY), JSON.stringify(entries));
}

async function pruneDiscardedJobKeysToKnownJobs(
  env: Env,
  inventory: InventorySnapshot,
  tenantId?: string,
  existingInventory?: InventorySnapshot | null
): Promise<void> {
  const entries = await loadRawDiscardEntries(env, tenantId);
  if (!entries.length) return;

  const appliedJobs = await loadAppliedJobs(env, tenantId);
  const knownJobKeys = new Set([
    ...inventory.jobs.map(jobKey),
    ...(existingInventory?.jobs ?? []).map(jobKey),
    ...Object.keys(appliedJobs),
  ]);

  // Only prune legacy string entries whose jobKey is no longer known.
  // Structured { jobKey, fingerprint } entries are never auto-pruned — fingerprints are durable
  // identity across ATS id churn and must outlast any single scan's result set.
  const prunedEntries = entries.filter((entry) =>
    typeof entry !== "string" || knownJobKeys.has(entry)
  );
  if (prunedEntries.length !== entries.length) {
    await jobStateKv(env).put(tenantScopedKey(tenantId, DISCARDED_JOB_KEYS_KEY), JSON.stringify(prunedEntries));
  }
}

function summarizeStoredInventory(
  inventory: InventorySnapshot,
  jobs: JobPosting[],
  statsPatch: Partial<InventorySnapshot["stats"]> = {}
): InventorySnapshot {
  const next = rebuildInventorySnapshot(inventory, jobs);
  return {
    ...next,
    stats: {
      ...next.stats,
      ...statsPatch,
      totalJobsMatched: jobs.length,
    },
  };
}

function getFetchedByCompany(inventory: InventorySnapshot | null | undefined): Record<string, number> {
  const value = inventory?.stats.byCompanyFetched;
  if (!value || typeof value !== "object") return {};
  return value;
}

function mergeFetchedStatsForPartialInventory(
  scannedInventory: InventorySnapshot,
  previousInventory: InventorySnapshot | null,
  enabledCompanyNames: Set<string>,
  preservedPausedJobs: JobPosting[]
): Pick<InventorySnapshot["stats"], "totalFetched" | "byCompanyFetched"> {
  const scannedFetchedByCompany = getFetchedByCompany(scannedInventory);
  const previousFetchedByCompany = getFetchedByCompany(previousInventory);
  const previousFetchedEntries = Object.entries(previousFetchedByCompany);

  if (previousFetchedEntries.length) {
    const byCompanyFetched: Record<string, number> = { ...scannedFetchedByCompany };
    for (const [company, fetchedCount] of previousFetchedEntries) {
      if (!enabledCompanyNames.has(companyIdentity(company))) {
        byCompanyFetched[company] = Number(fetchedCount) || 0;
      }
    }
    return {
      byCompanyFetched,
      totalFetched: Object.values(byCompanyFetched).reduce((sum, value) => sum + (Number(value) || 0), 0),
    };
  }

  return {
    byCompanyFetched: scannedFetchedByCompany,
    totalFetched: preservedPausedJobs.length && previousInventory
      ? Math.max(scannedInventory.stats.totalFetched, previousInventory.stats.totalFetched)
      : scannedInventory.stats.totalFetched,
  };
}

export function removeInventoryJobsByKeys(inventory: InventorySnapshot, keys: Set<string>): InventorySnapshot {
  if (!keys.size) return inventory;
  return rebuildInventorySnapshot(inventory, inventory.jobs.filter((job) => !keys.has(jobKey(job))));
}

export async function pruneAppliedJobsFromInventory(
  env: Env,
  inventory: InventorySnapshot,
  tenantId?: string
): Promise<InventorySnapshot> {
  const appliedJobs = await loadAppliedJobs(env, tenantId);
  return removeInventoryJobsByKeys(inventory, new Set(Object.keys(appliedJobs)));
}

async function listDecisionSummariesForRun(
  env: Env,
  tenantId: string | undefined,
  runId: string | undefined
): Promise<MatchDecisionSummary[]> {
  if (!runId) return [];
  const listed = await jobStateKv(env).list({
    prefix: tenantScopedKey(tenantId, `${DECISION_SUMMARY_PREFIX}${runId}:`),
    limit: 500,
  });
  const rows = await Promise.all(
    listed.keys.map(async (key) => {
      const value = await jobStateKv(env).get(key.name, "json");
      return value && typeof value === "object" ? (value as MatchDecisionSummary) : null;
    })
  );
  return rows.filter((row): row is MatchDecisionSummary => Boolean(row));
}

type CompanyFetchOutcome = {
  fetchedJobs: JobPosting[];
  rawScanCache: {
    hit: boolean;
    stale: boolean;
    scannedAt?: string;
    reason?: string;
  };
};

const STALE_WORKDAY_CACHE_ALERT_HOURS = 12;

function analyticsActorForTenant(tenantId?: string) {
  return tenantId
    ? { userId: tenantId, tenantId, email: "", displayName: "", scope: "user" as const, isAdmin: false }
    : null;
}

function rawScanAgeHours(scannedAt: string | undefined): number | null {
  if (!scannedAt) return null;
  const scannedAtMs = Date.parse(scannedAt);
  if (!Number.isFinite(scannedAtMs)) return null;
  return (Date.now() - scannedAtMs) / (60 * 60 * 1000);
}

async function emitStaleWorkdayCacheAlert(
  env: Env,
  companyName: string,
  detected: DetectedConfig,
  scannedAt: string | undefined,
  tenantId: string | undefined,
  reason: string,
): Promise<void> {
  const ageHours = rawScanAgeHours(scannedAt);
  if (ageHours === null || ageHours < STALE_WORKDAY_CACHE_ALERT_HOURS) return;

  await recordAppLog(env, {
    level: "warn",
    event: "workday_stale_cache_alert",
    message: `Serving stale Workday cache for ${companyName} (${Math.round(ageHours)}h old)`,
    tenantId,
    company: companyName,
    source: detected.source,
    route: "scan",
    details: {
      scannedAt: scannedAt ?? null,
      cacheAgeHours: ageHours,
      reason,
    },
  });

  const actor = analyticsActorForTenant(tenantId);
  await recordEvent(actor, "SCAN_STALE_CACHE_ALERT", {
    company: companyName,
    atsType: detected.source,
    cacheAgeHours: ageHours,
    scannedAt: scannedAt ?? null,
    reason,
  });
}

function buildWorkdayLayerAttemptOrder(
  scanState: WorkdayScanState,
  layerFlags: { layer2: boolean; layer3: boolean },
): WorkdayScanLayer[] {
  const order: WorkdayScanLayer[] = [];
  const layer3Available = layerFlags.layer3 && isScraperApiConfigured();

  // Promoted companies probe Layer 1 first so we can automatically downgrade
  // when the tenant becomes healthy again, while still falling back to the
  // promoted layer within the same run if the cheap probe fails.
  if (scanState.scanLayer !== "layer1") {
    order.push("layer1");
  }

  if (scanState.scanLayer === "layer2" && layerFlags.layer2) {
    order.push("layer2");
    if (layer3Available) order.push("layer3");
  } else if (scanState.scanLayer === "layer3" && layer3Available) {
    order.push("layer3");
  } else {
    order.push("layer1");
    if (layerFlags.layer2) order.push("layer2");
    if (layer3Available) order.push("layer3");
  }

  return [...new Set(order)];
}

type PlanCacheOpts = { allowStale: true } | { allowStale?: false; maxAgeMs?: number };

async function fetchCompanyJobsWithSharedCache(
  env: Env,
  companyName: string,
  detected: DetectedConfig,
  includeKeywords: string[],
  tenantId?: string,
  planCacheOpts: PlanCacheOpts = {},
): Promise<CompanyFetchOutcome> {
  // Cache-only mode (free tier with canTriggerLiveScan=false).
  if ((planCacheOpts as { allowStale?: boolean }).allowStale) {
    const cachedScan = await loadLatestRawScan(companyName, detected, { allowStale: true });
    return {
      fetchedJobs: cachedScan?.jobs ?? [],
      rawScanCache: {
        hit: Boolean(cachedScan),
        stale: true,
        scannedAt: cachedScan?.scannedAt,
        reason: cachedScan ? undefined : "no_cache",
      },
    };
  }

  const planMaxAgeMs = (planCacheOpts as { maxAgeMs?: number }).maxAgeMs;
  const freshRawScan = await loadLatestRawScan(companyName, detected, { maxAgeMs: planMaxAgeMs });
  if (freshRawScan) {
    return {
      fetchedJobs: freshRawScan.jobs,
      rawScanCache: {
        hit: true,
        stale: false,
        scannedAt: freshRawScan.scannedAt,
      },
    };
  }

  if (detected.source !== "workday") {
    const fetchedJobs = await fetchJobsForDetectedConfig(companyName, detected, includeKeywords);
    await saveRawScan(companyName, detected, fetchedJobs);
    return {
      fetchedJobs,
      rawScanCache: {
        hit: false,
        stale: false,
      },
    };
  }

  const staleRawScan = await loadLatestRawScan(companyName, detected, { allowStale: true });
  const scanState = await loadWorkdayScanState(companyName);
  if (shouldBypassLiveWorkdayScan(scanState)) {
    if (!staleRawScan) {
      throw new Error(`Workday scan for ${companyName} is temporarily ${scanState.rateLimitStatus}.`);
    }

    await emitStaleWorkdayCacheAlert(
      env,
      companyName,
      detected,
      staleRawScan.scannedAt,
      tenantId,
      String(scanState.rateLimitStatus),
    );

    return {
      fetchedJobs: staleRawScan.jobs,
      rawScanCache: {
        hit: true,
        stale: true,
        scannedAt: staleRawScan.scannedAt,
        reason: scanState.rateLimitStatus,
      },
    };
  }

  const layerFlags = await loadSystemWorkdayLayerFlags();
  const workdayConfig = {
    sampleUrl: detected.sampleUrl,
    workdayBaseUrl: detected.workdayBaseUrl,
    host: detected.host,
    tenant: detected.tenant,
    site: detected.site,
  };
  const attemptLayers = buildWorkdayLayerAttemptOrder(scanState, layerFlags);
  let finalFailure: WorkdayScanResult | null = null;

  for (let index = 0; index < attemptLayers.length; index += 1) {
    const layer = attemptLayers[index];
    if (layer !== "layer1" && scanState.scanLayer !== layer) {
      await markWorkdayLayerPromotion(companyName, layer);
    }

    const result = await scanWorkdayJobs(companyName, workdayConfig, includeKeywords, layer);
    if (result.ok) {
      await saveRawScan(companyName, detected, result.jobs);
      await markWorkdayScanSuccess(companyName, result.layerUsed);
      return {
        fetchedJobs: result.jobs,
        rawScanCache: {
          hit: false,
          stale: false,
        },
      };
    }

    await markWorkdayScanFailure(companyName, {
      layerUsed: result.layerUsed,
      failureReason: result.failureReason,
      retryAfter: result.retryAfter ?? null,
    });
    finalFailure = result;
  }

  if (finalFailure && !finalFailure.ok) {
    const analyticsActor = analyticsActorForTenant(tenantId);
    // Only emit SCAN_FAILED once the scan has exhausted every available layer.
    void recordEvent(analyticsActor, "SCAN_FAILED", {
      company: companyName,
      atsType: detected.source,
      failureReason: finalFailure.failureReason,
      layer: finalFailure.layerUsed,
    }).catch((error) => {
      console.warn("[analytics] failed to record scan failure event", error);
    });

    if (!staleRawScan) {
      throw new Error(finalFailure.message);
    }

    await emitStaleWorkdayCacheAlert(
      env,
      companyName,
      detected,
      staleRawScan.scannedAt,
      tenantId,
      finalFailure.failureReason,
    );

    return {
      fetchedJobs: staleRawScan.jobs,
      rawScanCache: {
        hit: true,
        stale: true,
        scannedAt: staleRawScan.scannedAt,
        reason: finalFailure.failureReason,
      },
    };
  }

  throw new Error(`Workday scan failed for ${companyName} without a typed result.`);
}

async function maybePromoteCustomCompanyAfterSuccessfulScan(
  env: Env,
  company: RuntimeConfig["companies"][number],
  tenantId?: string,
): Promise<void> {
  if (company.isRegistry === true || Boolean(company.registryAts || company.registryTier)) return;

  try {
    await promoteCustomCompaniesToRegistry([company]);
  } catch (error) {
    await recordAppLog(env, {
      level: "warn",
      event: "registry_promotion_failed",
      message: error instanceof Error ? error.message : String(error),
      tenantId,
      company: company.company,
      source: company.source,
      route: "scan",
      details: {
        boardUrl: company.boardUrl ?? null,
      },
    });
  }
}

export async function buildInventory(
  env: Env,
  config: RuntimeConfig,
  previousInventory: InventorySnapshot | null = null,
  runId?: string,
  tenantId?: string,
  options: {
    preserveUnscannedJobs?: boolean;
    metadata?: BuildInventoryMetadata;
    disableActiveRunHeartbeat?: boolean;
    isAdmin?: boolean;
    cacheOnly?: boolean;
  } = {}
): Promise<InventorySnapshot> {
  const enabledCompanies = config.companies.filter((company) => company.enabled !== false);
  const enabledCompanyNames = new Set(enabledCompanies.map((company) => companyIdentity(company.company)));
  const jobs: JobPosting[] = [];
  const bySource: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const byCompanyFetched: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  const companySummaries: MatchDecisionSummary[] = [];
  const firstSeenFingerprintsThisRun = options.metadata?.firstSeenFingerprintsThisRun ?? new Set<string>();
  const userDiscardRegistry = await loadDiscardRegistry(env, tenantId);
  let totalFetched = 0;
  let totalCompaniesDetected = 0;
  let cacheHits = 0;
  let liveFetchCompanies = 0;
  let quotaBlockedCompanies: string[] = [];
  let filteredOutCompanies = 0;
  let filteredOutJobs = 0;

  // Plan tier only applies to user-triggered scans (tenantId present).
  // System/background scans (no tenantId) run live with no cache restrictions.
  let planCacheOpts: PlanCacheOpts = {};
  let planScanCacheAgeMs: number | undefined;
  if (tenantId) {
    let userPlan: UserPlan = "free";
    try {
      const subscription = await loadBillingSubscription(tenantId);
      userPlan = subscription.plan;
    } catch {
      // Default to free on billing lookup failure — safe degradation
    }
    try {
      const planCfg = await loadPlanConfig(userPlan);
      // Treat missing/invalid cache-age config as zero-hour freshness so the
      // scan still attempts a live fetch instead of silently degrading into a
      // cache-only run.
      const cacheAgeHours = Number.isFinite(planCfg.scanCacheAgeHours) ? planCfg.scanCacheAgeHours : 0;
      planScanCacheAgeMs = cacheAgeHours * 60 * 60 * 1000;
      // All plans can trigger live scans — quota gates instead of plan gate.
      planCacheOpts = { maxAgeMs: planScanCacheAgeMs };
    } catch {
      // If plan-config storage is unavailable, keep the scan live-fetch
      // capable. Falling back to stale cache only hides the real failure mode.
      planScanCacheAgeMs = 0;
      planCacheOpts = { maxAgeMs: 0 };
    }
  }

  for (let index = 0; index < enabledCompanies.length; index += 1) {
    const company = enabledCompanies[index];
    let registryAdapterId: string | null = company.source ?? null;
    let fetchStartedAt = Date.now();
    if (runId) {
      await ensureActiveRunOwnership(env, runId);
    }
    if (runId && !options.disableActiveRunHeartbeat) {
      // Publish a heartbeat before each company so the UI can show live scan
      // progress instead of only a one-time "scan started" toast.
      await heartbeatActiveRun(env, runId, {
        totalCompanies: enabledCompanies.length,
        fetchedCompanies: index,
        currentCompany: company.company,
        currentSource: company.source,
        currentStage: "scanning_company",
        lastEvent: "company_scan_started",
      });
    }

    try {
      const detected = await getDetectedConfig(env, company, tenantId);
      registryAdapterId = registryScanAdapterId(detected, company.source ?? null);
      if (!detected) {
        await markRegistryCompanyScanMisconfigured(company.company, {
          adapterId: registryAdapterId,
          failureReason: "No ATS mapping was resolved for this company.",
        });
        byCompany[company.company] = 0;
        byCompanyFetched[company.company] = 0;
        const skippedDiscardedJobs = (previousInventory?.jobs ?? []).filter((job) => job.company === company.company).map((job) => ({
          title: job.title,
          jobKey: jobKey(job),
          location: job.location || undefined,
          reason: "skipped_unresolved_source" as const,
          justification: discardReasonDetails("skipped_unresolved_source"),
        }));
        companySummaries.push({
          company: company.company,
          source: company.source ?? "unknown",
          runId: runId ?? "",
          createdAt: new Date().toISOString(),
          fetchStatus: "skipped",
          fetchedCount: 0,
          matchedCount: 0,
          failureReason: "No ATS mapping was resolved for this company.",
          counts: {
            total: 0,
            included: 0,
            excludedTitle: 0,
            excludedGeography: 0,
            groupedDuplicate: 0,
            suppressedSeen: 0,
            suppressedEmailed: 0,
            discardedFromPrevious: skippedDiscardedJobs.length,
            newJobs: 0,
            updatedJobs: 0,
          },
          discardedJobs: skippedDiscardedJobs,
        });
        await recordAppLog(env, {
          level: "warn",
          event: "company_scan_skipped",
          message: `Skipped ${company.company} because no explicit ATS mapping was resolved`,
          tenantId,
          company: company.company,
          runId,
          route: "scan",
          details: { progress: { current: index + 1, total: enabledCompanies.length } },
        });
        if (runId) {
          await ensureActiveRunOwnership(env, runId);
        }
        if (runId && !options.disableActiveRunHeartbeat) {
          await heartbeatActiveRun(env, runId, {
            totalCompanies: enabledCompanies.length,
            fetchedCompanies: index + 1,
            currentCompany: company.company,
            currentSource: company.source,
            currentStage: "company_skipped",
            lastEvent: "company_scan_skipped",
          });
        }
        continue;
      }

      fetchStartedAt = Date.now();

      // For user-triggered scans: check if the shared cache has a fresh enough
      // result first. If not (cache miss), gate the live fetch on daily quota.
      let companyFetch: CompanyFetchOutcome;
      if (options.cacheOnly) {
        const cachedScan = await loadLatestRawScan(company.company, detected, { allowStale: true });
        if (cachedScan) {
          companyFetch = {
            fetchedJobs: cachedScan.jobs,
            rawScanCache: { hit: true, stale: true, scannedAt: cachedScan.scannedAt },
          };
          cacheHits += 1;
        } else {
          const previousJobsForCompany = (previousInventory?.jobs ?? []).filter((job) => job.company === company.company);
          // Admin job browsing should reflect the shared raw-scan cache
          // without triggering live fetches. When a company has not produced a
          // shared cache record yet, keep the previous tenant snapshot for that
          // company so the Available Jobs page does not flicker empty while the
          // registry scheduler catches up.
          companyFetch = {
            fetchedJobs: previousJobsForCompany,
            rawScanCache: {
              hit: previousJobsForCompany.length > 0,
              stale: true,
              reason: previousJobsForCompany.length > 0 ? "previous_inventory_fallback" : "no_cache",
            },
          };
          if (previousJobsForCompany.length > 0) cacheHits += 1;
        }
      } else if (tenantId && planScanCacheAgeMs !== undefined) {
        const cachedScan = await loadLatestRawScan(company.company, detected, { maxAgeMs: planScanCacheAgeMs });
        const usableCachedScan = cachedScan && cachedScan.jobs.length > 0 ? cachedScan : null;
        if (usableCachedScan) {
          // Treat empty raw-cache rows as a soft miss for user-triggered scans.
          // A zero-job cache line can come from a transient parser problem or a
          // prior bad fetch, and users interpret that as "nothing happened". By
          // requiring at least one cached job here, a real cache miss can still
          // escalate to a live fetch when quota is available.
          companyFetch = {
            fetchedJobs: usableCachedScan.jobs,
            rawScanCache: { hit: true, stale: false, scannedAt: usableCachedScan.scannedAt },
          };
          cacheHits += 1;
        } else {
          // Cache miss — atomically consume quota before allowing live fetch.
          const consumed = await tryConsumeLiveScan(tenantId, runId ?? "no-run-id", undefined, { isAdmin: options.isAdmin });
          if (!consumed) {
            // Quota exhausted — serve stale cache if any, otherwise skip.
            const stale = await loadLatestRawScan(company.company, detected, { allowStale: true });
            const usableStaleScan = stale && stale.jobs.length > 0 ? stale : null;
            if (usableStaleScan) {
              companyFetch = {
                fetchedJobs: usableStaleScan.jobs,
                rawScanCache: { hit: true, stale: true, scannedAt: usableStaleScan.scannedAt, reason: "quota_exhausted" },
              };
              cacheHits += 1;
            } else {
              quotaBlockedCompanies.push(company.company);
              await recordAppLog(env, {
                level: "warn",
                event: "quota_blocked",
                message: `Daily live scan quota exhausted for tenant — skipping live fetch for ${company.company}`,
                tenantId,
                company: company.company,
                runId,
                route: "scan",
                details: { scanOutcome: "quota_blocked" },
              });
              byCompany[company.company] = 0;
              byCompanyFetched[company.company] = 0;
              continue;
            }
          } else {
            // Quota consumed — perform live fetch.
            liveFetchCompanies += 1;
            companyFetch = await fetchCompanyJobsWithSharedCache(
              env,
              company.company,
              detected,
              config.jobtitles.includeKeywords,
              tenantId,
              planCacheOpts,
            );
          }
        }
      } else {
        // System/background scan — no quota, run live.
        companyFetch = await fetchCompanyJobsWithSharedCache(
          env,
          company.company,
          detected,
          config.jobtitles.includeKeywords,
          tenantId,
          planCacheOpts,
        );
        if (companyFetch.rawScanCache.hit) {
          cacheHits += 1;
        } else {
          liveFetchCompanies += 1;
        }
      }

      const fetchedJobs = companyFetch.fetchedJobs;
      totalCompaniesDetected += 1;
      totalFetched += fetchedJobs.length;
      byCompanyFetched[company.company] = fetchedJobs.length;
      // Only advance scan-state when a real live fetch happened.
      // Cache-hit reads must not update nextScanAt / lastScanAt — that would
      // corrupt the scheduler's source of truth.
      if (!companyFetch.rawScanCache.hit) {
        await markRegistryCompanyScanSuccess(company.company, {
          adapterId: registryAdapterId,
          fetchedCount: fetchedJobs.length,
        });
      }
      await maybePromoteCustomCompanyAfterSuccessfulScan(env, company, tenantId);

      const enrichedJobs = fetchedJobs.map((job: JobPosting) => enrichJob(job, config.jobtitles));
      const matchedJobs: JobPosting[] = [];
      const titleExcludedKeys = new Set<string>();
      const geographyExcludedKeys = new Set<string>();
      let excludedTitleCount = 0;
      let excludedGeographyCount = 0;

      for (const job of enrichedJobs) {
        const titleMatched = isInterestingTitle(job.title, config.jobtitles);
        if (!titleMatched) {
          excludedTitleCount += 1;
          titleExcludedKeys.add(jobKey(job));
          continue;
        }

        if (!shouldKeepJobForUSInventory(job.location, job.title, job.url)) {
          excludedGeographyCount += 1;
          geographyExcludedKeys.add(jobKey(job));
          continue;
        }

        matchedJobs.push(job);
      }

      jobs.push(...matchedJobs);
      bySource[detected.source] = (bySource[detected.source] ?? 0) + matchedJobs.length;
      byCompany[company.company] = matchedJobs.length;
      if (fetchedJobs.length > 0 && matchedJobs.length === 0) {
        // Preserve the distinction between "the ATS returned nothing" and
        // "jobs were fetched but then filtered out by tenant rules".
        filteredOutCompanies += 1;
      }
      filteredOutJobs += excludedTitleCount + excludedGeographyCount;

      for (const job of matchedJobs) {
        for (const keyword of job.matchedKeywords ?? []) {
          keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + 1;
        }
      }

      const previousCompanyJobs = jobsForCompanySource(previousInventory, company.company, detected.source);
      const previousCompanyMap = new Map(previousCompanyJobs.map((job) => [jobKey(job), job]));
      const rawNewCandidates = matchedJobs.filter((job) => !previousCompanyMap.has(jobKey(job)) && !isDiscarded(job, userDiscardRegistry));
      let companyNewJobs = 0;
      let companySuppressedSeen = 0;
      let companyGroupedDuplicate = 0;
      for (let candidateIndex = 0; candidateIndex < rawNewCandidates.length; candidateIndex += 1) {
        const candidate = rawNewCandidates[candidateIndex];
        const fingerprint = jobStableFingerprint(candidate);
        if (firstSeenFingerprintsThisRun.has(fingerprint)) {
          options.metadata?.duplicateFingerprintJobKeysThisRun.add(jobKey(candidate));
          companyGroupedDuplicate += 1;
          continue;
        }
        firstSeenFingerprintsThisRun.add(fingerprint);
        options.metadata?.firstSeenJobKeysThisRun.add(jobKey(candidate));
        companyNewJobs += 1;
      }

      const updatedJobDetails = matchedJobs
        .filter((job) => !isDiscarded(job, userDiscardRegistry))
        .map((job) => {
          const previousJob = previousCompanyMap.get(jobKey(job));
          if (!previousJob || !jobsAreMeaningfullyDifferent(previousJob, job)) return null;
          return {
            title: job.title,
            jobKey: jobKey(job),
            justification: "Tracked inventory fields changed since the previous snapshot for this company run.",
            changes: diffJobFields(previousJob, job),
          };
        })
        .filter((item): item is NonNullable<MatchDecisionSummary["updatedJobs"]>[number] => Boolean(item));

      const matchedKeys = new Set(matchedJobs.map((job) => jobKey(job)));
      const discardedJobs = jobsForCompanySource(previousInventory, company.company, detected.source)
        .filter((job) => !matchedKeys.has(jobKey(job)))
        .map((job) => {
          const key = jobKey(job);
          const reason: DiscardReason =
            titleExcludedKeys.has(key)
              ? "excluded_title"
              : geographyExcludedKeys.has(key)
                ? "excluded_geography"
                : "not_returned_by_source";
          return {
            title: job.title,
            jobKey: key,
            location: job.location || undefined,
            reason,
            justification: discardReasonDetails(reason),
          };
        });

      companySummaries.push({
        company: company.company,
        source: detected.source,
        runId: runId ?? "",
        createdAt: new Date().toISOString(),
        fetchStatus: "fetched",
        fetchedCount: fetchedJobs.length,
        matchedCount: matchedJobs.length,
        failureReason: null,
        counts: {
          ...makeEmptyDecisionCounts(),
          total: fetchedJobs.length,
          included: matchedJobs.length,
          excludedTitle: excludedTitleCount,
          excludedGeography: excludedGeographyCount,
          groupedDuplicate: companyGroupedDuplicate,
          suppressedSeen: companySuppressedSeen,
          discardedFromPrevious: discardedJobs.length,
          newJobs: companyNewJobs,
          updatedJobs: updatedJobDetails.length,
        },
        updatedJobs: updatedJobDetails,
        discardedJobs,
      });

      await recordAppLog(env, {
        level: "info",
        event: "company_scan_completed",
        message: `Company scan completed for ${company.company} with ${matchedJobs.length} matched jobs`,
        tenantId,
        company: company.company,
        source: detected.source,
        runId,
        route: "scan",
        details: {
          fetchStatus: "fetched",
          fetchedCount: fetchedJobs.length,
          matchedCount: matchedJobs.length,
          newJobsCount: companyNewJobs,
          updatedJobsCount: updatedJobDetails.length,
          updatedJobs: updatedJobDetails,
          excludedTitleCount,
          excludedGeographyCount,
          discardedCount: discardedJobs.length,
          discardedJobs,
          groupedDuplicateCount: companyGroupedDuplicate,
          suppressedSeenCount: companySuppressedSeen,
          fetchDurationMs: Date.now() - fetchStartedAt,
          rawScanCache: companyFetch.rawScanCache,
          progress: { current: index + 1, total: enabledCompanies.length },
        },
      });
      if (runId) {
        await ensureActiveRunOwnership(env, runId);
      }
      if (runId && !options.disableActiveRunHeartbeat) {
        await heartbeatActiveRun(env, runId, {
          totalCompanies: enabledCompanies.length,
          fetchedCompanies: index + 1,
          currentCompany: company.company,
          currentSource: detected.source,
          currentStage: "company_completed",
          lastEvent: "company_scan_completed",
        });
      }
    } catch (error) {
      byCompany[company.company] = 0;
      byCompanyFetched[company.company] = 0;
      const message = error instanceof Error ? error.message : String(error);
      const isOwnershipLost = error instanceof ActiveRunOwnershipError;
      if (!isOwnershipLost) {
        await markRegistryCompanyScanFailure(company.company, {
          adapterId: registryAdapterId,
          failureReason: message,
        });
      }
      const failedDiscardedJobs = (previousInventory?.jobs ?? []).filter((job) => job.company === company.company).map((job) => ({
        title: job.title,
        jobKey: jobKey(job),
        location: job.location || undefined,
        reason: "fetch_failed" as const,
        justification: discardReasonDetails("fetch_failed"),
      }));
      companySummaries.push({
        company: company.company,
        source: company.source ?? "unknown",
        runId: runId ?? "",
        createdAt: new Date().toISOString(),
        fetchStatus: "failed",
        fetchedCount: 0,
        matchedCount: 0,
        failureReason: message,
        counts: {
          total: 0,
          included: 0,
          excludedTitle: 0,
          excludedGeography: 0,
          groupedDuplicate: 0,
          suppressedSeen: 0,
          suppressedEmailed: 0,
          discardedFromPrevious: failedDiscardedJobs.length,
          newJobs: 0,
          updatedJobs: 0,
        },
        discardedJobs: failedDiscardedJobs,
      });
      console.log("[inventory] company scan failed", JSON.stringify({
        company: company.company,
        error: message,
        ownershipLost: isOwnershipLost,
        source: company.source ?? null,
      }));
      await recordAppLog(env, {
        level: isOwnershipLost ? "warn" : "error",
        event: isOwnershipLost ? "company_scan_aborted" : "company_scan_failed",
        message,
        tenantId,
        company: company.company,
        source: company.source,
        runId,
        route: "scan",
        details: {
          fetchStatus: "failed",
          fetchedCount: 0,
          matchedCount: 0,
          newJobsCount: 0,
          updatedJobsCount: 0,
          updatedJobs: [],
          discardedCount: failedDiscardedJobs.length,
          discardedJobs: failedDiscardedJobs,
          failureReason: message,
          ownershipLost: isOwnershipLost,
          elapsedMs: Date.now() - fetchStartedAt,
          configuredSource: company.source ?? null,
          progress: { current: index + 1, total: enabledCompanies.length },
        },
      });
      if (runId && !options.disableActiveRunHeartbeat && !isOwnershipLost) {
        await heartbeatActiveRun(env, runId, {
          totalCompanies: enabledCompanies.length,
          fetchedCompanies: index + 1,
          currentCompany: company.company,
          currentSource: company.source,
          currentStage: "company_failed",
          lastEvent: "company_scan_failed",
        });
      }

      if (isOwnershipLost) {
        throw error;
      }
    }
  }

  const remainingScans = tenantId
    ? await remainingLiveScans(tenantId, undefined, { isAdmin: options.isAdmin }).catch(() => undefined)
    : undefined;

  // Emit a single aggregated analytics event per run so the admin can track
  // cache-hit rate, live-fetch rate, and quota-block rate over time.
  if (tenantId && (cacheHits > 0 || liveFetchCompanies > 0 || quotaBlockedCompanies.length > 0)) {
    const actor = analyticsActorForTenant(tenantId);
    if (actor) {
      void recordEvent(actor, "RUN_SCAN_SUMMARY", {
        runId: runId ?? null,
        cacheHits,
        liveFetchCompanies,
        quotaBlocked: quotaBlockedCompanies.length,
        totalCompanies: enabledCompanies.length,
      }).catch(() => undefined);
    }
  }

  const scannedInventory: InventorySnapshot = {
    runAt: new Date().toISOString(),
    jobs,
    stats: {
      totalJobsMatched: jobs.length,
      totalCompaniesConfigured: enabledCompanies.length,
      totalCompaniesDetected,
      totalFetched,
      bySource,
      byCompany,
      byCompanyFetched,
      keywordCounts,
      cacheHits,
      liveFetchCompanies,
      quotaBlockedCompanies: quotaBlockedCompanies.length ? quotaBlockedCompanies : undefined,
      remainingLiveScansToday: remainingScans,
      filteredOutCompanies: filteredOutCompanies || undefined,
      filteredOutJobs: filteredOutJobs || undefined,
    },
  };
  const shouldPreserveUnscannedJobs = options.preserveUnscannedJobs !== false;
  const preservedPausedJobs = shouldPreserveUnscannedJobs
    ? (previousInventory?.jobs ?? []).filter((job) => !enabledCompanyNames.has(companyIdentity(job.company)))
    : [];
  const inventory = preservedPausedJobs.length
    ? summarizeStoredInventory(
      scannedInventory,
      [...preservedPausedJobs, ...jobs],
      mergeFetchedStatsForPartialInventory(scannedInventory, previousInventory, enabledCompanyNames, preservedPausedJobs)
    )
    : scannedInventory;

  await saveDecisionSummaries(env, tenantId, runId, companySummaries);

  return inventory;
}

export async function saveInventory(
  env: Env,
  inventory: InventorySnapshot,
  tenantId?: string,
  knownState?: InventoryState,
  options?: { skipKeyPrune?: boolean }
): Promise<void> {
  const existingState = knownState ?? await loadInventoryState(env, tenantId);
  if (!options?.skipKeyPrune) {
    await pruneDiscardedJobKeysToKnownJobs(env, inventory, tenantId, existingState.inventory);
  }
  const storageInventory = await pruneInventoryForStorage(env, inventory, tenantId);
  const inventoryKey = tenantScopedKey(tenantId, INVENTORY_KEY);
  const serializedInventory = JSON.stringify(storageInventory);
  if (serializedInventory.length > 380_000) {
    await logAppEvent(env, {
      level: "warn",
      event: "inventory_size_limit_approached",
      message: `Inventory serialized size is ${serializedInventory.length} bytes`,
      tenantId,
      route: "scan",
      details: {
        byteLength: serializedInventory.length,
        jobCount: storageInventory.jobs.length,
        hardLimitBytes: 400_000,
      },
    });
  }
  if (serializedInventory.length > 400_000) {
    // DynamoDB items max out at 400 KB, so fail loudly before writing an unsafe blob.
    throw new Error("Inventory too large to save safely — prune more aggressively");
  }
  if (JSON.stringify(existingState.inventory) !== serializedInventory) {
    await jobStateKv(env).put(inventoryKey, serializedInventory);
  }
  await pruneJobNotesToInventory(env, storageInventory, tenantId);

  // Trend collection is disabled until the UI renders it; this avoids unused KV write/read churn.
}

export async function pruneInventoryForStorage(
  env: Env,
  inventory: InventorySnapshot,
  tenantId?: string
): Promise<InventorySnapshot> {
  const registry = await loadDiscardRegistry(env, tenantId);
  const hasEntries = registry.jobKeys.size > 0 || registry.fingerprints.size > 0;
  return hasEntries
    ? summarizeStoredInventory(inventory, inventory.jobs.filter((job) => !isDiscarded(job, registry)))
    : inventory;
}

async function pruneJobNotesToInventory(env: Env, inventory: InventorySnapshot, tenantId?: string): Promise<void> {
  const notes = await loadJobNotes(env, tenantId);
  if (!Object.keys(notes).length) return;

  const inventoryKeys = new Set(inventory.jobs.map(jobKey));
  const nextNotes: Record<string, string> = {};
  for (const [key, value] of Object.entries(notes)) {
    if (inventoryKeys.has(key) && typeof value === "string" && value.trim()) {
      nextNotes[key] = value.trim();
    }
  }

  if (Object.keys(nextNotes).length !== Object.keys(notes).length) {
    await saveJobNotes(env, nextNotes, tenantId);
  }
}

async function inventoryFromState(
  env: Env,
  config: RuntimeConfig,
  state: InventoryState,
  tenantId?: string
): Promise<InventorySnapshot> {
  if (state.inventory) {
    return state.inventory;
  }

  const kvInventory = tenantId ? await jobStateKv(env).get(INVENTORY_KEY, "json") : null;
  if (tenantId && kvInventory && typeof kvInventory === "object") {
    const inventory = kvInventory as InventorySnapshot;
    await saveInventory(env, inventory, tenantId, state);
    return inventory;
  }

  const inventory = buildEmptyInventory(config);
  await saveInventory(env, inventory, tenantId, state);
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_NEW_JOBS_COUNT_KEY), "0");
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_NEW_JOB_KEYS_KEY), JSON.stringify([]));
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_UPDATED_JOBS_COUNT_KEY), "0");
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_UPDATED_JOB_KEYS_KEY), JSON.stringify([]));
  return inventory;
}

export function buildEmptyInventory(config: RuntimeConfig): InventorySnapshot {
  return {
    runAt: new Date().toISOString(),
    jobs: [],
    stats: {
      totalJobsMatched: 0,
      totalCompaniesConfigured: config.companies.filter((company) => company.enabled !== false).length,
      totalCompaniesDetected: 0,
      totalFetched: 0,
      bySource: {},
      byCompany: {},
      byCompanyFetched: {},
      keywordCounts: {},
    },
  };
}

export async function loadInventoryWithState(
  env: Env,
  config: RuntimeConfig,
  tenantId?: string
): Promise<{ inventory: InventorySnapshot; state: InventoryState }> {
  const state = await loadInventoryState(env, tenantId);
  const inventory = await inventoryFromState(env, config, state, tenantId);
  return { inventory, state };
}

export async function loadInventory(env: Env, config: RuntimeConfig, tenantId?: string): Promise<InventorySnapshot> {
  const { inventory } = await loadInventoryWithState(env, config, tenantId);
  return inventory;
}

async function isJobAlreadySeen(env: Env, job: JobPosting, tenantId?: string): Promise<boolean> {
  const keysToCheck = [seenJobKey(job), ...legacySeenJobKeys(job)];
  try {
    await Promise.any(keysToCheck.map(async (key) => {
      const seen = await jobStateKv(env).get(tenantScopedKey(tenantId, key));
      if (!seen) throw new Error("not found");
      return seen;
    }));
    return true;
  } catch {
    return false;
  }
}

async function getJobFirstSeenAt(env: Env, job: JobPosting, tenantId?: string): Promise<string | null> {
  const firstSeenAt = await jobStateKv(env).get(tenantScopedKey(tenantId, firstSeenFingerprintKey(job)));
  return firstSeenAt ?? null;
}

function comparableJobShape(job: JobPosting) {
  return {
    source: job.source,
    company: job.company,
    id: job.id,
    title: job.title,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt ?? null,
    postedAtSource: job.postedAtSource ?? null,
    detectedCountry: job.detectedCountry ?? null,
    isUSLikely: job.isUSLikely ?? null,
    matchedKeywords: [...(job.matchedKeywords ?? [])].sort(),
  };
}

function updateRelevantJobShape(job: JobPosting) {
  return {
    source: job.source,
    company: job.company,
    id: job.id,
    title: job.title,
    location: job.location,
    url: job.url,
    detectedCountry: job.detectedCountry ?? null,
    isUSLikely: job.isUSLikely ?? null,
  };
}

function jobsAreMeaningfullyDifferent(previousJob: JobPosting, nextJob: JobPosting): boolean {
  return JSON.stringify(updateRelevantJobShape(previousJob)) !== JSON.stringify(updateRelevantJobShape(nextJob));
}

function summarizeValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value).trim();
  return text || null;
}

function diffJobFields(previousJob: JobPosting, nextJob: JobPosting): UpdatedJobChange[] {
  const fields: Array<{ key: keyof ReturnType<typeof comparableJobShape>; label: string }> = [
    { key: "title", label: "title" },
    { key: "location", label: "location" },
    { key: "url", label: "url" },
    { key: "detectedCountry", label: "detectedCountry" },
    { key: "isUSLikely", label: "isUSLikely" },
  ];
  const previousShape = comparableJobShape(previousJob);
  const nextShape = comparableJobShape(nextJob);

  return fields
    .map(({ key, label }) => ({
      field: label,
      previous: summarizeValue(previousShape[key]),
      current: summarizeValue(nextShape[key]),
    }))
    .filter((entry) => entry.previous !== entry.current);
}

export async function getLatestRunNotificationJobs(
  env: Env,
  inventory: InventorySnapshot,
  previousInventory: InventorySnapshot | null,
  tenantId?: string
): Promise<{ newJobs: JobPosting[]; updatedJobs: UpdatedEmailJob[] }> {
  const state = await loadInventoryState(env, tenantId);
  const discardRegistry = await loadDiscardRegistry(env, tenantId);
  const jobsByKey = new Map(inventory.jobs.map((job) => [jobKey(job), job]));
  const previousJobsByKey = new Map((previousInventory?.jobs ?? []).map((job) => [jobKey(job), job]));

  const newJobs = state.lastNewJobKeys
    .map((key) => jobsByKey.get(key))
    .filter((job): job is JobPosting => Boolean(job))
    .filter((job) => !isDiscarded(job, discardRegistry));

  const updatedJobs: UpdatedEmailJob[] = state.lastUpdatedJobKeys
    .map((key) => {
      const job = jobsByKey.get(key);
      if (!job || isDiscarded(job, discardRegistry)) return null;
      const previousJob = previousJobsByKey.get(key);
      const changes = previousJob ? diffJobFields(previousJob, job) : [];
      return {
        ...job,
        updateJustification: "Tracked inventory fields changed since the previous snapshot.",
        updateChanges: changes,
      };
    })
    .filter((job): job is NonNullable<typeof job> => Boolean(job));

  return { newJobs, updatedJobs };
}

function jobsForCompanySource(inventory: InventorySnapshot | null, company: string, source: string): JobPosting[] {
  return (inventory?.jobs ?? []).filter((job) => job.company === company && job.source === source);
}

function discardReasonDetails(reason: DiscardReason): string {
  switch (reason) {
    case "excluded_title":
      return "Present in the latest fetch, but the title no longer matches the configured job-title filters.";
    case "excluded_geography":
      return "Present in the latest fetch, but the role resolved outside the US-only inventory rules.";
    case "fetch_failed":
      return "Dropped from the current inventory because the company fetch failed in this run.";
    case "skipped_unresolved_source":
      return "Dropped from the current inventory because no ATS source could be resolved for this company in this run.";
    case "not_returned_by_source":
    default:
      return "Dropped from the current inventory because the source did not return the posting in this run.";
  }
}

function summarizeDiscardReasons(discardSummaries: Array<{ reason: DiscardReason }>): Record<string, number> {
  return discardSummaries.reduce<Record<string, number>>((counts, job) => {
    counts[job.reason] = (counts[job.reason] ?? 0) + 1;
    return counts;
  }, {});
}

function formatETDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isJobUpdatedTodayInET(job: JobPosting, runAt: string): boolean {
  if (!job.postedAt) return false;
  const jobDay = formatETDay(job.postedAt);
  const runDay = formatETDay(runAt);
  return Boolean(jobDay && runDay && jobDay === runDay);
}

export function getInventoryDiff(previousInventory: InventorySnapshot | null, nextInventory: InventorySnapshot): InventoryDiff {
  const previousJobs = previousInventory?.jobs ?? [];
  const previousMap = new Map(previousJobs.map((job) => [jobKey(job), job]));

  const newJobs = nextInventory.jobs.filter((job) => !previousMap.has(jobKey(job)));
  const updatedJobs = nextInventory.jobs.filter((job) => {
    const previousJob = previousMap.get(jobKey(job));
    if (!previousJob) return false;
    return jobsAreMeaningfullyDifferent(previousJob, job);
  });
  return { newJobs, updatedJobs };
}

export async function findNewJobs(
  env: Env,
  previousInventory: InventorySnapshot | null,
  inventory: InventorySnapshot,
  runId?: string,
  tenantId?: string,
  options: {
    recordLog?: boolean;
    diff?: InventoryDiff;
    firstSeenJobKeysThisRun?: Set<string>;
    duplicateFingerprintJobKeysThisRun?: Set<string>;
  } = {}
): Promise<JobPosting[]> {
  const { newJobs: rawNewJobs } = options.diff ?? getInventoryDiff(previousInventory, inventory);
  const sortedRawNewJobs = [...rawNewJobs].sort((a, b) => {
    const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });

  const newJobs: JobPosting[] = [];
  const duplicateFingerprintJobs: JobPosting[] = [];
  const repeatedSeenJobs: JobPosting[] = [];
  const firstSeenToPersist = new Map<string, string>();
  const firstSeenFingerprintsThisRun = new Set<string>();
  const firstSeenJobKeysThisRun = options.firstSeenJobKeysThisRun;
  const duplicateFingerprintJobKeysThisRun = options.duplicateFingerprintJobKeysThisRun;

  for (let index = 0; index < sortedRawNewJobs.length; index += 1) {
    const job = sortedRawNewJobs[index];
    const key = jobKey(job);

    if (firstSeenJobKeysThisRun) {
      if (firstSeenJobKeysThisRun.has(key)) {
        firstSeenToPersist.set(firstSeenFingerprintKey(job), inventory.runAt);
        newJobs.push(job);
      } else if (duplicateFingerprintJobKeysThisRun?.has(key)) {
        duplicateFingerprintJobs.push(job);
      }
      continue;
    }

    const fingerprint = jobStableFingerprint(job);

    if (firstSeenFingerprintsThisRun.has(fingerprint)) {
      duplicateFingerprintJobs.push(job);
      continue;
    }

    // Jobs can come back with a fresh ATS id or URL while still referring to
    // the same underlying role. Consult both the durable first-seen
    // fingerprint and the explicit seen markers before re-alerting the user.
    const [firstSeenAt, alreadySeen] = await Promise.all([
      getJobFirstSeenAt(env, job, tenantId),
      isJobAlreadySeen(env, job, tenantId),
    ]);
    if (firstSeenAt || alreadySeen) {
      repeatedSeenJobs.push(job);
      continue;
    }

    firstSeenFingerprintsThisRun.add(fingerprint);
    firstSeenToPersist.set(firstSeenFingerprintKey(job), inventory.runAt);
    newJobs.push(job);
  }

  if (firstSeenToPersist.size) {
    const firstSeenEntries = [...firstSeenToPersist.entries()];
    await Promise.all(firstSeenEntries.map(([key, value]) => jobStateKv(env).put(tenantScopedKey(tenantId, key), value)));
  }

  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_NEW_JOBS_COUNT_KEY), String(newJobs.length));
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_NEW_JOB_KEYS_KEY), JSON.stringify(newJobs.map((job) => jobKey(job))));
  if (options.recordLog !== false) {
    await recordAppLog(env, {
      level: "info",
      event: "new_jobs_evaluated",
      message: `Detected ${newJobs.length} new jobs in the latest run`,
      tenantId,
      runId,
      route: "scan",
      details: {
        totalMatched: inventory.stats.totalJobsMatched,
        previousMatched: previousInventory?.stats.totalJobsMatched ?? 0,
        newJobCount: newJobs.length,
        rawNewJobCount: rawNewJobs.length,
        repeatedSeenJobCount: repeatedSeenJobs.length,
        duplicateFingerprintJobCount: duplicateFingerprintJobs.length,
      },
    });
  }

  return newJobs;
}

export async function findUpdatedJobs(
  env: Env,
  previousInventory: InventorySnapshot | null,
  inventory: InventorySnapshot,
  runId?: string,
  tenantId?: string,
  options: { recordLog?: boolean; diff?: InventoryDiff } = {}
): Promise<JobPosting[]> {
  const { updatedJobs } = options.diff ?? getInventoryDiff(previousInventory, inventory);
  const visibleUpdatedJobs = updatedJobs.filter((job) => isJobUpdatedTodayInET(job, inventory.runAt));

  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_UPDATED_JOBS_COUNT_KEY), String(visibleUpdatedJobs.length));
  await jobStateKv(env).put(tenantScopedKey(tenantId, LAST_UPDATED_JOB_KEYS_KEY), JSON.stringify(visibleUpdatedJobs.map((job) => jobKey(job))));
  if (options.recordLog !== false) {
    await recordAppLog(env, {
      level: "info",
      event: "updated_jobs_evaluated",
      message: `Detected ${visibleUpdatedJobs.length} updated jobs dated today in the latest run`,
      tenantId,
      runId,
      route: "scan",
      details: {
        totalMatched: inventory.stats.totalJobsMatched,
        previousMatched: previousInventory?.stats.totalJobsMatched ?? 0,
        updatedJobCount: visibleUpdatedJobs.length,
        totalUpdatedDetected: updatedJobs.length,
        updatedJobsFilteredOutByDate: updatedJobs.length - visibleUpdatedJobs.length,
      },
    });
  }
  return visibleUpdatedJobs;
}

export async function markJobsAsSeen(env: Env, jobs: JobPosting[], seenAt: string, runId?: string, tenantId?: string): Promise<void> {
  if (!jobs.length) return;
  const unseenJobs: JobPosting[] = [];
  for (const job of jobs) {
    const seen = await isJobAlreadySeen(env, job, tenantId);
    if (!seen) unseenJobs.push(job);
  }
  if (!unseenJobs.length) return;

  const keys = Array.from(new Set(unseenJobs.flatMap((job) => [seenJobKey(job), ...legacySeenJobKeys(job)])));
  await Promise.all(keys.map((key) => jobStateKv(env).put(tenantScopedKey(tenantId, key), seenAt)));

  await recordAppLog(env, {
    level: "info",
    event: "new_jobs_marked_seen",
    message: `Marked ${unseenJobs.length} jobs as seen after successful notification`,
    tenantId,
    runId,
    route: "scan",
    details: {
      seenCount: unseenJobs.length,
      storedSeenKeys: keys.length,
    },
  });
}

export async function runScan(
  env: Env,
  config: RuntimeConfig,
  runId?: string,
  tenantId?: string,
  options: { isAdmin?: boolean } = {},
): Promise<{ inventory: InventorySnapshot; previousInventory: InventorySnapshot | null; newJobs: JobPosting[]; updatedJobs: JobPosting[] }> {
  const previousState = await loadInventoryState(env, tenantId);
  const previousInventory = previousState.inventory;
  const buildMetadata: BuildInventoryMetadata = {
    firstSeenJobKeysThisRun: new Set<string>(),
    duplicateFingerprintJobKeysThisRun: new Set<string>(),
    firstSeenFingerprintsThisRun: new Set<string>(),
  };

  const inventory = await buildInventory(env, config, previousInventory, runId, tenantId, {
    metadata: buildMetadata,
    isAdmin: options.isAdmin,
  });
  if (runId) {
    await ensureActiveRunOwnership(env, runId);
  }
  const storageInventory = await pruneInventoryForStorage(env, inventory, tenantId);
  const diff = getInventoryDiff(previousInventory, storageInventory);
  const newJobs = await findNewJobs(env, previousInventory, storageInventory, runId, tenantId, {
    recordLog: false,
    diff,
    firstSeenJobKeysThisRun: buildMetadata.firstSeenJobKeysThisRun,
    duplicateFingerprintJobKeysThisRun: buildMetadata.duplicateFingerprintJobKeysThisRun,
  });
  const updatedJobs = await findUpdatedJobs(env, previousInventory, storageInventory, runId, tenantId, { recordLog: false, diff });
  await saveInventory(env, inventory, tenantId, previousState);

  await recordAppLog(env, {
    level: "info",
    event: "final_inventory_counts",
    message: `Inventory saved with ${inventory.stats.totalJobsMatched} current matches, ${newJobs.length} new jobs, and ${updatedJobs.length} updated jobs`,
    tenantId,
    runId,
    route: "scan",
    details: {
      finalJobsStored: storageInventory.stats.totalJobsMatched,
      latestRunMatched: storageInventory.stats.totalJobsMatched,
      newJobCount: newJobs.length,
      updatedJobCount: updatedJobs.length,
      previousMatched: previousInventory?.stats.totalJobsMatched ?? 0,
    },
  });

  return { inventory: storageInventory, previousInventory, newJobs, updatedJobs };
}
