/**
 * CQRS read-model types for tenant-visible jobs and admin/registry summaries.
 *
 * Entity-family separation is enforced at the key level:
 *   - Applied-job rows  → SK begins with  APPLIEDJOB#  (existing, unchanged)
 *   - Visible-job rows  → SK begins with  VISIBLEJOB#  (new read-model family)
 *
 * These two families must never appear in the same GSI query. All VISIBLEJOB
 * GSIs use gsi3pk/gsi3sk or gsi4pk/gsi4sk — distinct attributes from the
 * gsi1/gsi2 attributes used by APPLIEDJOB rows.
 *
 * Admin/registry read models live in the SummariesTable under REGISTRY# PKs —
 * separate from any TENANT# PK scope.
 */

// ---------------------------------------------------------------------------
// Row schema version — bump whenever field shape changes requiring full rebuild
// ---------------------------------------------------------------------------

export const VISIBLE_JOB_ROW_SCHEMA_VERSION = 2;
export const DASHBOARD_SUMMARY_SCHEMA_VERSION = 2;
export const REGISTRY_STATUS_SCHEMA_VERSION = 2;
export const REGISTRY_ACTIONS_NEEDED_SCHEMA_VERSION = 1;
export const COMPANY_INDEX_SCHEMA_VERSION = 1;
export const TENANT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Entity-type constants — hard strings, not strings derived from other fields
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_VISIBLE_JOB = "VISIBLE_JOB" as const;
export const ENTITY_TYPE_TENANT_CONFIG_SNAPSHOT = "TENANT_CONFIG_SNAPSHOT" as const;
export const ENTITY_TYPE_DASHBOARD_SUMMARY = "DASHBOARD_SUMMARY" as const;
export const ENTITY_TYPE_REGISTRY_STATUS = "REGISTRY_STATUS" as const;
export const ENTITY_TYPE_REGISTRY_ACTIONS_NEEDED =
  "REGISTRY_ACTIONS_NEEDED" as const;
export const ENTITY_TYPE_COMPANY_INDEX = "COMPANY_INDEX" as const;

// ---------------------------------------------------------------------------
// SK prefix constants — enforces entity-family isolation at the key level
// ---------------------------------------------------------------------------

/** All tenant-visible job rows have an SK that begins with this prefix. */
export const VISIBLE_JOB_SK_PREFIX = "VISIBLEJOB#" as const;

// ---------------------------------------------------------------------------
// Key helpers — JobsTable (tenant-visible job rows)
// ---------------------------------------------------------------------------

/** Base-table PK for all rows belonging to a tenant. */
export function visibleJobPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

/**
 * Base-table SK for a tenant-visible job row.
 * Begins with VISIBLEJOB# — impossible to confuse with APPLIEDJOB# rows.
 */
export function visibleJobSk(postedAtEpoch: number, jobKey: string): string {
  return `${VISIBLE_JOB_SK_PREFIX}POSTED#${postedAtEpoch}#JOB#${jobKey}`;
}

/**
 * GSI3 PK — company dimension for visible-job queries.
 * Uses gsi3pk so it never overlaps with gsi1pk (APPLIEDJOB status-index).
 */
export function visibleJobCompanyGsiPk(
  tenantId: string,
  companyLower: string
): string {
  return `TENANT#${tenantId}#COMPANY#${companyLower}`;
}

/**
 * GSI4 PK — source dimension for visible-job queries.
 * Uses gsi4pk so it never overlaps with gsi2pk (APPLIEDJOB company-index).
 */
export function visibleJobSourceGsiPk(
  tenantId: string,
  sourceLower: string
): string {
  return `TENANT#${tenantId}#SOURCE#${sourceLower}`;
}

/**
 * Shared GSI SK for both company-index and source-index on visible jobs.
 * Begins with VISIBLEJOB# — GSI query with begins_with prevents mixing
 * any future row families that might share the same GSI attribute.
 */
export function visibleJobGsiSk(postedAtEpoch: number, jobKey: string): string {
  return `${VISIBLE_JOB_SK_PREFIX}POSTED#${postedAtEpoch}#JOB#${jobKey}`;
}

// ---------------------------------------------------------------------------
// Key helpers — SummariesTable (dashboard + admin/registry rows)
// ---------------------------------------------------------------------------

/** PK for the tenant dashboard snapshot (one record per tenant). */
export function dashboardSummaryPk(tenantId: string): string {
  return `TENANT#${tenantId}#TYPE#DASHBOARD_SUMMARY`;
}
export const DASHBOARD_SUMMARY_SK = "SUMMARY" as const;

/** PK for registry-status rows (one row per company — global/shared scope). */
export const REGISTRY_STATUS_PK = "REGISTRY#STATUS" as const;

/** PK for registry-actions-needed rows (one row per company — global/shared). */
export const REGISTRY_ACTIONS_NEEDED_PK = "REGISTRY#ACTIONS_NEEDED" as const;

/** PK for the company config index rows (one row per company — global/shared). */
export const REGISTRY_COMPANY_INDEX_PK = "REGISTRY#COMPANY_INDEX" as const;

/** SK for any per-company row in the SummariesTable. */
export function companySlugSk(companySlug: string): string {
  return `COMPANY#${companySlug}`;
}

// ---------------------------------------------------------------------------
// Shared freshness/version fields — mandatory on ALL read-model rows
// ---------------------------------------------------------------------------

/**
 * Every read-model row carries these fields.
 * - configVersion:     increments on any tenant/admin config change
 * - inventoryVersion:  on tenant rows = tenant-visible inventory build version;
 *                      on global registry rows = shared raw/scan source version
 *                      (same field name, different semantic — documented here)
 * - rowSchemaVersion:  bumped when the row's field shape changes; triggers full rebuild
 * - builtAt:           ISO timestamp of when this row was last materialized
 * - sourceUpdatedAt:   ISO timestamp watermark of the source data this row reflects
 */
export type ReadModelFreshnessFields = {
  configVersion: number;
  inventoryVersion: number;
  rowSchemaVersion: number;
  builtAt: string;
  sourceUpdatedAt: string;
};

// ---------------------------------------------------------------------------
// Tenant-visible job row (JobsTable)
// ---------------------------------------------------------------------------

export type VisibleJobRow = ReadModelFreshnessFields & {
  // DynamoDB keys
  pk: string; // visibleJobPk(tenantId)
  sk: string; // visibleJobSk(postedAtEpoch, jobKey)
  gsi3pk: string; // visibleJobCompanyGsiPk(tenantId, companyLower)
  gsi3sk: string; // visibleJobGsiSk(postedAtEpoch, jobKey)
  gsi4pk: string; // visibleJobSourceGsiPk(tenantId, sourceLower)
  gsi4sk: string; // visibleJobGsiSk(postedAtEpoch, jobKey)

  entityType: typeof ENTITY_TYPE_VISIBLE_JOB;

  // Job identity
  tenantId: string;
  jobKey: string;
  company: string;
  source: string;

  // Display fields
  jobTitle: string;
  location: string;
  postedAt: string; // ISO string for display
  postedAtEpoch: number; // Unix epoch ms — used for sort/compare, avoids string parsing
  url: string; // direct link to the job posting page

  // Filter flags
  isNew: boolean;
  isUpdated: boolean;
  usEligible: boolean;
  matchedKeywords: string[];

  // Pre-normalized search fields — written once at materializer time, never recomputed at read
  companyLower: string;
  jobTitleLower: string;
  locationLower: string;
  sourceLower: string;
};

// ---------------------------------------------------------------------------
// Dashboard summary snapshot (SummariesTable — tenant-scoped)
// ---------------------------------------------------------------------------

export type DashboardKpis = {
  totalApplied: number;
  activeApplications: number;
  interviews: number;
  offers: number;
  responseRate: number; // 0–1 ratio, computed at build time
  // Inventory-derived fields (from visible_jobs at build time)
  availableJobs: number;
  totalFetched: number;
  companiesDetected: number;
  newJobsLatestRun: number;
  updatedJobsLatestRun: number;
};

export type DashboardStageBreakdown = {
  applied: number;
  interview: number;
  negotiations: number;
  offered: number;
  rejected: number;
};

export type DashboardTopCompany = {
  company: string;
  count: number;
};

export type DashboardRecentActivity = {
  jobKey: string;
  company: string;
  jobTitle: string;
  eventType: string;
  eventAt: string;
};

export type DashboardSummaryRow = ReadModelFreshnessFields & {
  // DynamoDB keys
  pk: string; // dashboardSummaryPk(tenantId)
  sk: typeof DASHBOARD_SUMMARY_SK;

  entityType: typeof ENTITY_TYPE_DASHBOARD_SUMMARY;
  tenantId: string;

  kpis: DashboardKpis;
  stageBreakdown: DashboardStageBreakdown;
  topCompanies: DashboardTopCompany[];
  topLocations: Array<{ label: string; count: number }>;
  recentActivity: DashboardRecentActivity[];
  staleApplications: DashboardRecentActivity[];
  companiesByAts: Array<{ ats: string; count: number }>;
  keywordCounts: Record<string, number>;
  statusBreakdown: Record<string, number>;
  builtInventoryRunAt: string; // ISO timestamp of the visible_jobs build this row reflects
};

// ---------------------------------------------------------------------------
// Registry status rows (SummariesTable — global/shared scope, one per company)
//
// inventoryVersion here = shared raw/scan source version, NOT tenant inventory.
// ---------------------------------------------------------------------------

export type RegistryStatusRow = ReadModelFreshnessFields & {
  // DynamoDB keys
  pk: typeof REGISTRY_STATUS_PK;
  sk: string; // companySlugSk(companySlug)

  entityType: typeof ENTITY_TYPE_REGISTRY_STATUS;

  companySlug: string;
  company: string;
  jobCount: number;
  lastScanStatus: "pass" | "fail" | "pending";
  lastScannedAt: string | null;
  nextScheduledAt: string | null;
  failureCount: number;
  failureReason: string | null;
  lastFailureAt: string | null;
  scanStatus: string | null; // raw scan state status (failing/misconfigured/paused/…)
  ats: string | null; // ATS identifier from registry entry
  scheduleTier: string;
  registryTier: string;
};

// ---------------------------------------------------------------------------
// Registry actions-needed rows (SummariesTable — global/shared, one per company)
// ---------------------------------------------------------------------------

export type RegistryActionsNeededRow = ReadModelFreshnessFields & {
  // DynamoDB keys
  pk: typeof REGISTRY_ACTIONS_NEEDED_PK;
  sk: string; // companySlugSk(companySlug)

  entityType: typeof ENTITY_TYPE_REGISTRY_ACTIONS_NEEDED;

  companySlug: string;
  company: string;
  reason: "failed" | "stale" | "misconfigured" | "needs_review";
  severity: "low" | "medium" | "high";
  lastCheckedAt: string;
};

// ---------------------------------------------------------------------------
// Company config index rows (SummariesTable — global/shared, one per company)
// Lightweight — no full config blob. Used for fast admin search/filter/list.
// ---------------------------------------------------------------------------

export type CompanyIndexRow = ReadModelFreshnessFields & {
  // DynamoDB keys
  pk: typeof REGISTRY_COMPANY_INDEX_PK;
  sk: string; // companySlugSk(companySlug)

  entityType: typeof ENTITY_TYPE_COMPANY_INDEX;

  companySlug: string;
  company: string;
  ats: string | null;
  scheduleTier: string | null;
  registryTier: string;
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// Tenant config snapshot (SummariesTable — tenant-scoped)
//
// Written by the Cloudflare Worker API whenever tenant config is saved.
// Read by the materializer Lambda to apply the same tenant-visibility rules
// without needing access to Cloudflare KV.
//
// If absent (first backfill before any config save), the materializer falls
// back to using all raw scans — this is documented and expected behaviour
// for a fresh deployment.
// ---------------------------------------------------------------------------

export const TENANT_CONFIG_SNAPSHOT_SK = "CURRENT" as const;

export function tenantConfigSnapshotPk(tenantId: string): string {
  return `TENANT#${tenantId}#TYPE#CONFIG_SNAPSHOT`;
}

/**
 * Minimal tenant visibility rules needed by the materializer Lambda.
 * enabledCompanySlugs: null means "all companies enabled" (no filter).
 * usFilterEnabled: when true, only US-eligible jobs are visible.
 * includeKeywords / excludeKeywords: empty array = no filter.
 */
export type TenantConfigSnapshot = ReadModelFreshnessFields & {
  pk: string; // tenantConfigSnapshotPk(tenantId)
  sk: typeof TENANT_CONFIG_SNAPSHOT_SK;
  entityType: typeof ENTITY_TYPE_TENANT_CONFIG_SNAPSHOT;
  tenantId: string;
  enabledCompanySlugs: string[] | null; // null = all companies
  usFilterEnabled: boolean;
  includeKeywords: string[];
  excludeKeywords: string[];
};

// ---------------------------------------------------------------------------
// CQRS jobs readiness marker (SummariesTable — tenant-scoped)
//
// Written by the visible-jobs materializer builder at the END of a successful
// full build. Presence + matching configVersion proves the read model is
// complete for the current tenant config — not just non-empty.
// ---------------------------------------------------------------------------

export const CQRS_JOBS_READY_SK = "JOBS" as const;

export function cqrsJobsReadyPk(tenantId: string): string {
  return `TENANT#${tenantId}#TYPE#CQRS_READY`;
}

export type CqrsJobsReadyRow = {
  pk: string; // cqrsJobsReadyPk(tenantId)
  sk: typeof CQRS_JOBS_READY_SK;
  tenantId: string;
  configVersion: number;
  inventoryVersion: number;
  rowCount: number;
  builtAt: string;
};
