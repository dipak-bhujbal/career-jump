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
};

export type ConfigEnvelope = {
  ok: boolean;
  config: RuntimeConfig;
  companyScanOverrides: Record<string, { company: string; paused: boolean; updatedAt: string }>;
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
  kpis?: DashboardKpis;
  lastRunAt?: string;
  statusBreakdown?: Record<string, number>;
  keywordCounts?: Record<string, number>;
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
    plan: "free" | "pro" | "power";
    joinedAt: string;
    lastLoginAt: string;
  };
  settings?: {
    emailNotifications: boolean;
    weeklyDigest: boolean;
    trackedCompanies: string[];
  };
  billing?: {
    plan: "free" | "pro" | "power";
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
  }>;
};

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
  usLikely?: boolean | null;
  detectedCountry?: string;
  isNew?: boolean;
  isUpdated?: boolean;
  changes?: { field: string; from: string; to: string }[];
};

export type JobsEnvelope = {
  ok: boolean;
  runAt?: string;
  total: number;
  pagination: { offset: number; limit: number; nextOffset: number; hasMore: boolean };
  totals: { availableJobs: number; newJobs: number; updatedJobs: number };
  companyOptions: string[];
  jobs: Job[];
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

// ---------- Action plan ----------
export type ActionPlanRow = {
  jobKey: string;
  company: string;
  jobTitle: string;
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
  featureFlags: Array<{
    flagName: string;
    enabled: boolean;
    description: string;
    rolloutPercent: number;
  }>;
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
    plan: "free" | "pro" | "power";
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
    plan: "free" | "pro" | "power";
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
    enabledForPlans: Array<"free" | "pro" | "power">;
    enabledForUsers: string[];
  }>;
};
