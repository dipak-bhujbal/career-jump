import type { JobPosting } from "../../types";

/**
 * Eightfold AI ATS adapter.
 * Public API: https://{slug}.eightfold.ai/api/apply/v2/jobs
 * Pagination: ?start=0&num=50
 *
 * Slug = subdomain on eightfold.ai (e.g., "vodafone" → vodafone.eightfold.ai).
 */

type EightfoldJob = {
  id?: string | number;
  name?: string;
  display_job_title?: string;
  location?: string;
  locations?: string[];
  canonicalPositionUrl?: string;
  ats_job_id?: string;
  business_unit?: string;
  description?: string;
  date_posted?: string;
  posting_date?: string;
};

type EightfoldResponse = {
  count?: number;
  positions?: EightfoldJob[];
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

function apiUrl(slug: string, start = 0, num = 50): string {
  const domain = `${slug}.eightfold.ai`;
  return `https://${domain}/api/apply/v2/jobs?domain=${domain}&start=${start}&num=${num}&pid=&Function=&location=`;
}

/**
 * Validate an Eightfold slug and return DetectedConfig-style payload.
 */
export async function validateEightfoldSlug(
  companySlug: string
): Promise<{ source: "eightfold"; companySlug: string } | null> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return null;
    const data = (await r.json()) as EightfoldResponse;
    if (typeof data.count !== "number" && !Array.isArray(data.positions)) return null;
    return { source: "eightfold", companySlug };
  } catch {
    return null;
  }
}

/**
 * Get total job count for a board.
 */
export async function countEightfoldJobs(companySlug: string): Promise<number> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return 0;
    const data = (await r.json()) as EightfoldResponse;
    return data.count ?? data.positions?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch all jobs for an Eightfold board.
 */
export async function fetchEightfoldJobs(
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
    const data = (await r.json()) as EightfoldResponse;
    const positions = data.positions ?? [];
    if (!positions.length) break;
    for (const job of positions) {
      const id = String(job.id ?? job.ats_job_id ?? "");
      if (!id) continue;
      const url = job.canonicalPositionUrl ?? `https://${companySlug}.eightfold.ai/careers?pid=${id}`;
      const title = job.display_job_title ?? job.name ?? "";
      const location = job.location ?? (job.locations && job.locations[0]) ?? "";
      out.push({
        id,
        title,
        company: companyName,
        location,
        url,
        source: "eightfold" as never,
        department: job.business_unit,
        postedAt: job.posting_date ?? job.date_posted,
      } as JobPosting);
    }
    const total = data.count ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }

  return out;
}
