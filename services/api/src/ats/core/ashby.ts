import type { AshbyJob, CompanyInput, DetectedConfig, JobPosting } from "../../types";
import { buildCompanyCandidates } from "../../lib/utils";

/**
 * Detect Ashby board slug by probing likely candidates.
 */
export async function detectAshby(company: CompanyInput): Promise<DetectedConfig | null> {
  for (const candidate of buildCompanyCandidates(company)) {
    const slugCandidates = new Set<string>([
      candidate.replace(/\s+/g, ""),
      candidate,
      candidate.replace(/[.'’]/g, "").replace(/\s+/g, ""),
    ]);

    for (const slug of slugCandidates) {
      if (!slug) continue;
      try {
        const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, {
          headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
        });
        if (!response.ok) continue;
        const data = (await response.json()) as { jobs?: AshbyJob[] };
        if (Array.isArray(data.jobs)) return { source: "ashby", companySlug: slug };
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Validate a specific Ashby company slug.
 */
export async function validateAshbySlug(companySlug: string): Promise<DetectedConfig | null> {
  try {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(companySlug)}`, {
      headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { jobs?: AshbyJob[] };
    return Array.isArray(data.jobs) ? { source: "ashby", companySlug } : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all Ashby jobs for a company slug.
 */
export async function fetchAshbyJobs(
  companyName: string,
  companySlug: string,
  signal?: AbortSignal
): Promise<JobPosting[]> {
  const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(companySlug)}`, {
    headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Ashby fetch failed for ${companyName}: ${response.status}`);
  const data = (await response.json()) as { jobs?: AshbyJob[] };
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs.map((job) => ({
    source: "ashby" as const,
    company: companyName,
    id: String(job.id ?? job.title ?? ""),
    title: job.title ?? "",
    location: [job.location, ...(Array.isArray(job.secondaryLocations) ? job.secondaryLocations.map((x) => x.location).filter(Boolean) : [])].filter(Boolean).join(" / ") || "Unknown",
    url: job.jobUrl ?? job.applyUrl ?? `https://jobs.ashbyhq.com/${companySlug}`,
    postedAt: job.publishedAt ?? undefined,
  }));
}
