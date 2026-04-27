import type { JobPosting } from "../../types";

/**
 * Jobvite ATS adapter.
 * Public API: https://jobs.jobvite.com/{slug}/api/jobs
 */

type JobviteJob = {
  id?: string | number;
  requisitionId?: string;
  title?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  applyUrl?: string;
  jobUrl?: string;
  category?: string;
  department?: string;
  postedDate?: string;
};

type JobviteResponse = {
  total?: number;
  jobs?: JobviteJob[];
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

function apiUrl(slug: string, page = 1, perPage = 50): string {
  return `https://jobs.jobvite.com/${slug}/api/jobs?page=${page}&per_page=${perPage}`;
}

export async function validateJobviteSlug(
  companySlug: string
): Promise<{ source: "jobvite"; companySlug: string } | null> {
  try {
    const r = await fetch(apiUrl(companySlug, 1, 1), { headers: HEADERS });
    if (!r.ok) return null;
    const data = (await r.json()) as JobviteResponse;
    if (typeof data.total !== "number" && !Array.isArray(data.jobs)) return null;
    return { source: "jobvite", companySlug };
  } catch {
    return null;
  }
}

export async function countJobviteJobs(companySlug: string): Promise<number> {
  try {
    const r = await fetch(apiUrl(companySlug, 1, 1), { headers: HEADERS });
    if (!r.ok) return 0;
    const data = (await r.json()) as JobviteResponse;
    return data.total ?? data.jobs?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchJobviteJobs(
  companySlug: string,
  companyName: string,
  options: { perPage?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const perPage = options.perPage ?? 50;
  const maxPages = options.maxPages ?? 20;
  const out: JobPosting[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const r = await fetch(apiUrl(companySlug, page, perPage), { headers: HEADERS });
    if (!r.ok) break;
    const data = (await r.json()) as JobviteResponse;
    const jobs = data.jobs ?? [];
    if (!jobs.length) break;
    for (const job of jobs) {
      const id = String(job.id ?? job.requisitionId ?? "");
      if (!id) continue;
      const url = job.applyUrl ?? job.jobUrl ?? `https://jobs.jobvite.com/${companySlug}/job/${id}`;
      const title = job.title ?? "";
      const location = job.location ?? [job.city, job.state, job.country].filter(Boolean).join(", ");
      out.push({
        id,
        title,
        company: companyName,
        location,
        url,
        source: "jobvite" as never,
        department: job.department ?? job.category,
        postedAt: job.postedDate,
      } as JobPosting);
    }
    const total = data.total ?? Number.MAX_SAFE_INTEGER;
    if (page * perPage >= total) break;
  }
  return out;
}
