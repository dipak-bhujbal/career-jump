import { SMARTRECRUITERS_PAGE_SIZE } from "../../constants";
import { buildCompanyCandidates } from "../../lib/utils";
import type { CompanyInput, DetectedConfig, JobPosting, SmartRecruitersJob, SmartRecruitersPage } from "../../types";

/**
 * Require evidence of a real public job page before trusting a SmartRecruiters company id.
 * This avoids false positives where the API returns an empty content array for arbitrary ids.
 */
function hasRealSmartRecruitersJobs(data: SmartRecruitersPage): boolean {
  if (!Array.isArray(data.content) || data.content.length === 0) return false;
  return data.content.some((job) => {
    const id = String(job.id ?? job.uuid ?? "").trim();
    const title = String(job.name ?? "").trim();
    return Boolean(id && title);
  });
}

/**
 * Detect SmartRecruiters company id by probing likely ids.
 */
export async function detectSmartRecruiters(company: CompanyInput): Promise<DetectedConfig | null> {
  for (const candidate of buildCompanyCandidates(company)) {
    const idCandidates = new Set<string>([
      candidate.replace(/\s+/g, ""),
      candidate,
      candidate.replace(/[.'’]/g, "").replace(/\s+/g, ""),
    ]);

    for (const companyId of idCandidates) {
      if (!companyId) continue;
      try {
        const response = await fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=5&offset=0`, {
          headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
        });
        if (!response.ok) continue;
        const data = (await response.json()) as SmartRecruitersPage;
        if (hasRealSmartRecruitersJobs(data)) return { source: "smartrecruiters", smartRecruitersCompanyId: companyId };
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Validate a specific SmartRecruiters company id.
 */
export async function validateSmartRecruitersCompanyId(companyId: string): Promise<DetectedConfig | null> {
  try {
    const response = await fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=5&offset=0`, {
      headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SmartRecruitersPage;
    return hasRealSmartRecruitersJobs(data) ? { source: "smartrecruiters", smartRecruitersCompanyId: companyId } : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one SmartRecruiters page.
 */
export async function fetchSmartRecruitersPage(
  companyId: string,
  offset: number,
  limit: number,
  signal?: AbortSignal
): Promise<SmartRecruitersPage> {
  const url = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`SmartRecruiters fetch failed for ${companyId}: ${response.status}`);
  return (await response.json()) as SmartRecruitersPage;
}

/**
 * Build SmartRecruiters application URL.
 */
export function resolveSmartRecruitersApplyUrl(companyId: string, job: SmartRecruitersJob): string {
  return `https://jobs.smartrecruiters.com/${companyId}/${String(job.id ?? job.uuid ?? "")}`;
}

/**
 * Fetch all SmartRecruiters jobs with pagination and dedupe.
 */
export async function fetchSmartRecruitersJobs(
  companyName: string,
  companyId: string,
  signal?: AbortSignal
): Promise<JobPosting[]> {
  const allJobs: SmartRecruitersJob[] = [];
  let offset = 0;

  while (true) {
    const data = await fetchSmartRecruitersPage(companyId, offset, SMARTRECRUITERS_PAGE_SIZE, signal);
    const jobs = Array.isArray(data.content) ? data.content : [];
    const pageOffset = typeof data.offset === "number" ? data.offset : offset;
    const pageLimit = typeof data.limit === "number" && data.limit > 0 ? data.limit : SMARTRECRUITERS_PAGE_SIZE;
    const totalFound = typeof data.totalFound === "number" && data.totalFound >= 0 ? data.totalFound : jobs.length;

    if (jobs.length === 0) break;
    allJobs.push(...jobs);
    if (pageOffset + pageLimit >= totalFound) break;
    if (jobs.length < pageLimit) break;
    offset = pageOffset + pageLimit;
  }

  const deduped = new Map<string, SmartRecruitersJob>();
  for (const job of allJobs) {
    const key = String(job.id ?? job.uuid ?? job.name ?? "");
    if (key && !deduped.has(key)) deduped.set(key, job);
  }

  return [...deduped.values()].map((job) => ({
    source: "smartrecruiters",
    company: companyName,
    id: String(job.id ?? job.uuid ?? job.name ?? ""),
    title: job.name ?? "",
    location: [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") || "Unknown",
    locationCity: job.location?.city,
    locationState: job.location?.region,
    locationCountry: job.location?.country,
    url: resolveSmartRecruitersApplyUrl(companyId, job),
    postedAt: job.releasedDate ?? job.postingDate ?? undefined,
  }));
}
