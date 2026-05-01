import type { RunStartResponse, ScanQuotaEnvelope } from "@/lib/api";

const QUEUED_RUN_GRACE_MS = 30_000;

export function isAcceptedRun(result: RunStartResponse | null | undefined): boolean {
  return result?.status === "accepted";
}

export function isQueuedRunPending(
  result: RunStartResponse | null | undefined,
  now = Date.now()
): boolean {
  if (!isAcceptedRun(result)) return false;
  const queuedAt = result?.queuedAt ?? result?.runAt;
  if (!queuedAt) return true;
  const queuedAtMs = Date.parse(queuedAt);
  if (!Number.isFinite(queuedAtMs)) return true;
  return now - queuedAtMs <= QUEUED_RUN_GRACE_MS;
}

function getScanMeta(result: RunStartResponse | null | undefined) {
  // Older cached run responses and partially rolled deploys may omit scanMeta.
  // Normalize them here so the sidebar/run UI never crashes while reading
  // quota-aware completion messaging.
  return {
    cacheHits: result?.scanMeta?.cacheHits ?? 0,
    liveFetchCompanies: result?.scanMeta?.liveFetchCompanies ?? 0,
    quotaBlockedCompanies: result?.scanMeta?.quotaBlockedCompanies ?? [],
    remainingLiveScansToday: result?.scanMeta?.remainingLiveScansToday ?? null,
    filteredOutCompanies: result?.scanMeta?.filteredOutCompanies ?? 0,
    filteredOutJobs: result?.scanMeta?.filteredOutJobs ?? 0,
  };
}

export function wasRunFullyQuotaBlocked(result: RunStartResponse | null | undefined): boolean {
  if (!result) return false;
  if (isAcceptedRun(result)) return false;
  const scanMeta = getScanMeta(result);
  return scanMeta.liveFetchCompanies === 0 && scanMeta.quotaBlockedCompanies.length > 0;
}

export function formatScanQuotaHint(quota: ScanQuotaEnvelope | undefined): string {
  if (!quota) return "Loading daily live-scan quota…";
  if (quota.unlimited) return "Unlimited live scans.";
  if (quota.remainingLiveScansToday === 0) return "Daily live scans used up. New runs will use cached scans when available and skip companies with no cache until tomorrow.";
  if (quota.remainingLiveScansToday === 1) return "1 live scan left today.";
  return `${quota.remainingLiveScansToday} live scans left today.`;
}

export function formatRunCompletionToast(result: RunStartResponse): string {
  if (isAcceptedRun(result)) {
    return "Scan queued. Progress will appear here as soon as scanning begins.";
  }
  const scanMeta = getScanMeta(result);
  const blocked = scanMeta.quotaBlockedCompanies.length;
  if (blocked > 0) {
    if (scanMeta.cacheHits > 0) {
      return blocked === 1
        ? "Scan finished. Cached results were used where available, and 1 company with no cache was skipped."
        : `Scan finished. Cached results were used where available, and ${blocked} companies with no cache were skipped.`;
    }
    return blocked === 1
      ? "Scan finished. 1 company was skipped because the daily live-scan quota was exhausted and no cached scan was available."
      : `Scan finished. ${blocked} companies were skipped because the daily live-scan quota was exhausted and no cached scan was available.`;
  }
  if ((result.totalNewMatches ?? 0) > 0 || (result.totalUpdatedMatches ?? 0) > 0) {
    return `Scan finished. ${result.totalNewMatches ?? 0} new and ${result.totalUpdatedMatches ?? 0} updated jobs found.`;
  }
  if ((result.totalFetched ?? 0) > 0 && (result.totalMatched ?? 0) === 0 && scanMeta.filteredOutJobs > 0) {
    return "Scan finished. Jobs were fetched, but none matched your current title or geography filters.";
  }
  if (scanMeta.liveFetchCompanies > 0) {
    return "Scan finished. No new changes this run.";
  }
  if (scanMeta.cacheHits > 0) {
    return "Scan finished using cached results.";
  }
  return "Scan finished. No cache was available and no jobs were returned this run.";
}

export function formatLastRunSummary(result: RunStartResponse | null | undefined): string {
  if (!result) return "No completed scans in this session yet.";
  if (isAcceptedRun(result)) return "Scan queued and waiting for scan progress.";
  const scanMeta = getScanMeta(result);
  const blocked = scanMeta.quotaBlockedCompanies.length;
  if (blocked > 0) {
    if (scanMeta.cacheHits > 0) {
      return blocked === 1
        ? "Last run used cached data where available and skipped 1 company that had no cached scan."
        : `Last run used cached data where available and skipped ${blocked} companies that had no cached scan.`;
    }
    return blocked === 1
      ? "Last run skipped 1 company because quota was exhausted and no cached scan was available."
      : `Last run skipped ${blocked} companies because quota was exhausted and no cached scan was available.`;
  }
  if ((result.totalFetched ?? 0) > 0 && (result.totalMatched ?? 0) === 0 && scanMeta.filteredOutJobs > 0) {
    return "Last run fetched jobs, but your current title or geography filters excluded them.";
  }
  if (scanMeta.liveFetchCompanies > 0) {
    return `Last run fetched live data for ${scanMeta.liveFetchCompanies} companies.`;
  }
  if (scanMeta.cacheHits > 0) {
    return "Last run served results from cache only.";
  }
  return "Last run returned no live or cached jobs.";
}

export function formatFullyBlockedBanner(result: RunStartResponse | null | undefined, quota: ScanQuotaEnvelope | undefined): string {
  if (!wasRunFullyQuotaBlocked(result)) return "";
  const scanMeta = getScanMeta(result);
  const blocked = scanMeta.quotaBlockedCompanies.length;
  const companies = blocked === 1 ? "1 company" : `${blocked} companies`;
  const quotaHint = quota?.remainingLiveScansToday === 0
    ? "Daily live-scan quota is exhausted."
    : "No live fetch happened in the last run.";
  if (scanMeta.cacheHits > 0) {
    return `${quotaHint} The last scan reused cached data where possible, but ${companies} had no cached scan and were skipped.`;
  }
  return `${quotaHint} The last scan could not perform a live fetch for ${companies}, and no cached scan was available.`;
}
