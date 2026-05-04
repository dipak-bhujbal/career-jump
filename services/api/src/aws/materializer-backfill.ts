import { scanAllRows, usersTableName } from "../aws/dynamo";
import { enqueueMaterializerMessages } from "../materializer";
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

  // Discover all tenants from the users table PROFILE rows
  type ProfileRow = { pk: string; sk: string; email?: string };
  const profileRows = await scanAllRows<ProfileRow>(usersTableName(), {
    filterExpression: "sk = :sk",
    expressionAttributeValues: { ":sk": "PROFILE" },
  });

  const tenantIds = profileRows
    .map((r) => (r.email ?? r.pk.replace(/^USER#/, "")).trim().toLowerCase())
    .filter(Boolean);

  // Ensure at least the default tenant is always covered
  const tenants = tenantIds.length > 0
    ? [...new Set(tenantIds)]
    : [DEFAULT_TENANT_ID];

  const messages: MaterializerMessage[] = [];

  for (const tenantId of tenants) {
    messages.push({
      scope: "tenant",
      tenantId,
      jobId: `${jobId}-${tenantId}-visible-jobs`,
      entityType: "visible_jobs",
      triggerType: "backfill",
      triggeredAt,
      configVersion: 1,
      inventoryVersion: 1,
    });
    messages.push({
      scope: "tenant",
      tenantId,
      jobId: `${jobId}-${tenantId}-dashboard`,
      entityType: "dashboard_summary",
      triggerType: "backfill",
      triggeredAt,
      configVersion: 1,
      inventoryVersion: 1,
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
    tenants,
    enqueued: messages.length,
    triggeredAt,
  }));

  return {
    enqueued: messages.length,
    tenants,
    jobId,
    triggeredAt,
  };
}
