import seedCompanies from "../companies.json";
import seedJobtitles from "../jobtitles.json";

export type AssetFetcher = { fetch(request: Request): Promise<Response> };

export interface Env {
  JOB_STATE: KVNamespace;
  ATS_CACHE: KVNamespace;
  CONFIG_STORE: KVNamespace;
  DB: D1Database;
  ASSETS: AssetFetcher;
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
  APP_NAME?: string;
  APP_ENV?: "dev" | "prod" | string;
  DEFAULT_TENANT_EMAIL?: string;
  APPS_SCRIPT_WEBHOOK_URL?: string;
  APPS_SCRIPT_SHARED_SECRET?: string;
  SES_FROM_EMAIL?: string;
}

export type AuthScope = "user" | "admin";

export type RequestActor = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  scope: AuthScope;
  isAdmin: boolean;
};

export type Source =
  | "greenhouse"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "lever"
  | "bamboohr"
  | "breezy"
  | "eightfold"
  | "icims"
  | "jobvite"
  | "oracle"
  | "phenom"
  | "recruitee"
  | "successfactors"
  | "taleo"
  | "workable"
  | "custom-jsonld"
  | "sitemap";
export type JobSource = Source | "manual";

export type CompanyInput = {
  company: string;
  aliases?: string[];
  enabled?: boolean;
  source?: Source;
  boardUrl?: string;
  sampleUrl?: string;
  isRegistry?: boolean;
  registryAts?: string;
  registryTier?: string;
  boardToken?: string;
  companySlug?: string;
  smartRecruitersCompanyId?: string;
  leverSite?: string;
  workdayBaseUrl?: string;
  host?: string;
  tenant?: string;
  site?: string;
};

export type JobTitleConfig = {
  includeKeywords: string[];
  excludeKeywords: string[];
};

export type RuntimeConfig = {
  companies: CompanyInput[];
  jobtitles: JobTitleConfig;
  updatedAt: string;
  /**
   * Admin-only registry presentation mode.
   *
   * `all` keeps the full registry auto-expanded. `none` preserves only the
   * explicitly saved subset so admins can temporarily clear the giant catalog
   * without writing thousands of disabled rows.
   */
  adminRegistryMode?: "all" | "none";
  /**
   * Phase 2: tenant scoping. When unset, behavior is single-tenant (current
   * deploy). When set, downstream storage keys, filters, and pipeline
   * decisions can be tenant-isolated.
   */
  tenantId?: string;
};

/**
 * Tenant settings (Phase 2). Stored in DynamoDB at
 *   pk = "tenant#<id>"
 *   sk = "settings"
 * The runtime tenantId resolves the active tenant; this struct holds the
 * per-tenant overrides that diverge from the global defaults.
 */
export type TenantSettings = {
  tenantId: string;
  displayName: string;
  /** Override the global jobtitles config per tenant. */
  jobtitlesOverride?: JobTitleConfig;
  /** Restrict which registry sheets are visible (e.g., only Tech/SaaS). */
  enabledRegistrySheets?: string[];
  /** Pipeline customization — names of stages to add/remove vs default order. */
  pipelineOverrides?: { add?: string[]; remove?: string[] };
  createdAt: string;
  updatedAt: string;
};

export type CompanyScanOverride = {
  company: string;
  paused: boolean;
  updatedAt: string;
  updatedByUserId?: string;
};

export type AppliedJobStatus =
  | "Applied"
  | "Interview"
  | "Rejected"
  | "Negotiations"
  | "Offered";

export type InterviewOutcome = "Passed" | "Failed" | "Follow-up" | "Pending";
export type InterviewRoundDesignation = "Recruiter" | "Aptitude Tests" | "Hiring Manager" | "Loop Interview" | "Skip Manager";

export type TimelineEventType = "posted" | "applied" | "interview" | "status" | "outcome";

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  label: string;
  at?: string;
  value?: string;
  roundId?: string;
};

export type InterviewRound = {
  id: string;
  roundNumber: number;
  designation?: InterviewRoundDesignation;
  interviewer?: string;
  interviewAt?: string;
  outcome: InterviewOutcome;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type PostedAtSource = "ats" | "identified_fallback" | "legacy";

export type JobPosting = {
  source: JobSource;
  company: string;
  id: string;
  title: string;
  location: string;
  url: string;
  manualEntry?: boolean;
  postedAt?: string;
  postedAtSource?: PostedAtSource;
  identifiedAt?: string;
  detectedCountry?: string;
  isUSLikely?: boolean | null;
  matchedKeywords?: string[];
};

export type UpdatedJobChange = {
  field: string;
  previous: string | null;
  current: string | null;
};

export type UpdatedEmailJob = JobPosting & {
  updateJustification?: string;
  updateChanges?: UpdatedJobChange[];
};

export type NoteRecord = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
};

export type AppliedJobRecord = {
  jobKey: string;
  job: JobPosting;
  originalJobUrl?: string;
  archivedSnapshotKey?: string;
  archivedAt?: string;
  notes?: string;
  noteRecords?: NoteRecord[];
  appliedAt: string;
  status: AppliedJobStatus;
  interviewRounds: InterviewRound[];
  timeline: TimelineEvent[];
  lastStatusChangedAt?: string;
};

export type ActionPlanRow = {
  jobKey: string;
  company: string;
  jobTitle: string;
  originalUrl?: string;
  archivedUrl?: string;
  archiveCapturedAt?: string;
  notes?: string;
  appliedAt?: string | null;
  appliedAtDate?: string | null;
  interviewAt?: string | null;
  interviewAtDate?: string | null;
  outcome: InterviewOutcome;
  currentRoundId: string;
  currentRoundNumber: number;
  interviewRounds: InterviewRound[];
  timeline: TimelineEvent[];
  url: string;
  location?: string;
  source?: string;
  postedAt?: string;
};

export type AppLogLevel = "info" | "warn" | "error";

export type AppLogEntry = {
  id: string;
  event: string;
  timestamp: string;
  level: AppLogLevel;
  message: string;
  tenantId?: string;
  route?: string;
  company?: string;
  source?: string;
  runId?: string;
  details?: Record<string, unknown>;
};

export type AppTraceSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: string;
  attributes?: Record<string, unknown>;
};

export type ActiveRunLock = {
  runId: string;
  triggerType: "manual" | "scheduled";
  startedAt: string;
  expiresAt: string;
  expiresAtEpoch?: number;
  lastHeartbeatAt?: string;
  totalCompanies?: number;
  fetchedCompanies?: number;
  currentCompany?: string;
  currentSource?: string;
  currentStage?: string;
  currentPage?: number | null;
  lastEvent?: string;
};

export type SavedFilterScope = "available_jobs" | "applied_jobs" | "dashboard" | "logs";

export type SavedFilterRecord = {
  id: string;
  tenantId?: string;
  name: string;
  scope: SavedFilterScope;
  filter: Record<string, unknown>;
  createdByUserId?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MatchDecisionRecord = {
  id: string;
  tenantId: string;
  runId: string;
  decisionType:
    | "included"
    | "excluded_title"
    | "excluded_geography"
    | "grouped_duplicate"
    | "suppressed_seen"
    | "suppressed_emailed";
  explanation: Record<string, unknown>;
  createdAt: string;
};

export type MatchDecisionSummary = {
  company: string;
  source: string;
  runId: string;
  createdAt: string;
  fetchStatus?: "fetched" | "failed" | "skipped";
  fetchedCount?: number;
  matchedCount?: number;
  failureReason?: string | null;
  counts: {
    total: number;
    included: number;
    excludedTitle: number;
    excludedGeography: number;
    groupedDuplicate: number;
    suppressedSeen: number;
    suppressedEmailed: number;
    discardedFromPrevious?: number;
    newJobs?: number;
    updatedJobs?: number;
  };
  updatedJobs?: Array<{
    title: string;
    jobKey: string;
    justification: string;
    changes: UpdatedJobChange[];
  }>;
  discardedJobs?: Array<{
    title: string;
    jobKey: string;
    location?: string;
    reason: "excluded_title" | "excluded_geography" | "not_returned_by_source" | "fetch_failed" | "skipped_unresolved_source";
    justification: string;
  }>;
  rationales?: string[];
  examples?: Array<{
    decisionType: MatchDecisionRecord["decisionType"];
    title: string;
    location?: string;
    reason: string;
  }>;
};

export type EmailWebhookConfig = {
  webhookUrl: string;
  sharedSecret: string;
};

export type UserPlan = "free" | "starter" | "pro" | "power";
export type AccountStatus = "active" | "suspended";

export type UserProfileRecord = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  accountStatus: AccountStatus;
  plan: UserPlan;
  joinedAt: string;
  lastLoginAt: string;
  firstScanAt?: string;
  cognitoSub: string;
  scope: AuthScope;
};

export type UserSettingsRecord = {
  userId: string;
  emailNotifications: boolean;
  weeklyDigest: boolean;
  trackedCompanies: string[];
  updatedAt: string;
};

export type UserSessionRecord = {
  userId: string;
  sessionId: string;
  createdAt: string;
  lastSeenAt: string;
  deviceFingerprint: string;
  ipAddress: string;
  country: string;
  plan: UserPlan;
  revokedAt?: string | null;
  revokeReason?: string | null;
};

export type BillingSubscriptionRecord = {
  userId: string;
  plan: UserPlan;
  status: "active" | "trialing" | "canceled";
  provider: "internal" | "stripe";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
  updatedAt: string;
};

export type PlanConfig = {
  plan: UserPlan;
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

export type ScanOutcome =
  | "cache_hit"
  | "live_fetch_started"
  | "live_fetch_completed"
  | "quota_blocked"
  | "cache_miss_no_data"
  | "scan_failed";

export type ScanQuotaUsage = {
  tenantId: string;
  date: string;
  liveScansUsed: number;
  lastLiveScanAt: string | null;
  runIds: string[];
};

export type FeatureFlagRecord = {
  flagName: string;
  enabled: boolean;
  enabledForPlans: UserPlan[];
  enabledForUsers: string[];
  rolloutPercent: number;
  description: string;
  updatedAt: string;
  updatedBy: string;
};

export type AnnouncementRecord = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  active: boolean;
  dismissible: boolean;
  activeFrom: string;
  activeTo: string | null;
  targetPlans: Array<UserPlan | "all">;
  targetTenantIds: string[] | null;
  updatedAt: string;
  updatedBy: string;
};

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";
export type SupportTicketTag =
  | "bug"
  | "enhancement"
  | "subscription_assistance"
  | "other"
  | "billing"
  | "scan"
  | "account";

export type SupportTicketRecord = {
  ticketId: string;
  userId: string;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  tags: SupportTicketTag[];
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
};

export type SupportTicketMessageRecord = {
  ticketId: string;
  sender: string;
  senderType: "user" | "admin";
  body: string;
  attachments: string[];
  createdAt: string;
  internal: boolean;
};

export type TrendPoint = {
  ts: string;
  totalMatched: number;
  keywordCounts: Record<string, number>;
};

export type InventorySnapshot = {
  runAt: string;
  jobs: JobPosting[];
  stats: {
    totalJobsMatched: number;
    totalCompaniesConfigured: number;
    totalCompaniesDetected: number;
    totalFetched: number;
    bySource: Record<string, number>;
    byCompany: Record<string, number>;
    byCompanyFetched?: Record<string, number>;
    keywordCounts: Record<string, number>;
    cacheHits?: number;
    liveFetchCompanies?: number;
    quotaBlockedCompanies?: string[];
    remainingLiveScansToday?: number;
    filteredOutCompanies?: number;
    filteredOutJobs?: number;
  };
};

export type DetectedConfig =
  | { source: "greenhouse"; boardToken: string; sampleUrl?: string }
  | { source: "ashby"; companySlug: string }
  | { source: "smartrecruiters"; smartRecruitersCompanyId: string }
  | { source: "lever"; leverSite: string; sampleUrl?: string }
  | {
      source: "workday";
      sampleUrl?: string;
      workdayBaseUrl?: string;
      host?: string;
      tenant?: string;
      site?: string;
    }
  | {
      source: "registry-adapter";
      adapterId: Source | string;
      boardUrl: string;
      sampleUrl?: string;
      companyName: string;
    };

export type WorkdayScanLayer = "layer1" | "layer2" | "layer3";

export type WorkdayRateLimitStatus =
  | "ok"
  | "throttled"
  | "blocked"
  | "captcha"
  | "parse_error"
  | "paused"
  | "layer_promoted";

export type WorkdayFailureReason = Exclude<WorkdayRateLimitStatus, "ok" | "paused" | "layer_promoted">;

export type WorkdayScanState = {
  company: string;
  companySlug: string;
  scanLayer: WorkdayScanLayer;
  fallbackLayer: Exclude<WorkdayScanLayer, "layer1">;
  rateLimitStatus: WorkdayRateLimitStatus;
  resumeAfter?: string | null;
  failureCount24h: number;
  lastFailureReason?: WorkdayFailureReason | null;
  lastFailureAt?: string | null;
  probeSuccessCount: number;
  updatedAt: string;
};

export type RegistryScanPool = "hot" | "warm" | "cold";

export type RegistryScanPriority = "low" | "normal" | "high";

export type RegistryScanStatus =
  | "pending"
  | "healthy"
  | "stale"
  | "failing"
  | "paused"
  | "misconfigured";

export type KanbanColumn = {
  status: AppliedJobStatus;
  count: number;
  jobs: AppliedJobRecord[];
};

export type KanbanBoard = {
  columns: KanbanColumn[];
  total: number;
};

export type RegistryCompanyScanState = {
  company: string;
  companySlug: string;
  adapterId?: string | null;
  scanPool: RegistryScanPool;
  priority: RegistryScanPriority;
  status: RegistryScanStatus;
  activeTrackers: number;
  scanHourWeights: number[];
  nextScanAt?: string | null;
  staleAfterAt?: string | null;
  lastScanAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastFailureReason?: string | null;
  failureCount: number;
  lastFetchedCount: number;
  updatedAt: string;
};

export type WorkdayScanFailure = {
  ok: false;
  layerUsed: WorkdayScanLayer;
  failureReason: WorkdayFailureReason;
  message: string;
  status?: number;
  retryAfter?: string | null;
  details?: Record<string, unknown>;
};

export type WorkdayScanSuccess = {
  ok: true;
  layerUsed: WorkdayScanLayer;
  jobs: JobPosting[];
  retryAfter?: string | null;
};

export type WorkdayScanResult = WorkdayScanSuccess | WorkdayScanFailure;

export type DetectionCacheRecord =
  | { status: "detected"; company: string; config: DetectedConfig; checkedAt: string }
  | { status: "unknown"; company: string; checkedAt: string; reason?: string };

export type ProtectedDiscoveryRecord = {
  company: string;
  config: DetectedConfig;
  discoveredAt: string;
  updatedAt: string;
  via: "manual";
  notes?: string[];
};

export type GreenhouseJob = {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
};

export type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
};

export type SmartRecruitersJob = {
  id?: string;
  uuid?: string;
  name?: string;
  ref?: string;
  releasedDate?: string;
  postingDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
  };
};

export type SmartRecruitersPage = {
  content?: SmartRecruitersJob[];
  offset?: number;
  limit?: number;
  totalFound?: number;
};

export type WorkdayJobPosting = {
  bulletFields?: string[] | Array<{ label?: string; value?: string }>;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  title?: string;
  jobReqId?: string;
};

export type WorkdaySearchResponse = {
  jobPostings?: WorkdayJobPosting[];
  total?: number;
};

export type LeverJob = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    allLocations?: string[];
  };
  workplaceType?: string;
  descriptionPlain?: string;
};

export const typedSeedCompanies: CompanyInput[] = seedCompanies as CompanyInput[];
export const typedSeedJobtitles: JobTitleConfig = seedJobtitles as JobTitleConfig;
