import type { CompanyInput, DetectedConfig, JobPosting, LeverJob } from "../../types";
import { buildCompanyCandidates, hyphenSlug, normalizePostedAtValue, slugify } from "../../lib/utils";

function parseLeverSiteFromSampleUrl(sampleUrl: string): string {
  const url = new URL(sampleUrl);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host !== "jobs.lever.co") {
    throw new Error(`Lever sample URL must use jobs.lever.co: ${sampleUrl}`);
  }

  const leverSite = String(parts[0] ?? "").trim().toLowerCase();
  if (!leverSite) {
    throw new Error(`Could not extract Lever site from sample URL: ${sampleUrl}`);
  }

  return leverSite;
}

function buildLeverApiUrl(leverSite: string): string {
  const url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(leverSite)}`);
  url.searchParams.set("mode", "json");
  return url.toString();
}

function buildLeverLocation(job: LeverJob): string {
  const allLocations = Array.isArray(job.categories?.allLocations) ? job.categories?.allLocations.filter(Boolean) : [];
  if (allLocations.length > 0) return allLocations.join(" / ");
  return String(job.categories?.location ?? "").trim() || "Unknown";
}

function buildLeverUrl(job: LeverJob, leverSite: string, id: string): string {
  const hostedUrl = String(job.hostedUrl ?? "").trim();
  if (hostedUrl) return hostedUrl;

  const applyUrl = String(job.applyUrl ?? "").trim();
  if (applyUrl) return applyUrl;

  return `https://jobs.lever.co/${leverSite}/${id}`;
}

export async function detectLever(company: CompanyInput): Promise<DetectedConfig | null> {
  for (const candidate of buildCompanyCandidates(company)) {
    const siteCandidates = new Set<string>([
      slugify(candidate),
      hyphenSlug(candidate),
      candidate.trim().toLowerCase().replace(/\s+/g, ""),
    ]);

    for (const leverSite of siteCandidates) {
      if (!leverSite) continue;
      try {
        const response = await fetch(buildLeverApiUrl(leverSite), {
          headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
        });
        if (!response.ok) continue;
        const data = (await response.json()) as LeverJob[];
        if (Array.isArray(data)) return { source: "lever", leverSite, sampleUrl: company.sampleUrl };
      } catch {
        continue;
      }
    }
  }

  return null;
}

export async function validateLeverSite(leverSite: string, sampleUrl?: string): Promise<DetectedConfig | null> {
  try {
    const response = await fetch(buildLeverApiUrl(leverSite), {
      headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as LeverJob[];
    return Array.isArray(data) ? { source: "lever", leverSite, sampleUrl } : null;
  } catch {
    return null;
  }
}

export function parseLeverSampleUrl(sampleUrl: string): Pick<CompanyInput, "leverSite"> {
  try {
    return { leverSite: parseLeverSiteFromSampleUrl(sampleUrl) };
  } catch {
    return {};
  }
}

export async function fetchLeverJobs(
  companyName: string,
  leverSite: string,
  signal?: AbortSignal
): Promise<JobPosting[]> {
  const response = await fetch(buildLeverApiUrl(leverSite), {
    headers: { "User-Agent": "career-jump/1.0", Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Lever fetch failed for ${companyName}: ${response.status}`);

  const jobs = (await response.json()) as LeverJob[];
  const rows = Array.isArray(jobs) ? jobs : [];

  return rows.map((job) => {
    const id = String(job.id ?? "").trim() || slugify(`${job.text ?? "lever"}-${job.hostedUrl ?? ""}`);
    return {
      source: "lever",
      company: companyName,
      id,
      title: String(job.text ?? "").trim(),
      location: buildLeverLocation(job),
      url: buildLeverUrl(job, leverSite, id),
      postedAt: typeof job.createdAt === "number" ? normalizePostedAtValue(new Date(job.createdAt).toISOString()) : undefined,
    };
  });
}
