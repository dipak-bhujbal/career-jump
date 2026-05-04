import { deleteRow, scanAllRows, registryTableName, summariesTableName } from "../../aws/dynamo";
import { loadRegistryCache, listAll } from "../../storage/registry-cache";
import { slugify, nowISO } from "../../lib/utils";
import {
  ENTITY_TYPE_REGISTRY_ACTIONS_NEEDED,
  REGISTRY_ACTIONS_NEEDED_PK,
  REGISTRY_ACTIONS_NEEDED_SCHEMA_VERSION,
  companySlugSk,
} from "../../storage/read-models";
import type { RegistryActionsNeededRow } from "../../storage/read-models";
import type { RegistryCompanyScanState } from "../../types";
import { queryActionsNeededRows } from "../readers";
import type { MaterializerBuilder } from "../types";

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

function needsAttention(
  state: RegistryCompanyScanState | undefined,
): { reason: RegistryActionsNeededRow["reason"]; severity: RegistryActionsNeededRow["severity"] } | null {
  if (!state) return null;

  if (state.status === "failing") {
    const severity = state.failureCount >= 10 ? "high" : state.failureCount >= 3 ? "medium" : "low";
    return { reason: "failed", severity };
  }

  if (state.status === "misconfigured") {
    return { reason: "misconfigured", severity: "high" };
  }

  if (state.status === "stale") {
    const lastScanMs = state.lastScanAt ? Date.parse(state.lastScanAt) : 0;
    const staleMs = Date.now() - lastScanMs;
    const severity = staleMs > 4 * STALE_THRESHOLD_MS ? "high" : staleMs > 2 * STALE_THRESHOLD_MS ? "medium" : "low";
    return { reason: "stale", severity };
  }

  return null;
}

export const actionsNeededBuilder: MaterializerBuilder = {
  entityType: "registry_actions_needed",

  async build(context): Promise<{ rowsWritten: number; details: Record<string, unknown> }> {
    const { message, upsertReadModelRow } = context;
    const inventoryVersion = message.inventoryVersion ?? 1;
    const configVersion = message.configVersion ?? 1;
    const builtAt = nowISO();

    const [, existingRows] = await Promise.all([
      loadRegistryCache(),
      queryActionsNeededRows(),
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

    let rowsWritten = 0;
    let rowsDeleted = 0;
    let skippedOk = 0;

    for (const entry of listAll()) {
      const slug = slugify(entry.company);
      const state = stateBySlug.get(slug);
      const attention = needsAttention(state);

      if (!attention) {
        skippedOk++;
        continue;
      }

      const row: RegistryActionsNeededRow = {
        pk: REGISTRY_ACTIONS_NEEDED_PK,
        sk: companySlugSk(slug),
        entityType: ENTITY_TYPE_REGISTRY_ACTIONS_NEEDED,
        companySlug: slug,
        company: entry.company,
        reason: attention.reason,
        severity: attention.severity,
        lastCheckedAt: builtAt,
        configVersion,
        inventoryVersion,
        rowSchemaVersion: REGISTRY_ACTIONS_NEEDED_SCHEMA_VERSION,
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

    return { rowsWritten, details: { skippedOk, rowsDeleted } };
  },
};
