import type { JobPosting } from "../../types";

/**
 * Oracle Cloud HCM (Recruiting Cloud) adapter.
 *
 * Public anonymous endpoint:
 *   https://{tenantHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
 *     ?onlyData=true
 *     &expand=requisitionList.secondaryLocations,flexFieldsFacet.values
 *     &finder=findReqs;siteNumber={siteNumber}
 *     &limit=N&offset=M
 *
 * Board URL form: https://{tenantHost}/hcmUI/CandidateExperience/{lang}/sites/{siteNumber}
 */

type OracleJob = {
  Id?: string;
  Title?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  ExternalURL?: string;
  PostedDate?: string;
  ContractType?: string;
  Department?: string;
};

type OracleResponse = {
  items?: Array<{
    requisitionList?: OracleJob[];
    TotalJobsCount?: number;
  }>;
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

export type OracleConfig = { tenantHost: string; siteNumber: string; lang: string };

export function parseOracleBoardUrl(url: string): OracleConfig | null {
  // Expected: https://{host}/hcmUI/CandidateExperience/{lang}/sites/{siteNumber}
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/hcmUI\/CandidateExperience\/([a-zA-Z]+)\/sites\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    return { tenantHost: u.hostname, lang: m[1], siteNumber: m[2] };
  } catch {
    return null;
  }
}

function apiUrl(cfg: OracleConfig, limit = 25, offset = 0): string {
  const params = new URLSearchParams({
    onlyData: "true",
    expand: "requisitionList",
    finder: `findReqs;siteNumber=${cfg.siteNumber}`,
    limit: String(limit),
    offset: String(offset),
  });
  return `https://${cfg.tenantHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?${params.toString()}`;
}

export async function validateOracleConfig(cfg: OracleConfig): Promise<boolean> {
  try {
    const r = await fetch(apiUrl(cfg, 1, 0), { headers: HEADERS });
    if (!r.ok) return false;
    const data = (await r.json()) as OracleResponse;
    return Array.isArray(data.items);
  } catch {
    return false;
  }
}

export async function countOracleJobs(cfg: OracleConfig): Promise<number> {
  try {
    const r = await fetch(apiUrl(cfg, 1, 0), { headers: HEADERS });
    if (!r.ok) return 0;
    const data = (await r.json()) as OracleResponse;
    return data.items?.[0]?.TotalJobsCount ?? data.items?.[0]?.requisitionList?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchOracleJobs(
  cfg: OracleConfig,
  companyName: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const pageSize = options.pageSize ?? 25;
  const maxPages = options.maxPages ?? 40;
  const out: JobPosting[] = [];

  for (let page = 0; page < maxPages; page++) {
    const r = await fetch(apiUrl(cfg, pageSize, page * pageSize), { headers: HEADERS });
    if (!r.ok) break;
    const data = (await r.json()) as OracleResponse;
    const list = data.items?.[0]?.requisitionList ?? [];
    if (!list.length) break;
    for (const job of list) {
      const id = job.Id ?? "";
      if (!id) continue;
      const url =
        job.ExternalURL ??
        `https://${cfg.tenantHost}/hcmUI/CandidateExperience/${cfg.lang}/sites/${cfg.siteNumber}/job/${id}`;
      out.push({
        id,
        title: job.Title ?? "",
        company: companyName,
        location: [job.PrimaryLocation, job.PrimaryLocationCountry].filter(Boolean).join(", "),
        url,
        source: "oracle" as never,
        department: job.Department,
        postedAt: job.PostedDate,
      } as JobPosting);
    }
    const total = data.items?.[0]?.TotalJobsCount ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }
  return out;
}
