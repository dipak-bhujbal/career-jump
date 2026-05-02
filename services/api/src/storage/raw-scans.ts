import { deleteRow, getRow, putRow, queryRows, rawScansTableName, scanAllRows } from "../aws/dynamo";
import { hyphenSlug, nowISO, slugify } from "../lib/utils";
import type { DetectedConfig, JobPosting } from "../types";

const RAW_SCAN_SCHEMA_VERSION = 1;
const RAW_SCAN_CURRENT_SK = "CURRENT";
const RAW_SCAN_JOB_SK_PREFIX = "JOB#";

type RawScanCurrentRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "RAW_SCAN_CURRENT" | "RAW_SCAN";
  cacheKey: string;
  company: string;
  companySlug: string;
  source: DetectedConfig["source"];
  detected: DetectedConfig;
  jobs: JobPosting[];
  fetchedCount: number;
  scannedAt: string;
  schemaVersion: number;
};

type RawScanJobRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "RAW_SCAN_JOB";
  cacheKey: string;
  company: string;
  companySlug: string;
  source: DetectedConfig["source"];
  detected: DetectedConfig;
  jobKey: string;
  job: JobPosting;
  scannedAt: string;
  schemaVersion: number;
};

type RawScanRow = RawScanCurrentRow | RawScanJobRow;

function isUsableScanTimestamp(
  scannedAt: string | undefined,
  options: { allowStale?: boolean; maxAgeMs?: number },
): boolean {
  if (!scannedAt) return false;
  if (options.allowStale) return true;
  const scannedAtMs = Date.parse(scannedAt);
  const maxAgeMs = options.maxAgeMs ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(scannedAtMs) && (Date.now() - scannedAtMs) <= maxAgeMs;
}

function stableDetectedToken(detected: DetectedConfig): string {
  switch (detected.source) {
    case "greenhouse":
      return `board:${slugify(detected.boardToken)}`;
    case "ashby":
      return `company:${slugify(detected.companySlug)}`;
    case "smartrecruiters":
      return `company:${slugify(detected.smartRecruitersCompanyId)}`;
    case "lever":
      return `site:${slugify(detected.leverSite)}`;
    case "workday":
      return [
        `host:${slugify(detected.host ?? "")}`,
        `tenant:${slugify(detected.tenant ?? "")}`,
        `site:${slugify(detected.site ?? "")}`,
      ].join("|");
    case "registry-adapter":
      return [
        `adapter:${slugify(detected.adapterId ?? "")}`,
        `board:${slugify(detected.boardUrl ?? "")}`,
      ].join("|");
  }
}

function rawScanPk(detected: DetectedConfig): string {
  return `RAW_SCAN#${detected.source}#${stableDetectedToken(detected)}`;
}

function rawScanJobSk(job: JobPosting): string {
  // Stable per-job rows let us replace a single company's current inventory
  // without scanning the entire table or relying on TTL expiry semantics.
  const rawId = String(job.id ?? "").trim();
  const token = rawId || `${slugify(job.title)}:${slugify(job.location)}:${slugify(job.url)}`;
  return `${RAW_SCAN_JOB_SK_PREFIX}${encodeURIComponent(token || "unknown-job")}`;
}

function isRawScanJobRow(row: RawScanRow): row is RawScanJobRow {
  return row.entityType === "RAW_SCAN_JOB";
}

function isRawScanCurrentRow(row: RawScanRow): row is RawScanCurrentRow {
  return row.entityType === "RAW_SCAN_CURRENT" || row.entityType === "RAW_SCAN";
}

async function loadCurrentRowsForDetected(detected: DetectedConfig): Promise<RawScanRow[]> {
  return queryRows<RawScanRow>(
    rawScansTableName(),
    "pk = :pk",
    { ":pk": rawScanPk(detected) },
    { consistentRead: true },
  );
}

function sortJobsForStorage(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((a, b) => {
    const aPosted = Date.parse(a.postedAt ?? "") || 0;
    const bPosted = Date.parse(b.postedAt ?? "") || 0;
    if (aPosted !== bPosted) return bPosted - aPosted;
    return rawScanJobSk(a).localeCompare(rawScanJobSk(b));
  });
}

/**
 * Shared raw ATS fetches live outside tenant storage so later users can reuse
 * the same source payload and only re-run their own title/geography filters.
 */
export async function loadLatestRawScan(
  _company: string,
  detected: DetectedConfig,
  options: { allowStale?: boolean; maxAgeMs?: number } = {}
): Promise<{ jobs: JobPosting[]; scannedAt: string } | null> {
  const current = await getRow<RawScanCurrentRow>(
    rawScansTableName(),
    { pk: rawScanPk(detected), sk: RAW_SCAN_CURRENT_SK },
    true,
  );
  const currentCandidate = current?.scannedAt && Array.isArray(current.jobs) ? current : null;
  if (currentCandidate && isUsableScanTimestamp(currentCandidate.scannedAt, options)) {
    return {
      jobs: sortJobsForStorage(currentCandidate.jobs),
      scannedAt: currentCandidate.scannedAt,
    };
  }

  const currentRows = await loadCurrentRowsForDetected(detected);
  const jobRows = currentRows.filter(isRawScanJobRow);
  if (jobRows.length > 0) {
    const scannedAt = currentRows.find(isRawScanCurrentRow)?.scannedAt ?? jobRows[0]?.scannedAt;
    if (!isUsableScanTimestamp(scannedAt, options)) return null;
    return {
      jobs: sortJobsForStorage(jobRows.map((row) => row.job)),
      scannedAt,
    };
  }

  // Backward compatibility for older prod rows written as historical snapshots.
  const rows = await queryRows<RawScanCurrentRow>(
    rawScansTableName(),
    "pk = :pk",
    { ":pk": rawScanPk(detected) },
    { scanIndexForward: false, limit: 1, consistentRead: true }
  );
  const latest = rows[0];
  if (!latest?.scannedAt || !Array.isArray(latest.jobs)) return null;

  if (!isUsableScanTimestamp(latest.scannedAt, options)) {
    return null;
  }

  return {
    jobs: latest.jobs,
    scannedAt: latest.scannedAt,
  };
}

export async function saveRawScan(
  company: string,
  detected: DetectedConfig,
  jobs: JobPosting[]
): Promise<void> {
  const scannedAt = nowISO();
  const companySlug = hyphenSlug(company) || slugify(company) || "unknown-company";
  const cacheKey = rawScanPk(detected);
  const nextJobs = sortJobsForStorage(jobs);
  const nextJobRows = nextJobs.map((job) => ({
    pk: cacheKey,
    sk: rawScanJobSk(job),
    gsi1pk: `COMPANY#${companySlug}`,
    gsi1sk: rawScanJobSk(job),
    entityType: "RAW_SCAN_JOB" as const,
    cacheKey,
    company,
    companySlug,
    source: detected.source,
    detected,
    jobKey: rawScanJobSk(job),
    job,
    scannedAt,
    schemaVersion: RAW_SCAN_SCHEMA_VERSION,
  }));

  const existingRows = await loadCurrentRowsForDetected(detected);
  const existingJobRows = existingRows.filter(isRawScanJobRow);
  const nextJobSkSet = new Set(nextJobRows.map((row) => row.sk));

  // Replace this company's live inventory atomically enough for our read path:
  // upsert the new per-job rows and delete jobs that disappeared from source.
  await Promise.all(existingJobRows
    .filter((row) => !nextJobSkSet.has(row.sk))
    .map((row) => deleteRow(rawScansTableName(), { pk: row.pk, sk: row.sk })));

  await Promise.all(nextJobRows.map((row) => putRow(rawScansTableName(), row)));

  await putRow(rawScansTableName(), {
    pk: cacheKey,
    sk: RAW_SCAN_CURRENT_SK,
    gsi1pk: `COMPANY#${companySlug}`,
    gsi1sk: RAW_SCAN_CURRENT_SK,
    entityType: "RAW_SCAN_CURRENT",
    cacheKey,
    company,
    companySlug,
    source: detected.source,
    detected,
    jobs: nextJobs,
    fetchedCount: nextJobs.length,
    scannedAt,
    schemaVersion: RAW_SCAN_SCHEMA_VERSION,
  });
}

/**
 * Admin browsing needs a shared inventory read path that does not require
 * one query per configured company when the operator is effectively viewing
 * the whole registry. The current-row scan keeps that read path simple while
 * the table remains bounded to one live row per company/source.
 */
export async function listCurrentRawScans(): Promise<Array<{ company: string; detected: DetectedConfig; jobs: JobPosting[]; scannedAt: string }>> {
  const currentRows = await scanAllRows<RawScanRow>(
    rawScansTableName(),
    {
      filterExpression: "entityType = :entityType",
      expressionAttributeValues: { ":entityType": "RAW_SCAN_CURRENT" },
    },
  );
  if (currentRows.length > 0) {
    return currentRows
      .filter((row): row is RawScanCurrentRow =>
        isRawScanCurrentRow(row) &&
        Array.isArray(row.jobs) &&
        typeof row.company === "string" &&
        typeof row.scannedAt === "string"
      )
      .map((row) => ({
        company: row.company,
        detected: row.detected,
        jobs: row.jobs,
        scannedAt: row.scannedAt,
      }));
  }

  // Transitional fallback for prod rows written before the durable CURRENT
  // format existed. We keep the latest row per shared raw-scan key so admin
  // browsing works immediately after deploy instead of waiting for every board
  // to be rescanned.
  const legacyRows = await scanAllRows<RawScanRow>(rawScansTableName());
  const latestByPk = new Map<string, RawScanCurrentRow>();
  for (const row of legacyRows) {
    if (!isRawScanCurrentRow(row) || !Array.isArray(row.jobs) || typeof row.company !== "string" || typeof row.scannedAt !== "string") continue;
    const existing = latestByPk.get(row.pk);
    if (!existing || existing.scannedAt.localeCompare(row.scannedAt) < 0) {
      latestByPk.set(row.pk, row);
    }
  }
  return [...latestByPk.values()].map((row) => ({
    company: row.company,
    detected: row.detected,
    jobs: row.jobs,
    scannedAt: row.scannedAt,
  }));
}

export async function summarizeCurrentRawScans(): Promise<{
  currentCompanies: number;
  currentJobs: number;
  lastScannedAt: string | null;
}> {
  const rows = await listCurrentRawScans();
  let lastScannedAt: string | null = null;

  for (const row of rows) {
    if (!lastScannedAt || row.scannedAt.localeCompare(lastScannedAt) > 0) {
      lastScannedAt = row.scannedAt;
    }
  }

  return {
    currentCompanies: rows.length,
    currentJobs: rows.reduce((sum, row) => sum + row.jobs.length, 0),
    lastScannedAt,
  };
}
