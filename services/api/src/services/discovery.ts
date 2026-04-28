import { loadRuntimeConfig, companyToDetectedConfig } from "../config";
import type { CompanyInput, DetectedConfig, Env, ProtectedDiscoveryRecord } from "../types";
import { fetchAshbyJobs } from "../ats/core/ashby";
import { fetchGreenhouseJobs } from "../ats/core/greenhouse";
import { fetchLeverJobs } from "../ats/core/lever";
import { fetchSmartRecruitersJobs } from "../ats/core/smartrecruiters";
import { fetchWorkdayJobs } from "../ats/core/workday";
import { fetchJobsForEntry } from "../ats/registry";

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
  switch (detected.source) {
    case "greenhouse":
      return fetchGreenhouseJobs(companyName, detected.boardToken, detected.sampleUrl, options?.signal);

    case "ashby":
      return fetchAshbyJobs(companyName, detected.companySlug, options?.signal);

    case "smartrecruiters":
      return fetchSmartRecruitersJobs(companyName, detected.smartRecruitersCompanyId, options?.signal);

    case "lever":
      return fetchLeverJobs(companyName, detected.leverSite, options?.signal);

    case "workday":
      return fetchWorkdayJobs(
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

    case "registry-adapter": {
      const jobs = await fetchJobsForEntry({
        rank: null,
        sheet: "Runtime Config",
        company: detected.companyName || companyName,
        board_url: detected.boardUrl,
        ats: detected.adapterId,
        total_jobs: null,
        source: "runtime_config",
        tier: "NEEDS_REVIEW",
        sample_url: detected.sampleUrl ?? null,
      });
      return jobs ?? [];
    }
  }
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
