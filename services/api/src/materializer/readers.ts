import { getRow, queryRows, jobsTableName, summariesTableName } from "../aws/dynamo";
import {
  CQRS_JOBS_READY_SK,
  DASHBOARD_SUMMARY_SK,
  REGISTRY_STATUS_PK,
  REGISTRY_ACTIONS_NEEDED_PK,
  VISIBLE_JOB_SK_PREFIX,
  cqrsJobsReadyPk,
  dashboardSummaryPk,
  visibleJobPk,
} from "../storage/read-models";
import type { CqrsJobsReadyRow, DashboardSummaryRow, RegistryStatusRow, RegistryActionsNeededRow, VisibleJobRow } from "../storage/read-models";

export async function queryRegistryStatusRows(): Promise<RegistryStatusRow[]> {
  return queryRows<RegistryStatusRow>(
    summariesTableName(),
    "pk = :pk",
    { ":pk": REGISTRY_STATUS_PK },
  );
}

export async function queryActionsNeededRows(): Promise<RegistryActionsNeededRow[]> {
  return queryRows<RegistryActionsNeededRow>(
    summariesTableName(),
    "pk = :pk",
    { ":pk": REGISTRY_ACTIONS_NEEDED_PK },
  );
}

/**
 * Returns the readiness marker written by the visible-jobs builder at the end
 * of each successful full build. Presence + configVersion equality proves the
 * read model is complete for the current tenant config.
 */
export async function queryDashboardSummaryRow(tenantId: string): Promise<DashboardSummaryRow | null> {
  return getRow<DashboardSummaryRow>(summariesTableName(), {
    pk: dashboardSummaryPk(tenantId),
    sk: DASHBOARD_SUMMARY_SK,
  });
}

export async function queryCqrsJobsReadyRow(tenantId: string): Promise<CqrsJobsReadyRow | null> {
  return getRow<CqrsJobsReadyRow>(summariesTableName(), {
    pk: cqrsJobsReadyPk(tenantId),
    sk: CQRS_JOBS_READY_SK,
  });
}

export async function queryAllVisibleJobRows(tenantId: string): Promise<VisibleJobRow[]> {
  return queryRows<VisibleJobRow>(
    jobsTableName(),
    "pk = :pk AND begins_with(sk, :skPrefix)",
    {
      ":pk": visibleJobPk(tenantId),
      ":skPrefix": VISIBLE_JOB_SK_PREFIX,
    },
  );
}

/**
 * Reimplements `categorizeRegistryFailure` from routes.ts using fields stored
 * in RegistryStatusRow so the read-model path does not need to re-join raw
 * scan state. Must stay in sync with the private function in routes.ts.
 */
export function categorizeFromStatusRow(row: RegistryStatusRow, nowIso: string): string {
  const reason = String(row.failureReason ?? "").trim().toLowerCase();
  const { lastScannedAt, nextScheduledAt: nextScanAt, scanStatus } = row;

  if (!lastScannedAt && nextScanAt && nextScanAt.localeCompare(nowIso) <= 0) return "Overdue scan";
  if (scanStatus === "misconfigured") return "Config issue";
  if (scanStatus === "paused") return "Needs review";
  if (!reason) return "Scan failed";
  if (reason.includes("timeout")) return "Timeout";
  if (reason.includes("429") || reason.includes("rate") || reason.includes("throttle")) return "Rate limit";
  if (reason.includes("401") || reason.includes("403") || reason.includes("auth") || reason.includes("forbidden")) return "Auth issue";
  if (reason.includes("404") || reason.includes("410") || reason.includes("missing") || reason.includes("not found")) return "Board missing";
  if (reason.includes("parse") || reason.includes("schema") || reason.includes("json") || reason.includes("html")) return "Parser issue";
  if (reason.includes("network") || reason.includes("dns") || reason.includes("fetch") || reason.includes("socket") || reason.includes("connect")) return "Network error";
  if (reason.includes("empty") || reason.includes("no jobs")) return "Empty result";
  return "Scan failed";
}
