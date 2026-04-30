import type { JobPosting } from "../../types";

/**
 * Phenom People ATS adapter.
 *
 * Some companies use the legacy `*.phenompeople.com` host directly, while
 * others publish custom-domain boards like `jobs.centene.com/us/en/jobs/`.
 * The previous implementation collapsed custom domains to the leftmost
 * subdomain (`jobs`) and then incorrectly queried `jobs.phenompeople.com`.
 *
 * The adapter now treats the full board URL as the source of truth and tries a
 * small candidate set of same-origin API paths before giving up.
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

type PhenomBoardConfig = {
  boardUrl: string;
  apiCandidates: string[];
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

function parsePhenomBoardUrl(boardUrl: string): PhenomBoardConfig | null {
  try {
    const url = new URL(boardUrl);
    const origin = url.origin;
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    const candidates = new Set<string>();

    if (normalizedPath && normalizedPath !== "/") {
      // Boards that end in `/jobs` often expose the API one level above.
      if (/\/jobs$/i.test(normalizedPath)) {
        const prefix = normalizedPath.replace(/\/jobs$/i, "");
        if (prefix) candidates.add(`${origin}${prefix}/api/jobs`);
      }
      // Some tenants mount the API under the visible board path itself.
      candidates.add(`${origin}${normalizedPath}/api/jobs`);
    }

    // Legacy hosted boards expose a root-level API on the same origin.
    candidates.add(`${origin}/api/jobs`);

    return {
      boardUrl,
      apiCandidates: [...candidates],
    };
  } catch {
    return null;
  }
}

function apiUrl(baseUrl: string, from = 0, size = 50): string {
  const url = new URL(baseUrl);
  url.searchParams.set("from", String(from));
  url.searchParams.set("size", String(size));
  return url.toString();
}

async function fetchPhenomResponse(
  boardUrl: string,
  from = 0,
  size = 50
): Promise<{ data: PhenomResponse; apiBaseUrl: string } | null> {
  const parsed = parsePhenomBoardUrl(boardUrl);
  if (!parsed) return null;

  for (const candidate of parsed.apiCandidates) {
    try {
      const response = await fetch(apiUrl(candidate, from, size), { headers: HEADERS });
      if (!response.ok) continue;
      const data = (await response.json()) as PhenomResponse;
      if (typeof data.totalHits === "number" || typeof data.total === "number" || Array.isArray(data.jobs)) {
        return { data, apiBaseUrl: candidate };
      }
    } catch {
      // Continue to the next API candidate. Custom-domain Phenom boards are
      // inconsistent enough that we need a small fallback chain here.
    }
  }

  return null;
}

export async function validatePhenomSlug(boardUrl: string): Promise<{ source: "phenom"; boardUrl: string } | null> {
  const result = await fetchPhenomResponse(boardUrl, 0, 1);
  return result ? { source: "phenom", boardUrl } : null;
}

export async function countPhenomJobs(boardUrl: string): Promise<number> {
  const result = await fetchPhenomResponse(boardUrl, 0, 1);
  if (!result) return 0;
  return result.data.totalHits ?? result.data.total ?? result.data.jobs?.length ?? 0;
}

export async function fetchPhenomJobs(
  boardUrl: string,
  companyName: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 20;
  const jobs: JobPosting[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPhenomResponse(boardUrl, page * pageSize, pageSize);
    if (!result) break;
    const pageJobs = result.data.jobs ?? [];
    if (!pageJobs.length) break;

    for (const job of pageJobs) {
      const id = String(job.jobId ?? job.jobSeqNo ?? "");
      if (!id) continue;

      let url = job.url ?? job.applyUrl ?? `${result.apiBaseUrl.replace(/\/api\/jobs$/i, "")}/jobs/${id}`;
      try {
        url = new URL(url, boardUrl).toString();
      } catch {
        // Keep the raw URL value when the ATS returns an odd relative path.
      }

      const title = job.title ?? job.jobTitle ?? "";
      const location = job.location ?? [job.city, job.country].filter(Boolean).join(", ");
      jobs.push({
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

    const total = result.data.totalHits ?? result.data.total ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }

  return jobs;
}
