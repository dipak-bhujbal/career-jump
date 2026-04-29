import { nowISO } from "../lib/utils";
import type { ScanQuotaUsage, UserPlan } from "../types";
import {
  atomicConsumeIfUnderQuota,
  billingTableName,
  getRow,
} from "../aws/dynamo";
import { loadBillingSubscription } from "./accounts";
import { loadPlanConfig } from "./plan-config";

type ScanQuotaRow = ScanQuotaUsage & { pk: string; sk: string };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function quotaPk(tenantId: string): string {
  return `USER#${tenantId}`;
}

function quotaSk(date: string): string {
  return `SCAN_USAGE#${date}`;
}

async function dailyQuotaForTenant(tenantId: string): Promise<number> {
  try {
    const sub = await loadBillingSubscription(tenantId);
    const cfg = await loadPlanConfig(sub.plan as UserPlan);
    return cfg.dailyLiveScans ?? 2;
  } catch {
    return 2;
  }
}

export async function loadScanQuotaUsage(tenantId: string, date = todayUtc()): Promise<ScanQuotaUsage> {
  const row = await getRow<ScanQuotaRow>(
    billingTableName(),
    { pk: quotaPk(tenantId), sk: quotaSk(date) },
    true,
  );
  if (row) return row;
  return { tenantId, date, liveScansUsed: 0, lastLiveScanAt: null, runIds: [] };
}

export async function remainingLiveScans(tenantId: string, date = todayUtc()): Promise<number> {
  const [usage, quota] = await Promise.all([
    loadScanQuotaUsage(tenantId, date),
    dailyQuotaForTenant(tenantId),
  ]);
  return Math.max(0, quota - usage.liveScansUsed);
}

/**
 * Atomically consume one daily live-scan slot. Uses a DynamoDB conditional
 * update so the increment and the quota check are a single atomic operation —
 * no TOCTOU race at the quota boundary.
 * Returns true if the slot was consumed, false if the daily quota is exhausted.
 */
export async function tryConsumeLiveScan(tenantId: string, runId: string, date = todayUtc()): Promise<boolean> {
  const quota = await dailyQuotaForTenant(tenantId);
  const now = nowISO();
  return atomicConsumeIfUnderQuota(
    billingTableName(),
    { pk: quotaPk(tenantId), sk: quotaSk(date) },
    "liveScansUsed",
    quota,
    "runIds",
    runId,
    { tenantId, date, lastLiveScanAt: now },
  );
}
