import { auth, getValidIdToken, isAuthEnabled } from "./auth";
import { envValue, runtimeValue, trimTrailingSlash } from "./runtime-config";
import { getDeviceFingerprint, getSessionId } from "./session";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Base URL is empty by default so local dev can use Vite's /api proxy. In
// production, aws-config.js injects the isolated Lambda/API URL at runtime.
const baseUrl = (() => {
  const raw = runtimeValue("apiBaseUrl") || envValue("VITE_API_BASE_URL");
  return raw ? trimTrailingSlash(raw) : "";
})();

// Separate registry base URL — points at the career-jump-web-poc-registry Lambda.
// Falls back to the main apiBaseUrl so the app works before the registry stack is deployed.
const registryBaseUrl = (() => {
  const raw = runtimeValue("registryBaseUrl") || runtimeValue("apiBaseUrl") || envValue("VITE_API_BASE_URL");
  return raw ? trimTrailingSlash(raw) : "";
})();

async function apiFetch<T>(path: string, init: RequestInit = {}, base = baseUrl): Promise<T> {
  const url = path.startsWith("/") ? `${base}${path}` : path;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("x-cj-session-id", getSessionId());
  headers.set("x-cj-device-fingerprint", getDeviceFingerprint());
  if (isAuthEnabled()) {
    const token = getValidIdToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const data = text ? safeJson(text) : ({} as unknown);
  if (!res.ok) {
    const message = (data as { error?: string; message?: string }).error
      ?? (data as { error?: string; message?: string }).message
      ?? `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function registryRequestBase(): string {
  // Older dedicated registry Lambdas only trust the standard user pool, so
  // admin sessions should prefer the main API where both pools are verified.
  const current = auth.currentUser();
  return current?.scope === "admin" ? baseUrl : registryBaseUrl;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return { message: text }; }
}

export const api = {
  get: <T,>(path: string) => apiFetch<T>(path),
  post: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T,>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// Registry-specific client — uses registryBaseUrl when configured so registry
// calls can be routed to the dedicated career-jump-web-poc-registry Lambda
// without changing the main apiBaseUrl or redeploying CloudFront.
export const registryApi = {
  get: async <T,>(path: string) => {
    const primaryBase = registryRequestBase();
    try {
      return await apiFetch<T>(path, {}, primaryBase);
    } catch (error) {
      // Retry registry reads against the main API when an older dedicated
      // registry endpoint rejects admin tokens or is otherwise unavailable.
      if (
        error instanceof ApiError
        && (error.status === 401 || error.status === 403 || error.status === 404)
        && primaryBase !== baseUrl
      ) {
        return apiFetch<T>(path, {}, baseUrl);
      }
      throw error;
    }
  },
};

export type RegistryEntry = {
  rank: number | null;
  sheet: string;
  company: string;
  board_url: string | null;
  ats: string | null;
  total_jobs: number | null;
  source: string | null;
  tier: "TIER1_VERIFIED" | "TIER2_MEDIUM" | "TIER3_LOW" | "NEEDS_REVIEW";
  sample_url?: string | null;
  last_checked?: string | null;
};

export type RegistryMeta = {
  ok: boolean;
  meta: { version: string; total: number; generated?: string };
  loadedAt: number;
  adapters: string[];
  counts: { total: number; tier1: number; tier2: number; tier3: number; needsReview: number };
};

export type CompanyConfig = {
  company: string;
  enabled: boolean;
  source: string;
  boardUrl?: string;
  sampleUrl?: string;
  isRegistry?: boolean;
  registryAts?: string;
  registryTier?: string;
  workdayBaseUrl?: string;
  host?: string;
  tenant?: string;
  site?: string;
};

export type RuntimeConfig = {
  companies: CompanyConfig[];
  jobtitles: { includeKeywords: string[]; excludeKeywords: string[] };
  updatedAt?: string;
  adminRegistryMode?: "all" | "none";
};

export type ConfigEnvelope = {
  ok: boolean;
  config: RuntimeConfig;
  companyScanOverrides: Record<string, { company: string; paused: boolean; updatedAt: string }>;
};

export type ValidateCompanyRequest = {
  company: string;
  source: string;
  boardUrl: string;
};

export type ValidateCompanyEnvelope = {
  ok: boolean;
  company: CompanyConfig;
  registryEntry: RegistryEntry;
  totalJobs: number;
  message?: string;
};

// ---------- Dashboard ----------
export type DashboardKpis = {
  availableJobs?: number;
  appliedJobs?: number;
  totalTrackedJobs?: number;
  newJobsLatestRun?: number;
  updatedJobsLatestRun?: number;
  applicationRatio?: number;
  interviewRatio?: number;
  offerRatio?: number;
  interview?: number;
  negotiations?: number;
  offered?: number;
  rejected?: number;
  companiesDetected?: number;
  companiesConfigured?: number;
  totalFetched?: number;
  matchRate?: number;
};

export type Dashboard = {
  ok?: boolean;
  generatedAt?: string;
  summaryBuiltAt?: string;
  dashboardAsOf?: string;
  inventorySource?: string;
  freshnessProbeSkipped?: boolean;
  staleReason?: string | null;
  kpis?: DashboardKpis;
  lastRunAt?: string;
  companiesByAts?: Array<{ ats: string; count: number }>;
  statusBreakdown?: Record<string, number>;
  keywordCounts?: Record<string, number>;
  appliedSummary?: {
    statusCounts?: Record<string, number>;
    topCompanies?: Array<{ label: string; count: number }>;
    topLocations?: Array<{ label: string; count: number }>;
    recentActivity?: Array<{
      jobKey: string;
      company: string;
      jobTitle: string;
      status: AppliedStatus;
      appliedAt: string;
      lastStatusChangedAt?: string;
      location?: string;
    }>;
    staleApplications?: Array<{
      jobKey: string;
      company: string;
      jobTitle: string;
      status: AppliedStatus;
      appliedAt: string;
      lastStatusChangedAt?: string;
      location?: string;
    }>;
  };
};

export type MeEnvelope = {
  ok: boolean;
  actor: {
    userId: string;
    tenantId: string;
    email: string;
    displayName: string;
    scope: "user" | "admin";
    isAdmin: boolean;
  };
  profile?: {
    userId: string;
    tenantId: string;
    email: string;
    displayName: string;
    accountStatus: "active" | "suspended";
    plan: "free" | "starter" | "pro" | "power";
    joinedAt: string;
    lastLoginAt: string;
  };
  settings?: {
    emailNotifications: boolean;
    weeklyDigest: boolean;
    trackedCompanies: string[];
  };
  billing?: {
    plan: "free" | "starter" | "pro" | "power";
    status: string;
    provider: string;
    currentPeriodEnd?: string;
  };
  featureFlags?: Array<{
    flagName: string;
    enabled: boolean;
    description: string;
    rolloutPercent: number;
  }>;
  announcements?: Array<{
    id: string;
    title: string;
    body: string;
    severity: "info" | "warning" | "critical";
    active: boolean;
    dismissible: boolean;
    activeFrom: string;
    activeTo: string | null;
    targetPlans: Array<"all" | "free" | "starter" | "pro" | "power">;
    targetTenantIds: string[] | null;
    updatedAt: string;
    updatedBy: string;
  }>;
};

export type AnnouncementSeverity = "info" | "warning" | "critical";
export type AnnouncementTargetPlan = "all" | "free" | "starter" | "pro" | "power";

export type AnnouncementRecord = {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  active: boolean;
  dismissible: boolean;
  activeFrom: string;
  activeTo: string | null;
  targetPlans: AnnouncementTargetPlan[];
  targetTenantIds: string[] | null;
  updatedAt: string;
  updatedBy: string;
};

export type AnnouncementsEnvelope = {
  ok: boolean;
  total: number;
  announcements: AnnouncementRecord[];
};

export type AnnouncementEnvelope = {
  ok: boolean;
  announcement: AnnouncementRecord;
};

export type CreateAnnouncementRequest = {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  active: boolean;
  dismissible: boolean;
  activeFrom: string;
  activeTo: string | null;
  targetPlans: AnnouncementTargetPlan[];
  targetTenantIds: string[] | null;
};

export type UpdateAnnouncementRequest = Partial<CreateAnnouncementRequest>;

// ---------- Notes ----------
export type NoteRecord = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
};

// ---------- Available jobs ----------
export type Job = {
  jobKey: string;
  notes?: string;
  noteRecords?: NoteRecord[];
  company: string;
  source: string;
  jobTitle: string;
  postedAt?: string;
  postedAtDate?: string;
  location?: string;
  url: string;
  originalUrl?: string;
  archivedUrl?: string;
  archiveCapturedAt?: string;
  usLikely?: boolean | null;
  detectedCountry?: string;
  isNew?: boolean;
  isUpdated?: boolean;
  updatedReason?: string;
  changes?: { field: string; from: string; to: string }[];
};

export type JobsEnvelope = {
  ok: boolean;
  runAt?: string;
  total: number;
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  totals: {
    availableJobs: number;
    newJobs: number;
    updatedJobs: number;
    totalAvailableJobs?: number;
    jobsCapped?: boolean;
    jobCapLimit?: number | null;
  };
  companyOptions: string[];
  jobs: Job[];
};

export type JobDetailEnvelope = {
  ok: boolean;
  job: Job;
};

// ---------- Applied jobs ----------
export type AppliedStatus = "Applied" | "Interview" | "Negotiations" | "Offered" | "Rejected";

export type InterviewRound = {
  id: string;
  number: number;
  designation?: string;
  scheduledAt?: string | null;
  outcome?: "Pending" | "Passed" | "Failed" | "Follow-up";
  notes?: string;
};

export type TimelineEvent = {
  id: string;
  at: string;
  kind: string;
  message: string;
};

export type AppliedJob = {
  jobKey: string;
  appliedAt: string;
  status: AppliedStatus;
  job: Job;
  originalUrl?: string;
  archivedUrl?: string;
  archiveCapturedAt?: string;
  notes?: string;
  noteRecords?: NoteRecord[];
  interviewRounds?: InterviewRound[];
  timeline?: TimelineEvent[];
  lastStatusChangedAt?: string;
};

export type AppliedJobsEnvelope = {
  ok: boolean;
  jobs: AppliedJob[];
  companyOptions: string[];
};

export type AppliedKanbanColumn = {
  status: AppliedStatus;
  count: number;
  jobs: AppliedJob[];
};

export type AppliedKanbanEnvelope = {
  ok: boolean;
  total: number;
  columns: AppliedKanbanColumn[];
};

export type CompanyAppliedJobsEnvelope = {
  ok: boolean;
  company: string;
  total: number;
  jobs: AppliedJob[];
};

// ---------- Action plan ----------
export type ActionPlanRow = {
  jobKey: string;
  company: string;
  jobTitle: string;
  originalUrl?: string;
  archivedUrl?: string;
  archiveCapturedAt?: string;
  notes?: string;
  noteRecords?: NoteRecord[];
  appliedAt?: string | null;
  appliedAtDate?: string | null;
  interviewAt?: string | null;
  interviewAtDate?: string | null;
  outcome?: string;
  currentRoundId?: string;
  currentRoundNumber?: number;
  interviewRounds?: InterviewRound[];
  timeline?: TimelineEvent[];
  url: string;
  location?: string;
  source?: string;
  postedAt?: string;
};

export type ActionPlanEnvelope = {
  ok: boolean;
  jobs: ActionPlanRow[];
};

// ---------- Run / scan ----------
export type RunStatus = {
  ok?: boolean;
  active?: boolean;
  runId?: string;
  triggerType?: "manual" | "scheduled";
  startedAt?: string;
  expiresAt?: string;
  totalCompanies?: number;
  fetchedCompanies?: number;
  currentCompany?: string;
  detail?: string;
  percent?: number;
  message?: string;
};

export type RunScanMeta = {
  cacheHits: number;
  liveFetchCompanies: number;
  quotaBlockedCompanies: string[];
  remainingLiveScansToday: number | null;
  filteredOutCompanies?: number;
  filteredOutJobs?: number;
};

export type RunStartResponse = {
  ok: boolean;
  // Manual scans in AWS are accepted asynchronously before the worker fanout
  // finishes. Keep the response type broad enough to model both the initial
  // accepted envelope and the later completed run summary shape.
  status?: "accepted";
  runId?: string;
  queuedAt?: string;
  runAt?: string;
  totalNewMatches?: number;
  totalUpdatedMatches?: number;
  totalMatched?: number;
  totalFetched?: number;
  byCompany?: Record<string, number>;
  emailedJobs?: Array<{ company: string; title: string; id: string }>;
  emailedUpdatedJobs?: Array<{ company: string; title: string; id: string }>;
  emailStatus?: "sent" | "skipped" | "failed";
  emailError?: string | null;
  scanMeta?: RunScanMeta;
  requiresConfirmation?: boolean;
  enabledCompanyCount?: number;
  threshold?: number;
};

export type ScanQuotaEnvelope = {
  ok: boolean;
  liveScansUsed: number;
  remainingLiveScansToday: number | null;
  lastLiveScanAt: string | null;
  date: string;
  unlimited?: boolean;
};

export type ScanContextEnvelope = {
  ok: boolean;
  enabledCompanyCount: number;
};

// ---------- Email webhook ----------
export type EmailWebhookSettings = {
  webhookUrl?: string;
  sharedSecretConfigured?: boolean;
};

export type SupportTicket = {
  ticketId: string;
  userId: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  tags: Array<"bug" | "enhancement" | "subscription_assistance" | "other" | "billing" | "scan" | "account">;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
};

export type SupportMessage = {
  ticketId: string;
  sender: string;
  senderType: "user" | "admin";
  body: string;
  attachments: string[];
  createdAt: string;
  internal: boolean;
};

export type SupportTicketsEnvelope = {
  ok: boolean;
  total: number;
  tickets: SupportTicket[];
};

export type SupportTicketEnvelope = {
  ok: boolean;
  ticket: SupportTicket;
  messages: SupportMessage[];
};

export type AdminSummaryEnvelope = {
  ok: boolean;
  users: {
    total: number;
    active: number;
    suspended: number;
  };
  support: {
    totalTickets: number;
    openTickets: number;
    inProgressTickets: number;
  };
  registry: {
    totalCompanies: number;
    currentCompanies: number;
    currentJobs: number;
    lastScannedAt: string | null;
  };
  featureFlags: Array<{
    flagName: string;
    enabled: boolean;
    description: string;
    rolloutPercent: number;
  }>;
};

export type AdminRegistryStatusRow = {
  registryId: string;
  company: string;
  ats: string | null;
  scanPool: "hot" | "warm" | "cold";
  lastScanStatus: "pass" | "fail" | "pending";
  totalJobs: number;
  lastScannedAt: string | null;
  nextScanAt: string | null;
};

export type AdminRegistryStatusEnvelope = {
  ok: boolean;
  totals: AdminSummaryEnvelope["registry"];
  rows: AdminRegistryStatusRow[];
};

export type AdminActionsNeededRow = {
  company: string;
  ats: string | null;
  scanPool: "hot" | "warm" | "cold";
  lastScanStatus: "fail";
  totalJobs: number;
  lastScannedAt: string | null;
  nextScanAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  failureCategory: string;
  failureReason: string | null;
};

export type AdminActionsNeededEnvelope = {
  ok: boolean;
  totals: {
    totalFailures: number;
    pausedCompanies: number;
    overdueCompanies: number;
  };
  rows: AdminActionsNeededRow[];
};

export type ResumeAdminActionEnvelope = {
  ok: boolean;
  company: string;
  nextScanAt: string | null;
  status: "healthy" | "pending" | "failing" | "paused" | "misconfigured" | "stale";
  failureCount: number;
};

export type AdminRegistryCompanyConfig = {
  rank: number | null;
  sheet: string;
  company: string;
  board_url: string | null;
  ats: string | null;
  total_jobs: number | null;
  source: string | null;
  tier: "TIER1_VERIFIED" | "TIER2_MEDIUM" | "TIER3_LOW" | "NEEDS_REVIEW";
  scan_pool?: "hot" | "warm" | "cold" | null;
  from?: string;
  adapterId?: string | null;
  boards?: Array<{ ats: string; url: string; total_jobs?: number }>;
  sample_url?: string | null;
  last_checked?: string | null;
} & Record<string, unknown>;

export type AdminRegistryCompanyConfigSummary = AdminRegistryCompanyConfig & {
  registryId: string;
};

export type AdminRegistryCompanyConfigsEnvelope = {
  ok: boolean;
  total: number;
  rows: AdminRegistryCompanyConfigSummary[];
};

export type AdminRegistryCompanyConfigEnvelope = {
  ok: boolean;
  registryId: string;
  config: AdminRegistryCompanyConfig;
};

export type AdminRegistryCompanyConfigDeleteEnvelope = {
  ok: boolean;
  registryId: string;
  deletedCompany: string;
};

export type AdminUsersEnvelope = {
  ok: boolean;
  total: number;
  users: Array<{
    userId: string;
    tenantId: string;
    email: string;
    displayName: string;
    accountStatus: "active" | "suspended";
    plan: "free" | "starter" | "pro" | "power";
    joinedAt: string;
    lastLoginAt: string;
    scope: "user" | "admin";
  }>;
};

export type AdminUserEnvelope = {
  ok: boolean;
  profile: AdminUsersEnvelope["users"][number];
  settings: {
    emailNotifications: boolean;
    weeklyDigest: boolean;
    trackedCompanies: string[];
  };
  billing: {
    plan: "free" | "starter" | "pro" | "power";
    status: string;
    provider: string;
  };
  tickets: SupportTicket[];
};

export type FeatureFlagsEnvelope = {
  ok: boolean;
  total: number;
  featureFlags: Array<{
    flagName: string;
    enabled: boolean;
    description: string;
    rolloutPercent: number;
    enabledForPlans: Array<"free" | "starter" | "pro" | "power">;
    enabledForUsers: string[];
  }>;
};

export type PlanConfig = {
  plan: "free" | "starter" | "pro" | "power";
  displayName: string;
  scanCacheAgeHours: number;
  canTriggerLiveScan: boolean;
  dailyLiveScans: number;
  maxCompanies: number | null;
  maxSessions: number;
  maxVisibleJobs: number | null;
  maxAppliedJobs: number | null;
  emailNotificationsEnabled: boolean;
  weeklyDigestEnabled: boolean;
  maxEmailsPerWeek: number;
  enabledFeatures: string[];
  updatedAt: string;
  updatedBy: string;
};

export type PlanConfigsEnvelope = {
  ok: boolean;
  configs: PlanConfig[];
};

export type PlanConfigEnvelope = {
  ok: boolean;
  config: PlanConfig;
};

export type StripeConfigPublic = {
  publishableKey: string;
  webhookConfigured: boolean;
  priceIds: {
    starter: string;
    pro: string;
    power: string;
  };
  updatedAt: string;
  updatedBy: string;
};

export type StripeConfigEnvelope = {
  ok: boolean;
  configured: boolean;
  config: StripeConfigPublic | null;
};

export type BillingSubscriptionEnvelope = {
  ok: boolean;
  subscription: {
    tenantId: string;
    plan: "free" | "starter" | "pro" | "power";
    status: string;
    provider: "internal" | "stripe";
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: string;
    updatedAt?: string;
  } | null;
  planConfig: PlanConfig | null;
};

export type BillingCheckoutEnvelope = {
  ok: boolean;
  url: string;
  sessionId: string;
};

// ---------- Admin analytics ----------
export type AdminAnalyticsEnvelope<T> = {
  ok: boolean;
  data: T;
  cachedAt: string;
  cacheExpiresAt: string;
};

export type GrowthAnalytics = {
  signupsPerDay: Array<{ date: string; count: number }>;
  activationRate: number;
  medianHoursToFirstScan: number | null;
  churnSignalCount: number;
};

export type MarketIntelAnalytics = {
  mostScannedCompanies: Array<{ company: string; scanCount: number }>;
  scanVolumePerDay: Array<{ date: string; count: number }>;
  scanFailureRate: number;
};

export type FeatureUsageAnalytics = {
  totalRunsLast30d: number;
  runDurationP50Ms: number | null;
  runDurationP95Ms: number | null;
  scanFailuresByLayer: Array<{ layer: string; count: number }>;
  jobViewedCount: number;
};

export type SystemHealthAnalytics = {
  scanFailuresByReason: Array<{ reason: string; count: number }>;
  scanFailuresByAts: Array<{ atsType: string; count: number }>;
  recentFailures: Array<{ company: string; reason: string; layer: string; at: string }>;
};

export type ScanQuotaAnalytics = {
  cacheHitRate: number;
  liveFetchRate: number;
  quotaBlockRate: number;
  totalRunsAnalyzed: number;
  totalCacheHits: number;
  totalLiveFetches: number;
  totalQuotaBlocked: number;
  perPlanUsage: Array<{
    plan: "free" | "starter" | "pro" | "power";
    totalLiveScansUsed: number;
    tenantCount: number;
    avgPerTenant: number;
  }>;
  quotaUsagePerDay: Array<{
    date: string;
    count: number;
  }>;
};
