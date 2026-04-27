import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";

/**
 * Workable adapter.
 * Public widget API: https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
 * Each posting: https://apply.workable.com/{slug}/j/{shortcode}/
 */

type WorkableJob = {
  id?: string;
  shortcode?: string;
  title?: string;
  city?: string;
  state?: string;
  country?: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  department?: string;
  function?: string;
  published_on?: string;
  created_at?: string;
};

type WorkableResponse = {
  name?: string;
  jobs?: WorkableJob[];
};

const HEADERS = { Accept: "application/json" };

function api(slug: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
}

export async function validateWorkableSlug(slug: string): Promise<{ source: "workable"; companySlug: string } | null> {
  const r = await atsJson<WorkableResponse>(api(slug), { headers: HEADERS });
  return r && Array.isArray(r.jobs) ? { source: "workable", companySlug: slug } : null;
}

export async function countWorkableJobs(slug: string): Promise<number> {
  const r = await atsJson<WorkableResponse>(api(slug), { headers: HEADERS });
  return r?.jobs?.length ?? 0;
}

export async function fetchWorkableJobs(slug: string, companyName: string): Promise<JobPosting[]> {
  const r = await atsJson<WorkableResponse>(api(slug), { headers: HEADERS });
  if (!r?.jobs) return [];
  return r.jobs
    .map((j) => {
      const id = String(j.id ?? j.shortcode ?? "");
      if (!id) return null;
      const url = j.shortlink ?? j.application_url ?? j.url ?? `https://apply.workable.com/${slug}/j/${j.shortcode}/`;
      const location = [j.city, j.state, j.country].filter(Boolean).join(", ");
      return {
        id,
        title: j.title ?? "",
        company: companyName,
        location,
        url,
        source: "workable" as never,
        department: j.department ?? j.function,
        postedAt: j.published_on ?? j.created_at,
      } as JobPosting;
    })
    .filter((x): x is JobPosting => x !== null);
}
