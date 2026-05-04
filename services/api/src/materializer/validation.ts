import { jobsTableName, queryRows, summariesTableName } from "../aws/dynamo";
import { listCurrentRawScans } from "../storage/raw-scans";
import { loadRegistryCache, listAll } from "../storage/registry-cache";
import { jobKey, shouldKeepJobForUSInventory, slugify } from "../lib/utils";
import {
  REGISTRY_STATUS_PK,
  VISIBLE_JOB_ROW_SCHEMA_VERSION,
  VISIBLE_JOB_SK_PREFIX,
  visibleJobPk,
  visibleJobSk,
} from "../storage/read-models";
import type { VisibleJobRow } from "../storage/read-models";
import { loadTenantConfigSnapshot } from "./config-snapshot";

const SMALL_TENANT_THRESHOLD = 5_000;
const LARGE_TENANT_MAX_MISMATCH_RATE = 0.0001; // 0.01%
const SAMPLE_SIZE = 200;

export type ValidationResult = {
  passed: boolean;
  tenantId: string;
  sourceCount: number;
  readModelCount: number;
  countMismatch: boolean;
  sampleResults: SampleValidationResult[];
  missingKeys: string[];
  versionMismatches: VersionMismatch[];
  staleSourceUpdatedAt: StaleWatermark[];
};

type SampleValidationResult = {
  jobKey: string;
  found: boolean;
  versionMatch: boolean;
  sourceUpdatedAtMatch: boolean;
};

type VersionMismatch = {
  jobKey: string;
  expectedConfigVersion: number;
  actualConfigVersion: number | null;
  expectedInventoryVersion: number;
  actualInventoryVersion: number | null;
};

type StaleWatermark = {
  jobKey: string;
  expectedSourceUpdatedAt: string;
  actualSourceUpdatedAt: string | null;
};

/**
 * Validates that VISIBLEJOB read-model rows match the tenant-visible source
 * data for a given tenant. Uses the same config snapshot the builder uses so
 * source-of-truth and read-model are filtered identically.
 *
 * Small/medium tenants (< 5,000 jobs): exact count match required.
 * Large tenants: 0.01% tolerance.
 * All tenants: sampled row-key diff with three logged categories:
 *   - missing keys
 *   - version mismatches (configVersion / inventoryVersion / rowSchemaVersion)
 *   - stale sourceUpdatedAt watermarks
 *
 * A stale watermark is treated as a validation failure — it means the read
 * model row reflects older source data than expected.
 */
export async function validateTenantVisibleJobs(
  tenantId: string,
  expectedConfigVersion: number,
  expectedInventoryVersion: number,
): Promise<ValidationResult> {
  const [rawScans, readModelRows, configSnapshot] = await Promise.all([
    listCurrentRawScans(),
    queryAllVisibleJobRows(tenantId),
    loadTenantConfigSnapshot(tenantId),
  ]);

  // Apply the same tenant-visibility filters the builder uses, so source
  // count reflects what should actually be in the read model.
  const enabledSlugs = configSnapshot?.enabledCompanySlugs
    ? new Set(configSnapshot.enabledCompanySlugs)
    : null;
  const usFilterEnabled = configSnapshot?.usFilterEnabled ?? false;
  const excludeKeywords = configSnapshot?.excludeKeywords ?? [];
  const includeKeywords = configSnapshot?.includeKeywords ?? [];

  // Build source job map: jobKey → scannedAt watermark (filtered).
  // Applies the identical visibility gates as the builder so source count
  // reflects exactly what should be in the read model.
  const sourceJobs = new Map<string, string>();
  for (const scan of rawScans) {
    const companySlug = slugify(scan.company);
    if (enabledSlugs !== null && !enabledSlugs.has(companySlug)) continue;

    for (const job of scan.jobs) {
      const title = typeof job.title === "string" ? job.title.trim() : "";
      if (!title) continue;
      if (usFilterEnabled && !shouldKeepJobForUSInventory(job.location ?? "", title, job.url ?? "")) continue;
      if (
        excludeKeywords.length > 0 &&
        excludeKeywords.some((kw) => title.toLowerCase().includes(kw.toLowerCase()))
      ) continue;

      // Include-keyword gate: job must have at least one matching stored keyword
      // after intersecting with the configured include set, or it is not visible.
      if (includeKeywords.length > 0) {
        const storedKeywords: string[] = Array.isArray(job.matchedKeywords) ? job.matchedKeywords : [];
        const hasMatch = storedKeywords.some((kw) =>
          includeKeywords.some((ik) => kw.toLowerCase().includes(ik.toLowerCase()))
        );
        if (!hasMatch) continue;
      }

      sourceJobs.set(jobKey(job), scan.scannedAt);
    }
  }

  // Build read-model map: jobKey → row
  const readModelByKey = new Map<string, VisibleJobRow>();
  for (const row of readModelRows) {
    readModelByKey.set(row.jobKey, row);
  }

  const sourceCount = sourceJobs.size;
  const readModelCount = readModelRows.length;
  const delta = Math.abs(sourceCount - readModelCount);
  const countMismatch = sourceCount <= SMALL_TENANT_THRESHOLD
    ? delta > 0
    : delta / Math.max(sourceCount, 1) > LARGE_TENANT_MAX_MISMATCH_RATE;

  // Sample up to SAMPLE_SIZE keys from source for row-key diff
  const sourceKeys = [...sourceJobs.keys()];
  const sampleKeys = sampleRandom(sourceKeys, SAMPLE_SIZE);

  const sampleResults: SampleValidationResult[] = [];
  const missingKeys: string[] = [];
  const versionMismatches: VersionMismatch[] = [];
  const staleSourceUpdatedAt: StaleWatermark[] = [];

  for (const key of sampleKeys) {
    const row = readModelByKey.get(key);
    const found = !!row;

    if (!found) {
      missingKeys.push(key);
      sampleResults.push({ jobKey: key, found: false, versionMatch: false, sourceUpdatedAtMatch: false });
      console.warn(JSON.stringify({
        component: "materializer.validation",
        level: "warn",
        event: "missing_key",
        tenantId,
        jobKey: key,
      }));
      continue;
    }

    const versionMatch =
      row.configVersion === expectedConfigVersion &&
      row.inventoryVersion === expectedInventoryVersion &&
      row.rowSchemaVersion === VISIBLE_JOB_ROW_SCHEMA_VERSION;

    if (!versionMatch) {
      versionMismatches.push({
        jobKey: key,
        expectedConfigVersion,
        actualConfigVersion: row.configVersion,
        expectedInventoryVersion,
        actualInventoryVersion: row.inventoryVersion,
      });
      console.warn(JSON.stringify({
        component: "materializer.validation",
        level: "warn",
        event: "version_mismatch",
        tenantId,
        jobKey: key,
        expectedConfigVersion,
        actualConfigVersion: row.configVersion,
        expectedInventoryVersion,
        actualInventoryVersion: row.inventoryVersion,
      }));
    }

    const expectedWatermark = sourceJobs.get(key) ?? "";
    const sourceUpdatedAtMatch = !expectedWatermark || row.sourceUpdatedAt >= expectedWatermark;

    if (!sourceUpdatedAtMatch) {
      staleSourceUpdatedAt.push({
        jobKey: key,
        expectedSourceUpdatedAt: expectedWatermark,
        actualSourceUpdatedAt: row.sourceUpdatedAt,
      });
      console.warn(JSON.stringify({
        component: "materializer.validation",
        level: "warn",
        event: "stale_source_updated_at",
        tenantId,
        jobKey: key,
        expectedSourceUpdatedAt: expectedWatermark,
        actualSourceUpdatedAt: row.sourceUpdatedAt,
      }));
    }

    sampleResults.push({ jobKey: key, found, versionMatch, sourceUpdatedAtMatch });
  }

  // All three sampled categories must be clean for validation to pass.
  const passed =
    !countMismatch &&
    missingKeys.length === 0 &&
    versionMismatches.length === 0 &&
    staleSourceUpdatedAt.length === 0;

  console.log(JSON.stringify({
    component: "materializer.validation",
    event: "tenant_validation_complete",
    tenantId,
    passed,
    sourceCount,
    readModelCount,
    countMismatch,
    configAbsent: !configSnapshot,
    sampleSize: sampleKeys.length,
    missingKeyCount: missingKeys.length,
    versionMismatchCount: versionMismatches.length,
    staleWatermarkCount: staleSourceUpdatedAt.length,
  }));

  return {
    passed,
    tenantId,
    sourceCount,
    readModelCount,
    countMismatch,
    sampleResults,
    missingKeys,
    versionMismatches,
    staleSourceUpdatedAt,
  };
}

/**
 * Validates that global registry read-model rows exist for all known companies.
 */
export async function validateRegistryStatusRows(): Promise<{
  passed: boolean;
  sourceCount: number;
  readModelCount: number;
  missingCompanySlugs: string[];
}> {
  await loadRegistryCache();
  const entries = listAll();

  type StatusRow = { pk: string; sk: string };
  const rows = await queryRows<StatusRow>(
    summariesTableName(),
    "pk = :pk",
    { ":pk": REGISTRY_STATUS_PK },
  );

  const readModelSlugs = new Set(rows.map((r) => r.sk));
  const missingCompanySlugs: string[] = [];

  for (const entry of entries) {
    const sk = `COMPANY#${slugify(entry.company)}`;
    if (!readModelSlugs.has(sk)) {
      missingCompanySlugs.push(entry.company);
    }
  }

  const passed = missingCompanySlugs.length === 0;

  console.log(JSON.stringify({
    component: "materializer.validation",
    event: "registry_validation_complete",
    passed,
    sourceCount: entries.length,
    readModelCount: rows.length,
    missingCount: missingCompanySlugs.length,
  }));

  return {
    passed,
    sourceCount: entries.length,
    readModelCount: rows.length,
    missingCompanySlugs,
  };
}

async function queryAllVisibleJobRows(tenantId: string): Promise<VisibleJobRow[]> {
  return queryRows<VisibleJobRow>(
    jobsTableName(),
    "pk = :pk AND begins_with(sk, :skPrefix)",
    {
      ":pk": visibleJobPk(tenantId),
      ":skPrefix": VISIBLE_JOB_SK_PREFIX,
    },
  );
}

function sampleRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const result: T[] = [];
  const indices = new Set<number>();
  while (indices.size < n) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  for (const i of indices) result.push(arr[i]);
  return result;
}

export { visibleJobPk, visibleJobSk };
