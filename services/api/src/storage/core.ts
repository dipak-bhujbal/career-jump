import { ACTIVE_RUN_LOCK_KEY, ACTIVE_RUN_LOCK_TTL_SECONDS, ACTIVE_RUN_STALE_AFTER_SECONDS, APPLIED_KEY, APP_LOG_PREFIX, APP_LOG_TTL_SECONDS, ATS_CACHE_PREFIX, COMPANY_SCAN_OVERRIDES_KEY, DASHBOARD_SUMMARY_KEY, DEFAULT_APP_LOG_LIMIT, EMAIL_ATTEMPT_PREFIX, EMAIL_WEBHOOK_CONFIG_KEY, FIRST_SEEN_PREFIX, INVENTORY_KEY, JOB_NOTES_KEY, MAX_APP_LOG_LIMIT, PROTECTED_DISCOVERY_PREFIX, SAVED_FILTERS_KEY, SEEN_PREFIX, VALID_INTERVIEW_OUTCOMES } from "../constants";
import { atsCacheKv, configStoreKv, jobStateKv } from "../lib/bindings";
import { tenantScopedKey, tenantScopedPrefix } from "../lib/tenant";
import { hyphenSlug, jobKey, jobStableFingerprint, normalizeAppliedStatus, normalizeText, nowISO, slugify } from "../lib/utils";
import { deleteRow, jobsTableName, putRow, queryRows } from "../aws/dynamo";
import {
  buildDashboardPayload,
  buildDashboardSummaryFingerprint,
  saveCachedDashboardPayload,
  summarizeCompaniesByAtsFromInventory,
} from "../services/dashboard";
import type {
  AppliedJobRecord,
  AppLogEntry,
  AppLogLevel,
  ActiveRunLock,
  CompanyInput,
  CompanyScanOverride,
  DetectionCacheRecord,
  EmailWebhookConfig,
  Env,
  InterviewOutcome,
  InterviewRoundDesignation,
  JobSource,
  JobPosting,
  InventorySnapshot,
  NoteRecord,
  ProtectedDiscoveryRecord,
  SavedFilterRecord,
  SavedFilterScope,
  Source,
  TimelineEvent,
  InterviewRound,
} from "../types";

export function atsCacheKey(company: string): string {
  return `${ATS_CACHE_PREFIX}${slugify(company)}`;
}

const APPLIED_JOB_ROW_PREFIX = `${APPLIED_KEY}:row:`;
const JOB_NOTE_ROW_PREFIX = `${JOB_NOTES_KEY}:row:`;
const RUN_ABORT_PREFIX = "run-abort:";
const TENANT_JOB_ENTITY_TYPE = "TENANT_JOB";

type TenantJobRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  entityType: typeof TENANT_JOB_ENTITY_TYPE;
  tenantId: string;
  jobKey: string;
  status: AppliedJobRecord["status"];
  company: string;
  companySlug: string;
  appliedAt: string;
  updatedAt: string;
  record: AppliedJobRecord;
};

export function protectedDiscoveryKey(company: string): string {
  return `${PROTECTED_DISCOVERY_PREFIX}${slugify(company)}`;
}

function normalizeSeenUrl(url?: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const search = parsed.search || "";
    return `${parsed.origin.toLowerCase()}${pathname}${search}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeSeenLocation(location?: string): string {
  const value = normalizeText(String(location ?? ""));
  return value ? hyphenSlug(value) : "unknown";
}

function normalizeSeenTitle(title?: string): string {
  const value = normalizeText(String(title ?? ""));
  return value ? hyphenSlug(value) : "unknown";
}

export function seenJobKey(job: JobPosting): string {
  const company = slugify(job.company);
  const source = slugify(job.source);
  const normalizedUrl = normalizeSeenUrl(job.url);
  if (normalizedUrl) {
    return `${SEEN_PREFIX}${company}:${source}:url:${normalizedUrl}`;
  }

  const rawId = String(job.id ?? "").trim();
  if (rawId) {
    return `${SEEN_PREFIX}${company}:${source}:id:${rawId}`;
  }

  return `${SEEN_PREFIX}${company}:${source}:title:${normalizeSeenTitle(job.title)}:location:${normalizeSeenLocation(job.location)}`;
}

export function firstSeenFingerprintKey(job: JobPosting): string {
  return `${FIRST_SEEN_PREFIX}${jobStableFingerprint(job)}`;
}

export function legacySeenJobKeys(job: JobPosting): string[] {
  const company = slugify(job.company);
  const source = slugify(job.source);
  const rawId = String(job.id ?? "").trim();
  const keys = new Set<string>();

  if (rawId) {
    keys.add(`${SEEN_PREFIX}${job.company}:${job.source}:${rawId}`);
    keys.add(`${SEEN_PREFIX}${company}:${source}:${rawId}`);
    keys.add(`${SEEN_PREFIX}${company}:${source}:id:${rawId}`);
  }

  const normalizedUrl = normalizeSeenUrl(job.url);
  if (normalizedUrl) {
    keys.add(`${SEEN_PREFIX}${company}:${source}:url:${normalizedUrl}`);
  }

  keys.add(`${SEEN_PREFIX}${company}:${source}:title:${normalizeSeenTitle(job.title)}:location:${normalizeSeenLocation(job.location)}`);

  return [...keys];
}

function normalizeInterviewOutcome(value: unknown): InterviewOutcome {
  const text = String(value ?? "Pending").trim() as InterviewOutcome;
  return (VALID_INTERVIEW_OUTCOMES as string[]).includes(text) ? text : "Pending";
}

function normalizeInterviewRoundDesignation(value: unknown): InterviewRoundDesignation | undefined {
  return value === "Recruiter" ||
    value === "Aptitude Tests" ||
    value === "Hiring Manager" ||
    value === "Loop Interview" ||
    value === "Skip Manager"
    ? value
    : undefined;
}

function defaultInterviewRoundDesignation(index: number): InterviewRoundDesignation {
  const sequence: InterviewRoundDesignation[] = ["Recruiter", "Aptitude Tests", "Hiring Manager", "Loop Interview", "Skip Manager"];
  return sequence[Math.min(Math.max(index, 0), sequence.length - 1)];
}

function normalizeTimelineEvent(value: unknown): TimelineEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const type = String(row.type ?? "status").trim();
  const label = String(row.label ?? "").trim();
  if (!id || !type || !label) return null;
  return {
    id,
    type: type as TimelineEvent["type"],
    label,
    at: typeof row.at === "string" ? row.at : undefined,
    value: typeof row.value === "string" ? row.value : undefined,
    roundId: typeof row.roundId === "string" ? row.roundId : undefined,
  };
}

function normalizeInterviewRound(value: unknown, index: number): InterviewRound | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : nowISO();
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : createdAt;
  return {
    id: String(row.id ?? `round-${index + 1}`),
    roundNumber: Number(row.roundNumber ?? index + 1) || index + 1,
    designation: normalizeInterviewRoundDesignation(row.designation) ?? defaultInterviewRoundDesignation(index),
    interviewer: typeof row.interviewer === "string" ? row.interviewer : undefined,
    interviewAt: typeof row.interviewAt === "string" ? row.interviewAt : undefined,
    outcome: normalizeInterviewOutcome(row.outcome),
    notes: typeof row.notes === "string" ? row.notes : undefined,
    createdAt,
    updatedAt,
  };
}

function baseTimelineForRecord(job: JobPosting, appliedAt: string): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  if (job.postedAt) {
    timeline.push({
      id: `posted-${job.id}`,
      type: "posted",
      label: "Posted at",
      at: job.postedAt,
    });
  }
  timeline.push({
    id: `applied-${job.id}`,
    type: "applied",
    label: "Applied at",
    at: appliedAt,
  });
  return timeline;
}

function rowKey(prefix: string, key: string): string {
  return `${prefix}${encodeURIComponent(key)}`;
}

function rowPrefix(prefix: string): string {
  return prefix;
}

function parseRowKey(prefix: string, key: string): string {
  const encoded = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function tenantJobsTableEnabled(): boolean {
  return Boolean(process.env.AWS_JOBS_TABLE);
}

function tenantJobPk(tenantId?: string): string {
  return `TENANT#${tenantId ?? "default"}`;
}

function tenantJobSk(jobKeyValue: string): string {
  return `JOB#${encodeURIComponent(jobKeyValue)}`;
}

async function loadAppliedJobsFromJobsTable(tenantId?: string): Promise<Record<string, AppliedJobRecord>> {
  const rows = await queryRows<TenantJobRow>(
    jobsTableName(),
    "pk = :pk",
    { ":pk": tenantJobPk(tenantId) },
    { consistentRead: true },
  );
  const result: Record<string, AppliedJobRecord> = {};
  for (const row of rows) {
    const record = normalizeAppliedJobRecord(row.jobKey, row.record);
    if (record) result[record.jobKey] = record;
  }
  return result;
}

async function saveAppliedJobsToJobsTable(tenantId: string | undefined, data: Record<string, AppliedJobRecord>): Promise<void> {
  const existingRows = await queryRows<TenantJobRow>(
    jobsTableName(),
    "pk = :pk",
    { ":pk": tenantJobPk(tenantId) },
    { consistentRead: true },
  );
  const nextJobKeys = new Set(Object.keys(data));

  // Synchronize the tenant-owned job set in Dynamo so applied/action-plan
  // records remain durable even after shared raw jobs are removed.
  await Promise.all(existingRows
    .filter((row) => !nextJobKeys.has(row.jobKey))
    .map((row) => deleteRow(jobsTableName(), { pk: row.pk, sk: row.sk })));

  await Promise.all(Object.entries(data).map(async ([nextJobKey, record]) => {
    const safe = normalizeAppliedJobRecord(nextJobKey, record);
    if (!safe) return;
    const updatedAt = safe.lastStatusChangedAt ?? safe.appliedAt;
    await putRow(jobsTableName(), {
      pk: tenantJobPk(tenantId),
      sk: tenantJobSk(nextJobKey),
      gsi1pk: `TENANT#${tenantId ?? "default"}#STATUS#${safe.status}`,
      gsi1sk: `${updatedAt}#${tenantJobSk(nextJobKey)}`,
      gsi2pk: `TENANT#${tenantId ?? "default"}#COMPANY#${slugify(safe.job.company) || "unknown-company"}`,
      gsi2sk: `${updatedAt}#${tenantJobSk(nextJobKey)}`,
      entityType: TENANT_JOB_ENTITY_TYPE,
      tenantId: tenantId ?? "default",
      jobKey: nextJobKey,
      status: safe.status,
      company: safe.job.company,
      companySlug: slugify(safe.job.company) || "unknown-company",
      appliedAt: safe.appliedAt,
      updatedAt,
      record: safe,
    });
  }));
}

async function listJsonRows(env: Env, prefix: string): Promise<Array<{ key: string; value: unknown }>> {
  const listOptions = { prefix: rowPrefix(prefix), limit: MAX_APP_LOG_LIMIT };
  const valueStore = kvListWithValuesStore(env);
  if (valueStore) {
    return (await valueStore.listWithValues(listOptions)).entries.map((entry) => ({
      key: parseRowKey(prefix, entry.name),
      value: parseJsonLogEntry(entry.value),
    }));
  }

  const listed = await jobStateKv(env).list(listOptions);
  return Promise.all(listed.keys.map(async (key) => ({
    key: parseRowKey(prefix, key.name),
    value: await jobStateKv(env).get(key.name, "json"),
  })));
}

async function replaceJsonRows(env: Env, prefix: string, rows: Record<string, unknown>): Promise<void> {
  const existing = await jobStateKv(env).list({ prefix: rowPrefix(prefix), limit: MAX_APP_LOG_LIMIT });
  const nextKeys = new Set(Object.keys(rows).map((key) => rowKey(prefix, key)));
  await Promise.all(existing.keys.map((key) => nextKeys.has(key.name) ? Promise.resolve() : jobStateKv(env).delete(key.name)));
  await Promise.all(Object.entries(rows).map(([key, value]) => (
    jobStateKv(env).put(rowKey(prefix, key), JSON.stringify(value))
  )));
}

function normalizeAppliedJobRecord(key: string, value: unknown): AppliedJobRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawJob = row.job && typeof row.job === "object" ? (row.job as Partial<JobPosting>) : {};
  const job: JobPosting = {
    source: (rawJob.source as JobSource) || "greenhouse",
    company: String(rawJob.company ?? ""),
    id: String(rawJob.id ?? ""),
    title: String(rawJob.title ?? ""),
    location: String(rawJob.location ?? "Unknown"),
    url: String(rawJob.url ?? ""),
    manualEntry: rawJob.manualEntry === true,
    postedAt: typeof rawJob.postedAt === "string" ? rawJob.postedAt : undefined,
    postedAtSource: rawJob.postedAtSource,
    identifiedAt: typeof rawJob.identifiedAt === "string" ? rawJob.identifiedAt : undefined,
    detectedCountry: typeof rawJob.detectedCountry === "string" ? rawJob.detectedCountry : undefined,
    isUSLikely: typeof rawJob.isUSLikely === "boolean" || rawJob.isUSLikely === null ? rawJob.isUSLikely : null,
    matchedKeywords: Array.isArray(rawJob.matchedKeywords) ? rawJob.matchedKeywords.map(String) : [],
  };

  const nextKey = String(row.jobKey || key || jobKey(job));
  const appliedAt = typeof row.appliedAt === "string" ? row.appliedAt : nowISO();
  const interviewRounds = Array.isArray(row.interviewRounds)
    ? row.interviewRounds.map(normalizeInterviewRound).filter((item): item is InterviewRound => Boolean(item))
    : [];
  const timeline = Array.isArray(row.timeline)
    ? row.timeline.map(normalizeTimelineEvent).filter((item): item is TimelineEvent => Boolean(item))
    : baseTimelineForRecord(job, appliedAt);
  const noteRecords = normalizeNoteRecords(row.noteRecords, row.notes, appliedAt);
  const notes = summarizeNoteRecords(noteRecords) ?? (typeof row.notes === "string" ? row.notes : undefined);

  return {
    jobKey: nextKey,
    job,
    originalJobUrl: typeof row.originalJobUrl === "string" ? row.originalJobUrl : undefined,
    archivedSnapshotKey: typeof row.archivedSnapshotKey === "string" ? row.archivedSnapshotKey : undefined,
    archivedAt: typeof row.archivedAt === "string" ? row.archivedAt : undefined,
    notes,
    noteRecords,
    appliedAt,
    status: normalizeAppliedStatus(row.status),
    interviewRounds,
    timeline,
    lastStatusChangedAt: typeof row.lastStatusChangedAt === "string" ? row.lastStatusChangedAt : undefined,
  };
}

export async function loadAppliedJobs(env: Env, tenantId?: string): Promise<Record<string, AppliedJobRecord>> {
  if (tenantJobsTableEnabled()) {
    const tableRows = await loadAppliedJobsFromJobsTable(tenantId);
    if (Object.keys(tableRows).length > 0) return tableRows;
  }

  const kv = jobStateKv(env);
  const rowData = await listJsonRows(env, tenantScopedPrefix(tenantId, APPLIED_JOB_ROW_PREFIX));
  if (rowData.length) {
    const result: Record<string, AppliedJobRecord> = {};
    for (const row of rowData) {
      const record = normalizeAppliedJobRecord(row.key, row.value);
      if (record) result[record.jobKey] = record;
    }
    return result;
  }

  const tenantKey = tenantScopedKey(tenantId, APPLIED_KEY);
  const data = await kv.get(tenantKey, "json") ?? (tenantId ? await kv.get(APPLIED_KEY, "json") : null);
  if (!data || typeof data !== "object") return {};

  const result: Record<string, AppliedJobRecord> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const record = normalizeAppliedJobRecord(key, value);
    if (record) result[record.jobKey] = record;
  }

  return result;
}

function normalizeNoteRecords(raw: unknown, legacyNotes: unknown, fallbackCreatedAt: string): NoteRecord[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry, index) => normalizeNoteRecord(entry, fallbackCreatedAt, index))
      .filter((entry): entry is NoteRecord => Boolean(entry));
  }

  const legacyText = typeof legacyNotes === "string" ? legacyNotes.trim() : "";
  if (!legacyText) return [];

  // Lift pre-record notes into a single note bubble so older data stays visible
  // and editable in the record-style drawer.
  return [{
    id: "legacy-note",
    text: legacyText,
    createdAt: fallbackCreatedAt,
  }];
}

function normalizeNoteRecord(raw: unknown, fallbackCreatedAt: string, index: number): NoteRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  if (!text) return null;
  return {
    id: typeof row.id === "string" && row.id.trim() ? row.id : `note-${index}`,
    text,
    createdAt: typeof row.createdAt === "string" && row.createdAt ? row.createdAt : fallbackCreatedAt,
    updatedAt: typeof row.updatedAt === "string" && row.updatedAt ? row.updatedAt : undefined,
  };
}

function summarizeNoteRecords(records: NoteRecord[]): string | undefined {
  if (!records.length) return undefined;
  return records.map((record) => record.text.trim()).filter(Boolean).join("\n\n") || undefined;
}

export async function saveAppliedJobs(env: Env, data: Record<string, AppliedJobRecord>, tenantId?: string): Promise<void> {
  if (tenantJobsTableEnabled()) {
    await saveAppliedJobsToJobsTable(tenantId, data);
  }
  await replaceJsonRows(env, tenantScopedPrefix(tenantId, APPLIED_JOB_ROW_PREFIX), data);
  await jobStateKv(env).delete(tenantScopedKey(tenantId, APPLIED_KEY));
}

export async function saveAppliedJobsForTenant(
  env: Env,
  data: Record<string, AppliedJobRecord>,
  tenantId?: string
): Promise<void> {
  await saveAppliedJobs(env, data, tenantId);
  const inventory = await jobStateKv(env).get(
    tenantScopedKey(tenantId, INVENTORY_KEY),
    "json",
  ) as InventorySnapshot | null;
  if (!inventory || typeof inventory !== "object") {
    await jobStateKv(env).delete(tenantScopedKey(tenantId, DASHBOARD_SUMMARY_KEY));
    return;
  }

  try {
    const companiesByAts = summarizeCompaniesByAtsFromInventory(inventory);
    const dashboardPayload = await buildDashboardPayload(
      env,
      inventory,
      data,
      tenantId,
      undefined,
      companiesByAts,
      {
        inventorySource: "stored-snapshot",
        freshnessProbeSkipped: false,
        staleReason: null,
      },
    );
    const dashboardFingerprint = buildDashboardSummaryFingerprint(
      inventory,
      data,
      companiesByAts,
      {
        lastNewJobsCount: dashboardPayload.kpis.newJobsLatestRun,
        lastUpdatedJobsCount: dashboardPayload.kpis.updatedJobsLatestRun,
      },
    );
    await saveCachedDashboardPayload(env, tenantId, dashboardFingerprint, dashboardPayload);
  } catch (error) {
    console.error("[dashboard.summary] failed to refresh after applied-jobs save", error);
    await jobStateKv(env).delete(tenantScopedKey(tenantId, DASHBOARD_SUMMARY_KEY));
  }
}

export async function loadJobNotes(env: Env, tenantId?: string): Promise<Record<string, string>> {
  const kv = jobStateKv(env);
  const rowData = await listJsonRows(env, tenantScopedPrefix(tenantId, JOB_NOTE_ROW_PREFIX));
  if (rowData.length) {
    const result: Record<string, string> = {};
    for (const row of rowData) {
      const value = row.value && typeof row.value === "object" ? row.value as Record<string, unknown> : {};
      const note = typeof value.note === "string" ? value.note.trim() : "";
      const key = typeof value.jobKey === "string" ? value.jobKey : row.key;
      if (key && note) result[key] = note;
    }
    return result;
  }

  const tenantKey = tenantScopedKey(tenantId, JOB_NOTES_KEY);
  const data = await kv.get(tenantKey, "json") ?? (tenantId ? await kv.get(JOB_NOTES_KEY, "json") : null);
  if (!data || typeof data !== "object") return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const note = typeof value === "string" ? value.trim() : "";
    if (key && note) result[key] = note;
  }

  return result;
}

export async function saveJobNotes(env: Env, data: Record<string, string>, tenantId?: string): Promise<void> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const note = String(value ?? "").trim();
    if (key && note) safe[key] = note;
  }
  await replaceJsonRows(
    env,
    tenantScopedPrefix(tenantId, JOB_NOTE_ROW_PREFIX),
    Object.fromEntries(Object.entries(safe).map(([key, note]) => [key, { jobKey: key, note }]))
  );
  await jobStateKv(env).delete(tenantScopedKey(tenantId, JOB_NOTES_KEY));
}

export async function loadEmailWebhookConfig(env: Env): Promise<EmailWebhookConfig | null> {
  const raw = await configStoreKv(env).get(EMAIL_WEBHOOK_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EmailWebhookConfig;
  } catch {
    return null;
  }
}

export async function saveEmailWebhookConfig(env: Env, config: Partial<EmailWebhookConfig>): Promise<void> {
  const existing = await loadEmailWebhookConfig(env) ?? { webhookUrl: "", sharedSecret: "" };
  const next: EmailWebhookConfig = {
    webhookUrl: typeof config.webhookUrl === "string" ? config.webhookUrl.trim() : existing.webhookUrl,
    sharedSecret: typeof config.sharedSecret === "string" ? config.sharedSecret.trim() : existing.sharedSecret,
  };
  await configStoreKv(env).put(EMAIL_WEBHOOK_CONFIG_KEY, JSON.stringify(next));
}

export async function loadDetectionCache(env: Env, company: string): Promise<DetectionCacheRecord | null> {
  const data = await atsCacheKv(env).get(atsCacheKey(company), "json");
  return data && typeof data === "object" ? (data as DetectionCacheRecord) : null;
}

export async function saveDetectionCache(env: Env, company: string, record: DetectionCacheRecord, ttlSeconds: number): Promise<void> {
  const safeTtl = Math.max(60, Math.floor(ttlSeconds || 60));
  await atsCacheKv(env).put(atsCacheKey(company), JSON.stringify(record), { expirationTtl: safeTtl });
}

export async function loadProtectedDiscovery(env: Env, company: string): Promise<ProtectedDiscoveryRecord | null> {
  const data = await configStoreKv(env).get(protectedDiscoveryKey(company), "json");
  return data && typeof data === "object" ? (data as ProtectedDiscoveryRecord) : null;
}

export async function saveProtectedDiscovery(env: Env, record: ProtectedDiscoveryRecord): Promise<void> {
  await configStoreKv(env).put(protectedDiscoveryKey(record.company), JSON.stringify(record));
}

export async function deleteProtectedDiscovery(env: Env, company: string): Promise<void> {
  await configStoreKv(env).delete(protectedDiscoveryKey(company));
}

export async function clearATSCache(env: Env, companies: CompanyInput[]): Promise<void> {
  await Promise.all(companies.map((company) => atsCacheKv(env).delete(atsCacheKey(company.company))));
}

export async function deleteKvPrefix(namespace: KVNamespace, prefix: string): Promise<void> {
  let cursor: string | undefined = undefined;

  do {
    const listed = await namespace.list({ prefix, cursor });
    const page = listed as {
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    };

    if (page.keys.length) {
      await Promise.all(page.keys.map((entry) => namespace.delete(entry.name)));
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

function companyScanOverridesKey(tenantId: string | undefined): string {
  return tenantScopedKey(tenantId, COMPANY_SCAN_OVERRIDES_KEY);
}

export async function loadCompanyScanOverrides(env: Env, tenantId?: string): Promise<Record<string, CompanyScanOverride>> {
  const data = await configStoreKv(env).get(companyScanOverridesKey(tenantId), "json");
  if (!data || typeof data !== "object") return {};

  const result: Record<string, CompanyScanOverride> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const company = String(row.company ?? "").trim();
    if (!company) continue;
    result[key] = {
      company,
      paused: row.paused === true,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowISO(),
      updatedByUserId: typeof row.updatedByUserId === "string" ? row.updatedByUserId : undefined,
    };
  }
  return result;
}

export async function setCompanyScanOverride(
  env: Env,
  input: { tenantId?: string; company: string; paused: boolean; updatedByUserId?: string }
): Promise<CompanyScanOverride> {
  const company = input.company.trim();
  if (!company) throw new Error("company is required");

  const key = slugify(company);
  const overrides = await loadCompanyScanOverrides(env, input.tenantId);
  const override: CompanyScanOverride = {
    company,
    paused: input.paused,
    updatedAt: nowISO(),
    updatedByUserId: input.updatedByUserId,
  };

  if (input.paused) {
    overrides[key] = override;
  } else {
    delete overrides[key];
  }

  await configStoreKv(env).put(companyScanOverridesKey(input.tenantId), JSON.stringify(overrides));
  return override;
}

export async function setCompanyScanOverrides(
  env: Env,
  input: { tenantId?: string; companies: string[]; paused: boolean; updatedByUserId?: string }
): Promise<Record<string, CompanyScanOverride>> {
  const overrides = await loadCompanyScanOverrides(env, input.tenantId);
  const now = nowISO();

  for (const rawCompany of input.companies) {
    const company = rawCompany.trim();
    if (!company) continue;
    const key = slugify(company);
    if (input.paused) {
      overrides[key] = {
        company,
        paused: true,
        updatedAt: now,
        updatedByUserId: input.updatedByUserId,
      };
    } else {
      delete overrides[key];
    }
  }

  await configStoreKv(env).put(companyScanOverridesKey(input.tenantId), JSON.stringify(overrides));
  return overrides;
}

export async function loadActiveRunLock(env: Env): Promise<ActiveRunLock | null> {
  const raw = await jobStateKv(env).get(ACTIVE_RUN_LOCK_KEY, "json");
  if (!raw || typeof raw !== "object") return null;
  const lock = raw as Partial<ActiveRunLock>;
  if (!lock.runId || !lock.triggerType || !lock.startedAt || !lock.expiresAt) return null;
  return {
    runId: String(lock.runId),
    triggerType: lock.triggerType === "scheduled" ? "scheduled" : "manual",
    startedAt: String(lock.startedAt),
    expiresAt: String(lock.expiresAt),
    lastHeartbeatAt: typeof lock.lastHeartbeatAt === "string" ? lock.lastHeartbeatAt : undefined,
    totalCompanies: typeof lock.totalCompanies === "number" ? lock.totalCompanies : undefined,
    fetchedCompanies: typeof lock.fetchedCompanies === "number" ? lock.fetchedCompanies : undefined,
    currentCompany: typeof lock.currentCompany === "string" ? lock.currentCompany : undefined,
    currentSource: typeof lock.currentSource === "string" ? lock.currentSource : undefined,
    currentStage: typeof lock.currentStage === "string" ? lock.currentStage : undefined,
    currentPage: typeof lock.currentPage === "number" && Number.isFinite(lock.currentPage) ? lock.currentPage : undefined,
    lastEvent: typeof lock.lastEvent === "string" ? lock.lastEvent : undefined,
  };
}

function isRunLockExpired(lock: ActiveRunLock): boolean {
  const expiresAtMs = new Date(lock.expiresAt).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

export function isRunLockStale(lock: ActiveRunLock): boolean {
  const heartbeatMs = new Date(lock.lastHeartbeatAt ?? lock.startedAt).getTime();
  if (!Number.isFinite(heartbeatMs)) return true;
  return heartbeatMs <= Date.now() - ACTIVE_RUN_STALE_AFTER_SECONDS * 1000;
}

export class ActiveRunOwnershipError extends Error {
  runId: string;
  activeRunId: string | null;

  constructor(runId: string, activeRunId: string | null) {
    super(activeRunId
      ? `Run ${runId} no longer owns the active lock. Active run is ${activeRunId}.`
      : `Run ${runId} no longer owns the active lock.`);
    this.name = "ActiveRunOwnershipError";
    this.runId = runId;
    this.activeRunId = activeRunId;
  }
}

export function isActiveRunOwnershipError(error: unknown): error is ActiveRunOwnershipError {
  return error instanceof ActiveRunOwnershipError
    || (typeof error === "object" && error !== null && (error as Error).name === "ActiveRunOwnershipError");
}

type AtomicActiveRunLockStore = {
  putActiveRunLockIfAvailable: (
    key: string,
    value: string,
    options: {
      expirationTtl: number;
      lastHeartbeatAt: string;
      runId: string;
      staleAfterSeconds: number;
    }
  ) => Promise<boolean>;
  deleteActiveRunLockIfOwned: (key: string, runId: string) => Promise<boolean>;
};

type AtomicPutIfAbsentStore = {
  putIfAbsent: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<boolean>;
};

type KvListWithValuesStore = {
  listWithValues: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{
    entries: Array<{ name: string; value: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
};

export type EmailSendAttempt = {
  runId: string;
  status: "sending" | "sent" | "failed";
  reservedAt: string;
  updatedAt: string;
  tenantId?: string;
  error?: string;
};

function atomicActiveRunLockStore(env: Env): AtomicActiveRunLockStore | null {
  const kv = jobStateKv(env) as KVNamespace & Partial<AtomicActiveRunLockStore>;
  if (
    typeof kv.putActiveRunLockIfAvailable === "function"
    && typeof kv.deleteActiveRunLockIfOwned === "function"
  ) {
    return kv as KVNamespace & AtomicActiveRunLockStore;
  }
  return null;
}

function atomicPutIfAbsentStore(env: Env): AtomicPutIfAbsentStore | null {
  const kv = jobStateKv(env) as KVNamespace & Partial<AtomicPutIfAbsentStore>;
  return typeof kv.putIfAbsent === "function" ? kv as KVNamespace & AtomicPutIfAbsentStore : null;
}

function kvListWithValuesStore(env: Env): KvListWithValuesStore | null {
  const kv = jobStateKv(env) as KVNamespace & Partial<KvListWithValuesStore>;
  return typeof kv.listWithValues === "function" ? kv as KVNamespace & KvListWithValuesStore : null;
}

function parseJsonLogEntry(value: unknown): AppLogEntry | null {
  if (value && typeof value === "object") return value as AppLogEntry;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AppLogEntry) : null;
  } catch {
    return null;
  }
}

function emailSendAttemptKey(runId: string, tenantId?: string): string {
  return tenantScopedKey(tenantId, `${EMAIL_ATTEMPT_PREFIX}${runId}`);
}

export async function loadEmailSendAttempt(env: Env, runId: string, tenantId?: string): Promise<EmailSendAttempt | null> {
  const raw = await jobStateKv(env).get(emailSendAttemptKey(runId, tenantId), "json");
  if (!raw || typeof raw !== "object") return null;
  const attempt = raw as Partial<EmailSendAttempt>;
  if (!attempt.runId || !attempt.status || !attempt.reservedAt || !attempt.updatedAt) return null;
  return {
    runId: String(attempt.runId),
    status: attempt.status === "sent" || attempt.status === "failed" ? attempt.status : "sending",
    reservedAt: String(attempt.reservedAt),
    updatedAt: String(attempt.updatedAt),
    tenantId: typeof attempt.tenantId === "string" ? attempt.tenantId : undefined,
    error: typeof attempt.error === "string" ? attempt.error : undefined,
  };
}

export async function reserveEmailSendAttempt(
  env: Env,
  runId: string,
  tenantId?: string
): Promise<{ reserved: true; attempt: EmailSendAttempt } | { reserved: false; attempt: EmailSendAttempt | null }> {
  const now = nowISO();
  const attempt: EmailSendAttempt = {
    runId,
    status: "sending",
    reservedAt: now,
    updatedAt: now,
    tenantId,
  };
  const key = emailSendAttemptKey(runId, tenantId);
  const atomicStore = atomicPutIfAbsentStore(env);
  if (atomicStore) {
    const reserved = await atomicStore.putIfAbsent(key, JSON.stringify(attempt), {
      expirationTtl: APP_LOG_TTL_SECONDS,
    });
    if (reserved) return { reserved: true, attempt };
    return { reserved: false, attempt: await loadEmailSendAttempt(env, runId, tenantId) };
  }

  const existing = await loadEmailSendAttempt(env, runId, tenantId);
  if (existing) return { reserved: false, attempt: existing };
  await jobStateKv(env).put(key, JSON.stringify(attempt), { expirationTtl: APP_LOG_TTL_SECONDS });
  return { reserved: true, attempt };
}

export async function updateEmailSendAttempt(
  env: Env,
  runId: string,
  status: "sent" | "failed",
  input: { tenantId?: string; error?: string } = {}
): Promise<void> {
  const existing = await loadEmailSendAttempt(env, runId, input.tenantId);
  const now = nowISO();
  const attempt: EmailSendAttempt = {
    runId,
    status,
    reservedAt: existing?.reservedAt ?? now,
    updatedAt: now,
    tenantId: input.tenantId,
    error: input.error,
  };
  await jobStateKv(env).put(emailSendAttemptKey(runId, input.tenantId), JSON.stringify(attempt), {
    expirationTtl: APP_LOG_TTL_SECONDS,
  });
}

export async function acquireActiveRunLock(
  env: Env,
  input: { runId: string; triggerType: "manual" | "scheduled" }
): Promise<
  | { ok: true; lock: ActiveRunLock; recoveredLock?: ActiveRunLock }
  | { ok: false; lock: ActiveRunLock }
> {
  const startedAt = nowISO();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ACTIVE_RUN_LOCK_TTL_SECONDS;
  const lock: ActiveRunLock = {
    runId: input.runId,
    triggerType: input.triggerType,
    startedAt,
    expiresAt: new Date(Date.now() + ACTIVE_RUN_LOCK_TTL_SECONDS * 1000).toISOString(),
    expiresAtEpoch,
    lastHeartbeatAt: startedAt,
    totalCompanies: undefined,
    fetchedCompanies: 0,
    currentStage: "run_started",
    lastEvent: `${input.triggerType}_run_started`,
  };

  const atomicStore = atomicActiveRunLockStore(env);
  if (atomicStore) {
    const acquired = await atomicStore.putActiveRunLockIfAvailable(
      ACTIVE_RUN_LOCK_KEY,
      JSON.stringify(lock),
      {
        expirationTtl: ACTIVE_RUN_LOCK_TTL_SECONDS,
        lastHeartbeatAt: startedAt,
        runId: input.runId,
        staleAfterSeconds: ACTIVE_RUN_STALE_AFTER_SECONDS,
      }
    );
    if (acquired) {
      return {
        ok: true,
        lock,
        recoveredLock: undefined,
      };
    }

    const existing = await loadActiveRunLock(env);
    if (existing) return { ok: false, lock: existing };
    return acquireActiveRunLock(env, input);
  }

  const existing = await loadActiveRunLock(env);
  if (existing && !isRunLockExpired(existing) && !isRunLockStale(existing) && existing.runId !== input.runId) {
    return { ok: false, lock: existing };
  }

  await jobStateKv(env).put(ACTIVE_RUN_LOCK_KEY, JSON.stringify(lock), {
    expirationTtl: ACTIVE_RUN_LOCK_TTL_SECONDS,
  });

  return {
    ok: true,
    lock,
    recoveredLock: existing && existing.runId !== input.runId ? existing : undefined,
  };
}

export async function releaseActiveRunLock(env: Env, runId: string): Promise<void> {
  const atomicStore = atomicActiveRunLockStore(env);
  if (atomicStore) {
    await atomicStore.deleteActiveRunLockIfOwned(ACTIVE_RUN_LOCK_KEY, runId);
    return;
  }

  const existing = await loadActiveRunLock(env);
  if (!existing || existing.runId !== runId) return;
  await jobStateKv(env).delete(ACTIVE_RUN_LOCK_KEY);
}

export async function clearActiveRunLock(env: Env): Promise<void> {
  await jobStateKv(env).delete(ACTIVE_RUN_LOCK_KEY);
}

function runAbortKey(runId: string): string {
  return `${RUN_ABORT_PREFIX}${runId}`;
}

export async function requestRunAbort(env: Env, runId: string): Promise<void> {
  // Keep abort requests alive long enough for queued orchestrator events or
  // already-fanned-out workers to observe the stop signal.
  await jobStateKv(env).put(runAbortKey(runId), JSON.stringify({
    runId,
    requestedAt: nowISO(),
  }), {
    expirationTtl: 60 * 60,
  });
}

export async function isRunAbortRequested(env: Env, runId: string): Promise<boolean> {
  return Boolean(await jobStateKv(env).get(runAbortKey(runId)));
}

export async function clearRunAbortRequest(env: Env, runId: string): Promise<void> {
  await jobStateKv(env).delete(runAbortKey(runId));
}

export async function ensureActiveRunOwnership(env: Env, runId: string): Promise<void> {
  if (await isRunAbortRequested(env, runId)) {
    throw new ActiveRunOwnershipError(runId, null);
  }
  const existing = await loadActiveRunLock(env);
  if (!existing || existing.runId !== runId || isRunLockExpired(existing)) {
    throw new ActiveRunOwnershipError(runId, existing?.runId ?? null);
  }
}

export async function heartbeatActiveRun(
  env: Env,
  runId: string,
  patch?: Partial<Pick<ActiveRunLock, "totalCompanies" | "fetchedCompanies" | "currentCompany" | "currentSource" | "currentStage" | "currentPage" | "lastEvent">>
): Promise<ActiveRunLock> {
  const existing = await loadActiveRunLock(env);
  if (!existing || existing.runId !== runId || isRunLockExpired(existing)) {
    throw new ActiveRunOwnershipError(runId, existing?.runId ?? null);
  }

  const heartbeatAt = nowISO();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ACTIVE_RUN_LOCK_TTL_SECONDS;
  const next: ActiveRunLock = {
    ...existing,
    ...patch,
    lastHeartbeatAt: heartbeatAt,
    expiresAt: new Date(Date.now() + ACTIVE_RUN_LOCK_TTL_SECONDS * 1000).toISOString(),
    expiresAtEpoch,
  };

  const atomicStore = atomicActiveRunLockStore(env);
  if (atomicStore) {
    const updated = await atomicStore.putActiveRunLockIfAvailable(
      ACTIVE_RUN_LOCK_KEY,
      JSON.stringify(next),
      {
        expirationTtl: ACTIVE_RUN_LOCK_TTL_SECONDS,
        lastHeartbeatAt: heartbeatAt,
        runId,
        staleAfterSeconds: ACTIVE_RUN_STALE_AFTER_SECONDS,
      }
    );
    if (!updated) {
      const activeRun = await loadActiveRunLock(env);
      throw new ActiveRunOwnershipError(runId, activeRun?.runId ?? null);
    }
  } else {
    await jobStateKv(env).put(ACTIVE_RUN_LOCK_KEY, JSON.stringify(next), {
      expirationTtl: ACTIVE_RUN_LOCK_TTL_SECONDS,
    });
  }

  return next;
}

function normalizeLogLevel(value: unknown): AppLogLevel {
  const level = String(value ?? "info").trim().toLowerCase();
  return level === "warn" || level === "error" ? (level as AppLogLevel) : "info";
}

export async function recordAppLog(
  env: Env,
  entry: Omit<AppLogEntry, "id" | "timestamp"> & { timestamp?: string }
): Promise<AppLogEntry> {
  const timestamp = entry.timestamp ?? nowISO();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safe: AppLogEntry = {
    id,
    event: String(entry.event ?? "app_event"),
    timestamp,
    level: normalizeLogLevel(entry.level),
    message: String(entry.message ?? ""),
    route: entry.route,
    tenantId: entry.tenantId,
    company: entry.company,
    source: entry.source,
    runId: entry.runId,
    details: entry.details,
  };
  const logKey = tenantScopedKey(entry.tenantId, `${APP_LOG_PREFIX}${timestamp}:${id}`);
  await jobStateKv(env).put(logKey, JSON.stringify(safe), { expirationTtl: APP_LOG_TTL_SECONDS });
  return safe;
}

export async function recordErrorLog(
  env: Env,
  entry: Omit<AppLogEntry, "id" | "timestamp" | "level"> & { timestamp?: string }
): Promise<AppLogEntry> {
  return recordAppLog(env, { ...entry, level: "error" });
}

export async function listAppLogs(
  env: Env,
  options?: {
    tenantId?: string;
    tenantIdFilter?: string;
    allTenants?: boolean;
    event?: string;
    query?: string;
    level?: string;
    route?: string;
    company?: string;
    companies?: string[];
    source?: string;
    runId?: string;
    limit?: number;
    compact?: boolean;
  }
): Promise<AppLogEntry[]> {
  const tenantIdFilter = String(options?.tenantIdFilter ?? "").trim().toLowerCase();
  const event = String(options?.event ?? "").trim().toLowerCase();
  const query = String(options?.query ?? "").trim().toLowerCase();
  const level = String(options?.level ?? "").trim().toLowerCase();
  const route = String(options?.route ?? "").trim().toLowerCase();
  const company = String(options?.company ?? "").trim().toLowerCase();
  const companies = Array.isArray(options?.companies)
    ? options.companies.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  const source = String(options?.source ?? "").trim().toLowerCase();
  const runId = String(options?.runId ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(MAX_APP_LOG_LIMIT, Number(options?.limit ?? DEFAULT_APP_LOG_LIMIT) || DEFAULT_APP_LOG_LIMIT));
  const listOptions = {
    prefix: options?.allTenants ? "tenant:" : tenantScopedPrefix(options?.tenantId, APP_LOG_PREFIX),
    limit: MAX_APP_LOG_LIMIT,
  };
  const valueStore = kvListWithValuesStore(env);
  const rows = valueStore
    ? (await valueStore.listWithValues(listOptions)).entries
      .filter((entry) => options?.allTenants ? entry.name.includes(APP_LOG_PREFIX) : true)
      .map((entry) => parseJsonLogEntry(entry.value))
    : await Promise.all(
      (await jobStateKv(env).list(listOptions)).keys.map(async (key) => {
        if (options?.allTenants && !key.name.includes(APP_LOG_PREFIX)) return null;
        const value = await jobStateKv(env).get(key.name, "json");
        return parseJsonLogEntry(value);
      })
    );

  const filtered = rows
    .filter((row): row is AppLogEntry => Boolean(row))
    .filter((row) => (event ? row.event.toLowerCase().includes(event) : true))
    .filter((row) => (level ? row.level.toLowerCase() === level : true))
    .filter((row) => (route ? String(row.route ?? "").toLowerCase().includes(route) : true))
    .filter((row) => (tenantIdFilter ? String(row.tenantId ?? "").toLowerCase().includes(tenantIdFilter) : true))
    .filter((row) => {
      const rowCompany = String(row.company ?? "").toLowerCase();
      if (companies.length) return companies.some((value) => rowCompany === value);
      if (company) return rowCompany.includes(company);
      return true;
    })
    .filter((row) => (source ? String(row.source ?? "").toLowerCase().includes(source) : true))
    .filter((row) => (runId ? String(row.runId ?? "").toLowerCase().includes(runId) : true))
    .filter((row) => {
      if (!query) return true;
      const haystack = [
        row.event,
        row.message,
        row.route ?? "",
        row.company ?? "",
        row.source ?? "",
        row.runId ?? "",
        JSON.stringify(row.details ?? {}),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const compacted = options?.compact === false ? filtered : compactAppLogs(filtered);
  return compacted.slice(0, limit);
}

const NOISY_COMPACT_EVENTS = new Set([
  "inventory_build_started",
  "inventory_build_completed",
  "raw_scan_counts",
  "new_jobs_evaluated",
  "updated_jobs_evaluated",
  "email_attempt",
  "email_send_started",
  "company_scan_started",
]);

const COMPANY_SUMMARY_EVENTS = new Set([
  "company_scan_completed",
  "company_scan_failed",
  "company_scan_timeout",
  "company_scan_skipped",
  "company_scan_aborted",
  "aws_company_scan_failed",
]);

const RUN_START_EVENTS = new Set([
  "manual_run_started",
  "scheduled_run_started",
  "aws_run_fanout_started",
]);

const RUN_FINAL_EVENTS = new Set([
  "run_completed",
  "manual_run_completed",
  "scheduled_run_completed",
  "aws_run_finalized",
]);

function compactAppLogs(rows: AppLogEntry[]): AppLogEntry[] {
  const output: AppLogEntry[] = [];
  const companyRows = new Map<string, AppLogEntry>();

  for (const row of rows) {
    if (NOISY_COMPACT_EVENTS.has(row.event)) continue;
    if (RUN_START_EVENTS.has(row.event)) {
      output.push(makeRunStartSummary(row));
      continue;
    }
    if (COMPANY_SUMMARY_EVENTS.has(row.event)) {
      const key = [
        row.runId || row.timestamp.slice(0, 13),
        row.company || "unknown-company",
        row.source || "unknown-source",
      ].join(":");
      const existing = companyRows.get(key);
      if (!existing || existing.timestamp < row.timestamp) {
        companyRows.set(key, makeCompanyLogSummary(row));
      }
      continue;
    }
    if (RUN_FINAL_EVENTS.has(row.event)) {
      output.push(makeRunFinalSummary(row));
    }
  }

  output.push(...companyRows.values());

  return output.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function makeRunStartSummary(row: AppLogEntry): AppLogEntry {
  const details = row.details ?? {};
  const companies = Array.isArray(details.companies) ? details.companies.map(String) : [];
  return {
    ...row,
    id: `run-start-${row.runId || row.id}`,
    event: "scan_started",
    message: companies.length ? `Scan started for ${companies.length} companies` : "Scan started",
    route: "logs/compact",
    details: {
      runId: row.runId ?? null,
      totalCompanies: companies.length || undefined,
    },
  };
}

function makeCompanyLogSummary(row: AppLogEntry): AppLogEntry {
  const details = row.details ?? {};
  const fetchStatus = String(details.fetchStatus || (
    row.event.includes("failed") || row.event.includes("timeout") ? "failed" :
      row.event.includes("skipped") || row.event.includes("aborted") ? "skipped" :
        "fetched"
  ));
  const fetched = Number(details.fetchedCount || 0);
  const matched = Number(details.matchedCount || details.totalJobsMatched || 0);
  const newJobs = Number(details.newJobsCount || details.newJobs || 0);
  const updatedJobs = Number(details.updatedJobsCount || details.updatedJobs || 0);
  const company = row.company || "Unknown company";

  return {
    ...row,
    id: `company-summary-${row.runId || row.id}-${String(row.company || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    event: "company_scan_summary",
    level: row.level === "error" ? "error" : fetchStatus === "failed" || fetchStatus === "skipped" ? "warn" : "info",
    message: `${company}: ${fetchStatus}, ${fetched} fetched, ${matched} matched, ${newJobs} new, ${updatedJobs} updated`,
    route: "logs/compact",
    details: {
      fetchStatus,
      fetchedCount: fetched,
      matchedCount: matched,
      newJobsCount: newJobs,
      updatedJobsCount: updatedJobs,
      updatedJobs: Array.isArray(details.updatedJobs) ? details.updatedJobs : [],
      excludedTitleCount: Number(details.excludedTitleCount || 0),
      excludedGeographyCount: Number(details.excludedGeographyCount || 0),
      discardedCount: Number(details.discardedCount || 0),
      discardedJobs: [],
      groupedDuplicateCount: Number(details.groupedDuplicateCount || 0),
      suppressedSeenCount: Number(details.suppressedSeenCount || 0),
      fetchDurationMs: Number(details.fetchDurationMs || details.elapsedMs || 0),
      failureReason: typeof details.failureReason === "string" ? details.failureReason : undefined,
      progress: details.progress,
    },
  };
}

function makeRunFinalSummary(row: AppLogEntry): AppLogEntry {
  const details = row.details ?? {};
  const totalNewMatches = Number(details.totalNewMatches ?? details.totalNew ?? details.newJobCount ?? 0);
  const totalUpdatedMatches = Number(details.totalUpdatedMatches ?? details.totalUpdated ?? details.updatedJobCount ?? 0);
  return {
    ...row,
    id: `run-final-${row.runId || row.id}`,
    event: "inventory_final_built",
    message: `Inventory final built with ${Number(details.totalMatched || 0)} matches`,
    route: "logs/compact",
    details: {
      totalMatched: Number(details.totalMatched || 0),
      totalNewMatches,
      totalUpdatedMatches,
      totalFetched: Number(details.totalFetched || 0),
      emailStatus: typeof details.emailStatus === "string" ? details.emailStatus : "skipped",
      emailSkipReason: typeof details.emailSkipReason === "string" ? details.emailSkipReason : null,
      emailError: typeof details.emailError === "string" ? details.emailError : null,
    },
  };
}

function savedFiltersKey(tenantId: string | undefined): string {
  return tenantScopedKey(tenantId, SAVED_FILTERS_KEY);
}

export async function listSavedFilters(
  env: Env,
  tenantId?: string,
  scope?: SavedFilterScope
): Promise<SavedFilterRecord[]> {
  const rows = await configStoreKv(env).get(savedFiltersKey(tenantId), "json");
  const filters = Array.isArray(rows) ? rows as SavedFilterRecord[] : [];
  return filters
    .filter((filter) => !scope || filter.scope === scope)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveSavedFilter(
  env: Env,
  input: {
    tenantId?: string;
    userId: string;
    filterId?: string;
    name: string;
    scope: SavedFilterScope;
    filter: Record<string, unknown>;
    isDefault: boolean;
  }
): Promise<string> {
  const rows = await listSavedFilters(env, input.tenantId);
  const now = nowISO();
  const id = input.filterId?.trim() || crypto.randomUUID();
  const duplicate = rows.find((row) => row.scope === input.scope && row.name.trim().toLowerCase() === input.name.trim().toLowerCase() && row.id !== id);
  if (duplicate) {
    throw new Error(`A saved filter named "${input.name}" already exists for ${input.scope}.`);
  }

  const nextRows = rows
    .filter((row) => row.id !== id)
    .map((row) => input.isDefault && row.scope === input.scope ? { ...row, isDefault: false, updatedAt: now } : row);

  const existing = rows.find((row) => row.id === id);
  nextRows.push({
    id,
    tenantId: input.tenantId,
    name: input.name.trim(),
    scope: input.scope,
    filter: input.filter,
    createdByUserId: input.userId,
    isDefault: input.isDefault,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  await configStoreKv(env).put(savedFiltersKey(input.tenantId), JSON.stringify(nextRows));
  return id;
}

export async function deleteSavedFilter(env: Env, tenantId: string | undefined, filterId: string): Promise<boolean> {
  const rows = await listSavedFilters(env, tenantId);
  if (!rows.some((row) => row.id === filterId)) return false;
  const nextRows = rows.filter((row) => row.id !== filterId);
  await configStoreKv(env).put(savedFiltersKey(tenantId), JSON.stringify(nextRows));
  return true;
}
