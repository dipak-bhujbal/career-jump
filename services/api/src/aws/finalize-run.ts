import { INVENTORY_KEY } from "../constants";
import { applyCompanyScanOverrides, loadRuntimeConfig } from "../config";
import { jobStateKv } from "../lib/bindings";
import { logAppEvent, logErrorEvent } from "../lib/logger";
import { tenantScopedKey } from "../lib/tenant";
import { maybeSendEmail } from "../services/email";
import {
  findNewJobs,
  findUpdatedJobs,
  getInventoryDiff,
  getLatestRunNotificationJobs,
  markJobsAsSeen,
  pruneInventoryForStorage,
  saveInventory,
} from "../services/inventory";
import { markFirstScanAtIfUnset, recordEvent, releaseActiveRunLock, reserveEmailSendAttempt, updateEmailSendAttempt } from "../storage";
import type { InventorySnapshot, JobPosting, RequestActor } from "../types";
import { makeAwsEnv } from "./env";
import { companyResultPrefix, getRunMeta, markFinalized } from "./run-state";

type FinalizeRunEvent = {
  runId: string;
  tenantId?: string;
};

type CompanyResult = {
  companyName: string;
  inventory: InventorySnapshot;
  completedAt: string;
};

type FailedCompanyResult = {
  companyName: string;
  error: string;
  failedAt: string;
};

function analyticsActorForTenant(tenantId?: string): RequestActor | null {
  if (!tenantId) return null;
  return {
    userId: tenantId,
    tenantId,
    email: "",
    displayName: "",
    scope: "user",
    isAdmin: false,
  };
}

async function loadPreviousInventory(tenantId?: string): Promise<InventorySnapshot | null> {
  const env = makeAwsEnv();
  const data = await jobStateKv(env).get(tenantScopedKey(tenantId, INVENTORY_KEY), "json")
    ?? (tenantId ? await jobStateKv(env).get(INVENTORY_KEY, "json") : null);
  return data && typeof data === "object" ? (data as InventorySnapshot) : null;
}

async function listCompanyResults(runId: string): Promise<CompanyResult[]> {
  const env = makeAwsEnv();
  const listed = await jobStateKv(env).list({ prefix: companyResultPrefix(runId), limit: 500 });
  const rows = await Promise.all(listed.keys.map(async (key) => {
    if (key.name.includes(":__failed__")) return null;
    const value = await jobStateKv(env).get(key.name, "json");
    const row = value && typeof value === "object" ? (value as Partial<CompanyResult>) : null;
    return row?.inventory && typeof row.companyName === "string" ? (row as CompanyResult) : null;
  }));
  return rows.filter((row): row is CompanyResult => Boolean(row));
}

async function listFailedCompanyResults(runId: string): Promise<FailedCompanyResult[]> {
  const env = makeAwsEnv();
  const listed = await jobStateKv(env).list({ prefix: `${companyResultPrefix(runId)}__failed__`, limit: 500 });
  const rows = await Promise.all(listed.keys.map(async (key) => {
    const value = await jobStateKv(env).get(key.name, "json");
    const row = value && typeof value === "object" ? (value as Partial<FailedCompanyResult>) : null;
    return row?.companyName && row.error && row.failedAt ? (row as FailedCompanyResult) : null;
  }));
  return rows.filter((row): row is FailedCompanyResult => Boolean(row));
}


function mergeInventories(results: CompanyResult[], configuredCompanies: number): InventorySnapshot {
  const jobs: JobPosting[] = [];
  const bySource: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  let totalFetched = 0;
  let totalCompaniesDetected = 0;

  for (const result of results) {
    const inventory = result.inventory;
    jobs.push(...inventory.jobs);
    totalFetched += inventory.stats.totalFetched;
    totalCompaniesDetected += inventory.stats.totalCompaniesDetected;
    for (const [source, count] of Object.entries(inventory.stats.bySource)) {
      bySource[source] = (bySource[source] ?? 0) + count;
    }
    for (const [company, count] of Object.entries(inventory.stats.byCompany)) {
      byCompany[company] = (byCompany[company] ?? 0) + count;
    }
    for (const [keyword, count] of Object.entries(inventory.stats.keywordCounts)) {
      keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + count;
    }
  }

  return {
    runAt: new Date().toISOString(),
    jobs,
    stats: {
      totalJobsMatched: jobs.length,
      totalCompaniesConfigured: configuredCompanies,
      totalCompaniesDetected,
      totalFetched,
      bySource,
      byCompany,
      byCompanyFetched: results.reduce<Record<string, number>>((counts, result) => {
        for (const [company, count] of Object.entries(result.inventory.stats.byCompanyFetched ?? {})) {
          counts[company] = (counts[company] ?? 0) + (Number(count) || 0);
        }
        return counts;
      }, {}),
      keywordCounts,
    },
  };
}

function companyIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function runCompletionStatus(meta: Awaited<ReturnType<typeof getRunMeta>>): "success" | "partial" | "failed" {
  if (!meta) return "failed";
  if ((meta.failedCompanies ?? 0) === 0) return "success";
  if ((meta.completedCompanies ?? 0) === 0) return "failed";
  return "partial";
}

function summarizeInventory(inventory: InventorySnapshot, jobs: JobPosting[], statsPatch: Partial<InventorySnapshot["stats"]> = {}): InventorySnapshot {
  const bySource: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};

  for (const job of jobs) {
    bySource[job.source] = (bySource[job.source] ?? 0) + 1;
    byCompany[job.company] = (byCompany[job.company] ?? 0) + 1;
    for (const keyword of job.matchedKeywords ?? []) {
      keywordCounts[keyword] = (keywordCounts[keyword] ?? 0) + 1;
    }
  }

  return {
    ...inventory,
    jobs,
    stats: {
      ...inventory.stats,
      ...statsPatch,
      totalJobsMatched: jobs.length,
      bySource,
      byCompany,
      keywordCounts,
    },
  };
}

export async function handler(event: FinalizeRunEvent): Promise<{ ok: boolean; runId: string; resultCount?: number }> {
  const env = makeAwsEnv();
  const { runId, tenantId } = event;
  if (!runId) throw new Error("runId is required");

  try {
    const meta = await getRunMeta(runId);
    if (!meta) throw new Error(`Run ${runId} was not found`);
    if (meta.completedCompanies + meta.failedCompanies < meta.expectedCompanies) {
      return { ok: false, runId, resultCount: meta.completedCompanies + meta.failedCompanies };
    }

    const config = await applyCompanyScanOverrides(env, await loadRuntimeConfig(env, tenantId), tenantId);
    const previousInventory = await loadPreviousInventory(tenantId);
    const results = await listCompanyResults(runId);
    const failedResults = await listFailedCompanyResults(runId);
    const enabledCompanies = config.companies.filter((company) => company.enabled !== false);
    const enabledCompanyNames = new Set(enabledCompanies.map((company) => companyIdentity(company.company)));
    const mergedInventory = mergeInventories(results, enabledCompanies.length);
    const preservedPausedJobs = (previousInventory?.jobs ?? []).filter((job) => !enabledCompanyNames.has(companyIdentity(job.company)));
    const previousFetchedByCompany = previousInventory?.stats.byCompanyFetched ?? {};
    const byCompanyFetched = { ...(mergedInventory.stats.byCompanyFetched ?? {}) };
    for (const [company, count] of Object.entries(previousFetchedByCompany)) {
      if (!enabledCompanyNames.has(companyIdentity(company))) {
        byCompanyFetched[company] = Number(count) || 0;
      }
    }
    const mergedWithPreservedInventory = preservedPausedJobs.length
      ? summarizeInventory(mergedInventory, [...preservedPausedJobs, ...mergedInventory.jobs], {
        byCompanyFetched,
        totalFetched: Object.values(byCompanyFetched).reduce((sum, value) => sum + (Number(value) || 0), 0),
      })
      : mergedInventory;
    const inventory = await pruneInventoryForStorage(env, mergedWithPreservedInventory, tenantId);
    const diff = getInventoryDiff(previousInventory, inventory);
    const newJobs = await findNewJobs(env, previousInventory, inventory, runId, tenantId, { recordLog: false, diff });
    const updatedJobs = await findUpdatedJobs(env, previousInventory, inventory, runId, tenantId, { recordLog: false, diff });
    await saveInventory(env, mergedWithPreservedInventory, tenantId);

    const notificationJobs = await getLatestRunNotificationJobs(env, inventory, previousInventory, tenantId);
    let emailStatus: "sent" | "skipped" | "failed" = "skipped";
    let emailSkipReason: string | null = null;
    let emailError: string | null = null;

    try {
      const hasNotificationJobs = notificationJobs.newJobs.length > 0 || notificationJobs.updatedJobs.length > 0;
      if (hasNotificationJobs) {
        const emailAttempt = await reserveEmailSendAttempt(env, runId, tenantId);
        if (!emailAttempt.reserved) {
          emailStatus = "skipped";
          emailSkipReason = `Email already attempted for this run (${emailAttempt.attempt?.status ?? "unknown"})`;
        } else {
          try {
            const emailResult = await maybeSendEmail(
              env,
              notificationJobs.newJobs,
              notificationJobs.updatedJobs,
              inventory.runAt,
              runId,
              tenantId
            );
            emailStatus = emailResult.status;
            emailSkipReason = emailResult.skipReason;
            await updateEmailSendAttempt(env, runId, "sent", { tenantId });
          } catch (error) {
            emailStatus = "failed";
            emailError = error instanceof Error ? error.message : String(error);
            await updateEmailSendAttempt(env, runId, "failed", { tenantId, error: emailError });
          }
        }
      } else {
        const emailResult = await maybeSendEmail(
          env,
          notificationJobs.newJobs,
          notificationJobs.updatedJobs,
          inventory.runAt,
          runId,
          tenantId
        );
        emailStatus = emailResult.status;
        emailSkipReason = emailResult.skipReason;
      }
      if (notificationJobs.newJobs.length > 0 && emailStatus === "sent") {
        await markJobsAsSeen(env, notificationJobs.newJobs, inventory.runAt, runId, tenantId);
      }
    } catch (error) {
      emailStatus = "failed";
      emailError = error instanceof Error ? error.message : String(error);
    }

    await logAppEvent(env, {
      level: "info",
      event: "run_completed",
      message: `Run completed with ${inventory.stats.totalJobsMatched} current matches, ${newJobs.length} new jobs, and ${updatedJobs.length} updated jobs`,
      tenantId,
      runId,
      route: "aws/finalize-run",
      details: {
        resultCount: results.length,
        expectedCompanies: meta.expectedCompanies,
        completedCompanies: meta.completedCompanies,
        failedCompanies: meta.failedCompanies,
        failedCompanyNames: failedResults.map((result) => result.companyName),
        totalMatched: inventory.stats.totalJobsMatched,
        totalNewMatches: newJobs.length,
        totalUpdatedMatches: updatedJobs.length,
        totalFetched: inventory.stats.totalFetched,
        emailStatus,
        emailSkipReason,
        emailError,
      },
    });

    const analyticsActor = analyticsActorForTenant(tenantId);
    const runStartedAtMs = Date.parse(meta.startedAt);
    const runCompletedAtMs = Date.now();
    const durationMs = Number.isFinite(runStartedAtMs) ? Math.max(0, runCompletedAtMs - runStartedAtMs) : 0;
    void (async () => {
      await recordEvent(analyticsActor, "RUN_COMPLETED", {
        runId,
        companiesScanned: meta.completedCompanies + meta.failedCompanies,
        durationMs,
        status: runCompletionStatus(meta),
      });

      if (!analyticsActor) return;
      const firstScan = await markFirstScanAtIfUnset(analyticsActor.userId);
      if (!firstScan.wasFirstScan || !firstScan.joinedAt) return;

      const joinedAtMs = Date.parse(firstScan.joinedAt);
      const hoursAfterSignup = Number.isFinite(joinedAtMs)
        ? Math.max(0, Math.round(((runCompletedAtMs - joinedAtMs) / (60 * 60 * 1000)) * 100) / 100)
        : null;
      await recordEvent(analyticsActor, "FIRST_SCAN_RUN", {
        hoursAfterSignup,
      });
    })().catch((error) => {
      console.warn("[analytics] failed to record run completion events", error);
    });

    await markFinalized(runId);
    await releaseActiveRunLock(env, runId);
    return { ok: true, runId, resultCount: results.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logErrorEvent(env, {
      event: "aws_finalize_run_failed",
      message,
      tenantId,
      runId,
      route: "aws/finalize-run",
      error,
    });
    await releaseActiveRunLock(env, runId);
    throw error;
  }
}
