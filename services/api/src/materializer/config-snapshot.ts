import {
  ConditionalCheckFailedException,
  getRow,
  putRow,
  summariesTableName,
} from "../aws/dynamo";
import { nowISO, slugify } from "../lib/utils";
import {
  ENTITY_TYPE_TENANT_CONFIG_SNAPSHOT,
  TENANT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  TENANT_CONFIG_SNAPSHOT_SK,
  tenantConfigSnapshotPk,
} from "../storage/read-models";
import type { TenantConfigSnapshot } from "../storage/read-models";
import type { CompanyScanOverride, RuntimeConfig } from "../types";

/**
 * Loads the tenant config snapshot written by the Cloudflare Worker when
 * config is saved. Returns null if no snapshot exists yet (first backfill
 * on a fresh deployment before any config save has occurred).
 *
 * When null: callers should treat all raw-scan companies as enabled and
 * apply no keyword/US filter — matching the pre-CQRS behaviour.
 */
export async function loadTenantConfigSnapshot(
  tenantId: string,
): Promise<TenantConfigSnapshot | null> {
  const row = await getRow<TenantConfigSnapshot>(summariesTableName(), {
    pk: tenantConfigSnapshotPk(tenantId),
    sk: TENANT_CONFIG_SNAPSHOT_SK,
  });
  return row ?? null;
}

function effectiveEnabledCompanySlugs(
  config: RuntimeConfig,
  companies: RuntimeConfig["companies"],
  overrides: Record<string, CompanyScanOverride>,
): string[] | null {
  if (config.adminRegistryMode === "all") {
    // Admin "all registry" mode should browse every company without forcing
    // thousands of rows into the saved config page state.
    return null;
  }

  // The snapshot needs the tenant-visible company set, not the raw config set,
  // so paused overrides are folded in before materialization.
  const enabled = companies
    .filter((company) => company.enabled !== false)
    .filter((company) => overrides[slugify(company.company)]?.paused !== true)
    .map((company) => slugify(company.company))
    .filter(Boolean);

  return enabled.length > 0 ? [...new Set(enabled)].sort((a, b) => a.localeCompare(b)) : [];
}

export async function saveTenantConfigSnapshot(input: {
  tenantId: string;
  config: RuntimeConfig;
  overrides?: Record<string, CompanyScanOverride>;
  configVersion: number;
  inventoryVersion: number;
  ifNotExists?: boolean;
}): Promise<TenantConfigSnapshot> {
  const builtAt = nowISO();
  const row: TenantConfigSnapshot = {
    pk: tenantConfigSnapshotPk(input.tenantId),
    sk: TENANT_CONFIG_SNAPSHOT_SK,
    entityType: ENTITY_TYPE_TENANT_CONFIG_SNAPSHOT,
    tenantId: input.tenantId,
    enabledCompanySlugs: effectiveEnabledCompanySlugs(
      input.config,
      input.config.companies,
      input.overrides ?? {},
    ),
    // The current app behavior is always US-only inventory filtering.
    usFilterEnabled: true,
    includeKeywords: [...input.config.jobtitles.includeKeywords],
    excludeKeywords: [...input.config.jobtitles.excludeKeywords],
    configVersion: input.configVersion,
    inventoryVersion: input.inventoryVersion,
    rowSchemaVersion: TENANT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    builtAt,
    sourceUpdatedAt: input.config.updatedAt || builtAt,
  };

  try {
    // Scan-complete hooks only bootstrap the snapshot when one is missing.
    // Config-change hooks remain the authoritative writer for current tenant
    // visibility, so a conditional put avoids overwriting paused-company state.
    await putRow(summariesTableName(), row as Record<string, unknown>, input.ifNotExists
      ? {
        conditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      }
      : {});
  } catch (error) {
    if (!(input.ifNotExists && error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
  }
  return row;
}

export type { TenantConfigSnapshot };
