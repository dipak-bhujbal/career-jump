import { deleteRow, jobsTableName, putRow, summariesTableName } from "../../aws/dynamo";
import { listCurrentRawScans } from "../../storage/raw-scans";
import { jobKey, nowISO, shouldKeepJobForUSInventory, slugify } from "../../lib/utils";
import {
  CQRS_JOBS_READY_SK,
  ENTITY_TYPE_VISIBLE_JOB,
  VISIBLE_JOB_ROW_SCHEMA_VERSION,
  cqrsJobsReadyPk,
  visibleJobCompanyGsiPk,
  visibleJobGsiSk,
  visibleJobPk,
  visibleJobSourceGsiPk,
  visibleJobSk,
} from "../../storage/read-models";
import type { CqrsJobsReadyRow, VisibleJobRow } from "../../storage/read-models";
import { loadTenantConfigSnapshot } from "../config-snapshot";
import { queryAllVisibleJobRows } from "../readers";
import type { MaterializerBuilder } from "../types";

export const visibleJobsBuilder: MaterializerBuilder = {
  entityType: "visible_jobs",

  async build(context): Promise<{ rowsWritten: number; details: Record<string, unknown> }> {
    const { message, upsertReadModelRow } = context;

    if (message.scope !== "tenant") {
      throw new Error("visible_jobs builder requires scope=tenant");
    }

    const { tenantId } = message;
    const configVersion = message.configVersion ?? 1;
    const inventoryVersion = message.inventoryVersion ?? 1;
    const builtAt = nowISO();

    // Load tenant visibility rules from the DynamoDB config snapshot written
    // by the Cloudflare Worker on config save. If absent (fresh deployment /
    // first backfill), fall back to unfiltered: all companies, no keyword
    // filter, no US filter — matching pre-CQRS inventory behaviour.
    const configSnapshot = await loadTenantConfigSnapshot(tenantId);
    const enabledSlugs = configSnapshot?.enabledCompanySlugs
      ? new Set(configSnapshot.enabledCompanySlugs)
      : null; // null = all companies enabled
    const usFilterEnabled = configSnapshot?.usFilterEnabled ?? false;
    const includeKeywords = configSnapshot?.includeKeywords ?? [];
    const excludeKeywords = configSnapshot?.excludeKeywords ?? [];
    const configAbsent = !configSnapshot;

    const [rawScans, existingRows] = await Promise.all([
      listCurrentRawScans(),
      queryAllVisibleJobRows(tenantId),
    ]);
    const existingByKey = new Map(existingRows.map((r) => [r.jobKey, r]));
    const isBackfill = message.triggerType === "backfill";
    const writtenKeys = new Set<string>();

    let rowsWritten = 0;
    let rowsDeleted = 0;
    let skippedNoTitle = 0;
    let skippedCompanyFilter = 0;
    let skippedUsFilter = 0;
    let skippedExcludeKeyword = 0;
    let totalJobs = 0;

    for (const scan of rawScans) {
      const companySlug = slugify(scan.company);

      // Company-level visibility: skip if tenant has explicit company list
      // and this company is not in it.
      if (enabledSlugs !== null && !enabledSlugs.has(companySlug)) {
        skippedCompanyFilter += scan.jobs.length;
        continue;
      }

      for (const job of scan.jobs) {
        totalJobs++;

        const title = typeof job.title === "string" ? job.title.trim() : "";
        if (!title) {
          skippedNoTitle++;
          continue;
        }

        // US eligibility filter
        if (usFilterEnabled && !shouldKeepJobForUSInventory(job.location ?? "", title, job.url ?? "")) {
          skippedUsFilter++;
          continue;
        }

        // Exclude-keyword filter: skip if any exclude keyword appears in title
        const titleLower = title.toLowerCase();
        if (
          excludeKeywords.length > 0 &&
          excludeKeywords.some((kw) => titleLower.includes(kw.toLowerCase()))
        ) {
          skippedExcludeKeyword++;
          continue;
        }

        const key = jobKey(job);
        const postedAtStr = typeof job.postedAt === "string" ? job.postedAt : "";
        const postedAtEpoch = postedAtStr ? Date.parse(postedAtStr) || 0 : 0;
        const companyLower = (job.company ?? "").toLowerCase();
        const locationLower = (job.location ?? "").toLowerCase();
        const sourceLower = slugify(job.source ?? "");
        const usEligible = shouldKeepJobForUSInventory(job.location ?? "", title, job.url ?? "");
        const existing = existingByKey.get(key);
        const isNew = !isBackfill && existing === undefined;
        const isUpdated = !isBackfill && existing !== undefined && existing.sourceUpdatedAt !== scan.scannedAt;

        // matchedKeywords: use stored value from scan; if include filter is
        // active, intersect with configured keywords. Jobs with zero matches
        // after intersection are not tenant-visible — skip them entirely.
        const storedKeywords: string[] = Array.isArray(job.matchedKeywords) ? job.matchedKeywords : [];
        const matchedKeywords =
          includeKeywords.length > 0
            ? storedKeywords.filter((kw) =>
                includeKeywords.some((ik) => kw.toLowerCase().includes(ik.toLowerCase()))
              )
            : storedKeywords;

        if (includeKeywords.length > 0 && matchedKeywords.length === 0) {
          continue;
        }

        const row: VisibleJobRow = {
          pk: visibleJobPk(tenantId),
          sk: visibleJobSk(postedAtEpoch, key),
          gsi3pk: visibleJobCompanyGsiPk(tenantId, companyLower),
          gsi3sk: visibleJobGsiSk(postedAtEpoch, key),
          gsi4pk: visibleJobSourceGsiPk(tenantId, sourceLower),
          gsi4sk: visibleJobGsiSk(postedAtEpoch, key),

          entityType: ENTITY_TYPE_VISIBLE_JOB,

          tenantId,
          jobKey: key,
          company: job.company ?? "",
          source: job.source ?? "",
          jobTitle: title,
          location: job.location ?? "",
          postedAt: postedAtStr,
          postedAtEpoch,
          url: job.url ?? "",

          isNew,
          isUpdated,
          usEligible,
          matchedKeywords,

          companyLower,
          jobTitleLower: titleLower,
          locationLower,
          sourceLower,

          configVersion,
          inventoryVersion,
          rowSchemaVersion: VISIBLE_JOB_ROW_SCHEMA_VERSION,
          builtAt,
          sourceUpdatedAt: scan.scannedAt,
        };

        writtenKeys.add(key);
        const written = await upsertReadModelRow({ row, table: "jobs" });
        if (written) rowsWritten++;
      }
    }

    for (const staleRow of existingRows) {
      if (!writtenKeys.has(staleRow.jobKey)) {
        await deleteRow(jobsTableName(), { pk: staleRow.pk, sk: staleRow.sk });
        rowsDeleted++;
      }
    }

    // Write a readiness marker so the read cutover in routes.ts can verify
    // that a complete build has finished for the current configVersion.
    // Written unconditionally at the end — any prior partial marker is replaced.
    const readyRow: CqrsJobsReadyRow = {
      pk: cqrsJobsReadyPk(tenantId),
      sk: CQRS_JOBS_READY_SK,
      tenantId,
      configVersion,
      inventoryVersion,
      rowCount: rowsWritten,
      builtAt,
    };
    await putRow(summariesTableName(), readyRow as Record<string, unknown>);

    return {
      rowsWritten,
      details: {
        totalJobs,
        skippedNoTitle,
        skippedCompanyFilter,
        skippedUsFilter,
        skippedExcludeKeyword,
        companies: rawScans.length,
        configAbsent,
        rowsDeleted,
      },
    };
  },
};
