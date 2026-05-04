import { scanAllRows, usersTableName } from "../aws/dynamo";
import { makeAwsEnv } from "./env";
import { loadRuntimeConfig } from "../config";
import { enqueueMaterializerMessages } from "../materializer";
import { saveTenantConfigSnapshot } from "../materializer";
import { versionFromIso } from "../materializer/dual-build";
import { nowISO } from "../lib/utils";
import type { MaterializerMessage } from "../materializer";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_EMAIL?.trim().toLowerCase() || "default";

/**
 * Enqueues backfill materializer messages for all tenants in the users table,
 * plus one set of global (shared) messages.
 *
 * Tenant-scoped messages (visible_jobs, dashboard_summary) are enqueued once
 * per tenant found by scanning for PROFILE rows in the users table. If the
 * scan returns no results, falls back to DEFAULT_TENANT_EMAIL so a single-
 * tenant deployment is always covered.
 *
 * Global messages (registry_status, registry_actions_needed, company_index)
 * are enqueued once regardless of tenant count.
 *
 * Idempotent — re-running is safe. The shared upsert primitive no-ops on
 * rows that are already current. Stale rows are pruned by each builder after
 * writing the current set.
 *
 * Invoke via: aws lambda invoke --function-name ...-materializer-backfill
 */
export async function handler(): Promise<{
  enqueued: number;
  tenants: string[];
  jobId: string;
  triggeredAt: string;
}> {
  const triggeredAt = nowISO();
  const jobId = `backfill-${Date.now()}`;
  const env = makeAwsEnv();

  // Discover all tenants from the users table PROFILE rows. The CQRS routes
  // key rows by runtime tenantId (the Cognito sub / tenant UUID), not by
  // email, so backfill must enqueue the same tenant key the API will query.
  type ProfileRow = {
    pk: string;
    sk: string;
    userId?: string;
    tenantId?: string;
    email?: string;
    scope?: "user" | "admin";
  };
  const profileRows = await scanAllRows<ProfileRow>(usersTableName(), {
    filterExpression: "sk = :sk",
    expressionAttributeValues: { ":sk": "PROFILE" },
  });

  const tenantProfiles = profileRows
    .map((row) => ({
      tenantId: String(row.tenantId ?? row.userId ?? row.pk.replace(/^USER#/, "")).trim(),
      userId: String(row.userId ?? row.tenantId ?? row.pk.replace(/^USER#/, "")).trim(),
      isAdmin: row.scope === "admin",
    }))
    .filter((row) => row.tenantId.length > 0);

  // Ensure at least the default tenant is always covered. This fallback is
  // only for empty/bootstrap environments; real prod tenants should always
  // come from PROFILE rows with a concrete tenantId.
  const tenants = tenantProfiles.length > 0
    ? Array.from(new Map(tenantProfiles.map((row) => [row.tenantId, row])).values())
    : [{ tenantId: DEFAULT_TENANT_ID, userId: DEFAULT_TENANT_ID, isAdmin: false }];

  const messages: MaterializerMessage[] = [];

  for (const tenant of tenants) {
    // Backfill must align configVersion with the live runtime config; the
    // /api/jobs CQRS cutover rejects ready rows built for a stale version.
    const config = await loadRuntimeConfig(env, tenant.tenantId, {
      isAdmin: tenant.isAdmin,
      updatedByUserId: tenant.userId,
      expandAdminCompanies: tenant.isAdmin ? false : undefined,
    });
    const configVersion = versionFromIso(config.updatedAt);
    const inventoryVersion = configVersion;

    // Bootstrap the tenant config snapshot before the visible-jobs build so
    // old tenants without a recent config save still materialize the correct
    // enabled-company and keyword filters during backfill.
    await saveTenantConfigSnapshot({
      tenantId: tenant.tenantId,
      config,
      configVersion,
      inventoryVersion,
      ifNotExists: false,
    });

    messages.push({
      scope: "tenant",
      tenantId: tenant.tenantId,
      jobId: `${jobId}-${tenant.tenantId}-visible-jobs`,
      entityType: "visible_jobs",
      triggerType: "backfill",
      triggeredAt,
      configVersion,
      inventoryVersion,
    });
    messages.push({
      scope: "tenant",
      tenantId: tenant.tenantId,
      jobId: `${jobId}-${tenant.tenantId}-dashboard`,
      entityType: "dashboard_summary",
      triggerType: "backfill",
      triggeredAt,
      configVersion,
      inventoryVersion,
    });
  }

  // Global messages — one set regardless of tenant count
  messages.push(
    {
      scope: "global",
      jobId: `${jobId}-registry-status`,
      entityType: "registry_status",
      triggerType: "backfill",
      triggeredAt,
      inventoryVersion: 1,
      configVersion: 1,
    },
    {
      scope: "global",
      jobId: `${jobId}-actions-needed`,
      entityType: "registry_actions_needed",
      triggerType: "backfill",
      triggeredAt,
      inventoryVersion: 1,
      configVersion: 1,
    },
    {
      scope: "global",
      jobId: `${jobId}-company-index`,
      entityType: "company_index",
      triggerType: "backfill",
      triggeredAt,
      inventoryVersion: 1,
      configVersion: 1,
    },
  );

  await enqueueMaterializerMessages(messages);

  console.log(JSON.stringify({
    component: "materializer.backfill",
    event: "backfill_enqueued",
    jobId,
    tenants: tenants.map((tenant) => tenant.tenantId),
    enqueued: messages.length,
    triggeredAt,
  }));

  return {
    enqueued: messages.length,
    tenants: tenants.map((tenant) => tenant.tenantId),
    jobId,
    triggeredAt,
  };
}
