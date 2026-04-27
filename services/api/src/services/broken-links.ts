import type { Env, InventorySnapshot, JobPosting } from "../types";
import { jobKey } from "../lib/utils";
import { loadAppliedJobs, recordAppLog } from "../storage";

function isBrokenJobResponseStatus(status: number): boolean {
  return status === 404 || status === 410;
}

export async function checkJobUrlHealth(
  url: string,
  signal?: AbortSignal
): Promise<{
  broken: boolean;
  status: number | null;
  finalUrl: string | null;
  method: "HEAD" | "GET";
}> {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "career-jump/1.0",
  };

  let response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers,
    signal,
  });

  if (response.status === 405 || response.status === 501) {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal,
    });
  }

  const finalUrl = response.url || url;

  return {
    broken: isBrokenJobResponseStatus(response.status),
    status: Number.isFinite(response.status) ? response.status : null,
    finalUrl,
    method: response.status === 405 || response.status === 501 ? "GET" : "HEAD",
  };
}

function rebuildInventorySnapshot(inventory: InventorySnapshot, jobs: JobPosting[]): InventorySnapshot {
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
      totalJobsMatched: jobs.length,
      bySource,
      byCompany,
      keywordCounts,
    },
  };
}

export async function removeBrokenAvailableJobs(
  env: Env,
  inventory: InventorySnapshot,
  options?: {
    tenantId?: string;
    runId?: string;
    route?: string;
    signal?: AbortSignal;
  }
): Promise<{
  inventory: InventorySnapshot;
  checkedCount: number;
  removedCount: number;
  brokenJobs: Array<{
    jobKey: string;
    company: string;
    title: string;
    url: string;
    status: number | null;
    method: "HEAD" | "GET";
    finalUrl: string | null;
  }>;
}> {
  const tenantId = options?.tenantId;
  const route = options?.route ?? "scan";
  const appliedJobs = await loadAppliedJobs(env, tenantId);
  const availableJobs = inventory.jobs.filter((job) => !appliedJobs[jobKey(job)]);
  const brokenJobs: Array<{
    jobKey: string;
    company: string;
    title: string;
    url: string;
    status: number | null;
    method: "HEAD" | "GET";
    finalUrl: string | null;
  }> = [];

  for (let start = 0; start < availableJobs.length; start += 5) {
    const batch = availableJobs.slice(start, start + 5);
    const results = await Promise.all(batch.map(async (job) => {
      try {
        const health = await checkJobUrlHealth(job.url, options?.signal);
        return { job, health };
      } catch (error) {
        await recordAppLog(env, {
          level: "warn",
          event: "broken_link_check_failed",
          message: `Could not validate job URL for ${job.company}`,
          route,
          company: job.company,
          source: job.source,
          runId: options?.runId,
          tenantId,
          details: {
            title: job.title,
            url: job.url,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return null;
      }
    }));

    for (const result of results) {
      if (!result || !result.health.broken) continue;
      brokenJobs.push({
        jobKey: jobKey(result.job),
        company: result.job.company,
        title: result.job.title,
        url: result.job.url,
        status: result.health.status,
        method: result.health.method,
        finalUrl: result.health.finalUrl,
      });
    }
  }

  if (!brokenJobs.length) {
    return {
      inventory,
      checkedCount: availableJobs.length,
      removedCount: 0,
      brokenJobs: [],
    };
  }

  const brokenJobKeys = new Set(brokenJobs.map((job) => job.jobKey));
  const cleanedJobs = inventory.jobs.filter((job) => !brokenJobKeys.has(jobKey(job)));

  return {
    inventory: rebuildInventorySnapshot(inventory, cleanedJobs),
    checkedCount: availableJobs.length,
    removedCount: brokenJobs.length,
    brokenJobs,
  };
}
