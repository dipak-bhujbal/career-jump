import type { DetectedConfig, GreenhouseJob, JobPosting } from "../../types";
import { buildCompanyCandidates, hyphenSlug, slugify } from "../../lib/utils";
import type { CompanyInput } from "../../types";

/**
 * Detect Greenhouse board token by probing likely slugs.
 */
export async function detectGreenhouse(company: CompanyInput): Promise<DetectedConfig | null> {
  for (const candidate of buildCompanyCandidates(company)) {
    const tokenCandidates = new Set<string>([
      slugify(candidate),
      hyphenSlug(candidate).replace(/-/g, ""),
      hyphenSlug(candidate),
    ]);

    for (const token of tokenCandidates) {
      if (!token) continue;
      try {
        const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`, {
          headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
        });
        if (!response.ok) continue;
        const data = (await response.json()) as { jobs?: GreenhouseJob[] };
        if (Array.isArray(data.jobs)) return { source: "greenhouse", boardToken: token };
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Validate a specific Greenhouse board token.
 */
export async function validateGreenhouseToken(boardToken: string): Promise<DetectedConfig | null> {
  try {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`, {
      headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { jobs?: GreenhouseJob[] };
    return Array.isArray(data.jobs) ? { source: "greenhouse", boardToken } : null;
  } catch {
    return null;
  }
}

function buildGreenhouseTokenCandidates(primaryBoardToken: string, sampleUrl?: string): string[] {
  const candidates = new Set<string>();

  const normalizedPrimary = String(primaryBoardToken || "").trim();
  if (normalizedPrimary) {
    candidates.add(normalizedPrimary);
  }

  if (sampleUrl) {
    try {
      const url = new URL(sampleUrl);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split("/").filter(Boolean);

      if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
        const queryBoardToken = url.searchParams.get("for")?.trim();
        if (queryBoardToken) {
          candidates.add(queryBoardToken);
        }

        const firstPathPart = parts[0]?.trim();
        if (firstPathPart && firstPathPart !== "embed") {
          candidates.add(firstPathPart);
        }
      }
    } catch {
      // ignore malformed sample URL
    }
  }

  return [...candidates].filter(Boolean);
}

async function fetchGreenhouseJobsForToken(
  boardToken: string,
  signal?: AbortSignal
): Promise<{ status: number; jobs: GreenhouseJob[] }> {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`, {
    headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    return { status: response.status, jobs: [] };
  }

  const data = (await response.json()) as { jobs?: GreenhouseJob[] };
  return {
    status: response.status,
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
  };
}

/**
 * Fetch all Greenhouse jobs for a board.
 *
 * Primary path:
 * - use the configured board token first
 *
 * Fallback path:
 * - if that fails, try token candidates derived from the sample URL
 *   so embed URLs like:
 *   https://job-boards.greenhouse.io/embed/job_board?for=airbnb
 *   also work.
 */
export async function fetchGreenhouseJobs(
  companyName: string,
  boardToken: string,
  sampleUrl?: string,
  signal?: AbortSignal
): Promise<JobPosting[]> {
  const tokenCandidates = buildGreenhouseTokenCandidates(boardToken, sampleUrl);
  let lastStatus = 404;
  let resolvedToken = boardToken;

  for (const token of tokenCandidates) {
    const result = await fetchGreenhouseJobsForToken(token, signal);
    if (result.status >= 200 && result.status < 300) {
      resolvedToken = token;

      return result.jobs.map((job) => ({
        source: "greenhouse" as const,
        company: companyName,
        id: String(job.id ?? ""),
        title: job.title ?? "",
        location: job.location?.name ?? "Unknown",
        url: job.absolute_url ?? `https://job-boards.greenhouse.io/${resolvedToken}/jobs/${String(job.id ?? "")}`,
        postedAt: job.updated_at ?? undefined,
      }));
    }

    lastStatus = result.status;
  }

  throw new Error(`Greenhouse fetch failed for ${companyName}: ${lastStatus}`);
}
