import { loadRegistryCache, listAll } from "../../storage/registry-cache";
import { slugify, nowISO } from "../../lib/utils";
import {
  COMPANY_INDEX_SCHEMA_VERSION,
  ENTITY_TYPE_COMPANY_INDEX,
  REGISTRY_COMPANY_INDEX_PK,
  companySlugSk,
} from "../../storage/read-models";
import type { CompanyIndexRow } from "../../storage/read-models";
import type { MaterializerBuilder } from "../types";

export const companyIndexBuilder: MaterializerBuilder = {
  entityType: "company_index",

  async build(context): Promise<{ rowsWritten: number; details: Record<string, unknown> }> {
    const { message, upsertReadModelRow } = context;
    const inventoryVersion = message.inventoryVersion ?? 1;
    const configVersion = message.configVersion ?? 1;
    const builtAt = nowISO();

    await loadRegistryCache();
    const entries = listAll();

    let rowsWritten = 0;

    for (const entry of entries) {
      const slug = slugify(entry.company);

      const row: CompanyIndexRow = {
        pk: REGISTRY_COMPANY_INDEX_PK,
        sk: companySlugSk(slug),
        entityType: ENTITY_TYPE_COMPANY_INDEX,
        companySlug: slug,
        company: entry.company,
        ats: entry.ats ?? null,
        scheduleTier: entry.scan_pool ?? null,
        registryTier: entry.tier ?? "NEEDS_REVIEW",
        isActive: entry.tier !== "NEEDS_REVIEW",
        configVersion,
        inventoryVersion,
        rowSchemaVersion: COMPANY_INDEX_SCHEMA_VERSION,
        builtAt,
        sourceUpdatedAt: builtAt,
      };

      const written = await upsertReadModelRow({ row, table: "summaries" });
      if (written) rowsWritten++;
    }

    return { rowsWritten, details: { companiesIndexed: entries.length } };
  },
};
