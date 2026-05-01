import { getRow, putRow, queryRows, rawScansTableName, scanRows } from "../aws/dynamo";
import { hyphenSlug, nowISO, slugify } from "../lib/utils";
import type { DetectedConfig, JobPosting } from "../types";

const RAW_SCAN_SCHEMA_VERSION = 1;
const RAW_SCAN_CURRENT_SK = "CURRENT";

type RawScanRow = {
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

/**
 * Shared raw ATS fetches live outside tenant storage so later users can reuse
 * the same source payload and only re-run their own title/geography filters.
 */
export async function loadLatestRawScan(
  _company: string,
  detected: DetectedConfig,
  options: { allowStale?: boolean; maxAgeMs?: number } = {}
): Promise<{ jobs: JobPosting[]; scannedAt: string } | null> {
  const current = await getRow<RawScanRow>(
    rawScansTableName(),
    { pk: rawScanPk(detected), sk: RAW_SCAN_CURRENT_SK },
    true,
  );
  const currentCandidate = current?.scannedAt && Array.isArray(current.jobs) ? current : null;
  if (currentCandidate) {
    return {
      jobs: currentCandidate.jobs,
      scannedAt: currentCandidate.scannedAt,
    };
  }

  // Backward compatibility for older prod rows written as historical snapshots.
  const rows = await queryRows<RawScanRow>(
    rawScansTableName(),
    "pk = :pk",
    { ":pk": rawScanPk(detected) },
    { scanIndexForward: false, limit: 1, consistentRead: true }
  );
  const latest = rows[0];
  if (!latest?.scannedAt || !Array.isArray(latest.jobs)) return null;

  const scannedAtMs = Date.parse(latest.scannedAt);
  const maxAgeMs = options.maxAgeMs ?? Number.POSITIVE_INFINITY;
  if (!options.allowStale && (!Number.isFinite(scannedAtMs) || (Date.now() - scannedAtMs) > maxAgeMs)) {
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

  await putRow(rawScansTableName(), {
    pk: rawScanPk(detected),
    sk: RAW_SCAN_CURRENT_SK,
    gsi1pk: `COMPANY#${companySlug}`,
    gsi1sk: RAW_SCAN_CURRENT_SK,
    entityType: "RAW_SCAN_CURRENT",
    cacheKey: rawScanPk(detected),
    company,
    companySlug,
    source: detected.source,
    detected,
    jobs,
    fetchedCount: jobs.length,
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
  const currentRows = await scanRows<RawScanRow>(
    rawScansTableName(),
    "entityType = :entityType",
    { ":entityType": "RAW_SCAN_CURRENT" },
  );
  if (currentRows.length > 0) {
    return currentRows
      .filter((row) => Array.isArray(row.jobs) && typeof row.company === "string" && typeof row.scannedAt === "string")
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
  const legacyRows = await scanRows<RawScanRow>(rawScansTableName());
  const latestByPk = new Map<string, RawScanRow>();
  for (const row of legacyRows) {
    if (!Array.isArray(row.jobs) || typeof row.company !== "string" || typeof row.scannedAt !== "string") continue;
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
