import type { JobPosting } from "../../types";

/**
 * Phenom People ATS adapter.
 * Public API: https://{slug}.phenompeople.com/api/jobs
 *
 * Slug = subdomain on phenompeople.com (e.g., unum → unum.phenompeople.com).
 */

type PhenomJob = {
  jobId?: string | number;
  jobSeqNo?: string;
  title?: string;
  jobTitle?: string;
  location?: string;
  city?: string;
  country?: string;
  url?: string;
  applyUrl?: string;
  category?: string;
  department?: string;
  postedDate?: string;
  publishedDate?: string;
  description?: string;
};

type PhenomResponse = {
  totalHits?: number;
  total?: number;
  jobs?: PhenomJob[];
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

function apiUrl(slug: string, from = 0, size = 50): string {
  return `https://${slug}.phenompeople.com/api/jobs?from=${from}&size=${size}`;
}

export async function validatePhenomSlug(
  companySlug: string
): Promise<{ source: "phenom"; companySlug: string } | null> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return null;
    const data = (await r.json()) as PhenomResponse;
    if (typeof data.totalHits !== "number" && !Array.isArray(data.jobs)) return null;
    return { source: "phenom", companySlug };
  } catch {
    return null;
  }
}

export async function countPhenomJobs(companySlug: string): Promise<number> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return 0;
    const data = (await r.json()) as PhenomResponse;
    return data.totalHits ?? data.total ?? data.jobs?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchPhenomJobs(
  companySlug: string,
  companyName: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 20;
  const out: JobPosting[] = [];

  for (let page = 0; page < maxPages; page++) {
    const r = await fetch(apiUrl(companySlug, page * pageSize, pageSize), { headers: HEADERS });
    if (!r.ok) break;
    const data = (await r.json()) as PhenomResponse;
    const jobs = data.jobs ?? [];
    if (!jobs.length) break;
    for (const job of jobs) {
      const id = String(job.jobId ?? job.jobSeqNo ?? "");
      if (!id) continue;
      const url = job.url ?? job.applyUrl ?? `https://${companySlug}.phenompeople.com/jobs/${id}`;
      const title = job.title ?? job.jobTitle ?? "";
      const location = job.location ?? [job.city, job.country].filter(Boolean).join(", ");
      out.push({
        id,
        title,
        company: companyName,
        location,
        url,
        source: "phenom" as never,
        department: job.department ?? job.category,
        postedAt: job.postedDate ?? job.publishedDate,
      } as JobPosting);
    }
    const total = data.totalHits ?? data.total ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }
  return out;
}
