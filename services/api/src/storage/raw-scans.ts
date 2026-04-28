import { putRow, queryRows, rawScansTableName } from "../aws/dynamo";
import { hyphenSlug, nowISO, slugify } from "../lib/utils";
import type { DetectedConfig, JobPosting } from "../types";

const RAW_SCAN_CACHE_HOURS = 4;
const RAW_SCAN_SCHEMA_VERSION = 1;

type RawScanRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "RAW_SCAN";
  cacheKey: string;
  company: string;
  companySlug: string;
  source: DetectedConfig["source"];
  detected: DetectedConfig;
  jobs: JobPosting[];
  fetchedCount: number;
  scannedAt: string;
  expiresAtEpoch: number;
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
  options: { allowStale?: boolean } = {}
): Promise<{ jobs: JobPosting[]; scannedAt: string } | null> {
  const rows = await queryRows<RawScanRow>(
    rawScansTableName(),
    "pk = :pk",
    { ":pk": rawScanPk(detected) },
    { scanIndexForward: false, limit: 1, consistentRead: true }
  );
  const latest = rows[0];
  if (!latest?.scannedAt || !Array.isArray(latest.jobs)) return null;

  const scannedAtMs = Date.parse(latest.scannedAt);
  const maxAgeMs = RAW_SCAN_CACHE_HOURS * 60 * 60 * 1000;
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
  const scannedAtMs = Date.parse(scannedAt);
  const companySlug = hyphenSlug(company) || slugify(company) || "unknown-company";

  await putRow(rawScansTableName(), {
    pk: rawScanPk(detected),
    sk: `SCAN#${scannedAt}`,
    gsi1pk: `COMPANY#${companySlug}`,
    gsi1sk: scannedAt,
    entityType: "RAW_SCAN",
    cacheKey: rawScanPk(detected),
    company,
    companySlug,
    source: detected.source,
    detected,
    jobs,
    fetchedCount: jobs.length,
    scannedAt,
    expiresAtEpoch: Math.floor((scannedAtMs + (RAW_SCAN_CACHE_HOURS * 60 * 60 * 1000)) / 1000),
    schemaVersion: RAW_SCAN_SCHEMA_VERSION,
  });
}
