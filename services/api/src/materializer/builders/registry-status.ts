import { deleteRow, scanAllRows, registryTableName, summariesTableName } from "../../aws/dynamo";
import { loadRegistryCache, listAll } from "../../storage/registry-cache";
import { slugify, nowISO } from "../../lib/utils";
import {
  ENTITY_TYPE_REGISTRY_STATUS,
  REGISTRY_STATUS_PK,
  REGISTRY_STATUS_SCHEMA_VERSION,
  companySlugSk,
} from "../../storage/read-models";
import type { RegistryStatusRow } from "../../storage/read-models";
import type { RegistryCompanyScanState } from "../../types";
import { queryRegistryStatusRows } from "../readers";
import type { MaterializerBuilder } from "../types";

export const registryStatusBuilder: MaterializerBuilder = {
  entityType: "registry_status",

  async build(context): Promise<{ rowsWritten: number; details: Record<string, unknown> }> {
    const { message, upsertReadModelRow } = context;
    const inventoryVersion = message.inventoryVersion ?? 1;
    const configVersion = message.configVersion ?? 1;
    const builtAt = nowISO();

    const [, existingRows] = await Promise.all([
      loadRegistryCache(),
      queryRegistryStatusRows(),
    ]);
    const writtenSlugs = new Set<string>();

    type ScanStateRow = RegistryCompanyScanState & { pk: string; sk: string };
    const stateRows = await scanAllRows<ScanStateRow>(registryTableName(), {
      filterExpression: "sk = :sk",
      expressionAttributeValues: { ":sk": "REGISTRY-SCAN-STATE" },
    });

    const stateBySlug = new Map(
      stateRows.map(({ pk: _pk, sk: _sk, ...state }) => [
        state.companySlug,
        state as RegistryCompanyScanState,
      ]),
    );

    const entries = listAll();
    let rowsWritten = 0;
    let rowsDeleted = 0;

    for (const entry of entries) {
      const slug = slugify(entry.company);
      const state = stateBySlug.get(slug);

      const row: RegistryStatusRow = {
        pk: REGISTRY_STATUS_PK,
        sk: companySlugSk(slug),
        entityType: ENTITY_TYPE_REGISTRY_STATUS,
        companySlug: slug,
        company: entry.company,
        jobCount: typeof state?.lastFetchedCount === "number"
          ? state.lastFetchedCount
          : (typeof entry.total_jobs === "number" ? entry.total_jobs : 0),
        lastScanStatus: state?.lastSuccessAt ? "pass" : state?.lastFailureAt ? "fail" : "pending",
        lastScannedAt: state?.lastScanAt ?? null,
        nextScheduledAt: state?.nextScanAt ?? null,
        failureCount: state?.failureCount ?? 0,
        failureReason: state?.lastFailureReason ?? null,
        lastFailureAt: state?.lastFailureAt ?? null,
        scanStatus: state?.status ?? null,
        ats: entry.ats ?? null,
        scheduleTier: state?.scanPool ?? entry.scan_pool ?? "cold",
        registryTier: entry.tier ?? "NEEDS_REVIEW",
        configVersion,
        inventoryVersion,
        rowSchemaVersion: REGISTRY_STATUS_SCHEMA_VERSION,
        builtAt,
        sourceUpdatedAt: state?.updatedAt ?? builtAt,
      };

      writtenSlugs.add(slug);
      const written = await upsertReadModelRow({ row, table: "summaries" });
      if (written) rowsWritten++;
    }

    for (const staleRow of existingRows) {
      if (!writtenSlugs.has(staleRow.companySlug)) {
        await deleteRow(summariesTableName(), { pk: staleRow.pk, sk: staleRow.sk });
        rowsDeleted++;
      }
    }

    return { rowsWritten, details: { companiesProcessed: entries.length, rowsDeleted } };
  },
};
