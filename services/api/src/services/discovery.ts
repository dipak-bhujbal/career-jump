import { loadRuntimeConfig, companyToDetectedConfig } from "../config";
import type { CompanyInput, DetectedConfig, Env, ProtectedDiscoveryRecord } from "../types";
import { annotateJobGeography, shouldKeepJobPostingForUSInventory } from "../lib/utils";
import { fetchAshbyJobs } from "../ats/core/ashby";
import { fetchGreenhouseJobs } from "../ats/core/greenhouse";
import { fetchLeverJobs } from "../ats/core/lever";
import { fetchSmartRecruitersJobs } from "../ats/core/smartrecruiters";
import { fetchWorkdayJobs } from "../ats/core/workday";
import { fetchJobsForEntry } from "../ats/registry";

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function logDroppedGeoRows(stage: string, companyName: string, detected: DetectedConfig, dropped: ReturnType<typeof annotateJobGeography>[]): void {
  if (dropped.length === 0) return;
  const sample = dropped.slice(0, 10).map((job) => ({
    title: job.title,
    location: job.location,
    url: job.url,
    decision: job.geoDecision,
    score: job.geoScore,
    reasons: job.geoReasons,
    detectedCountry: job.detectedCountry,
  }));

  // Debug-only audit trail for false-drop investigation. We keep it in logs
  // instead of Dynamo so non-US rows do not consume long-term storage.
  console.warn(JSON.stringify({
    component: "geo-filter",
    event: "non_us_jobs_dropped",
    stage,
    company: companyName,
    source: detected.source,
    droppedCount: dropped.length,
    sample,
  }));
}

async function getConfiguredCompany(env: Env, companyName: string, tenantId?: string): Promise<CompanyInput | null> {
  const config = await loadRuntimeConfig(env, tenantId);
  return config.companies.find((item) => namesMatch(item.company, companyName)) ?? null;
}

/**
 * Explicit-config mode only.
 * No discovery, no AI, no fallback probing.
 */
export async function getDetectedConfig(env: Env, company: CompanyInput, tenantId?: string): Promise<DetectedConfig | null> {
  const configured = company.source ? company : await getConfiguredCompany(env, company.company, tenantId);
  return configured ? companyToDetectedConfig(configured) : null;
}

/**
 * ATS-specific fetch dispatcher.
 *
 * includeKeywords is especially important for Workday so large boards
 * can be searched intelligently instead of broad crawling.
 */
export async function fetchJobsForDetectedConfig(
  companyName: string,
  detected: DetectedConfig,
  includeKeywords: string[] = [],
  options?: {
    signal?: AbortSignal;
    onProgress?: (details: {
      stage: string;
      pageNumber?: number;
      offset?: number;
      searchText?: string;
      postingsCount?: number;
      pageCapReached?: boolean;
    }) => Promise<void> | void;
  }
) {
  let jobs;
  switch (detected.source) {
    case "greenhouse":
      jobs = await fetchGreenhouseJobs(companyName, detected.boardToken, detected.sampleUrl, options?.signal);
      break;

    case "ashby":
      jobs = await fetchAshbyJobs(companyName, detected.companySlug, options?.signal);
      break;

    case "smartrecruiters":
      jobs = await fetchSmartRecruitersJobs(companyName, detected.smartRecruitersCompanyId, options?.signal);
      break;

    case "lever":
      jobs = await fetchLeverJobs(companyName, detected.leverSite, options?.signal);
      break;

    case "workday":
      jobs = await fetchWorkdayJobs(
        companyName,
        {
          sampleUrl: detected.sampleUrl,
          workdayBaseUrl: detected.workdayBaseUrl,
          host: detected.host,
          tenant: detected.tenant,
          site: detected.site,
        },
        includeKeywords
      );
      break;

    case "registry-adapter":
      jobs = await fetchJobsForEntry({
        rank: null,
        sheet: "Runtime Config",
        company: detected.companyName || companyName,
        board_url: detected.boardUrl,
        ats: detected.adapterId,
        total_jobs: null,
        source: "runtime_config",
        tier: "NEEDS_REVIEW",
        sample_url: detected.sampleUrl ?? null,
      }) ?? [];
      break;
  }

  // Drop non-US rows as early as possible so adapter-level fetches do not
  // hand unnecessary jobs to the rest of the pipeline. Ambiguous review rows
  // stay to avoid false-negative U.S. drops.
  const annotatedJobs = (jobs ?? []).map((job) => annotateJobGeography(job));
  const keptJobs = annotatedJobs.filter((job) => shouldKeepJobPostingForUSInventory(job));
  const droppedJobs = annotatedJobs.filter((job) => job.geoDecision === "drop");
  logDroppedGeoRows("adapter", companyName, detected, droppedJobs);
  return keptJobs;
}

export async function resolveWorkdayForCompany(env: Env, companyName: string, tenantId?: string): Promise<DetectedConfig | null> {
  const detected = await getDetectedConfig(env, { company: companyName, enabled: true }, tenantId);
  return detected?.source === "workday" ? detected : null;
}

export async function getProtectedDiscoveryRecord(
  _env: Env,
  _companyName: string
): Promise<ProtectedDiscoveryRecord | null> {
  return null;
}

export async function resetDiscoveryForCompany(_env: Env, _companyName: string): Promise<void> {
  // No-op in explicit-config mode.
}
