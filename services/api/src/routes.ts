import {
  APPLIED_KEY,
  DASHBOARD_SUMMARY_KEY,
  FIRST_SEEN_PREFIX,
  INVENTORY_KEY,
  LAST_NEW_JOB_KEYS_KEY,
  LAST_NEW_JOBS_COUNT_KEY,
  LAST_UPDATED_JOB_KEYS_KEY,
  LAST_UPDATED_JOBS_COUNT_KEY,
  MAX_APP_LOG_LIMIT,
  TREND_KEY,
} from "./constants";
import {
  applyCompanyScanOverrides,
  companyToDetectedConfig,
  inferSourceFromUrl,
  loadRuntimeConfig,
  normalizeSource,
  sanitizeCompanies,
  sanitizeJobtitles,
  saveRuntimeConfig,
} from "./config";
import { registeredAdapterIds } from "./ats/registry";
import { getByCompany, listAll, listByAts, loadRegistryCache } from "./storage/registry-cache";
import { resumeRegistryCompanyScan, updateActiveTrackers } from "./storage/registry-scan-state";
import { scrapeOne } from "./services/registry-scraper";
import { confirmPasswordReset, requestPasswordReset } from "./services/password-reset";
import { writeAnalytics } from "./lib/analytics";
import { jsonResponse, withDocsSecurity, withSecurity } from "./lib/http";
import { jobStateKv, atsCacheKv } from "./lib/bindings";
import { resolveRequestTenantContext, tenantScopedKey, tenantScopedPrefix } from "./lib/tenant";
import {
  enrichJob,
  formatDateOnly,
  formatET,
  isInterestingTitle,
  jobKey,
  jobStableFingerprint,
  normalizeAppliedStatus,
  nowISO,
  shouldKeepJobForUSInventory,
  slugify,
} from "./lib/utils";
import {
  ActiveRunOwnershipError,
  acquireActiveRunLock,
  appendSupportMessage,
  clearATSCache,
  clearActiveRunLock,
  createAnnouncement,
  createSupportTicket,
  deleteAnnouncement,
  deleteSavedFilter,
  deleteKvPrefix,
  ensureActiveRunOwnership,
  findUserProfiles,
  getFeatureUsageAnalytics,
  getGrowthAnalytics,
  getMarketIntelAnalytics,
  getScanQuotaAnalytics,
  getSystemHealthAnalytics,
  getSupportTicket,
  listAnnouncements,
  loadAnnouncementsForUser,
  listSavedFilters,
  listAdminTickets,
  listAppLogs,
  listSupportTicketMessages,
  listUserTickets,
  updateAnnouncement,
  loadAllPlanConfigs,
  loadBillingSubscription,
  loadPlanConfig,
  loadFeatureFlags,
  loadStripeConfigPublic,
  saveStripeConfig,
  savePlanConfig,
  loadActiveRunLock,
  loadAppliedJobs,
  loadCompanyScanOverrides,
  loadEmailWebhookConfig,
  loadJobNotes,
  loadLatestRawScanSummary,
  loadUserProfile,
  loadUserSettings,
  recordAppLog,
  recordEvent,
  recordErrorLog,
  releaseActiveRunLock,
  requestRunAbort,
  reserveEmailSendAttempt,
  saveFeatureFlag,
  saveEmailWebhookConfig,
  saveSavedFilter,
  saveAppliedJobsForTenant,
  saveJobNotes,
  setUserAccountStatus,
  adminSetUserPlan,
  loadScanQuotaUsage,
  listCurrentRawScanSummaries,
  summarizeCurrentRawScans,
  remainingLiveScans,
  setCompanyScanOverride,
  setCompanyScanOverrides,
  updateEmailSendAttempt,
  exportAppliedJobRecords,
  exportScanStateRecords,
  toNdjson,
  archiveAppliedJobSnapshot,
  deleteTenantArchivedJobSnapshots,
  loadArchivedJobSnapshotHtml,
} from "./storage";
import { biasQueryByCurrentHour } from "./storage/registry-scan-state";
import { recordPasswordResetConfirmAttempt } from "./storage/password-reset";
import {
  companyRegistryKey,
  deleteRegistryCompanyConfig,
  listRegistryCompanyConfigs,
  loadRegistryCompanyConfigByRegistryId,
  saveRegistryCompanyConfig,
  validateAndPromoteCustomCompany,
} from "./storage/registry-admin";
import { normalizeCompanyKey } from "./storage/tenant-keys";
import {
  buildDashboardPayload,
  buildDashboardSummaryFingerprint,
  loadCachedDashboardPayload,
  saveCachedDashboardPayload,
} from "./services/dashboard";
import { createCheckoutSession, handleStripeWebhook } from "./services/billing";
import {
  fetchJobsForDetectedConfig,
  getDetectedConfig,
  getProtectedDiscoveryRecord,
  resetDiscoveryForCompany,
  resolveWorkdayForCompany,
} from "./services/discovery";
import { removeBrokenAvailableJobs } from "./services/broken-links";
import { maybeSendEmail } from "./services/email";
import {
  addDiscardedJobKey,
  buildAvailableJobsFromSharedInventory,
  buildInventory,
  getLatestRunNotificationJobs,
  loadDiscardRegistry,
  loadInventory,
  loadInventoryState,
  loadInventoryWithState,
  markJobsAsSeen,
  removeInventoryJobsByKeys,
  runScan,
  saveInventory,
  streamAvailableJobsPage,
} from "./services/inventory";
import { openApiJsonResponse } from "./openapi";
import type {
  ActionPlanRow,
  AppliedJobRecord,
  AppliedJobStatus,
  Env,
  InterviewOutcome,
  InterviewRoundDesignation,
  InventorySnapshot,
  JobPosting,
  RegistryLastScanStatus,
  NoteRecord,
  RuntimeConfig,
  SavedFilterScope,
  TimelineEvent,
  UpdatedEmailJob,
  UserPlan,
} from "./types";

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Invalid JSON body");
  }
}

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const MAX_SUPPORT_TICKET_SUBJECT_LENGTH = 500;
const MAX_SUPPORT_TICKET_BODY_LENGTH = 50_000;

async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

function parseDurationHours(raw: string | null): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const shorthandMap: Record<string, number> = {
    "1h": 1,
    "3h": 3,
    "1d": 24,
    "3d": 24 * 3,
    "1w": 24 * 7,
    "2w": 24 * 14,
    "3w": 24 * 21,
    "1m": 24 * 30,
    "2m": 24 * 60,
    "3m": 24 * 90,
  };

  if (value in shorthandMap) return shorthandMap[value];
  return null;
}

function formatETDayKey(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function filterJobs(jobs: JobPosting[], params: URLSearchParams): JobPosting[] {
  const source = params.get("source")?.trim().toLowerCase();
  const companies = parseMultiValues(params, "company");
  const company = companies.length ? "" : params.get("company")?.trim().toLowerCase();
  const location = params.get("location")?.trim().toLowerCase();
  const keyword = params.get("keyword")?.trim().toLowerCase();
  const usOnly = params.get("usOnly") === "true";
  const durationHours = parseDurationHours(params.get("duration"));
  const now = Date.now();

  return jobs.filter((job) => {
    if (source && job.source !== source) return false;
    if (companies.length && !companies.includes(job.company.toLowerCase())) return false;
    if (company && !job.company.toLowerCase().includes(company)) return false;
    if (location && !job.location.toLowerCase().includes(location)) return false;
    if (keyword && !job.title.toLowerCase().includes(keyword)) return false;
    if (usOnly && job.isUSLikely === false) return false;

    if (durationHours !== null) {
      if (!job.postedAt) return false;
      const postedAtMs = new Date(job.postedAt).getTime();
      if (!Number.isFinite(postedAtMs)) return false;
      const ageMs = now - postedAtMs;
      if (ageMs < 0) return false;
      const maxAgeMs = durationHours * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) return false;
    }

    return true;
  });
}

function filterAppliedJobs(rows: AppliedJobRecord[], params: URLSearchParams): AppliedJobRecord[] {
  const companies = parseMultiValues(params, "company");
  const company = companies.length ? "" : params.get("company")?.trim().toLowerCase();
  const keyword = params.get("keyword")?.trim().toLowerCase();
  const status = params.get("status")?.trim().toLowerCase();

  return rows.filter((row) => {
    if (companies.length && !companies.includes(row.job.company.toLowerCase())) return false;
    if (company && !row.job.company.toLowerCase().includes(company)) return false;
    if (keyword && !row.job.title.toLowerCase().includes(keyword)) return false;
    if (status && row.status.toLowerCase() !== status) return false;
    return true;
  });
}

function parseMultiValues(params: URLSearchParams, key: string): string[] {
  const values = params.getAll(key)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

function uniqueSortedCompanies(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function enabledCompanyKeys(companies: RuntimeConfig["companies"]): Set<string> {
  return new Set(
    companies
      .filter((company) => company.enabled !== false)
      .map((company) => slugify(company.company))
      .filter(Boolean),
  );
}

function effectiveEnabledCompanyKeys(
  companies: RuntimeConfig["companies"],
  overrides: Record<string, { paused: boolean }>,
): Set<string> {
  return new Set(
    companies
      .filter((company) => company.enabled !== false)
      .filter((company) => overrides[slugify(company.company)]?.paused !== true)
      .map((company) => slugify(company.company))
      .filter(Boolean),
  );
}

function summarizeCompaniesByAts(companies: RuntimeConfig["companies"]): Array<{ ats: string; count: number }> {
  const counts = new Map<string, number>();
  for (const company of companies) {
    const ats = String(company.registryAts || company.source || "unknown").trim() || "unknown";
    counts.set(ats, (counts.get(ats) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ats, count]) => ({ ats, count }))
    .sort((a, b) => b.count - a.count || a.ats.localeCompare(b.ats));
}

async function loadCompanyLimitForUser(userId: string): Promise<number | null> {
  const subscription = await loadBillingSubscription(userId);
  const planConfig = await loadPlanConfig(subscription.plan);
  return planConfig.maxCompanies;
}

function maxCompaniesError(limit: number, current: number) {
  return {
    ok: false,
    error: `Plan limit reached. This plan allows up to ${limit} tracked companies.`,
    limit,
    current,
  };
}

const LARGE_SCAN_CONFIRMATION_THRESHOLD = 20;

function largeScanConfirmationError(enabledCompanyCount: number, isAdmin: boolean) {
  return {
    ok: false,
    error: isAdmin
      ? `This admin scan will refresh ${enabledCompanyCount} companies. Confirm before starting such a large manual scan.`
      : `This scan will check ${enabledCompanyCount} companies and may take a while. Confirm before starting.`,
    requiresConfirmation: true,
    enabledCompanyCount,
    threshold: LARGE_SCAN_CONFIRMATION_THRESHOLD,
  };
}

function validateSupportTextFields(subject: string, body: string): string | null {
  if (!subject.trim() || !body.trim()) return "subject and body are required";
  if (subject.length > MAX_SUPPORT_TICKET_SUBJECT_LENGTH) {
    return `subject must be ${MAX_SUPPORT_TICKET_SUBJECT_LENGTH} characters or fewer`;
  }
  if (body.length > MAX_SUPPORT_TICKET_BODY_LENGTH) {
    return `body must be ${MAX_SUPPORT_TICKET_BODY_LENGTH} characters or fewer`;
  }
  return null;
}

function parseIsoDateTime(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new RequestValidationError(`${fieldName} must be a valid ISO date-time`);
  }
  return new Date(parsed).toISOString();
}

async function resolveBreakGlassTenantId(rawValue: string): Promise<string> {
  const candidate = rawValue.trim();
  if (!candidate) return "";
  const profile = await loadUserProfile(candidate);
  return profile?.tenantId ?? candidate;
}

function mergeAppliedJobsWithInventory(
  appliedJobs: Record<string, AppliedJobRecord>,
  inventory: InventorySnapshot
): AppliedJobRecord[] {
  const inventoryMap = new Map(inventory.jobs.map((job) => [jobKey(job), job]));

  return Object.values(appliedJobs).map((row) => {
    const latestJob = inventoryMap.get(row.jobKey);
    if (!latestJob) return row;
    return { ...row, job: latestJob };
  });
}

function archivedJobRoute(jobKeyValue: string): string {
  return `/api/jobs/archive?jobKey=${encodeURIComponent(jobKeyValue)}`;
}

function applyArchivedUrlPresentation(record: AppliedJobRecord): AppliedJobRecord & {
  displayUrl: string;
  archivedUrl?: string;
  originalUrl: string;
} {
  const originalUrl = record.originalJobUrl ?? record.job.url;
  const archivedUrl = record.archivedSnapshotKey ? archivedJobRoute(record.jobKey) : undefined;
  return {
    ...record,
    displayUrl: archivedUrl ?? record.job.url,
    archivedUrl,
    originalUrl,
  };
}

async function loadDerivedAvailableInventory(
  env: Env,
  config: RuntimeConfig,
  tenantId: string | undefined,
  options: { isAdmin?: boolean } = {},
): Promise<{
  storedInventory: InventorySnapshot;
  effectiveInventory: InventorySnapshot;
  inventoryState: Awaited<ReturnType<typeof loadInventoryWithState>>["state"];
}> {
  const { inventory: storedInventory, state: inventoryState } = await loadInventoryWithState(env, config, tenantId);
  const effectiveInventory = await buildAvailableJobsFromSharedInventory(
    env,
    config,
    inventoryState.inventory ?? storedInventory,
    tenantId,
    options,
  );
  return { storedInventory, effectiveInventory, inventoryState };
}

async function loadStoredAvailableInventory(
  env: Env,
  config: RuntimeConfig,
  tenantId: string | undefined,
): Promise<{
  inventory: InventorySnapshot;
  inventoryState: Awaited<ReturnType<typeof loadInventoryWithState>>["state"];
}> {
  // Dashboard-like surfaces should prefer the tenant's persisted snapshot so
  // they can render quickly instead of rebuilding the shared inventory on every
  // read. The interactive jobs page already has its own optimized read path.
  const { inventory, state: inventoryState } = await loadInventoryWithState(env, config, tenantId);
  return { inventory, inventoryState };
}

type DashboardInventoryResolution = {
  inventory: InventorySnapshot;
  inventoryState: Awaited<ReturnType<typeof loadInventoryWithState>>["state"];
  source: "stored" | "shared-fallback";
  freshnessProbeSkipped: boolean;
  staleReason: string | null;
};

const DASHBOARD_FRESHNESS_PROBE_LIMIT = 40;

/**
 * Dashboard should stay fast, but it also cannot silently drift away from the
 * shared inventory that powers Available Jobs. Probe a bounded set of current
 * raw-scan summaries first, then only pay the rebuild cost when the tenant's
 * stored snapshot is clearly stale.
 */
async function resolveDashboardInventory(
  env: Env,
  config: RuntimeConfig,
  tenantId: string | undefined,
  options: { isAdmin?: boolean } = {},
): Promise<DashboardInventoryResolution> {
  const { inventory: storedInventory, inventoryState } = await loadStoredAvailableInventory(env, config, tenantId);
  const storedRunAtMs = Date.parse(storedInventory.runAt ?? "");
  const enabledCompanies = config.companies.filter((company) => company.enabled !== false);

  if (!Number.isFinite(storedRunAtMs)) {
    const effectiveInventory = await buildAvailableJobsFromSharedInventory(
      env,
      config,
      inventoryState.inventory ?? storedInventory,
      tenantId,
      options,
    );
    void saveInventory(env, effectiveInventory, tenantId, inventoryState).catch((error) => {
      console.error("[dashboard.summary] failed to persist fallback inventory", error);
    });
    return {
      inventory: effectiveInventory,
      inventoryState,
      source: "shared-fallback",
      freshnessProbeSkipped: true,
      staleReason: "invalid-stored-runAt",
    };
  }

  if (Date.parse(config.updatedAt) > storedRunAtMs) {
    const effectiveInventory = await buildAvailableJobsFromSharedInventory(
      env,
      config,
      inventoryState.inventory ?? storedInventory,
      tenantId,
      options,
    );
    void saveInventory(env, effectiveInventory, tenantId, inventoryState).catch((error) => {
      console.error("[dashboard.summary] failed to persist config-refresh inventory", error);
    });
    return {
      inventory: effectiveInventory,
      inventoryState,
      source: "shared-fallback",
      freshnessProbeSkipped: true,
      staleReason: "config-newer-than-stored",
    };
  }

  if (enabledCompanies.length === 0 || enabledCompanies.length > DASHBOARD_FRESHNESS_PROBE_LIMIT) {
    return {
      inventory: storedInventory,
      inventoryState,
      source: "stored",
      freshnessProbeSkipped: enabledCompanies.length > DASHBOARD_FRESHNESS_PROBE_LIMIT,
      staleReason: null,
    };
  }

  const detectedConfigs = enabledCompanies
    .map((company) => companyToDetectedConfig(company))
    .filter((detected): detected is NonNullable<typeof detected> => Boolean(detected));
  if (detectedConfigs.length === 0) {
    return {
      inventory: storedInventory,
      inventoryState,
      source: "stored",
      freshnessProbeSkipped: false,
      staleReason: null,
    };
  }

  const rawScanSummaries = await Promise.all(
    detectedConfigs.map((detected) => loadLatestRawScanSummary(detected, { allowStale: true })),
  );
  const latestSharedScanAtMs = rawScanSummaries.reduce<number>((latest, summary) => {
    const scannedAtMs = Date.parse(summary?.scannedAt ?? "");
    return Number.isFinite(scannedAtMs) ? Math.max(latest, scannedAtMs) : latest;
  }, 0);

  if (latestSharedScanAtMs > storedRunAtMs) {
    const effectiveInventory = await buildAvailableJobsFromSharedInventory(
      env,
      config,
      inventoryState.inventory ?? storedInventory,
      tenantId,
      options,
    );
    void saveInventory(env, effectiveInventory, tenantId, inventoryState).catch((error) => {
      console.error("[dashboard.summary] failed to persist shared-refresh inventory", error);
    });
    return {
      inventory: effectiveInventory,
      inventoryState,
      source: "shared-fallback",
      freshnessProbeSkipped: false,
      staleReason: "shared-scan-newer-than-stored",
    };
  }

  return {
    inventory: storedInventory,
    inventoryState,
    source: "stored",
    freshnessProbeSkipped: false,
    staleReason: null,
  };
}

function summarizeInventoryJobs(jobs: JobPosting[], inventory: InventorySnapshot): InventorySnapshot["stats"] {
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
    totalJobsMatched: jobs.length,
    totalCompaniesConfigured: inventory.stats.totalCompaniesConfigured,
    totalCompaniesDetected: inventory.stats.totalCompaniesDetected,
    totalFetched: inventory.stats.totalFetched,
    bySource,
    byCompany,
    keywordCounts,
  };
}

function buildEmptyInventory(config: RuntimeConfig): InventorySnapshot {
  return {
    runAt: nowISO(),
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

function deriveRegistryLastScanStatus(scanState: {
  status?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  nextScanAt?: string | null;
} | null | undefined, options: {
  lastScannedAt?: string | null;
  nextScanAt?: string | null;
  nowIso?: string;
} = {}): RegistryLastScanStatus {
  const effectiveLastScannedAt = options.lastScannedAt ?? scanState?.lastSuccessAt ?? null;
  const effectiveNowIso = options.nowIso ?? nowISO();
  const nextScanAt = options.nextScanAt ?? scanState?.nextScanAt ?? null;
  const isOverdueWithoutSnapshot = Boolean(
    !effectiveLastScannedAt
      && nextScanAt
      && nextScanAt.localeCompare(effectiveNowIso) <= 0,
  );

  // If a company is already overdue and still has no successful snapshot, the
  // admin table should surface that as a failure instead of a misleading pass.
  if (isOverdueWithoutSnapshot) return "fail";
  if (!scanState?.lastSuccessAt && !scanState?.lastFailureAt) return "pending";
  if (scanState.status === "failing" || scanState.status === "misconfigured") return "fail";
  if (scanState.status === "paused") return "fail";
  if (scanState.lastFailureAt && (!scanState.lastSuccessAt || scanState.lastFailureAt.localeCompare(scanState.lastSuccessAt) > 0)) {
    return "fail";
  }
  return "pass";
}

function categorizeRegistryFailure(
  scanState: {
    status?: string | null;
    lastFailureReason?: string | null;
  } | null | undefined,
  options: {
    lastScannedAt?: string | null;
    nextScanAt?: string | null;
    nowIso?: string;
  } = {},
): string {
  const reason = String(scanState?.lastFailureReason ?? "").trim().toLowerCase();
  const effectiveNowIso = options.nowIso ?? nowISO();
  const nextScanAt = options.nextScanAt ?? null;
  const lastScannedAt = options.lastScannedAt ?? null;

  if (!lastScannedAt && nextScanAt && nextScanAt.localeCompare(effectiveNowIso) <= 0) return "Overdue scan";
  if (scanState?.status === "misconfigured") return "Config issue";
  if (scanState?.status === "paused") return "Needs review";
  if (!reason) return "Scan failed";
  if (reason.includes("timeout")) return "Timeout";
  if (reason.includes("429") || reason.includes("rate") || reason.includes("throttle")) return "Rate limit";
  if (reason.includes("401") || reason.includes("403") || reason.includes("auth") || reason.includes("forbidden")) return "Auth issue";
  if (reason.includes("404") || reason.includes("410") || reason.includes("missing") || reason.includes("not found")) return "Board missing";
  if (reason.includes("parse") || reason.includes("schema") || reason.includes("json") || reason.includes("html")) return "Parser issue";
  if (reason.includes("network") || reason.includes("dns") || reason.includes("fetch") || reason.includes("socket") || reason.includes("connect")) return "Network error";
  if (reason.includes("empty") || reason.includes("no jobs")) return "Empty result";
  return "Scan failed";
}

function isSavedFilterScope(value: string): value is SavedFilterScope {
  return value === "available_jobs" || value === "applied_jobs" || value === "dashboard" || value === "logs";
}

async function loadLatestRunMarkers(
  env: Env,
  tenantId?: string
): Promise<{ newJobKeys: Set<string>; updatedJobKeys: Set<string> }> {
  const lastNewJobKeysRaw = await jobStateKv(env).get(tenantScopedKey(tenantId, LAST_NEW_JOB_KEYS_KEY), "json");
  const lastUpdatedJobKeysRaw = await jobStateKv(env).get(tenantScopedKey(tenantId, LAST_UPDATED_JOB_KEYS_KEY), "json");

  return {
    newJobKeys: new Set(Array.isArray(lastNewJobKeysRaw) ? lastNewJobKeysRaw.map(String) : []),
    updatedJobKeys: new Set(Array.isArray(lastUpdatedJobKeysRaw) ? lastUpdatedJobKeysRaw.map(String) : []),
  };
}

function isBrokenJobResponseStatus(status: number): boolean {
  return status === 404 || status === 410;
}

async function checkJobUrlHealth(url: string): Promise<{
  broken: boolean;
  status: number | null;
  finalUrl: string | null;
  method: "HEAD" | "GET";
  reason?: string;
}> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { broken: true, status: null, finalUrl: null, method: "HEAD", reason: "unsupported_protocol" };
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".internal")
    || hostname.endsWith(".local")
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    return { broken: true, status: null, finalUrl: null, method: "HEAD", reason: "private_host_blocked" };
  }

  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "career-jump/1.0",
  };

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      return {
        broken: isBrokenJobResponseStatus(response.status),
        status: response.status,
        finalUrl: response.url || null,
        method: "GET",
      };
    }

    return {
      broken: isBrokenJobResponseStatus(response.status),
      status: response.status,
      finalUrl: response.url || null,
      method: "HEAD",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { broken: true, status: null, finalUrl: null, method: "HEAD", reason: "timeout" };
    }
    throw error;
  }
}

function makeTimelineEvent(event: Omit<TimelineEvent, "id">): TimelineEvent {
  return {
    // Use UUIDs so front-end timeline rendering never risks accidental
    // collisions when several updates land in the same millisecond.
    id: crypto.randomUUID(),
    ...event,
  };
}

function ensureBaseTimeline(record: AppliedJobRecord): AppliedJobRecord {
  if (Array.isArray(record.timeline) && record.timeline.length > 0) return record;
  const timeline: TimelineEvent[] = [];
  if (record.job.postedAt) {
    timeline.push(makeTimelineEvent({ type: "posted", label: "Posted at", at: record.job.postedAt }));
  }
  timeline.push(makeTimelineEvent({ type: "applied", label: "Applied at", at: record.appliedAt }));
  return { ...record, timeline };
}

function createAppliedRecord(job: JobPosting, key: string, existing?: AppliedJobRecord, notes?: string): AppliedJobRecord {
  const legacyNoteRecords = buildInitialNoteRecords(notes);
  if (existing) {
    if (!notes) return ensureBaseTimeline(existing);
    const noteRecords = [...(existing.noteRecords ?? []), ...legacyNoteRecords];
    return {
      ...ensureBaseTimeline(existing),
      originalJobUrl: existing.originalJobUrl ?? existing.job.url,
      archivedSnapshotKey: existing.archivedSnapshotKey,
      archivedAt: existing.archivedAt,
      noteRecords,
      notes: summarizeNoteRecords(noteRecords),
    };
  }
  const appliedAt = nowISO();
  return ensureBaseTimeline({
    jobKey: key,
    job,
    originalJobUrl: job.url,
    notes: summarizeNoteRecords(legacyNoteRecords),
    noteRecords: legacyNoteRecords,
    appliedAt,
    status: "Applied",
    interviewRounds: [],
    timeline: [],
    lastStatusChangedAt: appliedAt,
  });
}

function buildInitialNoteRecords(notes?: string): NoteRecord[] {
  const text = String(notes ?? "").trim();
  if (!text) return [];
  return [{
    id: crypto.randomUUID(),
    text,
    createdAt: nowISO(),
  }];
}

function summarizeNoteRecords(records: NoteRecord[]): string | undefined {
  if (!records.length) return undefined;
  return records.map((record) => record.text.trim()).filter(Boolean).join("\n\n") || undefined;
}

function upsertAppliedJobNotes(
  record: AppliedJobRecord,
  updater: (records: NoteRecord[]) => NoteRecord[]
): AppliedJobRecord {
  const nextRecords = updater([...(record.noteRecords ?? [])]);
  return {
    ...record,
    noteRecords: nextRecords,
    notes: summarizeNoteRecords(nextRecords),
  };
}

function appendInterviewRound(record: AppliedJobRecord): AppliedJobRecord {
  const safe = ensureBaseTimeline(record);
  const roundNumber = safe.interviewRounds.length + 1;
  const roundId = `interview-${roundNumber}-${Date.now()}`;
  const now = nowISO();
  const interviewRounds = [
    ...safe.interviewRounds,
    {
      id: roundId,
      roundNumber,
      designation: defaultRoundDesignation(roundNumber),
      outcome: "Pending" as InterviewOutcome,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const timeline = [
    ...safe.timeline,
    makeTimelineEvent({
      type: "interview",
      label: `Interview round ${roundNumber}`,
      roundId,
    }),
  ];
  return { ...safe, interviewRounds, timeline };
}

function defaultRoundDesignation(roundNumber: number): InterviewRoundDesignation {
  const sequence: InterviewRoundDesignation[] = ["Recruiter", "Aptitude Tests", "Hiring Manager", "Loop Interview", "Skip Manager"];
  return sequence[Math.min(Math.max(roundNumber - 1, 0), sequence.length - 1)];
}

function normalizeRoundDesignation(value: unknown, fallback?: InterviewRoundDesignation): InterviewRoundDesignation | undefined {
  return value === "Recruiter" ||
    value === "Aptitude Tests" ||
    value === "Hiring Manager" ||
    value === "Loop Interview" ||
    value === "Skip Manager"
    ? value
    : fallback;
}

function appendStatusEvent(record: AppliedJobRecord, status: AppliedJobStatus): AppliedJobRecord {
  const safe = ensureBaseTimeline(record);
  return {
    ...safe,
    lastStatusChangedAt: nowISO(),
    timeline: [...safe.timeline, makeTimelineEvent({ type: "status", label: "Status", value: status, at: nowISO() })],
  };
}

function buildActionPlanRows(rows: AppliedJobRecord[]): ActionPlanRow[] {
  return rows
    .filter((row) => Array.isArray(row.interviewRounds) && row.interviewRounds.length > 0)
    .map((row) => {
      const currentRound = [...row.interviewRounds].sort((a, b) => b.roundNumber - a.roundNumber)[0];
      const archived = applyArchivedUrlPresentation(row);
      return {
        jobKey: row.jobKey,
        company: row.job.company,
        jobTitle: row.job.title,
        originalUrl: archived.originalUrl,
        archivedUrl: archived.archivedUrl,
        archiveCapturedAt: row.archivedAt,
        notes: row.notes,
        noteRecords: row.noteRecords,
        appliedAt: formatET(row.appliedAt) ?? null,
        appliedAtDate: formatDateOnly(row.appliedAt) ?? null,
        interviewAt: currentRound?.interviewAt ? formatET(currentRound.interviewAt) : null,
        interviewAtDate: currentRound?.interviewAt ? formatDateOnly(currentRound.interviewAt) : null,
        outcome: currentRound?.outcome ?? "Pending",
        currentRoundId: currentRound?.id ?? "",
        currentRoundNumber: currentRound?.roundNumber ?? 0,
        interviewRounds: row.interviewRounds,
        timeline: row.timeline,
        url: archived.displayUrl,
        location: row.job.location,
        source: row.job.source,
        postedAt: row.job.postedAt,
      };
    })
    .sort((a, b) => {
      const aTime = a.interviewAt ? new Date(a.interviewAt).getTime() : 0;
      const bTime = b.interviewAt ? new Date(b.interviewAt).getTime() : 0;
      return bTime - aTime;
    });
}

function requireAdminContext(
  tenantContext: Awaited<ReturnType<typeof resolveRequestTenantContext>>
): Response | null {
  if (tenantContext.isAdmin) return null;
  return jsonResponse({ ok: false, error: "Admin access required" }, 403);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    let tenantContextPromise: Promise<Awaited<ReturnType<typeof resolveRequestTenantContext>>> | null = null;
    const getTenantContext = () => {
      tenantContextPromise ??= resolveRequestTenantContext(request, env);
      return tenantContextPromise;
    };

    if (url.pathname === "/api/openapi.json" && request.method === "GET") {
      return openApiJsonResponse(request);
    }

    if (url.pathname === "/docs" && request.method === "GET") {
      return withDocsSecurity(await env.ASSETS.fetch(new Request(new URL("/swagger.html", request.url).toString(), request)));
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const [profile, settings, billing, featureFlags] = await Promise.all([
        loadUserProfile(tenantContext.userId),
        loadUserSettings(tenantContext.userId),
        loadBillingSubscription(tenantContext.userId),
        loadFeatureFlags({
          userId: tenantContext.userId,
          tenantId: tenantContext.tenantId,
          email: tenantContext.email,
          displayName: tenantContext.displayName,
          scope: tenantContext.scope,
          isAdmin: tenantContext.isAdmin,
        }),
      ]);
      const userPlan: UserPlan = billing?.plan ?? "free";
      const announcements = await loadAnnouncementsForUser(userPlan, tenantContext.tenantId);
      return jsonResponse({
        ok: true,
        actor: tenantContext,
        profile,
        settings,
        billing,
        featureFlags,
        announcements,
      });
    }

    if (url.pathname === "/api/support/tickets" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const tickets = await listUserTickets({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      });
      return jsonResponse({ ok: true, total: tickets.length, tickets });
    }

    if (url.pathname === "/api/support/tickets" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      const subject = String(body.subject ?? "");
      const messageBody = String(body.body ?? "");
      const supportValidationError = validateSupportTextFields(subject, messageBody);
      if (supportValidationError) {
        return jsonResponse({ ok: false, error: supportValidationError }, 400);
      }
      const ticket = await createSupportTicket({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, {
        subject,
        body: messageBody,
        priority: body.priority as "low" | "normal" | "high" | "urgent" | undefined,
        tags: Array.isArray(body.tags)
          ? body.tags as Array<"bug" | "enhancement" | "subscription_assistance" | "other" | "billing" | "scan" | "account">
          : undefined,
      });
      return jsonResponse({ ok: true, ticket }, 201);
    }

    const supportTicketMatch = url.pathname.match(/^\/api\/support\/tickets\/([^/]+)$/);
    if (supportTicketMatch && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const ticketId = decodeURIComponent(supportTicketMatch[1] ?? "");
      const ticket = await getSupportTicket(ticketId);
      if (!ticket) return jsonResponse({ ok: false, error: "Ticket not found" }, 404);
      if (!tenantContext.isAdmin && ticket.userId !== tenantContext.userId) {
        return jsonResponse({ ok: false, error: "Forbidden" }, 403);
      }
      const messages = await listSupportTicketMessages(ticketId);
      return jsonResponse({ ok: true, ticket, messages });
    }

    const supportTicketMessageMatch = url.pathname.match(/^\/api\/support\/tickets\/([^/]+)\/messages$/);
    if (supportTicketMessageMatch && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const ticketId = decodeURIComponent(supportTicketMessageMatch[1] ?? "");
      const ticket = await getSupportTicket(ticketId);
      if (!ticket) return jsonResponse({ ok: false, error: "Ticket not found" }, 404);
      if (!tenantContext.isAdmin && ticket.userId !== tenantContext.userId) {
        return jsonResponse({ ok: false, error: "Forbidden" }, 403);
      }
      const body = await readJsonBody<Record<string, unknown>>(request);
      const messageBody = String(body.body ?? "");
      if (!messageBody.trim()) return jsonResponse({ ok: false, error: "body is required" }, 400);
      if (messageBody.length > MAX_SUPPORT_TICKET_BODY_LENGTH) {
        return jsonResponse({ ok: false, error: `body must be ${MAX_SUPPORT_TICKET_BODY_LENGTH} characters or fewer` }, 400);
      }
      const message = await appendSupportMessage({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, ticketId, messageBody, { internal: body.internal === true });
      return jsonResponse({ ok: true, message }, 201);
    }

    if (url.pathname === "/api/admin/summary" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const [users, tickets, flags, registryEntries, rawScanSummary] = await Promise.all([
        findUserProfiles(),
        listAdminTickets(),
        loadFeatureFlags({
          userId: tenantContext.userId,
          tenantId: tenantContext.tenantId,
          email: tenantContext.email,
          displayName: tenantContext.displayName,
          scope: tenantContext.scope,
          isAdmin: tenantContext.isAdmin,
        }),
        loadRegistryCache().then(() => listAll()),
        summarizeCurrentRawScans(),
      ]);
      return jsonResponse({
        ok: true,
        users: {
          total: users.length,
          active: users.filter((user) => user.accountStatus === "active").length,
          suspended: users.filter((user) => user.accountStatus === "suspended").length,
        },
        support: {
          totalTickets: tickets.length,
          openTickets: tickets.filter((ticket) => ticket.status === "open").length,
          inProgressTickets: tickets.filter((ticket) => ticket.status === "in_progress").length,
        },
        registry: {
          totalCompanies: registryEntries.length,
          currentCompanies: rawScanSummary.currentCompanies,
          currentJobs: rawScanSummary.currentJobs,
          lastScannedAt: rawScanSummary.lastScannedAt,
        },
        featureFlags: flags,
      });
    }

    if (url.pathname === "/api/admin/registry-status" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const [registryEntries, currentRows, scanStateRows] = await Promise.all([
        loadRegistryCache().then(() => listAll()),
        listCurrentRawScanSummaries(),
        exportScanStateRecords(),
      ]);

      // Join the registry catalog against the current raw-scan inventory so
      // admins can see both scanned and not-yet-scanned companies in one table.
      const currentByCompanyKey = new Map(
        currentRows.map((row) => [normalizeCompanyKey(row.company), row] as const),
      );
      const scanStateByCompanyKey = new Map(
        scanStateRows.map((row) => [normalizeCompanyKey(row.company), row] as const),
      );
      const now = nowISO();
      const rawScanSummary = currentRows.reduce((summary, row) => {
        if (row.lastScannedAt && (!summary.lastScannedAt || row.lastScannedAt.localeCompare(summary.lastScannedAt) > 0)) {
          summary.lastScannedAt = row.lastScannedAt;
        }
        summary.currentCompanies += 1;
        summary.currentJobs += row.totalJobs;
        return summary;
      }, {
        currentCompanies: 0,
        currentJobs: 0,
        lastScannedAt: null as string | null,
      });

      const rows = registryEntries.map((entry) => {
        const current = currentByCompanyKey.get(normalizeCompanyKey(entry.company));
        const scanState = scanStateByCompanyKey.get(normalizeCompanyKey(entry.company));
        const effectiveLastScannedAt = current?.lastScannedAt ?? scanState?.lastSuccessAt ?? null;
        return {
          registryId: normalizeCompanyKey(entry.company),
          company: entry.company,
          ats: entry.ats ?? null,
          scanPool: scanState?.scanPool ?? "cold",
          lastScanStatus: deriveRegistryLastScanStatus(scanState, {
            lastScannedAt: effectiveLastScannedAt,
            nextScanAt: scanState?.nextScanAt ?? null,
            nowIso: now,
          }),
          totalJobs: current?.totalJobs ?? 0,
          lastScannedAt: effectiveLastScannedAt,
          nextScanAt: scanState?.nextScanAt ?? null,
        };
      });

      return jsonResponse({
        ok: true,
        totals: {
          totalCompanies: registryEntries.length,
          currentCompanies: rawScanSummary.currentCompanies,
          currentJobs: rawScanSummary.currentJobs,
          lastScannedAt: rawScanSummary.lastScannedAt,
        },
        rows,
      });
    }

    if (url.pathname === "/api/admin/registry/company-configs" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      // Force-refresh after admin edits so the list view cannot lag behind a
      // just-saved registry row on a different warm Lambda instance.
      const rows = await listRegistryCompanyConfigs(true);
      return jsonResponse({ ok: true, total: rows.length, rows });
    }

    const adminRegistryConfigMatch = url.pathname.match(/^\/api\/admin\/registry\/company-configs\/([^/]+)$/);
    if (adminRegistryConfigMatch && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const registryId = decodeURIComponent(adminRegistryConfigMatch[1] ?? "");
      // Force-refresh for the detail pane for the same reason as the list:
      // admin edits should be visible immediately after save.
      const config = await loadRegistryCompanyConfigByRegistryId(registryId, true);
      if (!config) return jsonResponse({ ok: false, error: "Registry company not found" }, 404);
      return jsonResponse({ ok: true, registryId, config });
    }

    if (adminRegistryConfigMatch && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const registryId = decodeURIComponent(adminRegistryConfigMatch[1] ?? "");
      const body = await readJsonBody<Record<string, unknown>>(request);
      const payload = typeof body.config === "object" && body.config !== null
        ? body.config as Record<string, unknown>
        : body;
      const saved = await saveRegistryCompanyConfig(registryId, payload);
      return jsonResponse({
        ok: true,
        registryId,
        nextRegistryId: companyRegistryKey(saved.config.company),
        previousCompany: saved.previousCompany ?? null,
        config: saved.config,
      });
    }

    if (adminRegistryConfigMatch && request.method === "DELETE") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const registryId = decodeURIComponent(adminRegistryConfigMatch[1] ?? "");
      const deleted = await deleteRegistryCompanyConfig(registryId);
      return jsonResponse({
        ok: true,
        registryId,
        deletedCompany: deleted.deletedCompany,
      });
    }

    if (url.pathname === "/api/admin/actions-needed" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const [registryEntries, currentRows, scanStateRows] = await Promise.all([
        loadRegistryCache().then(() => listAll()),
        listCurrentRawScanSummaries(),
        exportScanStateRecords(),
      ]);

      const currentByCompanyKey = new Map(
        currentRows.map((row) => [normalizeCompanyKey(row.company), row] as const),
      );
      const scanStateByCompanyKey = new Map(
        scanStateRows.map((row) => [normalizeCompanyKey(row.company), row] as const),
      );
      const now = nowISO();

      const rows = registryEntries.flatMap((entry) => {
        const companyKey = normalizeCompanyKey(entry.company);
        const current = currentByCompanyKey.get(companyKey);
        const scanState = scanStateByCompanyKey.get(companyKey);
        const effectiveLastScannedAt = current?.lastScannedAt ?? scanState?.lastSuccessAt ?? null;
        const lastScanStatus = deriveRegistryLastScanStatus(scanState, {
          lastScannedAt: effectiveLastScannedAt,
          nextScanAt: scanState?.nextScanAt ?? null,
          nowIso: now,
        });

        if (lastScanStatus !== "fail") return [];

        return [{
          company: entry.company,
          ats: entry.ats ?? null,
          scanPool: scanState?.scanPool ?? "cold",
          lastScanStatus,
          totalJobs: current?.totalJobs ?? 0,
          lastScannedAt: effectiveLastScannedAt,
          nextScanAt: scanState?.nextScanAt ?? null,
          lastFailureAt: scanState?.lastFailureAt ?? null,
          failureCount: scanState?.failureCount ?? 0,
          failureCategory: categorizeRegistryFailure(scanState, {
            lastScannedAt: effectiveLastScannedAt,
            nextScanAt: scanState?.nextScanAt ?? null,
            nowIso: now,
          }),
          failureReason: scanState?.lastFailureReason ?? null,
        }];
      });

      return jsonResponse({
        ok: true,
        totals: {
          totalFailures: rows.length,
          pausedCompanies: rows.filter((row) => row.nextScanAt === null).length,
          overdueCompanies: rows.filter((row) => row.lastScannedAt === null && row.nextScanAt && row.nextScanAt.localeCompare(now) <= 0).length,
        },
        rows,
      });
    }

    const adminActionResetMatch = url.pathname.match(/^\/api\/admin\/actions-needed\/(.+)\/resume$/);
    if (adminActionResetMatch && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;

      const company = decodeURIComponent(adminActionResetMatch[1] ?? "").trim();
      if (!company) {
        return jsonResponse({ ok: false, error: "company name is required" }, 400);
      }

      await loadRegistryCache({ force: true });
      const entry = getByCompany(company);
      if (!entry) {
        return jsonResponse({ ok: false, error: "Registry company not found" }, 404);
      }

      const state = await resumeRegistryCompanyScan(company, entry.ats);
      await recordEvent(tenantContext, "ADMIN_RESUME_REGISTRY_COMPANY", {
        company,
        ats: entry.ats ?? null,
        nextScanAt: state.nextScanAt,
        scanPool: state.scanPool,
      });

      return jsonResponse({
        ok: true,
        company,
        nextScanAt: state.nextScanAt,
        status: state.status,
        failureCount: state.failureCount,
      });
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const q = url.searchParams.get("q") ?? undefined;
      await recordEvent(tenantContext, "ADMIN_USER_SEARCH", { query: q ?? "" });
      const users = await findUserProfiles(q);
      const hydratedUsers = await Promise.all(users.map(async (user) => {
        // The admin user list should display the currently active paid tier,
        // not the older profile row's seed/default plan field.
        const billing = await loadBillingSubscription(user.userId).catch(() => null);
        return {
          ...user,
          plan: billing?.plan ?? user.plan,
        };
      }));
      return jsonResponse({ ok: true, total: hydratedUsers.length, users: hydratedUsers });
    }

    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const userId = decodeURIComponent(adminUserMatch[1] ?? "").replace(/^USER#/, "");
      const [profile, settings, billing, tickets] = await Promise.all([
        loadUserProfile(userId),
        loadUserSettings(userId),
        loadBillingSubscription(userId),
        listAdminTickets(),
      ]);
      if (!profile) return jsonResponse({ ok: false, error: "User not found" }, 404);
      const runtimeConfig = await loadRuntimeConfig(env, profile.tenantId, {
        isAdmin: profile.scope === "admin",
        updatedByUserId: tenantContext.userId,
      });
      return jsonResponse({
        ok: true,
        profile: {
          ...profile,
          // Keep the detail pane aligned with the active billing tier so paid
          // users and admins do not appear as stale "free" accounts.
          plan: billing.plan,
        },
        settings: {
          ...settings,
          // The admin user panel should report the tenant's actual runtime
          // company list, not the lightweight settings row that only stores
          // notification preferences.
          trackedCompanies: runtimeConfig.companies.map((company) => company.company),
        },
        billing,
        tickets: tickets.filter((ticket) => ticket.userId === userId),
      });
    }

    const adminUserStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (adminUserStatusMatch && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const userId = decodeURIComponent(adminUserStatusMatch[1] ?? "").replace(/^USER#/, "");
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body.accountStatus !== "active" && body.accountStatus !== "suspended") {
        return jsonResponse({ ok: false, error: "accountStatus must be active or suspended" }, 400);
      }
      const profile = await setUserAccountStatus({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, userId, body.accountStatus);
      if (!profile) return jsonResponse({ ok: false, error: "User not found" }, 404);
      return jsonResponse({ ok: true, profile });
    }

    const adminUserPlanMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/plan$/);
    if (adminUserPlanMatch && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const userId = decodeURIComponent(adminUserPlanMatch[1] ?? "").replace(/^USER#/, "");
      const body = await readJsonBody<Record<string, unknown>>(request);
      const validPlans: UserPlan[] = ["free", "starter", "pro", "power"];
      if (!validPlans.includes(body.plan as UserPlan)) {
        return jsonResponse({ ok: false, error: `plan must be one of: ${validPlans.join(", ")}` }, 400);
      }
      const billing = await adminSetUserPlan({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, userId, body.plan as UserPlan);
      if (!billing) return jsonResponse({ ok: false, error: "User not found" }, 404);
      return jsonResponse({ ok: true, billing });
    }

    if (url.pathname === "/api/admin/feature-flags" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const featureFlags = await loadFeatureFlags({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      });
      return jsonResponse({ ok: true, total: featureFlags.length, featureFlags });
    }

    if (url.pathname === "/api/admin/feature-flags" && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (!String(body.flagName ?? "").trim()) return jsonResponse({ ok: false, error: "flagName is required" }, 400);
      const flag = await saveFeatureFlag({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, {
        flagName: String(body.flagName),
        enabled: body.enabled === true,
        enabledForPlans: Array.isArray(body.enabledForPlans) ? body.enabledForPlans as Array<"free" | "pro" | "power"> : [],
        enabledForUsers: Array.isArray(body.enabledForUsers) ? body.enabledForUsers.map(String) : [],
        rolloutPercent: Number(body.rolloutPercent) || 0,
        description: String(body.description ?? ""),
        updatedAt: nowISO(),
        updatedBy: tenantContext.userId,
      });
      return jsonResponse({ ok: true, flag });
    }

    if (url.pathname === "/api/admin/announcements" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const announcements = await listAnnouncements();
      return jsonResponse({ ok: true, total: announcements.length, announcements });
    }

    if (url.pathname === "/api/admin/announcements" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (!String(body.title ?? "").trim() || !String(body.body ?? "").trim()) {
        return jsonResponse({ ok: false, error: "title and body are required" }, 400);
      }
      const activeFrom = parseIsoDateTime(body.activeFrom ?? nowISO(), "activeFrom");
      const activeTo = parseIsoDateTime(body.activeTo, "activeTo");
      const actor = { userId: tenantContext.userId, tenantId: tenantContext.tenantId, email: tenantContext.email, displayName: tenantContext.displayName, scope: tenantContext.scope, isAdmin: tenantContext.isAdmin };
      const announcement = await createAnnouncement(actor, {
        id: String(body.id ?? ""),
        title: String(body.title),
        body: String(body.body),
        severity: body.severity === "warning" || body.severity === "critical" ? body.severity : "info",
        active: body.active !== false,
        dismissible: body.dismissible === true,
        activeFrom: activeFrom ?? nowISO(),
        activeTo,
        targetPlans: Array.isArray(body.targetPlans) ? body.targetPlans as Array<"all" | UserPlan> : ["all"],
        targetTenantIds: Array.isArray(body.targetTenantIds) ? body.targetTenantIds as string[] : null,
        updatedAt: nowISO(),
        updatedBy: tenantContext.userId,
      });
      return jsonResponse({ ok: true, announcement }, 201);
    }

    const announcementIdMatch = url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
    if (announcementIdMatch) {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const id = announcementIdMatch[1];
      const actor = { userId: tenantContext.userId, tenantId: tenantContext.tenantId, email: tenantContext.email, displayName: tenantContext.displayName, scope: tenantContext.scope, isAdmin: tenantContext.isAdmin };

      if (request.method === "PUT") {
        const body = await readJsonBody<Record<string, unknown>>(request);
        const activeFrom = body.activeFrom !== undefined ? (parseIsoDateTime(body.activeFrom, "activeFrom") ?? undefined) : undefined;
        const activeTo = body.activeTo !== undefined ? parseIsoDateTime(body.activeTo, "activeTo") : undefined;
        const updated = await updateAnnouncement(actor, id, {
          ...(body.title !== undefined && { title: String(body.title) }),
          ...(body.body !== undefined && { body: String(body.body) }),
          ...(body.severity !== undefined && { severity: body.severity === "warning" || body.severity === "critical" ? body.severity : "info" }),
          ...(body.active !== undefined && { active: Boolean(body.active) }),
          ...(body.dismissible !== undefined && { dismissible: Boolean(body.dismissible) }),
          ...(activeFrom !== undefined && { activeFrom }),
          ...(activeTo !== undefined && { activeTo }),
          ...(body.targetPlans !== undefined && { targetPlans: Array.isArray(body.targetPlans) ? body.targetPlans as Array<"all" | UserPlan> : ["all"] }),
          ...(body.targetTenantIds !== undefined && { targetTenantIds: Array.isArray(body.targetTenantIds) ? body.targetTenantIds as string[] : null }),
        });
        if (!updated) return jsonResponse({ ok: false, error: "Announcement not found" }, 404);
        return jsonResponse({ ok: true, announcement: updated });
      }

      if (request.method === "DELETE") {
        const deleted = await deleteAnnouncement(actor, id);
        if (!deleted) return jsonResponse({ ok: false, error: "Announcement not found" }, 404);
        return jsonResponse({ ok: true, deleted: true });
      }

      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/admin/support/tickets" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const status = url.searchParams.get("status");
      const tickets = await listAdminTickets(
        status === "open" || status === "in_progress" || status === "resolved" || status === "closed"
          ? status
          : undefined
      );
      return jsonResponse({ ok: true, total: tickets.length, tickets });
    }

    // Keep analytics endpoints in the existing admin-gated section so access
    // control and response shape stay consistent with the rest of the admin API.
    if (url.pathname === "/api/admin/analytics/growth" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      try {
        const envelope = await getGrowthAnalytics();
        return jsonResponse({ ok: true, ...envelope });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/admin/analytics/market-intel" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      try {
        const envelope = await getMarketIntelAnalytics();
        return jsonResponse({ ok: true, ...envelope });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/admin/analytics/feature-usage" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      try {
        const envelope = await getFeatureUsageAnalytics();
        return jsonResponse({ ok: true, ...envelope });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/admin/analytics/system-health" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      try {
        const envelope = await getSystemHealthAnalytics();
        return jsonResponse({ ok: true, ...envelope });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/admin/analytics/scan-quota" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      try {
        const envelope = await getScanQuotaAnalytics();
        return jsonResponse({ ok: true, ...envelope });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/admin/export/jobs" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const requestedUserId = url.searchParams.get("userId")?.trim() ?? "";
      const requestedTenantId = url.searchParams.get("tenantId")?.trim() ?? "";
      let exportTenantId = requestedTenantId;
      if (!exportTenantId && requestedUserId) {
        const profile = await loadUserProfile(requestedUserId);
        exportTenantId = profile?.tenantId ?? "";
      }
      if (!exportTenantId) {
        return jsonResponse({ ok: false, error: "tenantId or userId is required" }, 400);
      }
      await recordEvent(tenantContext, "ADMIN_ACTION", { action: "export_applied_jobs", targetTenantId: exportTenantId, targetUserId: requestedUserId || null });
      const records = await exportAppliedJobRecords(env, exportTenantId);
      return new Response(toNdjson(records), {
        headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": "attachment; filename=\"jobs.ndjson\"" },
      });
    }

    if (url.pathname === "/api/admin/export/scan-state" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const records = await exportScanStateRecords();
      const biased = biasQueryByCurrentHour(records);
      return new Response(toNdjson(biased), {
        headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": "attachment; filename=\"scan-state.ndjson\"" },
      });
    }

    if (url.pathname === "/api/admin/plan-config" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const configs = await loadAllPlanConfigs();
      return jsonResponse({ ok: true, configs });
    }

    const adminPlanConfigMatch = url.pathname.match(/^\/api\/admin\/plan-config\/(free|starter|pro|power)$/);
    if (adminPlanConfigMatch && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const plan = adminPlanConfigMatch[1] as "free" | "starter" | "pro" | "power";
      const body = await readJsonBody<Record<string, unknown>>(request);
      const scanCacheAgeHours = Number(body.scanCacheAgeHours);
      const maxSessions = Number(body.maxSessions);
      const maxEmailsPerWeek = Number(body.maxEmailsPerWeek);
      if (!Number.isFinite(scanCacheAgeHours) || scanCacheAgeHours < 0) {
        return jsonResponse({ ok: false, error: "scanCacheAgeHours must be a non-negative number" }, 400);
      }
      if (!Number.isFinite(maxSessions) || maxSessions < 1) {
        return jsonResponse({ ok: false, error: "maxSessions must be at least 1" }, 400);
      }
      const config = await savePlanConfig(tenantContext.userId, {
        plan,
        displayName: String(body.displayName ?? plan),
        scanCacheAgeHours,
        canTriggerLiveScan: body.canTriggerLiveScan !== false,
        dailyLiveScans: Number.isFinite(Number(body.dailyLiveScans)) ? Number(body.dailyLiveScans) : 2,
        maxCompanies: body.maxCompanies === null ? null : Number(body.maxCompanies) || null,
        maxSessions,
        maxVisibleJobs: body.maxVisibleJobs === null ? null : Number(body.maxVisibleJobs) || null,
        maxAppliedJobs: body.maxAppliedJobs === null ? null : Number(body.maxAppliedJobs) || null,
        emailNotificationsEnabled: body.emailNotificationsEnabled === true,
        weeklyDigestEnabled: body.weeklyDigestEnabled === true,
        maxEmailsPerWeek: Number.isFinite(maxEmailsPerWeek) ? maxEmailsPerWeek : 0,
        enabledFeatures: Array.isArray(body.enabledFeatures) ? body.enabledFeatures.map(String) : [],
      });
      await recordEvent(
        { userId: tenantContext.userId, tenantId: tenantContext.tenantId, email: tenantContext.email, displayName: tenantContext.displayName, scope: tenantContext.scope, isAdmin: tenantContext.isAdmin },
        "PLAN_CONFIG_UPDATED",
        { plan, updatedBy: tenantContext.userId },
      );
      return jsonResponse({ ok: true, config });
    }

    if (url.pathname === "/api/admin/stripe-config" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const config = await loadStripeConfigPublic();
      return jsonResponse({ ok: true, configured: Boolean(config), config: config ?? null });
    }

    if (url.pathname === "/api/admin/stripe-config" && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const body = await readJsonBody<Record<string, unknown>>(request);
      const publishableKey = String(body.publishableKey ?? "").trim();
      const secretKey = String(body.secretKey ?? "").trim();
      const webhookSecret = String(body.webhookSecret ?? "").trim();
      if (!publishableKey || !secretKey) {
        return jsonResponse({ ok: false, error: "publishableKey and secretKey are required" }, 400);
      }
      const priceIds = {
        starter: String((body.priceIds as Record<string, unknown>)?.starter ?? "").trim(),
        pro: String((body.priceIds as Record<string, unknown>)?.pro ?? "").trim(),
        power: String((body.priceIds as Record<string, unknown>)?.power ?? "").trim(),
      };
      const saved = await saveStripeConfig(tenantContext.userId, {
        publishableKey,
        secretKey,
        webhookSecret,
        priceIds,
      });
      await recordEvent(
        { userId: tenantContext.userId, tenantId: tenantContext.tenantId, email: tenantContext.email, displayName: tenantContext.displayName, scope: tenantContext.scope, isAdmin: tenantContext.isAdmin },
        "STRIPE_CONFIG_UPDATED",
        { updatedBy: tenantContext.userId },
      );
      return jsonResponse({ ok: true, config: saved });
    }

    if (url.pathname === "/api/admin/email-webhook" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const stored = await loadEmailWebhookConfig(env);
      return jsonResponse({
        ok: true,
        webhookUrl: stored?.webhookUrl || env.APPS_SCRIPT_WEBHOOK_URL || null,
        sharedSecretConfigured: Boolean(stored?.sharedSecret || env.APPS_SCRIPT_SHARED_SECRET),
      });
    }

    if (url.pathname === "/api/admin/email-webhook" && request.method === "PUT") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const body = await readJsonBody<{ webhookUrl?: string; sharedSecret?: string } & Record<string, unknown>>(request);
      await saveEmailWebhookConfig(env, {
        webhookUrl: body.webhookUrl,
        sharedSecret: body.sharedSecret,
      });
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      const plan = body.plan as string;
      if (!["starter", "pro", "power"].includes(plan)) {
        return jsonResponse({ ok: false, error: "Invalid plan. Must be starter, pro, or power." }, 400);
      }
      const origin = request.headers.get("origin") ?? "https://app.careerjump.io";
      try {
        const result = await createCheckoutSession(
          tenantContext.tenantId,
          tenantContext.userId,
          tenantContext.email,
          plan as "starter" | "pro" | "power",
          `${origin}/profile?tab=subscription&upgraded=true`,
          `${origin}/profile?tab=subscription&canceled=true`,
        );
        return jsonResponse({ ok: true, url: result.url, sessionId: result.sessionId });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Checkout failed" }, 500);
      }
    }

    if (url.pathname === "/api/billing/subscription" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const [subscription, planCfg] = await Promise.all([
        loadBillingSubscription(tenantContext.tenantId).catch(() => null),
        loadBillingSubscription(tenantContext.tenantId)
          .then((s) => loadPlanConfig(s.plan))
          .catch(() => null),
      ]);
      return jsonResponse({ ok: true, subscription, planConfig: planCfg });
    }

    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      const signature = request.headers.get("stripe-signature") ?? "";
      const rawBody = await request.text();
      try {
        const result = await handleStripeWebhook(rawBody, signature);
        return jsonResponse({ ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Webhook error";
        const status = message.includes("signature") ? 400 : 500;
        return jsonResponse({ ok: false, error: message }, status);
      }
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const companyScanOverrides = await loadCompanyScanOverrides(env, tenantContext.tenantId);
      return jsonResponse({ ok: true, config, companyScanOverrides });
    }

    if (url.pathname === "/api/scan-context" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const config = await applyCompanyScanOverrides(
        env,
        await loadRuntimeConfig(env, tenantContext.tenantId, {
          isAdmin: tenantContext.isAdmin,
          updatedByUserId: tenantContext.userId,
          // Manual admin scans should honor the visible tenant configuration
          // instead of silently expanding into the full registry.
          expandAdminCompanies: tenantContext.isAdmin ? false : undefined,
        }),
        tenantContext.tenantId,
      );
      // Sidebar and palette only need the enabled-company count for the large
      // scan confirmation UX, so keep this endpoint intentionally tiny.
      return jsonResponse({
        ok: true,
        enabledCompanyCount: config.companies.filter((company) => company.enabled !== false).length,
      });
    }

    if (url.pathname === "/api/auth/reset/request" && request.method === "POST") {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const email = String(body.email ?? "").trim().toLowerCase();
      const scope = body.scope === "admin" ? "admin" : body.scope === "user" ? "user" : undefined;
      if (!email) return jsonResponse({ ok: false, error: "Email is required" }, 400);
      await requestPasswordReset(env, email, scope);
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/auth/reset/confirm" && request.method === "POST") {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const email = String(body.email ?? "").trim().toLowerCase();
      const code = String(body.code ?? "").trim();
      const newPassword = String(body.newPassword ?? "");
      const scope = body.scope === "admin" ? "admin" : body.scope === "user" ? "user" : undefined;
      if (!email || !code || !newPassword) {
        return jsonResponse({ ok: false, error: "Email, code, and new password are required" }, 400);
      }
      const forwardedFor = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
      const requestIp = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
      if (!(await recordPasswordResetConfirmAttempt(email, scope ?? "user", requestIp))) {
        return jsonResponse({ ok: false, error: "Too many reset attempts. Please wait a minute and try again." }, 429);
      }
      try {
        await confirmPasswordReset(env, email, code, newPassword, scope);
        return jsonResponse({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Password reset failed";
        return jsonResponse({ ok: false, error: message }, 400);
      }
    }

    if (url.pathname === "/api/config/save" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Partial<RuntimeConfig> & Record<string, unknown>>(request);
      const companies = sanitizeCompanies(body.companies ?? []);
      const adminRegistryMode = tenantContext.isAdmin && body.adminRegistryMode === "none" ? "none" : "all";
      const currentConfig = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      await loadRegistryCache();
      const duplicateRegistryCompany = companies.find((company) =>
        company.isRegistry !== true && Boolean(getByCompany(company.company))
      );
      if (duplicateRegistryCompany) {
        return jsonResponse({
          ok: false,
          error: `Company '${duplicateRegistryCompany.company}' already exists in the registry. Use Add company to pick it from the catalog instead of creating a custom entry.`,
        }, 409);
      }
      const invalidCompany = companies.find((company) => company.source && !companyToDetectedConfig(company));
      if (invalidCompany) {
        // Reject invalid ATS source/URL combinations before they become repeated zero-job scans.
        return jsonResponse({
          ok: false,
          error: `Company '${invalidCompany.company}' has source '${invalidCompany.source}' but the board URL or ATS identifiers could not be parsed. Check the URL and try again.`,
        }, 422);
      }
      if (!tenantContext.isAdmin) {
        try {
          const maxCompanies = await loadCompanyLimitForUser(tenantContext.userId);
          const currentEnabled = enabledCompanyKeys(currentConfig.companies);
          const nextEnabled = enabledCompanyKeys(companies);
          if (maxCompanies !== null && nextEnabled.size > maxCompanies) {
            const introducedEnabledCompany = [...nextEnabled].some((key) => !currentEnabled.has(key));
            if (introducedEnabledCompany || nextEnabled.size > currentEnabled.size) {
              return jsonResponse(maxCompaniesError(maxCompanies, currentEnabled.size), 403);
            }
          }
        } catch {
          // Fall through on plan-config lookup failure so config saves do not
          // become unavailable if billing config is temporarily unreadable.
        }
      }
      const next: RuntimeConfig = {
        companies,
        jobtitles: sanitizeJobtitles(body.jobtitles ?? {}),
        updatedAt: nowISO(),
        adminRegistryMode: tenantContext.isAdmin ? adminRegistryMode : undefined,
      };
      const persistedConfig = next;
      await saveRuntimeConfig(env, persistedConfig, tenantContext.tenantId, tenantContext.userId, {
        isAdmin: tenantContext.isAdmin,
      });
      const savedConfig = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      return jsonResponse({ ok: true, config: savedConfig });
    }

    if (url.pathname === "/api/config/validate-company" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      const candidate = sanitizeCompanies([{ ...body, enabled: true, isRegistry: false }])[0];
      const currentConfig = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });

      if (!candidate?.company.trim()) {
        return jsonResponse({ ok: false, error: "Company name is required." }, 400);
      }
      if (!candidate.source) {
        return jsonResponse({ ok: false, error: "ATS is required." }, 400);
      }
      if (!candidate.boardUrl) {
        return jsonResponse({ ok: false, error: "Job board URL is required." }, 400);
      }

      await loadRegistryCache({ force: true });
      if (getByCompany(candidate.company)) {
        return jsonResponse({
          ok: false,
          error: `Company '${candidate.company}' already exists in the registry. Use Add company to pick it from the catalog instead.`,
        }, 409);
      }

      const detected = companyToDetectedConfig(candidate);
      if (!detected) {
        // Fail fast on malformed ATS/URL pairs before hitting the expensive
        // adapter validation path so users get immediate shape feedback.
        return jsonResponse({
          ok: false,
          error: `The URL does not match the expected ${candidate.source} board format.`,
        }, 422);
      }

      if (!tenantContext.isAdmin) {
        try {
          const maxCompanies = await loadCompanyLimitForUser(tenantContext.userId);
          const currentEnabled = enabledCompanyKeys(currentConfig.companies);
          const nextKey = slugify(candidate.company);
          if (maxCompanies !== null && !currentEnabled.has(nextKey) && currentEnabled.size >= maxCompanies) {
            return jsonResponse(maxCompaniesError(maxCompanies, currentEnabled.size), 403);
          }
        } catch {
          // Preserve validation if billing config is temporarily unavailable.
        }
      }

      try {
        const result = await validateAndPromoteCustomCompany(candidate);
        return jsonResponse({
          ok: true,
          company: result.company,
          registryEntry: result.entry,
          totalJobs: result.totalJobs,
          message: `${result.entry.company} validated with ${result.totalJobs} jobs.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Company validation failed";
        const status = message.includes("already exists") ? 409 : 422;
        return jsonResponse({ ok: false, error: message }, status);
      }
    }

    const companyToggleMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/toggle$/);
    if (companyToggleMatch && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const companyName = decodeURIComponent(companyToggleMatch[1] ?? "").trim();
      if (!companyName) return jsonResponse({ ok: false, error: "company name is required" }, 400);

      const body = await readJsonBody<Record<string, unknown>>(request);
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const currentOverrides = await loadCompanyScanOverrides(env, tenantContext.tenantId);
      const currentPaused = currentOverrides[slugify(companyName)]?.paused === true;
      const paused = typeof body.paused === "boolean"
        ? body.paused
        : typeof body.enabled === "boolean"
          ? !body.enabled
          : !currentPaused;
      if (!tenantContext.isAdmin) {
        try {
          const maxCompanies = await loadCompanyLimitForUser(tenantContext.userId);
          const enabledCompanies = effectiveEnabledCompanyKeys(config.companies, currentOverrides);
          const companyKey = slugify(companyName);
          const currentlyEnabled = enabledCompanies.has(companyKey);
          if (maxCompanies !== null && !paused && !currentlyEnabled && enabledCompanies.size >= maxCompanies) {
            return jsonResponse(maxCompaniesError(maxCompanies, enabledCompanies.size), 403);
          }
        } catch {
          // Ignore temporary pricing-config lookup failures and preserve the
          // existing toggle path rather than blocking the whole settings flow.
        }
      }

      const override = await setCompanyScanOverride(env, {
        tenantId: tenantContext.tenantId,
        company: companyName,
        paused,
        updatedByUserId: tenantContext.userId,
      });
      const companyScanOverrides = await loadCompanyScanOverrides(env, tenantContext.tenantId);

      // Best-effort — update registry scan pool based on new active tracker count.
      // Don't await; a registry write failure must never block a user toggle.
      updateActiveTrackers(companyName, paused ? -1 : 1).catch(() => undefined);

      return jsonResponse({ ok: true, company: companyName, paused, enabled: !paused, override, companyScanOverrides });
    }

    if (url.pathname === "/api/companies/toggle-all" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (typeof body.paused !== "boolean") return jsonResponse({ ok: false, error: "paused boolean is required" }, 400);

      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const currentOverrides = await loadCompanyScanOverrides(env, tenantContext.tenantId);
      const companies = config.companies.map((company) => company.company).filter(Boolean);
      if (!tenantContext.isAdmin) {
        try {
          const maxCompanies = await loadCompanyLimitForUser(tenantContext.userId);
          const currentEnabled = effectiveEnabledCompanyKeys(config.companies, currentOverrides);
          const totalEnabledIfUnpaused = enabledCompanyKeys(config.companies);
          if (
            maxCompanies !== null
            && body.paused === false
            && totalEnabledIfUnpaused.size > maxCompanies
            && currentEnabled.size < totalEnabledIfUnpaused.size
          ) {
            return jsonResponse(maxCompaniesError(maxCompanies, currentEnabled.size), 403);
          }
        } catch {
          // Preserve the existing bulk-toggle path if pricing config is
          // temporarily unavailable.
        }
      }
      const companyScanOverrides = await setCompanyScanOverrides(env, {
        tenantId: tenantContext.tenantId,
        companies,
        paused: body.paused,
        updatedByUserId: tenantContext.userId,
      });

      return jsonResponse({
        ok: true,
        paused: body.paused,
        companyCount: companies.length,
        companyScanOverrides,
      });
    }

    if (url.pathname === "/api/config/apply" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      await clearATSCache(env, config.companies);
      const inventory = await buildInventory(env, config, null, undefined, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
      });
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOB_KEYS_KEY), JSON.stringify([]));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOB_KEYS_KEY), JSON.stringify([]));
      await saveInventory(env, inventory, tenantContext.tenantId);
      return jsonResponse({ ok: true, appliedAt: inventory.runAt, totalJobsMatched: inventory.stats.totalJobsMatched });
    }

    if (url.pathname === "/api/cache/clear" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      await clearATSCache(env, config.companies);
      const emptyInventory = buildEmptyInventory(config);

      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, INVENTORY_KEY), JSON.stringify(emptyInventory));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, TREND_KEY), JSON.stringify([]));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOB_KEYS_KEY), JSON.stringify([]));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOB_KEYS_KEY), JSON.stringify([]));
      await saveJobNotes(env, {}, tenantContext.tenantId);
      await jobStateKv(env).delete(tenantScopedKey(tenantContext.tenantId, DASHBOARD_SUMMARY_KEY));

      return jsonResponse({ ok: true, cleared: "available jobs cache", retained: ["applied jobs", "saved company ATS configuration"] });
    }

    if (url.pathname === "/api/data/clear" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      await deleteKvPrefix(jobStateKv(env), tenantScopedPrefix(tenantContext.tenantId, "seen:"));
      await deleteKvPrefix(jobStateKv(env), tenantScopedPrefix(tenantContext.tenantId, FIRST_SEEN_PREFIX));
      // Store an explicit empty tenant value instead of deleting the key.
      // Deleting lets loadAppliedJobs fall back to the legacy global applied
      // store, which can resurrect old applications after a user clears data.
      await saveAppliedJobsForTenant(env, {}, tenantContext.tenantId);
      await deleteTenantArchivedJobSnapshots(tenantContext.tenantId);
      await deleteKvPrefix(atsCacheKv(env), "ats:");
      const emptyInventory = buildEmptyInventory(config);
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, INVENTORY_KEY), JSON.stringify(emptyInventory));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, TREND_KEY), JSON.stringify([]));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_NEW_JOB_KEYS_KEY), JSON.stringify([]));
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOBS_COUNT_KEY), "0");
      await jobStateKv(env).put(tenantScopedKey(tenantContext.tenantId, LAST_UPDATED_JOB_KEYS_KEY), JSON.stringify([]));
      await jobStateKv(env).delete(tenantScopedKey(tenantContext.tenantId, "discardedJobKeys"));
      await saveJobNotes(env, {}, tenantContext.tenantId);
      await jobStateKv(env).delete(tenantScopedKey(tenantContext.tenantId, DASHBOARD_SUMMARY_KEY));
      return jsonResponse({ ok: true, cleared: "inventory and pipeline state", retained: ["saved company ATS configuration", "saved filters", "logs"] });
    }

    if (url.pathname === "/api/run" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request).catch(() => null);
      const confirmLargeScan = body?.confirmLargeScan === true;
      const config = await applyCompanyScanOverrides(
        env,
        await loadRuntimeConfig(env, tenantContext.tenantId, {
          isAdmin: tenantContext.isAdmin,
          updatedByUserId: tenantContext.userId,
          // Keep manual admin scans on the same bounded company set the user
          // sees in Configuration so "scan one company" never fans out to the
          // full registry behind the scenes.
          expandAdminCompanies: tenantContext.isAdmin ? false : undefined,
        }),
        tenantContext.tenantId,
      );
      const enabledCompanyCount = effectiveEnabledCompanyKeys(
        config.companies,
        await loadCompanyScanOverrides(env, tenantContext.tenantId),
      ).size;
      if (enabledCompanyCount > LARGE_SCAN_CONFIRMATION_THRESHOLD && !confirmLargeScan) {
        return jsonResponse(largeScanConfirmationError(enabledCompanyCount, tenantContext.isAdmin), 409);
      }

      const runId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const lockResult = await acquireActiveRunLock(env, { runId, triggerType: "manual" });
      if (!lockResult.ok) {
        await recordAppLog(env, {
          level: "warn",
          event: "manual_run_rejected",
          message: "Manual run rejected because another run is already in progress",
          tenantId: tenantContext.tenantId,
          runId,
          route: "/api/run",
          details: {
            activeRunId: lockResult.lock.runId,
            activeTriggerType: lockResult.lock.triggerType,
            activeStartedAt: lockResult.lock.startedAt,
          },
        });
        return jsonResponse({
          ok: false,
          error: "A run is already in progress. Please wait for the current scan to finish.",
          activeRun: lockResult.lock,
          runId,
        }, 409);
      }
      if (lockResult.recoveredLock) {
        await recordAppLog(env, {
          level: "warn",
          event: "manual_run_recovered_stale_lock",
          message: "Manual run recovered a stale active run lock before starting",
          tenantId: tenantContext.tenantId,
          runId,
          route: "/api/run",
          details: {
            recoveredRunId: lockResult.recoveredLock.runId,
            recoveredTriggerType: lockResult.recoveredLock.triggerType,
            recoveredStartedAt: lockResult.recoveredLock.startedAt,
            recoveredLastHeartbeatAt: lockResult.recoveredLock.lastHeartbeatAt ?? null,
            recoveredCurrentCompany: lockResult.recoveredLock.currentCompany ?? null,
            recoveredCurrentStage: lockResult.recoveredLock.currentStage ?? null,
          },
        });
      }
      await recordAppLog(env, {
        level: "info",
        event: "manual_run_started",
        message: "Manual run started",
        tenantId: tenantContext.tenantId,
        runId,
        route: "/api/run",
      });
      writeAnalytics(env, {
        event: "manual_run_started",
        indexes: ["manual", "/api/run"],
        blobs: [runId],
        doubles: [],
      });
      try {
        const { inventory, previousInventory, newJobs, updatedJobs } = await runScan(
          env,
          config,
          runId,
          tenantContext.tenantId,
          { isAdmin: tenantContext.isAdmin },
        );
        const notificationJobs = await getLatestRunNotificationJobs(env, inventory, previousInventory, tenantContext.tenantId);

        let emailStatus: "sent" | "skipped" | "failed" = "skipped";
        let emailError: string | null = null;
        let emailSkipReason: string | null = null;

        try {
          await ensureActiveRunOwnership(env, runId);
          const hasNotificationJobs = notificationJobs.newJobs.length > 0 || notificationJobs.updatedJobs.length > 0;
          if (hasNotificationJobs) {
            const emailAttempt = await reserveEmailSendAttempt(env, runId, tenantContext.tenantId);
            if (!emailAttempt.reserved) {
              emailStatus = "skipped";
              emailSkipReason = `Email already attempted for this run (${emailAttempt.attempt?.status ?? "unknown"})`;
            } else {
              try {
                const emailResult = await maybeSendEmail(
                  env,
                  notificationJobs.newJobs,
                  notificationJobs.updatedJobs,
                  inventory.runAt,
                  runId,
                  tenantContext.userId
                );
                emailStatus = emailResult.status;
                emailSkipReason = emailResult.skipReason;
                await updateEmailSendAttempt(env, runId, "sent", { tenantId: tenantContext.tenantId });
              } catch (error) {
                emailStatus = "failed";
                emailError = error instanceof Error ? error.message : String(error);
                await updateEmailSendAttempt(env, runId, "failed", { tenantId: tenantContext.tenantId, error: emailError });
              }
            }
          } else {
            const emailResult = await maybeSendEmail(
              env,
              notificationJobs.newJobs,
              notificationJobs.updatedJobs,
              inventory.runAt,
              runId,
              tenantContext.userId
            );
            emailStatus = emailResult.status;
            emailSkipReason = emailResult.skipReason;
          }
          if (notificationJobs.newJobs.length > 0 && emailStatus === "sent") {
            await ensureActiveRunOwnership(env, runId);
            await markJobsAsSeen(env, notificationJobs.newJobs, inventory.runAt, runId, tenantContext.tenantId);
          }
        } catch (error) {
          if (error instanceof ActiveRunOwnershipError) {
            throw error;
          }
          emailStatus = "failed";
          emailError = error instanceof Error ? error.message : String(error);
        }

        await ensureActiveRunOwnership(env, runId);
        await recordAppLog(env, {
          level: "info",
          event: "run_completed",
          message: `Run completed with ${inventory.stats.totalJobsMatched} current matches, ${newJobs.length} new jobs, and ${updatedJobs.length} updated jobs`,
          tenantId: tenantContext.tenantId,
          runId,
          route: "/api/run",
          details: {
            totalMatched: inventory.stats.totalJobsMatched,
            totalNewMatches: newJobs.length,
            totalUpdatedMatches: updatedJobs.length,
            totalFetched: inventory.stats.totalFetched,
            emailStatus,
            emailSkipReason,
            emailError,
          },
        });
        writeAnalytics(env, {
          event: "manual_run_completed",
          indexes: ["manual", "/api/run"],
          blobs: [runId, emailStatus],
          doubles: [inventory.stats.totalJobsMatched, newJobs.length, updatedJobs.length, inventory.stats.totalFetched],
        });
        return jsonResponse({
          ok: true,
          runAt: inventory.runAt,
          totalNewMatches: newJobs.length,
          totalUpdatedMatches: updatedJobs.length,
          totalMatched: inventory.stats.totalJobsMatched,
          totalFetched: inventory.stats.totalFetched,
          byCompany: inventory.stats.byCompany,
          emailedJobs: notificationJobs.newJobs.map((job) => ({ company: job.company, title: job.title, id: job.id })),
          emailedUpdatedJobs: notificationJobs.updatedJobs.map((job) => ({ company: job.company, title: job.title, id: job.id })),
          emailStatus,
          emailError,
          scanMeta: {
            cacheHits: inventory.stats.cacheHits ?? 0,
            liveFetchCompanies: inventory.stats.liveFetchCompanies ?? 0,
            quotaBlockedCompanies: inventory.stats.quotaBlockedCompanies ?? [],
            remainingLiveScansToday: inventory.stats.remainingLiveScansToday ?? null,
            filteredOutCompanies: inventory.stats.filteredOutCompanies ?? 0,
            filteredOutJobs: inventory.stats.filteredOutJobs ?? 0,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ActiveRunOwnershipError) {
          await recordAppLog(env, {
            level: "warn",
            event: "manual_run_aborted",
            message: "Manual run stopped after losing the active run lock",
            tenantId: tenantContext.tenantId,
            route: "/api/run",
            runId,
            details: {
              activeRunId: error.activeRunId,
            },
          });
          return jsonResponse({ ok: false, aborted: true, runId, error: "This scan was aborted." }, 409);
        }
        writeAnalytics(env, {
          event: "manual_run_failed",
          indexes: ["manual", "/api/run"],
          blobs: [runId, message],
          doubles: [1],
        });
        await recordErrorLog(env, {
          event: "manual_run_failed",
          message,
          tenantId: tenantContext.tenantId,
          route: "/api/run",
          runId,
          details: {
            stack: error instanceof Error ? error.stack : null,
          },
        });
        return jsonResponse({ ok: false, error: message, runId }, 500);
      } finally {
        await releaseActiveRunLock(env, runId);
      }
    }

    if (url.pathname === "/api/scan-quota" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const [usage, remaining] = await Promise.all([
        loadScanQuotaUsage(tenantContext.tenantId),
        remainingLiveScans(tenantContext.tenantId, undefined, { isAdmin: tenantContext.isAdmin }),
      ]);
      return jsonResponse({
        ok: true,
        liveScansUsed: tenantContext.isAdmin ? 0 : usage.liveScansUsed,
        remainingLiveScansToday: tenantContext.isAdmin ? null : remaining,
        lastLiveScanAt: tenantContext.isAdmin ? null : usage.lastLiveScanAt,
        date: usage.date,
        unlimited: tenantContext.isAdmin,
      });
    }

    if (url.pathname === "/api/run/status" && request.method === "GET") {
      const activeRun = await loadActiveRunLock(env);
      return jsonResponse({
        ok: true,
        active: Boolean(activeRun),
        runId: activeRun?.runId,
        triggerType: activeRun?.triggerType,
        startedAt: activeRun?.startedAt,
        expiresAt: activeRun?.expiresAt,
        totalCompanies: activeRun?.totalCompanies,
        fetchedCompanies: activeRun?.fetchedCompanies,
        currentCompany: activeRun?.currentCompany,
        detail: activeRun?.currentStage ? `${activeRun.currentStage.replace(/_/g, " ")}` : undefined,
        message: activeRun?.lastEvent ? activeRun.lastEvent.replace(/_/g, " ") : undefined,
        percent: activeRun?.totalCompanies
          ? (activeRun.fetchedCompanies ?? 0) / Math.max(activeRun.totalCompanies, 1)
          : undefined,
        activeRun,
      });
    }

    if (url.pathname === "/api/run/abort" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      const requestedRunId = String(body.runId ?? "").trim();
      const activeRun = await loadActiveRunLock(env);
      if (!activeRun && !requestedRunId) {
        return jsonResponse({ ok: true, cleared: false, activeRun: null, runId: null });
      }

      const runIdToAbort = requestedRunId || activeRun?.runId || "";
      if (runIdToAbort) {
        // Queue-aware aborts need a durable marker because the AWS
        // orchestrator may not have acquired the shared run lock yet.
        await requestRunAbort(env, runIdToAbort);
      }
      if (activeRun) {
        await clearActiveRunLock(env);
      }
      await recordAppLog(env, {
        level: "warn",
        event: "manual_run_aborted",
        message: "Active scan was aborted manually",
        tenantId: tenantContext.tenantId,
        route: "/api/run/abort",
        runId: runIdToAbort || activeRun?.runId,
        details: {
          activeRunId: activeRun?.runId ?? runIdToAbort,
          activeTriggerType: activeRun?.triggerType ?? "manual",
          activeStartedAt: activeRun?.startedAt ?? null,
          queuedOnly: !activeRun,
        },
      });

      return jsonResponse({ ok: true, cleared: Boolean(activeRun), aborted: Boolean(runIdToAbort), activeRun, runId: runIdToAbort || null });
    }

    if (url.pathname === "/api/jobs/remove-broken-links" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const { storedInventory, effectiveInventory } = await loadDerivedAvailableInventory(
        env,
        config,
        tenantContext.tenantId,
        { isAdmin: tenantContext.isAdmin },
      );
      const cleanup = await removeBrokenAvailableJobs(env, effectiveInventory, {
        tenantId: tenantContext.tenantId,
        route: "/api/jobs/remove-broken-links",
      });
      if (!cleanup.removedCount) {
        await recordAppLog(env, {
          level: "info",
          event: "broken_link_cleanup_completed",
          message: `Checked ${cleanup.checkedCount} available jobs and found no broken links`,
          route: "/api/jobs/remove-broken-links",
          details: { checkedCount: cleanup.checkedCount, removedCount: 0 },
        });
        writeAnalytics(env, {
          event: "broken_link_cleanup_completed",
          indexes: ["none_removed", "/api/jobs/remove-broken-links"],
          blobs: [],
          doubles: [cleanup.checkedCount, 0],
        });
        return jsonResponse({ ok: true, checkedCount: cleanup.checkedCount, removedCount: 0, removedJobs: [] });
      }
      const effectiveJobsByKey = new Map(effectiveInventory.jobs.map((job) => [jobKey(job), job]));
      await Promise.all(cleanup.brokenJobs.map(async (removedJob) => {
        const matchedJob = effectiveJobsByKey.get(removedJob.jobKey);
        if (!matchedJob) return;
        await addDiscardedJobKey(env, matchedJob, tenantContext.tenantId);
      }));
      await saveInventory(
        env,
        removeInventoryJobsByKeys(storedInventory, new Set(cleanup.brokenJobs.map((job) => job.jobKey))),
        tenantContext.tenantId,
        undefined,
        { skipKeyPrune: true },
      );
      const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
      for (const removedJob of cleanup.brokenJobs) {
        delete jobNotes[removedJob.jobKey];
      }
      await saveJobNotes(env, jobNotes, tenantContext.tenantId);
      await recordAppLog(env, {
        level: "info",
        event: "broken_link_cleanup_completed",
        message: `Removed ${cleanup.removedCount} broken available-job links from inventory`,
        route: "/api/jobs/remove-broken-links",
        details: {
          checkedCount: cleanup.checkedCount,
          removedCount: cleanup.removedCount,
          removedJobs: cleanup.brokenJobs.slice(0, 20),
        },
      });
      writeAnalytics(env, {
        event: "broken_link_cleanup_completed",
        indexes: ["removed", "/api/jobs/remove-broken-links"],
        blobs: [],
        doubles: [cleanup.checkedCount, cleanup.removedCount],
      });

      return jsonResponse({ ok: true, checkedCount: cleanup.checkedCount, removedCount: cleanup.removedCount, removedJobs: cleanup.brokenJobs });
    }

    if (url.pathname === "/api/jobs" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      // Company pause is a manual-run control only. Available Jobs should
      // continue to show the company's already fetched/shared inventory.
      const runtimeConfigStartedAt = Date.now();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const runtimeConfigLoadMs = Date.now() - runtimeConfigStartedAt;
      const inventoryStatePromise = (async () => {
        const startedAt = Date.now();
        const result = await loadInventoryState(env, tenantContext.tenantId);
        return { result, durationMs: Date.now() - startedAt };
      })();
      const appliedJobsPromise = (async () => {
        const startedAt = Date.now();
        const result = await loadAppliedJobs(env, tenantContext.tenantId);
        return { result, durationMs: Date.now() - startedAt };
      })();
      const billingPromise = (async () => {
        const startedAt = Date.now();
        const result = await loadBillingSubscription(tenantContext.tenantId).catch(() => null);
        return { result, durationMs: Date.now() - startedAt };
      })();
      const [{ result: inventoryState, durationMs: inventoryStateLoadMs }, { result: appliedJobs, durationMs: appliedJobsLoadMs }, { result: billing, durationMs: billingLoadMs }] = await Promise.all([
        inventoryStatePromise,
        appliedJobsPromise,
        billingPromise,
      ]);
      const planCfg = billing ? await loadPlanConfig(billing.plan).catch(() => null) : null;
      const newJobKeys = new Set(inventoryState.lastNewJobKeys);
      const updatedJobKeys = new Set(inventoryState.lastUpdatedJobKeys);
      const newOnly = url.searchParams.get("newOnly") === "true";
      const updatedOnly = url.searchParams.get("updatedOnly") === "true";
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100) || 100));
      const companyFilters = parseMultiValues(url.searchParams, "company");
      const companySearch = companyFilters.length ? "" : url.searchParams.get("company")?.trim().toLowerCase() ?? "";
      const streamStartedAt = Date.now();
      const jobCap = tenantContext.isAdmin ? null : (planCfg?.maxVisibleJobs ?? null);
      const streamedPage = await streamAvailableJobsPage(
        env,
        config,
        inventoryState.inventory,
        tenantContext.tenantId,
        limit,
        url.searchParams.get("cursor"),
        {
          companies: companyFilters,
          companySearch,
          location: url.searchParams.get("location")?.trim().toLowerCase() ?? "",
          keyword: url.searchParams.get("keyword")?.trim().toLowerCase() ?? "",
          durationHours: parseDurationHours(url.searchParams.get("duration")),
          source: url.searchParams.get("source")?.trim().toLowerCase() ?? "",
          usOnly: url.searchParams.get("usOnly") === "true",
          newOnly,
          updatedOnly,
          appliedJobKeys: new Set(Object.keys(appliedJobs)),
          newJobKeys,
          updatedJobKeys,
        },
        jobCap,
      );
      const streamPhaseMs = Date.now() - streamStartedAt;
      const sortStartedAt = Date.now();
      const jobs = streamedPage.jobs
        .sort((a, b) => {
          const aKey = jobKey(a);
          const bKey = jobKey(b);
          const aDay = formatETDayKey(a.postedAt);
          const bDay = formatETDayKey(b.postedAt);
          if (aDay !== bDay) return bDay.localeCompare(aDay);

          const aPriority = newJobKeys.has(aKey) ? 0 : updatedJobKeys.has(aKey) ? 1 : 2;
          const bPriority = newJobKeys.has(bKey) ? 0 : updatedJobKeys.has(bKey) ? 1 : 2;
          if (aPriority !== bPriority) return aPriority - bPriority;

          const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
          const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
          if (aTime !== bTime) return bTime - aTime;

          return a.title.localeCompare(b.title);
        });
      const sortPhaseMs = Date.now() - sortStartedAt;
      const storedAvailableJobs = (inventoryState.inventory?.jobs ?? []).filter((job) => !appliedJobs[jobKey(job)]);
      const visibleStoredJobs = jobCap !== null ? storedAvailableJobs.slice(0, jobCap) : storedAvailableJobs;
      const approximateVisibleJobs = filterJobs(visibleStoredJobs, url.searchParams)
        .filter((job) => !newOnly || newJobKeys.has(jobKey(job)))
        .filter((job) => !updatedOnly || updatedJobKeys.has(jobKey(job)));
      const companyOptions = uniqueSortedCompanies(visibleStoredJobs.map((job) => job.company));
      const totalNewAvailable = visibleStoredJobs.filter((job) => newJobKeys.has(jobKey(job))).length;
      const totalUpdatedAvailable = visibleStoredJobs.filter((job) => updatedJobKeys.has(jobKey(job))).length;
      const filteredCompanies = uniqueSortedCompanies(jobs.map((job) => job.company));
      const companySlug = filteredCompanies.length === 1 ? slugify(filteredCompanies[0]) : "multi";

      // Treat list retrieval as a coarse engagement signal without blocking the
      // user-facing inventory response on analytics writes.
      void recordEvent(tenantContext, "JOB_VIEWED", {
        companySlug,
        jobCount: approximateVisibleJobs.length,
      }).catch((error) => {
        console.warn("[analytics] failed to record job view event", error);
      });

      console.info("[jobs.list]", {
        tenantId: tenantContext.tenantId,
        runtimeConfigLoadMs,
        inventoryStateLoadMs,
        appliedJobsLoadMs,
        billingLoadMs,
        streamPhaseMs,
        sortPhaseMs,
        inspectedCompanies: streamedPage.inspectedCompanies,
        inspectedJobs: streamedPage.inspectedJobs,
        matchedJobs: streamedPage.matchedJobs,
        returnedJobs: jobs.length,
      });

      return jsonResponse({
        ok: true,
        runAt: inventoryState.inventory?.runAt ?? nowISO(),
        total: approximateVisibleJobs.length,
        pagination: {
          limit,
          nextCursor: streamedPage.nextCursor,
          hasMore: streamedPage.hasMore,
        },
        totals: {
          availableJobs: visibleStoredJobs.length,
          totalAvailableJobs: storedAvailableJobs.length,
          newJobs: totalNewAvailable,
          updatedJobs: totalUpdatedAvailable,
          jobsCapped: jobCap !== null && storedAvailableJobs.length > jobCap,
          jobCapLimit: jobCap,
        },
        companyOptions,
        jobs: jobs.map((job) => ({
          jobKey: jobKey(job),
          company: job.company,
          source: job.source,
          jobTitle: job.title,
          postedAt: formatET(job.postedAt),
          postedAtDate: formatDateOnly(job.postedAt),
          location: job.location,
          url: job.url,
          usLikely: job.isUSLikely,
          detectedCountry: job.detectedCountry ?? "Unknown",
          isNew: newJobKeys.has(jobKey(job)),
          isUpdated: updatedJobKeys.has(jobKey(job)),
        })),
      });
    }

    if (url.pathname === "/api/jobs/details" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const requestedJobKey = url.searchParams.get("jobKey")?.trim();
      if (!requestedJobKey) {
        return jsonResponse({ ok: false, error: "jobKey is required" }, 400);
      }

      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const [{ effectiveInventory }, jobNotes] = await Promise.all([
        loadDerivedAvailableInventory(env, config, tenantContext.tenantId, { isAdmin: false }),
        loadJobNotes(env, tenantContext.tenantId),
      ]);
      const matchedJob = effectiveInventory.jobs.find((job) => jobKey(job) === requestedJobKey);
      if (!matchedJob) {
        return jsonResponse({ ok: false, error: "Job not found" }, 404);
      }

      return jsonResponse({
        ok: true,
        job: {
          jobKey: requestedJobKey,
          notes: jobNotes[requestedJobKey] || "",
          noteRecords: [],
          company: matchedJob.company,
          source: matchedJob.source,
          jobTitle: matchedJob.title,
          postedAt: formatET(matchedJob.postedAt),
          postedAtDate: formatDateOnly(matchedJob.postedAt),
          location: matchedJob.location,
          url: matchedJob.url,
          usLikely: matchedJob.isUSLikely,
          detectedCountry: matchedJob.detectedCountry ?? "Unknown",
        },
      });
    }

    if (url.pathname === "/api/jobs/manual-add" && request.method === "POST") {
      const body = await readJsonBody<{
        company?: string;
        jobTitle?: string;
        url?: string;
        location?: string;
        notes?: string;
      } & Record<string, unknown>>(request);
      const company = String(body.company ?? "").trim();
      const jobTitle = String(body.jobTitle ?? "").trim();
      if (!company || !jobTitle) {
        return jsonResponse({ ok: false, error: "company and jobTitle are required" }, 400);
      }

      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const { storedInventory } = await loadDerivedAvailableInventory(
        env,
        config,
        tenantContext.tenantId,
        { isAdmin: tenantContext.isAdmin },
      );
      const notes = String(body.notes ?? "").trim();
      const manualJob: JobPosting = {
        source: "manual",
        company,
        id: crypto.randomUUID(),
        title: jobTitle,
        location: String(body.location ?? "").trim() || "",
        url: String(body.url ?? "").trim(),
        manualEntry: true,
        postedAt: nowISO(),
      };
      // Manual jobs should appear immediately in Available Jobs without waiting for the next scan cycle.
      const nextJobs = [manualJob, ...storedInventory.jobs];
      const nextInventory = {
        ...storedInventory,
        runAt: nowISO(),
        jobs: nextJobs,
        stats: summarizeInventoryJobs(nextJobs, storedInventory),
      };

      await saveInventory(env, nextInventory, tenantContext.tenantId);
      if (notes) {
        const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
        jobNotes[jobKey(manualJob)] = notes;
        await saveJobNotes(env, jobNotes, tenantContext.tenantId);
      }

      writeAnalytics(env, {
        event: "job_manual_added",
        indexes: ["manual", "/api/jobs/manual-add"],
        blobs: [company, jobKey(manualJob)],
        doubles: [],
      });

      return jsonResponse({ ok: true, jobKey: jobKey(manualJob) });
    }

    if (url.pathname === "/api/applied-jobs/kanban" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const allRows = Object.values(appliedJobs).sort(
        (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()
      );
      const STATUSES: AppliedJobStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];
      const columns = STATUSES.map((status) => {
        const jobs = allRows
          .filter((row) => row.status === status)
          .map((row) => {
            const archived = applyArchivedUrlPresentation(row);
            return {
              ...row,
              url: archived.displayUrl,
              originalUrl: archived.originalUrl,
              archivedUrl: archived.archivedUrl,
              archiveCapturedAt: row.archivedAt,
            };
          });
        return { status, count: jobs.length, jobs };
      });
      return jsonResponse({ ok: true, total: allRows.length, columns });
    }

    if (url.pathname.startsWith("/api/companies/") && url.pathname.endsWith("/applied") && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const companySlug = url.pathname.slice("/api/companies/".length, -"/applied".length);
      if (!companySlug) return jsonResponse({ ok: false, error: "company is required" }, 400);
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const rows = Object.values(appliedJobs)
        .filter((row) => slugify(row.job.company) === companySlug || row.job.company.toLowerCase() === companySlug.toLowerCase())
        .map((row) => {
          const archived = applyArchivedUrlPresentation(row);
          return {
            ...row,
            url: archived.displayUrl,
            originalUrl: archived.originalUrl,
            archivedUrl: archived.archivedUrl,
            archiveCapturedAt: row.archivedAt,
          };
        })
        .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
      return jsonResponse({ ok: true, company: companySlug, total: rows.length, jobs: rows });
    }

    if (url.pathname === "/api/applied-jobs" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const appliedJobsLoadStartedAt = Date.now();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const appliedJobsLoadMs = Date.now() - appliedJobsLoadStartedAt;

      const notesLoadStartedAt = Date.now();
      const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
      const notesLoadMs = Date.now() - notesLoadStartedAt;

      const markersLoadStartedAt = Date.now();
      const { updatedJobKeys } = await loadLatestRunMarkers(env, tenantContext.tenantId);
      const markersLoadMs = Date.now() - markersLoadStartedAt;

      // Applied jobs already persist a durable job snapshot, so this endpoint
      // should not block on rebuilding the live available inventory first.
      const appliedRows = Object.values(appliedJobs);
      const companyOptions = uniqueSortedCompanies(appliedRows.map((row) => row.job.company));
      const filterSortStartedAt = Date.now();
      const rows = filterAppliedJobs(appliedRows, url.searchParams).sort(
        (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()
      );
      const filterSortMs = Date.now() - filterSortStartedAt;

      console.info("[applied.list]", {
        tenantId: tenantContext.tenantId,
        appliedJobsLoadMs,
        notesLoadMs,
        markersLoadMs,
        filterSortMs,
        appliedRows: appliedRows.length,
        returnedRows: rows.length,
      });

      return jsonResponse({
        ok: true,
        total: rows.length,
        companyOptions,
        jobs: rows.map((row) => {
          const archived = applyArchivedUrlPresentation(row);
          return {
            jobKey: row.jobKey,
            notes: row.notes || jobNotes[row.jobKey] || "",
            noteRecords: row.noteRecords ?? [],
            company: row.job.company,
            jobTitle: row.job.title,
            appliedAt: formatET(row.appliedAt),
            appliedAtDate: formatDateOnly(row.appliedAt),
            postedAt: formatET(row.job.postedAt),
            postedAtDate: formatDateOnly(row.job.postedAt),
            url: archived.displayUrl,
            originalUrl: archived.originalUrl,
            archivedUrl: archived.archivedUrl,
            archiveCapturedAt: row.archivedAt,
            status: row.status,
            isUpdated: updatedJobKeys.has(row.jobKey),
            interviewRounds: row.interviewRounds,
            timeline: row.timeline,
            lastStatusChangedAt: row.lastStatusChangedAt,
          };
        }),
      });
    }

    if (url.pathname === "/api/jobs/archive" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const requestedJobKey = String(url.searchParams.get("jobKey") ?? "").trim();
      if (!requestedJobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const record = appliedJobs[requestedJobKey];
      if (!record) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const html = await loadArchivedJobSnapshotHtml(tenantContext.tenantId, record);
      if (!html) return jsonResponse({ ok: false, error: "Archived snapshot not found" }, 404);

      return new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, max-age=60",
        },
      });
    }

    if (url.pathname === "/api/jobs/apply" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; notes?: string } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const tenantContext = await getTenantContext();
      const [config, appliedJobsForLimit, billingForLimit] = await Promise.all([
        loadRuntimeConfig(env, tenantContext.tenantId, {
          isAdmin: tenantContext.isAdmin,
          updatedByUserId: tenantContext.userId,
        }),
        loadAppliedJobs(env, tenantContext.tenantId),
        loadBillingSubscription(tenantContext.tenantId).catch(() => null),
      ]);
      const planCfgForLimit = billingForLimit ? await loadPlanConfig(billingForLimit.plan).catch(() => null) : null;
      const appliedCount = Object.keys(appliedJobsForLimit).length;
      if (planCfgForLimit?.maxAppliedJobs !== null && planCfgForLimit?.maxAppliedJobs !== undefined) {
        if (appliedCount >= planCfgForLimit.maxAppliedJobs) {
          return jsonResponse({
            ok: false,
            error: "applied_jobs_limit_reached",
            limit: planCfgForLimit.maxAppliedJobs,
            plan: billingForLimit?.plan ?? "free",
          }, 402);
        }
      }
      const { effectiveInventory } = await loadDerivedAvailableInventory(
        env,
        config,
        tenantContext.tenantId,
        { isAdmin: tenantContext.isAdmin },
      );
      const appliedJobs = appliedJobsForLimit;
      const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
      const job = effectiveInventory.jobs.find((row) => jobKey(row) === body.jobKey);
      if (!job) return jsonResponse({ ok: false, error: "Job not found" }, 404);
      const submittedNotes = String(body.notes ?? "").trim();
      const initialNotes = submittedNotes || jobNotes[body.jobKey];

      appliedJobs[body.jobKey] = await archiveAppliedJobSnapshot(
        tenantContext.tenantId,
        createAppliedRecord(job, body.jobKey, appliedJobs[body.jobKey], initialNotes),
      );
      delete jobNotes[body.jobKey];
      await saveJobNotes(env, jobNotes, tenantContext.tenantId);
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      writeAnalytics(env, {
        event: "job_applied",
        indexes: [job.source, "/api/jobs/apply"],
        blobs: [job.company, body.jobKey],
        doubles: [],
      });
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/jobs/notes" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; notes?: string } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const tenantContext = await getTenantContext();
      const note = String(body.notes ?? "").trim();
      const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);

      if (appliedJobs[body.jobKey]) {
        appliedJobs[body.jobKey] = { ...appliedJobs[body.jobKey], notes: note || undefined };
        delete jobNotes[body.jobKey];
        await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      } else if (note) {
        jobNotes[body.jobKey] = note;
      } else {
        delete jobNotes[body.jobKey];
      }
      await saveJobNotes(env, jobNotes, tenantContext.tenantId);

      return jsonResponse({ ok: true, jobKey: body.jobKey, notes: note });
    }

    if (url.pathname === "/api/notes/add" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; text?: string } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const text = String(body.text ?? "").trim();
      if (!text) return jsonResponse({ ok: false, error: "text is required" }, 400);

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const record: NoteRecord = {
        id: crypto.randomUUID(),
        text,
        createdAt: nowISO(),
      };
      appliedJobs[body.jobKey] = upsertAppliedJobNotes(existing, (records) => [...records, record]);
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);

      return jsonResponse({ ok: true, jobKey: body.jobKey, record });
    }

    if (url.pathname === "/api/notes/update" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; noteId?: string; text?: string } & Record<string, unknown>>(request);
      if (!body.jobKey || !body.noteId) return jsonResponse({ ok: false, error: "jobKey and noteId are required" }, 400);

      const text = String(body.text ?? "").trim();
      if (!text) return jsonResponse({ ok: false, error: "text is required" }, 400);

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const current = existing.noteRecords ?? [];
      if (!current.some((record) => record.id === body.noteId)) {
        return jsonResponse({ ok: false, error: "Note not found" }, 404);
      }

      const updatedAt = nowISO();
      appliedJobs[body.jobKey] = upsertAppliedJobNotes(existing, (records) => records.map((record) => (
        record.id === body.noteId ? { ...record, text, updatedAt } : record
      )));
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);

      return jsonResponse({ ok: true, jobKey: body.jobKey, noteId: body.noteId, text });
    }

    if (url.pathname === "/api/notes/delete" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; noteId?: string } & Record<string, unknown>>(request);
      if (!body.jobKey || !body.noteId) return jsonResponse({ ok: false, error: "jobKey and noteId are required" }, 400);

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const current = existing.noteRecords ?? [];
      if (!current.some((record) => record.id === body.noteId)) {
        return jsonResponse({ ok: false, error: "Note not found" }, 404);
      }

      appliedJobs[body.jobKey] = upsertAppliedJobNotes(existing, (records) => (
        records.filter((record) => record.id !== body.noteId)
      ));
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);

      return jsonResponse({ ok: true, jobKey: body.jobKey, noteId: body.noteId });
    }

    if (url.pathname === "/api/jobs/discard" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const { storedInventory, effectiveInventory } = await loadDerivedAvailableInventory(
        env,
        config,
        tenantContext.tenantId,
        { isAdmin: tenantContext.isAdmin },
      );
      const job = effectiveInventory.jobs.find((row) => jobKey(row) === body.jobKey);
      if (!job) return jsonResponse({ ok: false, error: "Job not found" }, 404);

      await addDiscardedJobKey(env, job, tenantContext.tenantId);
      const jobNotes = await loadJobNotes(env, tenantContext.tenantId);
      delete jobNotes[body.jobKey];
      await saveJobNotes(env, jobNotes, tenantContext.tenantId);
      await saveInventory(env, removeInventoryJobsByKeys(storedInventory, new Set([body.jobKey])), tenantContext.tenantId, undefined, { skipKeyPrune: true });
      writeAnalytics(env, {
        event: "job_discarded",
        indexes: [job.source, "/api/jobs/discard"],
        blobs: [job.company, body.jobKey],
        doubles: [],
      });
      return jsonResponse({ ok: true, discarded: body.jobKey });
    }

    if (url.pathname === "/api/jobs/status" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; status?: AppliedJobStatus } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const nextStatus = normalizeAppliedStatus(body.status);
      let next = { ...ensureBaseTimeline(existing), status: nextStatus };
      if (nextStatus === "Interview" && existing.status !== "Interview") {
        next = appendInterviewRound(next);
      }
      if (existing.status !== nextStatus) {
        next = appendStatusEvent(next, nextStatus);
      }
      appliedJobs[body.jobKey] = next;
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      writeAnalytics(env, {
        event: "job_status_updated",
        indexes: [next.status, "/api/jobs/status"],
        blobs: [existing.job.company, body.jobKey],
        doubles: [],
      });

      return jsonResponse({ ok: true, actionPlanEnabled: next.interviewRounds.length > 0 });
    }

    if (url.pathname === "/api/action-plan" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const rows = filterAppliedJobs(Object.values(appliedJobs), url.searchParams);
      const actionPlan = buildActionPlanRows(rows);
      return jsonResponse({ ok: true, total: actionPlan.length, jobs: actionPlan });
    }

    if (url.pathname === "/api/action-plan/interview/add" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string } & Record<string, unknown>>(request);
      if (!body.jobKey) return jsonResponse({ ok: false, error: "jobKey is required" }, 400);

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const next = appendInterviewRound(existing);
      appliedJobs[body.jobKey] = next;
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      return jsonResponse({ ok: true, roundCount: next.interviewRounds.length, roundId: next.interviewRounds.at(-1)?.id });
    }

    if (url.pathname === "/api/action-plan/interview" && request.method === "POST") {
      const body = await readJsonBody<{
        jobKey?: string;
        roundId?: string;
        interviewAt?: string;
        outcome?: InterviewOutcome;
        designation?: InterviewRoundDesignation;
        interviewer?: string;
        notes?: string;
      } & Record<string, unknown>>(request);
      if (!body.jobKey || !body.roundId) {
        return jsonResponse({ ok: false, error: "jobKey and roundId are required" }, 400);
      }

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const interviewRounds = existing.interviewRounds.map((round) => {
        if (round.id !== body.roundId) return round;
        return {
          ...round,
          designation: normalizeRoundDesignation(body.designation, round.designation),
          interviewer: typeof body.interviewer === "string" ? body.interviewer.trim() || undefined : round.interviewer,
          interviewAt: typeof body.interviewAt === "string" && body.interviewAt ? body.interviewAt : round.interviewAt,
          outcome:
            body.outcome === "Passed" || body.outcome === "Failed" || body.outcome === "Follow-up" || body.outcome === "Pending"
              ? body.outcome
              : round.outcome,
          notes: typeof body.notes === "string" ? body.notes : round.notes,
          updatedAt: nowISO(),
        };
      });

      const targetRound = interviewRounds.find((round) => round.id === body.roundId);
      if (!targetRound) return jsonResponse({ ok: false, error: "Interview round not found" }, 404);

      const safe = ensureBaseTimeline(existing);
      const timeline = safe.timeline.filter((event) => {
        if (event.roundId !== body.roundId) return true;
        return event.type !== "outcome";
      });

      const interviewEventIndex = timeline.findIndex((event) => event.roundId === body.roundId && event.type === "interview");
      if (interviewEventIndex >= 0) {
        timeline[interviewEventIndex] = {
          ...timeline[interviewEventIndex],
          at: targetRound.interviewAt,
          label: `Interview round ${targetRound.roundNumber}`,
        };
      }
      if (targetRound.outcome && targetRound.outcome !== "Pending") {
        timeline.push(
          makeTimelineEvent({
            type: "outcome",
            label: `Outcome round ${targetRound.roundNumber}`,
            value: targetRound.outcome,
            at: targetRound.updatedAt,
            roundId: targetRound.id,
          })
        );
      }

      appliedJobs[body.jobKey] = { ...safe, interviewRounds, timeline };
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/action-plan/interview/delete" && request.method === "POST") {
      const body = await readJsonBody<{ jobKey?: string; roundId?: string } & Record<string, unknown>>(request);
      if (!body.jobKey || !body.roundId) {
        return jsonResponse({ ok: false, error: "jobKey and roundId are required" }, 400);
      }

      const tenantContext = await getTenantContext();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const existing = appliedJobs[body.jobKey];
      if (!existing) return jsonResponse({ ok: false, error: "Applied job not found" }, 404);

      const safe = ensureBaseTimeline(existing);
      const interviewRounds = safe.interviewRounds
        .filter((round) => round.id !== body.roundId)
        .map((round, index) => ({ ...round, roundNumber: index + 1, updatedAt: nowISO() }));
      if (interviewRounds.length === safe.interviewRounds.length) {
        return jsonResponse({ ok: false, error: "Interview round not found" }, 404);
      }
      const timeline = safe.timeline.filter((event) => event.roundId !== body.roundId);

      appliedJobs[body.jobKey] = { ...safe, interviewRounds, timeline };
      await saveAppliedJobsForTenant(env, appliedJobs, tenantContext.tenantId);
      return jsonResponse({ ok: true, roundCount: interviewRounds.length });
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const configLoadStartedAt = Date.now();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
        // Dashboard can derive admin shared-inventory metrics without fully
        // expanding every registry company into runtime config first.
        expandAdminCompanies: tenantContext.isAdmin ? false : undefined,
      });
      const runtimeConfigLoadMs = Date.now() - configLoadStartedAt;

      const inventoryLoadStartedAt = Date.now();
      const dashboardInventory = await resolveDashboardInventory(
        env,
        config,
        tenantContext.tenantId,
        { isAdmin: tenantContext.isAdmin },
      );
      const inventoryLoadMs = Date.now() - inventoryLoadStartedAt;

      const appliedJobsLoadStartedAt = Date.now();
      const appliedJobs = await loadAppliedJobs(env, tenantContext.tenantId);
      const appliedJobsLoadMs = Date.now() - appliedJobsLoadStartedAt;

      let companiesByAts = summarizeCompaniesByAts(config.companies);
      const cacheFingerprint = buildDashboardSummaryFingerprint(
        dashboardInventory.inventory,
        appliedJobs,
        companiesByAts,
        {
          lastNewJobsCount: dashboardInventory.inventoryState.lastNewJobsCount,
          lastUpdatedJobsCount: dashboardInventory.inventoryState.lastUpdatedJobsCount,
        },
      );
      const cacheLoadStartedAt = Date.now();
      const cachedPayload = await loadCachedDashboardPayload(env, tenantContext.tenantId, cacheFingerprint);
      const cacheLoadMs = Date.now() - cacheLoadStartedAt;
      const payloadBuildStartedAt = Date.now();
      const payload = cachedPayload ?? await buildDashboardPayload(
        env,
        dashboardInventory.inventory,
        appliedJobs,
        tenantContext.tenantId,
        dashboardInventory.inventoryState,
        companiesByAts,
        {
          inventorySource: dashboardInventory.source,
          freshnessProbeSkipped: dashboardInventory.freshnessProbeSkipped,
          staleReason: dashboardInventory.staleReason,
        },
      );
      const payloadBuildMs = Date.now() - payloadBuildStartedAt;
      if (!cachedPayload) {
        // Let the first useful dashboard response return immediately; cache
        // persistence is valuable, but it should not extend the user-visible
        // critical path on a cold miss.
        void saveCachedDashboardPayload(env, tenantContext.tenantId, cacheFingerprint, payload).catch((error) => {
          console.error("[dashboard.summary] failed to write cache", error);
        });
      }
      if (tenantContext.isAdmin && config.adminRegistryMode !== "none") {
        const adminSummaryStartedAt = Date.now();
        const [registryEntries, rawScanSummary] = await Promise.all([
          loadRegistryCache().then(() => listAll()),
          summarizeCurrentRawScans(),
        ]);
        companiesByAts = summarizeCompaniesByAts(
          registryEntries.map((entry) => ({
            company: entry.company,
            enabled: true,
            source: normalizeSource(entry.ats) ?? inferSourceFromUrl(entry.board_url || entry.sample_url || undefined),
            registryAts: entry.ats ?? undefined,
            registryTier: entry.tier ?? undefined,
          })),
        );
        payload.kpis = {
          ...payload.kpis,
          // For admins, "companies covered" should mean how many configured
          // registry companies currently have a successful shared raw fetch.
          companiesConfigured: registryEntries.length,
          companiesDetected: rawScanSummary.currentCompanies,
          totalFetched: rawScanSummary.currentJobs,
        };
        payload.companiesByAts = companiesByAts;
        console.info("[dashboard.admin.summary]", {
          tenantId: tenantContext.tenantId,
          registryCompanies: registryEntries.length,
          rawScanCompanies: rawScanSummary.currentCompanies,
          rawScanJobs: rawScanSummary.currentJobs,
          adminSummaryMs: Date.now() - adminSummaryStartedAt,
        });
      }
      console.info("[dashboard.summary]", {
        tenantId: tenantContext.tenantId,
        runtimeConfigLoadMs,
        inventoryLoadMs,
        appliedJobsLoadMs,
        cacheLoadMs,
        cacheHit: Boolean(cachedPayload),
        payloadBuildMs,
        inventorySource: dashboardInventory.source,
        freshnessProbeSkipped: dashboardInventory.freshnessProbeSkipped,
        staleReason: dashboardInventory.staleReason,
        inventoryJobs: dashboardInventory.inventory.jobs.length,
        appliedRows: Object.keys(appliedJobs).length,
      });
      return jsonResponse({
        ok: true,
        ...payload,
      });
    }

    if (url.pathname === "/api/filters" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const scopeRaw = String(url.searchParams.get("scope") ?? "").trim();
      let scope: SavedFilterScope | undefined;
      if (scopeRaw) {
        if (!isSavedFilterScope(scopeRaw)) {
          return jsonResponse({ ok: false, error: "Invalid filter scope" }, 400);
        }
        scope = scopeRaw;
      }

      const filters = await listSavedFilters(env, tenantContext.tenantId, scope);
      return jsonResponse({ ok: true, total: filters.length, filters });
    }

    if (url.pathname === "/api/filters" && request.method === "POST") {
      const tenantContext = await getTenantContext();
      const body = await readJsonBody<Record<string, unknown>>(request);
      const name = String(body.name ?? "").trim();
      const scopeRaw = String(body.scope ?? "").trim();
      if (!name) return jsonResponse({ ok: false, error: "name is required" }, 400);
      if (!isSavedFilterScope(scopeRaw)) return jsonResponse({ ok: false, error: "Valid scope is required" }, 400);
      const filter = body.filter && typeof body.filter === "object" ? (body.filter as Record<string, unknown>) : null;
      if (!filter) return jsonResponse({ ok: false, error: "filter is required" }, 400);

      let filterId: string;
      try {
        filterId = await saveSavedFilter(env, {
          tenantId: tenantContext.tenantId,
          userId: tenantContext.userId,
          filterId: typeof body.id === "string" && body.id ? body.id : undefined,
          name,
          scope: scopeRaw,
          filter,
          isDefault: body.isDefault === true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ ok: false, error: message }, message.includes("already exists") ? 409 : 500);
      }

      const filters = await listSavedFilters(env, tenantContext.tenantId, scopeRaw);
      const saved = filters.find((entry) => entry.id === filterId) ?? null;
      return jsonResponse({ ok: true, filter: saved });
    }

    if (url.pathname.startsWith("/api/filters/") && request.method === "DELETE") {
      const tenantContext = await getTenantContext();
      const filterId = decodeURIComponent(url.pathname.slice("/api/filters/".length)).trim();
      if (!filterId) return jsonResponse({ ok: false, error: "filter id is required" }, 400);
      const deleted = await deleteSavedFilter(env, tenantContext.tenantId, filterId);
      if (!deleted) return jsonResponse({ ok: false, error: "Saved filter not found" }, 404);
      return jsonResponse({ ok: true, deleted: filterId });
    }

    if (url.pathname === "/api/logs" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      if (!tenantContext.isAdmin) {
        return jsonResponse({ ok: false, error: "Admin access required" }, 403);
      }
      const requestedTenant = (url.searchParams.get("tenantId") ?? url.searchParams.get("userId") ?? "").trim();
      const reason = (url.searchParams.get("reason") ?? "").trim();
      if (!requestedTenant) {
        return jsonResponse({ ok: false, error: "tenantId is required for break-glass log access" }, 400);
      }
      if (reason.length < 8) {
        return jsonResponse({ ok: false, error: "reason is required for break-glass log access" }, 400);
      }
      const tenantIdFilter = await resolveBreakGlassTenantId(requestedTenant);
      await recordEvent({
        userId: tenantContext.userId,
        tenantId: tenantContext.tenantId,
        email: tenantContext.email,
        displayName: tenantContext.displayName,
        scope: tenantContext.scope,
        isAdmin: tenantContext.isAdmin,
      }, "ADMIN_ACTION", {
        action: "break_glass_log_access",
        targetTenantId: tenantIdFilter,
        reason,
      });
      const companies = parseMultiValues(url.searchParams, "company");
      const sharedLogOptions = {
        tenantId: tenantContext.tenantId,
        tenantIdFilter,
        allTenants: true,
        // Keep the older `type` query param working so the admin logs UI can
        // filter rows even if the browser is still using the pre-event alias.
        event: url.searchParams.get("event") ?? url.searchParams.get("type") ?? "",
        query: url.searchParams.get("query") ?? url.searchParams.get("q") ?? "",
        level: url.searchParams.get("level") ?? "",
        source: url.searchParams.get("source") ?? "",
        runId: url.searchParams.get("runId") ?? "",
        limit: Number(url.searchParams.get("limit") ?? 200),
        compact: url.searchParams.get("compact") !== "false",
      };
      const logs = await listAppLogs(env, {
        ...sharedLogOptions,
        route: url.searchParams.get("route") ?? "",
        company: url.searchParams.get("company") ?? "",
        companies,
      });
      const companyOptionLogs = await listAppLogs(env, {
        ...sharedLogOptions,
        route: url.searchParams.get("route") ?? "",
        compact: false,
        limit: MAX_APP_LOG_LIMIT,
      });
      return jsonResponse({
        ok: true,
        total: logs.length,
        storage: "kv",
        retentionHours: 6,
        companyOptions: uniqueSortedCompanies(companyOptionLogs.map((log) => log.company ?? "")),
        runOptions: [...new Set(companyOptionLogs.map((log) => log.runId ?? "").filter(Boolean))],
        logs,
      });
    }

    if (url.pathname === "/api/debug/webhook-url" && request.method === "GET") {
      const tenantContext = await getTenantContext();
      const gate = requireAdminContext(tenantContext);
      if (gate) return gate;
      const stored = await loadEmailWebhookConfig(env);
      return jsonResponse({
        hasWebhook: Boolean(stored?.webhookUrl || env.APPS_SCRIPT_WEBHOOK_URL),
        hasSharedSecret: Boolean(stored?.sharedSecret || env.APPS_SCRIPT_SHARED_SECRET),
        webhookUrl: stored?.webhookUrl || env.APPS_SCRIPT_WEBHOOK_URL || null,
      });
    }

    if (url.pathname === "/api/debug/schedule" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        registryScheduler: {
          cron: "rate(15 minutes)",
          note: "The registry scheduler wakes every 15 minutes and dispatches only companies whose registry-level nextScanAt is due.",
        },
        cadenceByPool: {
          hot: "every 3 hours",
          warm: "every 6 hours",
          cold: "every 12 hours",
        },
        tenantScheduler: {
          enabled: false,
          note: "Tenant-level background scheduling is disabled. Scheduled scanning is now owned by registry-level hot/warm/cold cadence.",
        },
      });
    }

    if (url.pathname === "/api/debug/discovery/reset" && request.method === "POST") {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const companyName = String(body.company ?? url.searchParams.get("company") ?? "").trim();
      if (!companyName) return jsonResponse({ ok: false, error: "company is required" }, 400);
      await resetDiscoveryForCompany(env, companyName);
      return jsonResponse({ ok: true, company: companyName, reset: ["No discovery state to reset in explicit-config mode"] });
    }

    if (url.pathname === "/api/debug/discovery" && request.method === "GET") {
      const companyName = url.searchParams.get("company")?.trim();
      if (!companyName) return jsonResponse({ ok: false, error: "company query parameter is required" }, 400);
      const tenantContext = await getTenantContext();
      const detected = await getDetectedConfig(env, { company: companyName, enabled: true }, tenantContext.tenantId);
      const protectedRecord = await getProtectedDiscoveryRecord(env, companyName);
      return jsonResponse({ ok: true, detected, protectedRecord });
    }

    if (url.pathname === "/api/debug/workday" && request.method === "GET") {
      const companyName = url.searchParams.get("company")?.trim();
      if (!companyName) return jsonResponse({ ok: false, error: "company query parameter is required" }, 400);
      const tenantContext = await getTenantContext();
      const detected = await resolveWorkdayForCompany(env, companyName, tenantContext.tenantId);
      if (!detected) return jsonResponse({ ok: false, error: `No Workday mapping resolved for ${companyName}` }, 404);
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const jobs = await fetchJobsForDetectedConfig(companyName, detected, config.jobtitles.includeKeywords);
      return jsonResponse({ ok: true, detected, includeKeywords: config.jobtitles.includeKeywords, count: jobs.length, firstFive: jobs.slice(0, 5) });
    }

    if (url.pathname === "/api/debug/workday-filter" && request.method === "GET") {
      const companyName = url.searchParams.get("company")?.trim();
      if (!companyName) return jsonResponse({ ok: false, error: "company query parameter is required" }, 400);
      const tenantContext = await getTenantContext();
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const detected = await resolveWorkdayForCompany(env, companyName, tenantContext.tenantId);
      if (!detected) return jsonResponse({ ok: false, error: `No Workday mapping resolved for ${companyName}` }, 404);
      const rawJobs = await fetchJobsForDetectedConfig(companyName, detected, config.jobtitles.includeKeywords);
      const enriched = rawJobs.map((job) => enrichJob(job, config.jobtitles));
      const matched = enriched.filter((job) => isInterestingTitle(job.title, config.jobtitles));
      return jsonResponse({
        ok: true,
        includeKeywords: config.jobtitles.includeKeywords,
        excludeKeywords: config.jobtitles.excludeKeywords,
        rawCount: rawJobs.length,
        matchedCount: matched.length,
        rawSample: rawJobs.slice(0, 15).map((job) => job.title),
        matchedSample: matched.slice(0, 15).map((job) => job.title),
      });
    }

    if (url.pathname === "/api/debug/email" && request.method === "POST") {
      const testJobs: JobPosting[] = [
        {
          source: "workday",
          company: "Debug Company",
          id: "debug-1",
          title: "Staff Technical Program Manager",
          location: "Sunnyvale, CA",
          url: "https://example.com/job/debug-1",
          postedAt: new Date().toISOString(),
        },
      ];
      const testUpdatedJobs: UpdatedEmailJob[] = [
        {
          source: "greenhouse",
          company: "Debug Company",
          id: "debug-2",
          title: "Lead Technical Program Manager",
          location: "Remote, US",
          url: "https://example.com/job/debug-2",
          postedAt: new Date().toISOString(),
          updateJustification: "Tracked inventory fields changed since the previous snapshot.",
          updateChanges: [
            {
              field: "title",
              previous: "Technical Program Manager",
              current: "Lead Technical Program Manager",
            },
            {
              field: "location",
              previous: "San Francisco, CA",
              current: "Remote, US",
            },
          ],
        },
      ];

      const tenantContext = await getTenantContext();
      if (!(env.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL)) {
        return jsonResponse({ ok: false, error: "SES_FROM_EMAIL is missing" }, 500);
      }

      try {
        await maybeSendEmail(env, testJobs, testUpdatedJobs, new Date().toISOString(), "debug-email", tenantContext.userId);
        return jsonResponse({ ok: true, sent: true, totalNewMatches: testJobs.length, totalUpdatedMatches: testUpdatedJobs.length });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname === "/api/registry/meta" && request.method === "GET") {
      const cache = await loadRegistryCache();
      return jsonResponse({
        ok: true,
        meta: cache.meta,
        loadedAt: cache.loadedAt,
        adapters: registeredAdapterIds(),
        counts: {
          total: cache.all.length,
          tier1: cache.all.filter((e) => e.tier === "TIER1_VERIFIED").length,
          tier2: cache.all.filter((e) => e.tier === "TIER2_MEDIUM").length,
          tier3: cache.all.filter((e) => e.tier === "TIER3_LOW").length,
          needsReview: cache.all.filter((e) => e.tier === "NEEDS_REVIEW").length,
        },
      });
    }

    if (url.pathname === "/api/registry/companies" && request.method === "GET") {
      await loadRegistryCache();
      const ats = url.searchParams.get("ats");
      const tier = url.searchParams.get("tier");
      const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 500);
      let entries = ats ? listByAts(ats) : listAll();
      if (tier) entries = entries.filter((e) => e.tier === tier);
      if (search) entries = entries.filter((e) => e.company.toLowerCase().includes(search));
      return jsonResponse({ ok: true, total: entries.length, entries: entries.slice(0, limit) });
    }

    if (url.pathname.startsWith("/api/registry/companies/") && request.method === "GET") {
      await loadRegistryCache();
      const name = decodeURIComponent(url.pathname.slice("/api/registry/companies/".length));
      const entry = getByCompany(name);
      if (!entry) return jsonResponse({ ok: false, error: `No registry entry for ${name}` }, 404);
      return jsonResponse({ ok: true, entry });
    }

    if (url.pathname === "/api/registry/scrape" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { company?: string; applyPipeline?: boolean };
      if (!body.company) return jsonResponse({ ok: false, error: "company required" }, 400);
      const config = await loadRuntimeConfig(env);
      const result = await scrapeOne(body.company, config, { applyPipeline: body.applyPipeline });
      if (!result) return jsonResponse({ ok: false, error: `No registry entry for ${body.company}` }, 404);
      return jsonResponse({
        ok: true,
        company: body.company,
        entry: result.entry,
        status: result.status,
        jobCount: result.jobs.length,
        jobs: result.jobs.slice(0, 100),
        error: result.error,
        ms: result.ms,
      });
    }

    if (url.pathname === "/api/registry/scrape/ats" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { ats?: string; applyPipeline?: boolean; limit?: number };
      if (!body.ats) return jsonResponse({ ok: false, error: "ats required" }, 400);
      const config = await loadRuntimeConfig(env);
      const limit = Math.min(body.limit ?? 25, 100);
      await loadRegistryCache();
      const targets = listByAts(body.ats).slice(0, limit);
      const results = await Promise.all(
        targets.map((entry) => scrapeOne(entry.company, config, { applyPipeline: body.applyPipeline })),
      );
      return jsonResponse({
        ok: true,
        ats: body.ats,
        total: targets.length,
        summary: results.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => ({
          company: r.entry.company,
          status: r.status,
          jobCount: r.jobs.length,
          ms: r.ms,
          error: r.error,
        })),
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, appName: env.APP_NAME ?? "Career Jump" });
    }

    return withSecurity(await env.ASSETS.fetch(request));
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    if (error instanceof RequestValidationError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.log("[routes] unhandled exception", JSON.stringify({ error: message, stack: error instanceof Error ? error.stack : null }));
    return jsonResponse({ ok: false, error: message }, 500);
  }
}
