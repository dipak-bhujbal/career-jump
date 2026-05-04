import { d1Db } from "./bindings";
import { analyzeJobLocation, hyphenSlug, jobKey, jobStableFingerprint, normalizeText, nowISO, slugify } from "./utils";
import type { AppLogEntry, AppliedJobRecord, Env, InventorySnapshot, JobPosting, MatchDecisionRecord, MatchDecisionSummary, RuntimeConfig, SavedFilterRecord, SavedFilterScope, TrendPoint } from "../types";

export type AuthenticatedTenantContext = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
};

type D1TenantConfigRow = {
  companies_json: string;
  jobtitles_json: string;
  created_at: string;
};

type D1RunSnapshot = {
  totalFetched: number;
  totalMatched: number;
  totalNew: number;
  totalUpdated: number;
};

type D1TenantInventoryStateRow = {
  inventory_json: string;
  trend_json: string;
  last_new_jobs_count: number;
  last_new_job_keys_json: string;
  last_updated_jobs_count: number;
  last_updated_job_keys_json: string;
};

type D1TenantAppliedStateRow = {
  applied_jobs_json: string;
};

type D1TenantFirstSeenRow = {
  first_seen_at: string;
};

type D1TenantSeenMarkerRow = {
  seen_key: string;
  seen_at: string;
};

type D1AppLogRow = {
  id: string;
  tenant_id: string | null;
  run_id: string | null;
  level: string;
  event: string;
  route: string | null;
  company_name: string | null;
  source: string | null;
  message: string;
  details_json: string | null;
  created_at: string;
};

type D1SavedFilterRow = {
  id: string;
  tenant_id: string;
  name: string;
  scope: SavedFilterScope;
  filter_json: string;
  created_by_user_id: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
};

type D1CanonicalRoleRow = {
  id: string;
  fingerprint: string;
  first_seen_at: string;
};

type D1MatchDecisionRow = {
  id: string;
  tenant_id: string;
  run_id: string;
  decision_type: MatchDecisionRecord["decisionType"];
  explanation_json: string;
  created_at: string;
};

type MatchDecisionType =
  | "included"
  | "excluded_title"
  | "excluded_geography"
  | "grouped_duplicate"
  | "suppressed_seen"
  | "suppressed_emailed";

function decisionReason(explanation: Record<string, unknown>, decisionType: MatchDecisionType): string {
  const explicit = typeof explanation.reason === "string" ? explanation.reason.trim() : "";
  if (explicit) return explicit;

  switch (decisionType) {
    case "included":
      return "Title matched the configured rules and location passed the US filter.";
    case "excluded_title":
      return "Title did not satisfy the configured matching rules.";
    case "excluded_geography":
      return "Location resolved as non-US for the US-only inventory.";
    case "grouped_duplicate":
      return "Job was grouped under an equivalent fingerprint in this run.";
    case "suppressed_seen":
      return "Job was already seen earlier for this tenant.";
    case "suppressed_emailed":
      return "Job was already included in an earlier notification flow.";
    default:
      return "Decision recorded.";
  }
}

function explanationCompany(explanation: Record<string, unknown>): string {
  return String(explanation.company ?? "").trim() || "Unknown company";
}

function explanationSource(explanation: Record<string, unknown>): string {
  return String(explanation.source ?? "").trim() || "unknown";
}

function exampleTitle(explanation: Record<string, unknown>): string {
  return String(explanation.title ?? "").trim() || "Untitled job";
}

function titleCaseFromEmail(email: string): string {
  const local = email.split("@")[0] || "user";
  const words = local.replace(/[._-]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || "User";
}

function tenantNameFromEmail(email: string): string {
  const base = titleCaseFromEmail(email);
  return `${base} Workspace`;
}

function defaultTenantEmail(env: Env): string {
  return env.DEFAULT_TENANT_EMAIL?.trim()
    || (env.APP_ENV === "dev" ? "local-dev@career-jump.local" : "system@career-jump.local");
}

function accessEmail(request: Request): string | null {
  return request.headers.get("cf-access-authenticated-user-email")
    || request.headers.get("Cf-Access-Authenticated-User-Email")
    || null;
}

function accessUserId(request: Request): string | null {
  return request.headers.get("cf-access-authenticated-user-id")
    || request.headers.get("Cf-Access-Authenticated-User-Id")
    || null;
}

export function db(env: Env): D1Database {
  return d1Db(env);
}

export async function healthcheckDb(env: Env): Promise<boolean> {
  const result = await db(env).prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return result?.ok === 1;
}

export async function ensureTenantContextForEmail(
  env: Env,
  email: string,
  displayName?: string,
  providerUserId?: string | null
): Promise<AuthenticatedTenantContext> {
  const normalizedEmail = email.trim().toLowerCase();
  const safeDisplayName = (displayName || titleCaseFromEmail(normalizedEmail)).trim() || "User";
  const existingMembership = await db(env).prepare(`
    SELECT
      u.id AS userId,
      t.id AS tenantId,
      u.email AS email,
      COALESCE(u.display_name, '') AS displayName
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE u.email = ?
    ORDER BY
      CASE tm.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        ELSE 3
      END,
      t.created_at ASC
    LIMIT 1
  `).bind(normalizedEmail).first<{
    userId: string;
    tenantId: string;
    email: string;
    displayName: string;
  }>();

  if (existingMembership?.userId && existingMembership?.tenantId) {
    await db(env).prepare(`
      UPDATE users
      SET last_login_at = ?, display_name = COALESCE(NULLIF(?, ''), display_name)
      WHERE id = ?
    `).bind(nowISO(), safeDisplayName, existingMembership.userId).run();

    return {
      userId: existingMembership.userId,
      tenantId: existingMembership.tenantId,
      email: existingMembership.email,
      displayName: existingMembership.displayName || safeDisplayName,
    };
  }

  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const timestamp = nowISO();
  const slugBase = slugify(normalizedEmail.split("@")[0] || "tenant") || "tenant";
  const tenantSlug = `${slugBase}-${tenantId.slice(0, 8)}`;

  await db(env).batch([
    db(env).prepare(`
      INSERT INTO users (id, email, auth_provider, provider_user_id, display_name, created_at, last_login_at)
      VALUES (?, ?, 'cloudflare-access', ?, ?, ?, ?)
    `).bind(userId, normalizedEmail, providerUserId || null, safeDisplayName, timestamp, timestamp),
    db(env).prepare(`
      INSERT INTO tenants (id, slug, name, owner_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).bind(tenantId, tenantSlug, tenantNameFromEmail(normalizedEmail), userId, timestamp, timestamp),
    db(env).prepare(`
      INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at, updated_at)
      VALUES (?, ?, 'owner', ?, ?)
    `).bind(tenantId, userId, timestamp, timestamp),
  ]);

  return {
    userId,
    tenantId,
    email: normalizedEmail,
    displayName: safeDisplayName,
  };
}

export async function resolveRequestTenantContext(request: Request, env: Env): Promise<AuthenticatedTenantContext> {
  const email = accessEmail(request) || defaultTenantEmail(env);
  return ensureTenantContextForEmail(env, email, titleCaseFromEmail(email), accessUserId(request));
}

export async function resolveSystemTenantContext(env: Env): Promise<AuthenticatedTenantContext> {
  const email = defaultTenantEmail(env);
  return ensureTenantContextForEmail(env, email, env.APP_NAME || "Career Jump");
}

export async function loadTenantConfigFromD1(env: Env, tenantId: string): Promise<RuntimeConfig | null> {
  const row = await db(env).prepare(`
    SELECT companies_json, jobtitles_json, created_at
    FROM tenant_configs
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY version DESC
    LIMIT 1
  `).bind(tenantId).first<D1TenantConfigRow>();

  if (!row) return null;

  return {
    companies: JSON.parse(row.companies_json),
    jobtitles: JSON.parse(row.jobtitles_json),
    updatedAt: row.created_at,
  } as RuntimeConfig;
}

export async function saveTenantConfigToD1(
  env: Env,
  tenantId: string,
  config: RuntimeConfig,
  userId?: string
): Promise<void> {
  const versionRow = await db(env).prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM tenant_configs
    WHERE tenant_id = ?
  `).bind(tenantId).first<{ version: number }>();

  const version = Number(versionRow?.version ?? 0) + 1;
  const id = crypto.randomUUID();
  const createdAt = config.updatedAt || nowISO();

  await db(env).batch([
    db(env).prepare(`
      UPDATE tenant_configs
      SET is_active = 0
      WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId),
    db(env).prepare(`
      INSERT INTO tenant_configs (
        id, tenant_id, version, is_active, companies_json, jobtitles_json, created_at, created_by_user_id
      )
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).bind(
      id,
      tenantId,
      version,
      JSON.stringify(config.companies),
      JSON.stringify(config.jobtitles),
      createdAt,
      userId || null
    ),
  ]);
}

export async function createRunRecord(
  env: Env,
  input: {
    runId: string;
    tenantId: string;
    triggerType: "manual" | "scheduled" | "system";
    startedAt?: string;
  }
): Promise<void> {
  const startedAt = input.startedAt || nowISO();
  await db(env).prepare(`
    INSERT OR REPLACE INTO runs (
      id, tenant_id, trigger_type, status, started_at, created_at
    )
    VALUES (?, ?, ?, 'running', ?, ?)
  `).bind(input.runId, input.tenantId, input.triggerType, startedAt, startedAt).run();
}

export async function completeRunRecord(
  env: Env,
  input: {
    runId: string;
    status: "completed" | "failed" | "cancelled";
    snapshot?: Partial<D1RunSnapshot>;
    errorMessage?: string | null;
  }
): Promise<void> {
  const completedAt = nowISO();
  await db(env).prepare(`
    UPDATE runs
    SET
      status = ?,
      completed_at = ?,
      total_fetched = COALESCE(?, total_fetched),
      total_matched = COALESCE(?, total_matched),
      total_new = COALESCE(?, total_new),
      total_updated = COALESCE(?, total_updated),
      error_message = ?
    WHERE id = ?
  `).bind(
    input.status,
    completedAt,
    input.snapshot?.totalFetched ?? null,
    input.snapshot?.totalMatched ?? null,
    input.snapshot?.totalNew ?? null,
    input.snapshot?.totalUpdated ?? null,
    input.errorMessage ?? null,
    input.runId
  ).run();
}

export async function persistRunCompanyStats(
  env: Env,
  input: {
    tenantId: string;
    runId: string;
    companies: Array<{ company: string; source?: string; matchedCount?: number }>;
  }
): Promise<void> {
  if (!input.companies.length) return;

  const timestamp = nowISO();
  await db(env).batch(
    input.companies.map((company) => db(env).prepare(`
      INSERT INTO run_company_stats (
        id, tenant_id, run_id, company_name, source, matched_count, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.tenantId,
      input.runId,
      company.company,
      company.source || null,
      company.matchedCount ?? 0,
      timestamp
    ))
  );
}

async function tenantIdForRun(env: Env, runId: string): Promise<string | null> {
  const row = await db(env).prepare("SELECT tenant_id AS tenantId FROM runs WHERE id = ? LIMIT 1").bind(runId).first<{ tenantId: string }>();
  return row?.tenantId ?? null;
}

export async function persistAppLogToD1(env: Env, log: AppLogEntry): Promise<void> {
  const tenantId = log.tenantId || (log.runId ? await tenantIdForRun(env, log.runId) : null);
  await db(env).prepare(`
    INSERT INTO app_logs (
      id, tenant_id, run_id, level, event, route, company_name, source, message, details_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    log.id,
    tenantId,
    log.runId ?? null,
    log.level,
    log.event,
    log.route ?? null,
    log.company ?? null,
    log.source ?? null,
    log.message,
    JSON.stringify(log.details ?? null),
    log.timestamp
  ).run();
}

export async function loadTenantInventoryStateFromD1(
  env: Env,
  tenantId: string
): Promise<{
  inventory: InventorySnapshot;
  trend: TrendPoint[];
  lastNewJobsCount: number;
  lastNewJobKeys: string[];
  lastUpdatedJobsCount: number;
  lastUpdatedJobKeys: string[];
} | null> {
  const row = await db(env).prepare(`
    SELECT
      inventory_json,
      trend_json,
      last_new_jobs_count,
      last_new_job_keys_json,
      last_updated_jobs_count,
      last_updated_job_keys_json
    FROM tenant_inventory_state
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first<D1TenantInventoryStateRow>();

  if (!row) return null;

  return {
    inventory: JSON.parse(row.inventory_json) as InventorySnapshot,
    trend: JSON.parse(row.trend_json) as TrendPoint[],
    lastNewJobsCount: Number(row.last_new_jobs_count ?? 0) || 0,
    lastNewJobKeys: Array.isArray(JSON.parse(row.last_new_job_keys_json)) ? JSON.parse(row.last_new_job_keys_json) : [],
    lastUpdatedJobsCount: Number(row.last_updated_jobs_count ?? 0) || 0,
    lastUpdatedJobKeys: Array.isArray(JSON.parse(row.last_updated_job_keys_json)) ? JSON.parse(row.last_updated_job_keys_json) : [],
  };
}

export async function saveTenantInventoryStateToD1(
  env: Env,
  tenantId: string,
  input: {
    inventory: InventorySnapshot;
    trend: TrendPoint[];
    lastNewJobsCount: number;
    lastNewJobKeys: string[];
    lastUpdatedJobsCount: number;
    lastUpdatedJobKeys: string[];
  }
): Promise<void> {
  await db(env).prepare(`
    INSERT INTO tenant_inventory_state (
      tenant_id,
      inventory_json,
      trend_json,
      last_new_jobs_count,
      last_new_job_keys_json,
      last_updated_jobs_count,
      last_updated_job_keys_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      inventory_json = excluded.inventory_json,
      trend_json = excluded.trend_json,
      last_new_jobs_count = excluded.last_new_jobs_count,
      last_new_job_keys_json = excluded.last_new_job_keys_json,
      last_updated_jobs_count = excluded.last_updated_jobs_count,
      last_updated_job_keys_json = excluded.last_updated_job_keys_json,
      updated_at = excluded.updated_at
  `).bind(
    tenantId,
    JSON.stringify(input.inventory),
    JSON.stringify(input.trend),
    input.lastNewJobsCount,
    JSON.stringify(input.lastNewJobKeys),
    input.lastUpdatedJobsCount,
    JSON.stringify(input.lastUpdatedJobKeys),
    nowISO()
  ).run();
}

export async function loadTenantAppliedJobsStateFromD1(
  env: Env,
  tenantId: string
): Promise<Record<string, AppliedJobRecord> | null> {
  const row = await db(env).prepare(`
    SELECT applied_jobs_json
    FROM tenant_applied_state
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first<D1TenantAppliedStateRow>();

  if (!row) return null;
  return JSON.parse(row.applied_jobs_json) as Record<string, AppliedJobRecord>;
}

export async function saveTenantAppliedJobsStateToD1(
  env: Env,
  tenantId: string,
  appliedJobs: Record<string, AppliedJobRecord>
): Promise<void> {
  await db(env).prepare(`
    INSERT INTO tenant_applied_state (tenant_id, applied_jobs_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      applied_jobs_json = excluded.applied_jobs_json,
      updated_at = excluded.updated_at
  `).bind(tenantId, JSON.stringify(appliedJobs), nowISO()).run();
}

export async function clearTenantStateInD1(env: Env, tenantId: string): Promise<void> {
  await db(env).batch([
    db(env).prepare("DELETE FROM tenant_inventory_state WHERE tenant_id = ?").bind(tenantId),
    db(env).prepare("DELETE FROM tenant_applied_state WHERE tenant_id = ?").bind(tenantId),
    db(env).prepare("DELETE FROM tenant_job_first_seen WHERE tenant_id = ?").bind(tenantId),
    db(env).prepare("DELETE FROM tenant_job_seen_markers WHERE tenant_id = ?").bind(tenantId),
  ]);
}

export async function clearTenantInventoryStateInD1(env: Env, tenantId: string): Promise<void> {
  await db(env).prepare("DELETE FROM tenant_inventory_state WHERE tenant_id = ?").bind(tenantId).run();
}

export async function loadTenantJobFirstSeenAt(
  env: Env,
  tenantId: string,
  fingerprint: string
): Promise<string | null> {
  const row = await db(env).prepare(`
    SELECT first_seen_at
    FROM tenant_job_first_seen
    WHERE tenant_id = ? AND fingerprint = ?
    LIMIT 1
  `).bind(tenantId, fingerprint).first<D1TenantFirstSeenRow>();

  return row?.first_seen_at ?? null;
}

export async function saveTenantJobFirstSeenAt(
  env: Env,
  tenantId: string,
  fingerprint: string,
  firstSeenAt: string
): Promise<void> {
  const timestamp = nowISO();
  await db(env).prepare(`
    INSERT INTO tenant_job_first_seen (
      tenant_id,
      fingerprint,
      first_seen_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, fingerprint) DO UPDATE SET
      first_seen_at = excluded.first_seen_at,
      updated_at = excluded.updated_at
  `).bind(tenantId, fingerprint, firstSeenAt, timestamp, timestamp).run();
}

export async function loadTenantSeenMarkers(
  env: Env,
  tenantId: string,
  seenKeys: string[]
): Promise<Record<string, string>> {
  if (!seenKeys.length) return {};

  const placeholders = seenKeys.map(() => "?").join(", ");
  const rows = await db(env).prepare(`
    SELECT seen_key, seen_at
    FROM tenant_job_seen_markers
    WHERE tenant_id = ? AND seen_key IN (${placeholders})
  `).bind(tenantId, ...seenKeys).all<D1TenantSeenMarkerRow>();

  const results = rows.results ?? [];
  return Object.fromEntries(
    results.map((row) => [row.seen_key, row.seen_at])
  );
}

export async function saveTenantSeenMarkers(
  env: Env,
  tenantId: string,
  markers: Array<{ seenKey: string; seenAt: string }>
): Promise<void> {
  if (!markers.length) return;

  const timestamp = nowISO();
  await db(env).batch(
    markers.map((marker) => db(env).prepare(`
      INSERT INTO tenant_job_seen_markers (
        tenant_id,
        seen_key,
        seen_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, seen_key) DO UPDATE SET
        seen_at = excluded.seen_at,
        updated_at = excluded.updated_at
    `).bind(tenantId, marker.seenKey, marker.seenAt, timestamp, timestamp))
  );
}

export async function queryTenantAppLogs(
  env: Env,
  tenantId: string,
  options?: { event?: string; query?: string; level?: string; route?: string; company?: string; source?: string; runId?: string; limit?: number }
): Promise<AppLogEntry[]> {
  const limit = Math.max(1, Math.min(1000, Number(options?.limit ?? 200) || 200));
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];

  const addLike = (column: string, value?: string) => {
    const trimmed = String(value ?? "").trim().toLowerCase();
    if (!trimmed) return;
    conditions.push(`LOWER(${column}) LIKE ?`);
    params.push(`%${trimmed}%`);
  };

  const level = String(options?.level ?? "").trim().toLowerCase();
  if (level) {
    conditions.push("level = ?");
    params.push(level);
  }

  addLike("event", options?.event);
  addLike("route", options?.route);
  addLike("company_name", options?.company);
  addLike("source", options?.source);
  addLike("run_id", options?.runId);

  const query = String(options?.query ?? "").trim().toLowerCase();
  if (query) {
    conditions.push("(LOWER(event) LIKE ? OR LOWER(message) LIKE ? OR LOWER(COALESCE(route, '')) LIKE ? OR LOWER(COALESCE(company_name, '')) LIKE ? OR LOWER(COALESCE(source, '')) LIKE ? OR LOWER(COALESCE(run_id, '')) LIKE ? OR LOWER(COALESCE(details_json, '')) LIKE ?)");
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  const rows = await db(env).prepare(`
    SELECT
      id,
      tenant_id,
      run_id,
      level,
      event,
      route,
      company_name,
      source,
      message,
      details_json,
      created_at
    FROM app_logs
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...params, limit).all<D1AppLogRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    runId: row.run_id ?? undefined,
    level: row.level as AppLogEntry["level"],
    event: row.event,
    route: row.route ?? undefined,
    company: row.company_name ?? undefined,
    source: row.source ?? undefined,
    message: row.message,
    details: row.details_json ? (JSON.parse(row.details_json) as Record<string, unknown>) : undefined,
    timestamp: row.created_at,
  }));
}

export async function listTenantSavedFilters(
  env: Env,
  tenantId: string,
  scope?: SavedFilterScope
): Promise<SavedFilterRecord[]> {
  const rows = scope
    ? await db(env).prepare(`
      SELECT id, tenant_id, name, scope, filter_json, created_by_user_id, is_default, created_at, updated_at
      FROM saved_filters
      WHERE tenant_id = ? AND scope = ?
      ORDER BY is_default DESC, updated_at DESC, name ASC
    `).bind(tenantId, scope).all<D1SavedFilterRow>()
    : await db(env).prepare(`
      SELECT id, tenant_id, name, scope, filter_json, created_by_user_id, is_default, created_at, updated_at
      FROM saved_filters
      WHERE tenant_id = ?
      ORDER BY scope ASC, is_default DESC, updated_at DESC, name ASC
    `).bind(tenantId).all<D1SavedFilterRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    scope: row.scope,
    filter: JSON.parse(row.filter_json) as Record<string, unknown>,
    createdByUserId: row.created_by_user_id,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveTenantSavedFilter(
  env: Env,
  input: {
    tenantId: string;
    userId?: string;
    filterId?: string;
    name: string;
    scope: SavedFilterScope;
    filter: Record<string, unknown>;
    isDefault?: boolean;
  }
): Promise<string> {
  const filterId = input.filterId || crypto.randomUUID();
  const timestamp = nowISO();
  const duplicateName = await db(env).prepare(`
    SELECT id
    FROM saved_filters
    WHERE tenant_id = ? AND scope = ? AND LOWER(name) = LOWER(?) AND id != ?
    LIMIT 1
  `).bind(input.tenantId, input.scope, input.name.trim(), filterId).first<{ id: string }>();

  if (duplicateName?.id) {
    throw new Error(`A saved filter named "${input.name.trim()}" already exists for ${input.scope}`);
  }

  const existing = await db(env).prepare(`
    SELECT id, created_at, created_by_user_id
    FROM saved_filters
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(input.tenantId, filterId).first<{ id: string; created_at: string; created_by_user_id: string | null }>();

  if (input.isDefault) {
    await db(env).prepare(`
      UPDATE saved_filters
      SET is_default = 0, updated_at = ?
      WHERE tenant_id = ? AND scope = ?
    `).bind(timestamp, input.tenantId, input.scope).run();
  }

  await db(env).prepare(`
    INSERT INTO saved_filters (
      id,
      tenant_id,
      name,
      scope,
      filter_json,
      created_by_user_id,
      is_default,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      scope = excluded.scope,
      filter_json = excluded.filter_json,
      is_default = excluded.is_default,
      updated_at = excluded.updated_at
  `).bind(
    filterId,
    input.tenantId,
    input.name.trim(),
    input.scope,
    JSON.stringify(input.filter),
    existing?.created_by_user_id ?? input.userId ?? null,
    input.isDefault ? 1 : 0,
    existing?.created_at ?? timestamp,
    timestamp
  ).run();

  return filterId;
}

export async function deleteTenantSavedFilter(env: Env, tenantId: string, filterId: string): Promise<boolean> {
  const result = await db(env).prepare(`
    DELETE FROM saved_filters
    WHERE tenant_id = ? AND id = ?
  `).bind(tenantId, filterId).run();

  return (result.meta.changes ?? 0) > 0;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(payload: unknown): string {
  const text = stableJson(payload);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function canonicalUrl(job: JobPosting): string {
  try {
    const parsed = new URL(job.url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return job.url;
  }
}

function variantFingerprint(job: JobPosting): string {
  return `${jobStableFingerprint(job)}:location:${hyphenSlug(job.location || "unknown") || "unknown"}`;
}

function mapLogEventType(eventType: "first_seen" | "matched" | "updated", eventAt: string, runId: string, job: JobPosting) {
  return {
    id: crypto.randomUUID(),
    runId,
    eventType,
    eventAt,
    eventDetailsJson: JSON.stringify({
      jobKey: jobKey(job),
      title: job.title,
      location: job.location,
      url: job.url,
    }),
    createdAt: eventAt,
  };
}

export async function persistCanonicalRolesForRun(
  env: Env,
  input: {
    tenantId: string;
    runId: string;
    inventory: InventorySnapshot;
    newJobs: JobPosting[];
    updatedJobs: JobPosting[];
  }
): Promise<void> {
  const runAt = input.inventory.runAt || nowISO();
  const newJobKeys = new Set(input.newJobs.map((job) => jobKey(job)));
  const updatedJobKeys = new Set(input.updatedJobs.map((job) => jobKey(job)));
  const currentFingerprints = [...new Set(input.inventory.jobs.map((job) => jobStableFingerprint(job)))];

  const rawPostingIds = new Map<string, string>();

  for (const job of input.inventory.jobs) {
    const rawPostingId = crypto.randomUUID();
    rawPostingIds.set(jobKey(job), rawPostingId);
    const locationAnalysis = analyzeJobLocation(job.location);
    const normalizedLocation = {
      raw: job.location,
      locationCity: job.locationCity ?? null,
      locationState: job.locationState ?? null,
      locationCountry: job.locationCountry ?? null,
      detectedCountry: job.detectedCountry ?? locationAnalysis.detectedCountry,
      isUSLikely: job.isUSLikely ?? locationAnalysis.isUSLikely,
      hasUS: locationAnalysis.hasUS,
      hasNonUS: locationAnalysis.hasNonUS,
      isMixed: locationAnalysis.isMixed,
      matchedUsLocality: job.matchedUsLocality ?? null,
      matchedUsState: job.matchedUsState ?? null,
      geoDecision: job.geoDecision ?? null,
      geoConfidence: job.geoConfidence ?? null,
      geoScore: job.geoScore ?? null,
      geoReasons: job.geoReasons ?? [],
    };

    await db(env).prepare(`
      INSERT INTO raw_postings (
        id,
        tenant_id,
        run_id,
        source,
        company_name,
        ats_job_id,
        title,
        location_raw,
        location_normalized_json,
        job_url,
        posted_at,
        posted_at_source,
        payload_json,
        payload_hash,
        fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      rawPostingId,
      input.tenantId,
      input.runId,
      job.source,
      job.company,
      job.id || null,
      job.title,
      job.location || null,
      JSON.stringify(normalizedLocation),
      job.url,
      job.postedAt ?? null,
      job.postedAtSource ?? null,
      JSON.stringify(job),
      payloadHash(job),
      runAt
    ).run();
  }

  for (const job of input.inventory.jobs) {
    const fingerprint = jobStableFingerprint(job);
    const roleId = crypto.randomUUID();
    await db(env).prepare(`
      INSERT INTO canonical_roles (
        id,
        tenant_id,
        fingerprint,
        source,
        company_name,
        normalized_title,
        canonical_url,
        first_seen_at,
        last_seen_at,
        first_matched_at,
        last_matched_at,
        latest_posted_at,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(tenant_id, fingerprint) DO UPDATE SET
        source = excluded.source,
        company_name = excluded.company_name,
        normalized_title = excluded.normalized_title,
        canonical_url = excluded.canonical_url,
        last_seen_at = excluded.last_seen_at,
        last_matched_at = excluded.last_matched_at,
        latest_posted_at = COALESCE(excluded.latest_posted_at, canonical_roles.latest_posted_at),
        is_active = 1,
        updated_at = excluded.updated_at
    `).bind(
      roleId,
      input.tenantId,
      fingerprint,
      job.source,
      job.company,
      normalizeText(job.title),
      canonicalUrl(job),
      runAt,
      runAt,
      runAt,
      runAt,
      job.postedAt ?? null,
      runAt,
      runAt
    ).run();
  }

  const canonicalRows = await db(env).prepare(`
    SELECT id, fingerprint, first_seen_at
    FROM canonical_roles
    WHERE tenant_id = ?
  `).bind(input.tenantId).all<D1CanonicalRoleRow>();

  const canonicalByFingerprint = new Map(
    (canonicalRows.results ?? []).map((row) => [row.fingerprint, row])
  );

  for (const job of input.inventory.jobs) {
    const fingerprint = jobStableFingerprint(job);
    const canonicalRole = canonicalByFingerprint.get(fingerprint);
    const rawPostingId = rawPostingIds.get(jobKey(job));
    if (!canonicalRole || !rawPostingId) continue;

    await db(env).prepare(`
      INSERT INTO role_variants (
        id,
        tenant_id,
        canonical_role_id,
        raw_posting_id,
        variant_fingerprint,
        normalized_location,
        is_primary,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, raw_posting_id) DO UPDATE SET
        canonical_role_id = excluded.canonical_role_id,
        variant_fingerprint = excluded.variant_fingerprint,
        normalized_location = excluded.normalized_location,
        is_primary = excluded.is_primary
    `).bind(
      crypto.randomUUID(),
      input.tenantId,
      canonicalRole.id,
      rawPostingId,
      variantFingerprint(job),
      normalizeText(job.location || "unknown"),
      1,
      runAt
    ).run();

    const events = [mapLogEventType("matched", runAt, input.runId, job)];
    if (newJobKeys.has(jobKey(job)) || canonicalRole.first_seen_at === runAt) {
      events.push(mapLogEventType("first_seen", runAt, input.runId, job));
    }
    if (updatedJobKeys.has(jobKey(job))) {
      events.push(mapLogEventType("updated", runAt, input.runId, job));
    }

    await db(env).batch(
      events.map((event) => db(env).prepare(`
        INSERT INTO role_events (
          id,
          tenant_id,
          canonical_role_id,
          run_id,
          event_type,
          event_at,
          event_details_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.id,
        input.tenantId,
        canonicalRole.id,
        event.runId,
        event.eventType,
        event.eventAt,
        event.eventDetailsJson,
        event.createdAt
      ))
    );
  }

  await db(env).prepare(`
    UPDATE canonical_roles
    SET is_active = 0, updated_at = ?
    WHERE tenant_id = ?
  `).bind(runAt, input.tenantId).run();

  for (const fingerprintChunk of chunkArray(currentFingerprints, 200)) {
    if (!fingerprintChunk.length) continue;
    const placeholders = fingerprintChunk.map(() => "?").join(", ");
    await db(env).prepare(`
      UPDATE canonical_roles
      SET is_active = 1, updated_at = ?
      WHERE tenant_id = ? AND fingerprint IN (${placeholders})
    `).bind(runAt, input.tenantId, ...fingerprintChunk).run();
  }
}

export async function persistMatchDecisions(
  env: Env,
  input: {
    tenantId: string;
    runId: string;
    decisions: Array<{
      decisionType: MatchDecisionType;
      explanation: Record<string, unknown>;
    }>;
  }
): Promise<void> {
  if (!input.decisions.length) return;
  const createdAt = nowISO();
  await db(env).batch(
    input.decisions.map((decision) => db(env).prepare(`
      INSERT INTO match_decisions (
        id,
        tenant_id,
        run_id,
        raw_posting_id,
        canonical_role_id,
        decision_type,
        explanation_json,
        created_at
      )
      VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.tenantId,
      input.runId,
      decision.decisionType,
      JSON.stringify(decision.explanation),
      createdAt
    ))
  );
}

export async function queryTenantMatchDecisions(
  env: Env,
  tenantId: string,
  options?: {
    runId?: string;
    decisionType?: MatchDecisionRecord["decisionType"] | "";
    company?: string;
    source?: string;
    query?: string;
    limit?: number;
  }
): Promise<MatchDecisionSummary[]> {
  const limit = Math.max(1, Math.min(500, Number(options?.limit ?? 100) || 100));
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];

  const decisionType = String(options?.decisionType ?? "").trim();
  if (decisionType) {
    conditions.push("decision_type = ?");
    params.push(decisionType);
  }

  const runId = String(options?.runId ?? "").trim();
  if (runId) {
    conditions.push("run_id = ?");
    params.push(runId);
  }

  const company = String(options?.company ?? "").trim().toLowerCase();
  if (company) {
    conditions.push("LOWER(explanation_json) LIKE ?");
    params.push(`%\"company\":\"%${company}%`);
  }

  const source = String(options?.source ?? "").trim().toLowerCase();
  if (source) {
    conditions.push("LOWER(explanation_json) LIKE ?");
    params.push(`%\"source\":\"%${source}%`);
  }

  const query = String(options?.query ?? "").trim().toLowerCase();
  if (query) {
    conditions.push("LOWER(explanation_json) LIKE ?");
    params.push(`%${query}%`);
  }

  const rows = await db(env).prepare(`
    SELECT id, tenant_id, run_id, decision_type, explanation_json, created_at
    FROM match_decisions
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...params, limit).all<D1MatchDecisionRow>();

  const groups = new Map<string, MatchDecisionSummary>();

  for (const row of rows.results ?? []) {
    const explanation = JSON.parse(row.explanation_json) as Record<string, unknown>;
    const company = explanationCompany(explanation);
    const sourceName = explanationSource(explanation);
    const key = `${row.run_id}::${company}::${sourceName}`;

    const existing = groups.get(key) ?? {
      company,
      source: sourceName,
      runId: row.run_id,
      createdAt: row.created_at,
      counts: {
        total: 0,
        included: 0,
        excludedTitle: 0,
        excludedGeography: 0,
        groupedDuplicate: 0,
        suppressedSeen: 0,
        suppressedEmailed: 0,
      },
      rationales: [],
      examples: [],
    };

    existing.counts.total += 1;
    if (row.created_at > existing.createdAt) existing.createdAt = row.created_at;

    switch (row.decision_type) {
      case "included":
        existing.counts.included += 1;
        break;
      case "excluded_title":
        existing.counts.excludedTitle += 1;
        break;
      case "excluded_geography":
        existing.counts.excludedGeography += 1;
        break;
      case "grouped_duplicate":
        existing.counts.groupedDuplicate += 1;
        break;
      case "suppressed_seen":
        existing.counts.suppressedSeen += 1;
        break;
      case "suppressed_emailed":
        existing.counts.suppressedEmailed += 1;
        break;
    }

    const reason = decisionReason(explanation, row.decision_type);
    const existingRationales = existing.rationales ?? [];
    if (!existingRationales.includes(reason) && existingRationales.length < 6) {
      existingRationales.push(reason);
      existing.rationales = existingRationales;
    }

    const title = exampleTitle(explanation);
    const location = typeof explanation.location === "string" ? explanation.location.trim() : "";
    const existingExamples = existing.examples ?? [];
    const hasExample = existingExamples.some(
      (item) => item.decisionType === row.decision_type && item.title === title && (item.location || "") === location
    );
    if (!hasExample && existingExamples.length < 8) {
      existingExamples.push({
        decisionType: row.decision_type,
        title,
        location: location || undefined,
        reason,
      });
      existing.examples = existingExamples;
    }

    groups.set(key, existing);
  }

  return [...groups.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}
